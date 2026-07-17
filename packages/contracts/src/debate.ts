import { z } from 'zod';

/**
 * Council debate-transcript contract (issue #348 — the P1 foundation slice).
 *
 * A Council run is a governed multi-agent debate: heterogeneous "seats" (each a
 * provider session) emit onto a MODERATED bus, scoped by stage, and a conductor
 * — an orchestrator, never a peer — owns turn-taking and routing. The bus write
 * path is the conductor's alone; seats have zero authority to write into each
 * other's context (safety non-negotiable #1, the injection firewall). Every write
 * is recorded as one immutable {@link DebateTranscriptEntry}, so the whole run is
 * auditable and replayable in order (safety non-negotiable #7).
 *
 * This is the SINGLE SOURCE OF TRUTH for the transcript-entry shape the engine's
 * append-only store persists AND the `nc:debate` Tauri channel carries (see
 * `CHANNELS.debate`). It is the DATA-MODEL contract the store consumes directly; the
 * WIRE event that rides the zod→Rust event-union codegen is {@link DebateEntryEvent}
 * below, which wraps one entry with its council-run id. The canvas emit seam (#352)
 * emits a `debate-entry` event per appended entry: engine `CouncilManager.emit` →
 * sidecar stdout → Rust `reader.rs` → `DEBATE_EVENT` channel → web bridge.
 */

/**
 * The Council state-machine stage a transcript entry belongs to. Mirrors the
 * design's `Frame → Propose → Debate → Converge → Build → Review` loop; the bus is
 * scoped by stage so an entry always records which phase produced it.
 */
export const DebateStageSchema = z.enum([
  'frame',
  'propose',
  'debate',
  'converge',
  'build',
  'review',
]);
export type DebateStage = z.infer<typeof DebateStageSchema>;

/**
 * The asymmetric role of the author of a transcript entry. Asymmetric roles
 * (proposer vs. adversary/critic vs. judge) are what make debate produce genuine
 * disagreement rather than an echo. `conductor` is the moderator/orchestrator that
 * owns every write; `human` is the terminal judge (the human gavel).
 */
export const DebateSeatRoleSchema = z.enum([
  'proposer',
  'critic',
  'judge',
  'conductor',
  'human',
]);
export type DebateSeatRole = z.infer<typeof DebateSeatRoleSchema>;

/**
 * What kind of write produced this entry:
 *  - `broadcast` — a conductor prompt sent to all seats at once (mints a
 *    `broadcastId` the replies carry).
 *  - `message` — a seat's own contribution onto the bus (a proposal/critique;
 *    `role` distinguishes which).
 *  - `delivery` — a QUOTED-UNTRUSTED inter-seat message: another seat's text
 *    relayed as data (`Seat B said: "…"`), injection-scanned before delivery, never
 *    an instruction. `injectionFlags` records the scan result (safety #2).
 *  - `note` — a conductor/system annotation (a stage transition, a moderation note).
 */
export const DebateEntryKindSchema = z.enum([
  'broadcast',
  'message',
  'delivery',
  'note',
]);
export type DebateEntryKind = z.infer<typeof DebateEntryKindSchema>;

/**
 * One immutable entry in a council run's append-only transcript. Keyed in the
 * store by its council-run id (so the entry does NOT carry that id). `seq` is a
 * per-run monotonic index the store assigns on append; an ordered read by `seq`
 * reconstructs the exact sequence for replay (safety #7). Entries are NEVER mutated
 * or deleted — append-only is a hard invariant.
 */
export const DebateTranscriptEntrySchema = z.object({
  /** The state-machine stage this entry belongs to (the bus is stage-scoped). */
  stage: DebateStageSchema,
  /** The authoring seat's id, or the conductor's id for `broadcast`/`note`. For a
   *  `delivery`, the SOURCE seat whose text is being relayed as quoted data. */
  seatId: z.string(),
  /** The author's asymmetric role. */
  role: DebateSeatRoleSchema,
  /** What kind of write produced the entry. */
  kind: DebateEntryKindSchema,
  /** Store-assigned per-run monotonic sequence — the replay ordering key. */
  seq: z.number().int().nonnegative(),
  /** The entry's text. For a `delivery`, the QUOTED, injection-scanned rendering
   *  (never a bare instruction). */
  content: z.string(),
  /** Present on a `broadcast` and every reply linked to it: the shared broadcast id
   *  that groups one broadcast's side-by-side replies. Absent otherwise. */
  broadcastId: z.string().optional(),
  /** Store-assigned append timestamp (epoch ms) — audit metadata. */
  at: z.number().int().nonnegative(),
  /** The injection-scan reasons for a `delivery` entry: PRESENT (possibly empty =
   *  scanned-clean) on every inter-seat delivery, ABSENT on non-delivery entries.
   *  Records that safety #2's scan ran and what it found. */
  injectionFlags: z.array(z.string()).optional(),
});
export type DebateTranscriptEntry = z.infer<typeof DebateTranscriptEntrySchema>;

/**
 * The `nc:debate` WIRE event: one appended {@link DebateTranscriptEntry} tagged with
 * the council run it belongs to. A member of the `NightcoreEvent` union, so it flows
 * the SAME engine → sidecar → Rust `reader.rs` path every other `nc:*` family event
 * uses; the reader forwards it verbatim onto the `DEBATE_EVENT` channel, where the web
 * bridge narrows and folds it into the canvas (the emit seam, #352). The entry carries
 * no run id of its own (the store keys it externally), so `runId` rides HERE — it is
 * the correlation key the canvas filters a run's stream by. Unlike every session-stream
 * event it has NO `sessionId`: a council run correlates by `runId`, like the scan
 * families, so the reader routes it BEFORE the session-id correlation.
 */
export const DebateEntryEvent = z.object({
  type: z.literal('debate-entry'),
  /** The council run this transcript entry belongs to (the canvas correlation key). */
  runId: z.string(),
  /** The append-only transcript entry the engine just recorded. */
  entry: DebateTranscriptEntrySchema,
});
export type DebateEntryEvent = z.infer<typeof DebateEntryEvent>;

/**
 * The three worktree operations a build-capable Council's in-engine driver asks the
 * Rust host to perform on its behalf (issue #383) — the ONLY verbs the engine↔host
 * worktree seam exposes:
 *  - `allocate` — allocate the run's isolated worktree (the elected writer's cwd + the
 *    objective gate's run dir).
 *  - `commit`   — persist the writer's edits onto the run's `nc/<runId>` branch so the
 *    human has something to merge (never a merge — merge/discard stay human-only).
 *  - `gauntlet` — run the deterministic Structure-Lock gate over the worktree (safety
 *    #6). The host loads the manifest from the TRUSTED project root and runs the checks
 *    in the worktree, reusing the board's audited gauntlet — no new engine exec sink.
 * The op is a CLOSED enum so a compromised engine can never name an unknown verb.
 */
export const WorktreeOpKindSchema = z.enum(['allocate', 'commit', 'gauntlet']);
export type WorktreeOpKind = z.infer<typeof WorktreeOpKindSchema>;

/**
 * The engine → host worktree-op REQUEST (issue #383) — the ONE new outbound event the
 * write-capable Council `SessionBuildDriver` / objective gate emit to reach Rust's
 * already-audited `crate::worktree` + Structure-Lock gauntlet across the sidecar process
 * boundary. It is deliberately PATH-LESS and keyed ONLY on `councilRunId`: the host
 * DERIVES the worktree path from the run id via `crate::worktree::path` against the
 * project root IT recorded at `start-council`, and NEVER trusts an engine-sent path. That
 * is what makes this a MESSAGE TYPE, not a write/exec sink — an injection-compromised
 * engine cannot redirect a worktree op outside `.nightcore/worktrees/<runId>`.
 *
 * Correlated by `requestId` back to the awaiting engine call via the resolving
 * `resolve-worktree-op` command — modeled on the parked-permission seam. Carries NO
 * `sessionId`: like `debate-entry`, it correlates by `councilRunId`, so the reader routes
 * it BEFORE the session-id correlation and consumes it internally (never forwarded to the
 * web — it rides no `nc:*` channel).
 */
export const WorktreeOpRequiredEvent = z.object({
  type: z.literal('worktree-op-required'),
  /** The correlation id the resolving `resolve-worktree-op` command echoes back. */
  requestId: z.string(),
  /** Which worktree verb to perform — a closed enum (never a caller-supplied path). */
  op: WorktreeOpKindSchema,
  /** The council run the op is scoped to. The host maps THIS to the trusted project root
   *  it recorded at `start-council` and derives the worktree path from it — the sole
   *  input; no path ever crosses the wire (the escape guard, path.rs). */
  councilRunId: z.string(),
});
export type WorktreeOpRequiredEvent = z.infer<typeof WorktreeOpRequiredEvent>;
