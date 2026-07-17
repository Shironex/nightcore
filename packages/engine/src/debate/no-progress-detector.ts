/**
 * The Council NO-PROGRESS (stall) detector — issue #372, P2 convergence quality.
 *
 * Complements the #350 stability early-stop, which catches AGREEMENT — a Debate round
 * that changes nothing (every seat restates its exact prior output), so the debate has
 * stopped moving. This detector catches the OPPOSITE failure: unproductive CHURN. Seats
 * keep revising round after round — so nothing ever "stabilizes" — yet they only reshuffle
 * positions ALREADY on the table, adding no NEW distinct position. Left to the hard caps
 * that churn burns the whole round/token/cost budget for zero new information; the detector
 * ends the debate the moment the churn is unmistakable and lets it fall through to Converge
 * (the human judge / objective gate), exactly as a stability stop does.
 *
 * DISTINCT-POSITION reuse (issue #353): a "position" is identified EXACTLY as the reply
 * diff identifies a distinct column — by its trim-normalized content ({@link
 * normalizePosition}), counted distinct with a `Set` ({@link distinctPositions}). This is
 * the SAME rule `apps/web` `reply-diff.ts` (`groupReplyRounds`/`diverged`) uses to tell a
 * round's columns apart; no new similarity model is invented, and the detector folds the
 * SAME per-round broadcast replies the reply diff groups.
 *
 * STRICT SHORTENER (safety non-negotiable #4): this can ONLY end the debate sooner. It
 * never grows the round budget — the {@link import('./conductor-budget.js').RunGovernor}'s
 * hard round/token/cost caps + the kill switch remain the sole outer bound. A detected
 * stall is a normal, halt-free completion, so the run proceeds to Converge unchanged.
 */

/** Normalize one seat's reply to its POSITION IDENTITY — the same rule the #353 reply
 *  diff uses to tell columns apart (trim-normalized content). Two replies are the "same
 *  position" iff they are identical after trimming; nothing fuzzier is inferred. */
export function normalizePosition(content: string): string {
  return content.trim();
}

/** The set of DISTINCT positions among a round's seat replies — the reply diff's
 *  distinct-column rule (issue #353), reused so the stall check and the canvas agree on
 *  what "a distinct position" is. */
export function distinctPositions(contents: Iterable<string>): Set<string> {
  const positions = new Set<string>();
  for (const content of contents) positions.add(normalizePosition(content));
  return positions;
}

/**
 * Default stall threshold: a stall requires this many CONSECUTIVE rounds that each add no
 * new distinct position. Two makes the trigger "successive rounds that restate prior ones"
 * (issue #372's wording), so a single consolidating round is never mistaken for churn.
 */
export const DEFAULT_NO_PROGRESS_ROUNDS = 2;

/**
 * Tracks the distinct positions a debate has produced and reports a STALL once the debate
 * churns for {@link DEFAULT_NO_PROGRESS_ROUNDS} (configurable) consecutive rounds without
 * adding a new one. Pure + deterministic: no clock, no I/O — driven entirely by the round
 * contents fed to {@link observeRound}.
 */
export class NoProgressDetector {
  /** Every distinct position seen so far (Propose seed + each completed round). */
  private readonly seen = new Set<string>();
  /** Consecutive no-new-position rounds observed. Reset the instant progress reappears. */
  private streak = 0;
  private readonly threshold: number;

  /**
   * @param seed The positions already on the table before Debate — the Propose outputs. A
   *   Debate round only makes progress by adding a position not already among these.
   * @param threshold Consecutive no-progress rounds that constitute a stall (clamped to
   *   `>= 1`). Defaults to {@link DEFAULT_NO_PROGRESS_ROUNDS}.
   */
  constructor(
    seed: Iterable<string> = [],
    threshold: number = DEFAULT_NO_PROGRESS_ROUNDS,
  ) {
    this.threshold = Math.max(1, Math.floor(threshold));
    for (const content of seed) this.seen.add(normalizePosition(content));
  }

  /**
   * Fold one completed Debate round's seat replies and report whether the debate has now
   * STALLED. A round that introduces at least one not-yet-seen distinct position is
   * progress (resets the streak to zero); a round that introduces none extends the streak.
   * A stall is declared once the streak reaches the threshold.
   *
   * Call this ONLY for a round that actually CHANGED — the #350 stability stop already ends
   * a round that changed nothing, so reaching here means the seats DID move. A stall here is
   * therefore specifically churn: movement without new information (distinct from agreement).
   */
  observeRound(contents: Iterable<string>): boolean {
    let addedNew = false;
    for (const content of contents) {
      const position = normalizePosition(content);
      if (!this.seen.has(position)) {
        this.seen.add(position);
        addedNew = true;
      }
    }
    this.streak = addedNew ? 0 : this.streak + 1;
    return this.streak >= this.threshold;
  }
}
