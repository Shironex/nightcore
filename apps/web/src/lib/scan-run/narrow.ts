/**
 * Enum-narrowing guards for the persisted-run → view-model mappers (the
 * `streamFrom*` / `storedTo*` functions in every `*-stream.ts`).
 *
 * WHY: those mappers read string-typed fields off the on-disk `Stored*` shapes —
 * ts-rs emits a plain `string` for every Rust enum, not the TypeScript union — and
 * historically narrowed them with an UNVALIDATED `as` cast (`f.severity as
 * Finding['severity']`). The engine guarantees valid values on WRITE, so a
 * well-formed store round-trips byte-for-byte unchanged. But a corrupted on-disk
 * store, or future enum drift (a contract member renamed/removed while old runs
 * persist the old spelling), would inject an invalid union value straight into the
 * UI — the `as` cast lies to the type system and the bad value propagates. Routing
 * every such cast through `safeParse` makes a bad value degrade to a documented,
 * least-alarming fallback (or get dropped, for list fields) instead. This guards the
 * READ; it is NOT a substitute for the engine's write-time validation.
 *
 * The guards are typed STRUCTURALLY (a minimal `{ safeParse }` shape), not against
 * `zod`'s `ZodType<T>`, so the web bundle keeps its single schema-import surface on
 * `@nightcore/contracts` and takes no direct `zod` dependency. Every contract enum
 * schema (`FindingSeveritySchema`, …) satisfies this shape as-is; web-local unions
 * that have no contract schema (the lifecycle `status` fields) mint the same shape
 * via {@link enumGuard}, again without importing `zod`.
 */

/** The minimal slice of a zod schema these guards consume — the discriminated
 *  `safeParse` result. Both contract enum schemas and {@link enumGuard} results
 *  satisfy it, and `T` infers from the success branch's `data`. */
export interface Narrowable<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/**
 * Narrow an `unknown` (a ts-rs–persisted enum string) to the schema's union,
 * returning `fallback` when the value isn't a member. `T` is inferred from the
 * schema; `fallback` is `NoInfer<T>` so it does NOT widen the inference — passing a
 * fallback that isn't a valid member is a compile error, keeping the documented
 * default honest.
 */
export function narrowOr<T>(
  schema: Narrowable<T>,
  value: unknown,
  fallback: NoInfer<T>,
): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

/**
 * Narrow a persisted array of `unknown` (e.g. a run's `categories` / `lenses` /
 * `dimensions`, or a finding's `corroboratedBy`) to the schema's union, DROPPING any
 * element that isn't a member. Unlike {@link narrowOr} there is no fabricated
 * fallback — an unknown step is simply omitted rather than invented, so the stepper
 * never shows a bogus lens.
 */
export function narrowMembers<T>(
  schema: Narrowable<T>,
  values: readonly unknown[],
): T[] {
  const out: T[] = [];
  for (const value of values) {
    const parsed = schema.safeParse(value);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Mint a {@link Narrowable} for a web-local string union that has no `@nightcore/
 * contracts` zod schema (the lifecycle `status` fields — `FindingStatus`,
 * `ArtifactStatus`, `ProposalStatus`, `ReadingStatus` — are declared as bare TS
 * unions in each feature's `.types.ts`). Backs the same `safeParse` interface with a
 * membership `Set`, so these unions guard identically to the contract enums WITHOUT
 * pulling `zod` into the web bundle. Pass the union's members as a `const` tuple that
 * mirrors the type exactly — do not invent members.
 */
export function enumGuard<const T extends readonly string[]>(
  members: T,
): Narrowable<T[number]> {
  const set: ReadonlySet<string> = new Set(members);
  return {
    safeParse: (value) =>
      typeof value === 'string' && set.has(value)
        ? { success: true, data: value as T[number] }
        : { success: false },
  };
}
