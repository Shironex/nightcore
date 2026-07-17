/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import {
  AutonomyNotPermittedError,
  GovernanceNotSupportedError,
} from '../providers/agent-provider.js';
import { refusalEvent } from './session-preflight-refusal.js';

describe('refusalEvent — preflight refusal → terminal session-failed', () => {
  test('maps an autonomy refusal to session-failed', () => {
    const event = refusalEvent(
      7,
      new AutonomyNotPermittedError('fake', 'bypass'),
      false,
      undefined,
    );
    expect(event).not.toBeNull();
    expect(event?.type).toBe('session-failed');
    expect(event?.sessionId).toBe(7);
    expect(event?.reason).toBe('runner-crash');
    // A BOARD refusal carries NO council marker — its session-failed still correlates.
    expect(event?.council).toBeUndefined();
  });

  test('maps a governance refusal to session-failed', () => {
    const event = refusalEvent(
      8,
      new GovernanceNotSupportedError('fake'),
      false,
      undefined,
    );
    expect(event?.type).toBe('session-failed');
    expect(event?.council).toBeUndefined();
  });

  test('echoes the council marker onto a refused SEAT terminal (issue #374)', () => {
    // A refused council seat emits ONLY this session-failed; the marker must ride it so the
    // reader skips board-FIFO correlation (else it pops a concurrent board task's slot).
    const event = refusalEvent(
      9,
      new AutonomyNotPermittedError('fake', 'auto-accept'),
      true,
      undefined,
    );
    expect(event?.council).toBe(true);
  });

  test('returns null for a NON-refusal error so the caller rethrows', () => {
    expect(refusalEvent(10, new Error('some other crash'), false, undefined)).toBeNull();
    // Even a council seat: a non-refusal error is not a preflight refusal.
    expect(refusalEvent(11, new TypeError('boom'), true, undefined)).toBeNull();
  });
});
