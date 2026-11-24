// Test helper for the preset editor replays: the follow-up fixes after the rebuild change a few recorded steps on
// purpose. The recordings stay as the old editor produced them; each replay spec lists the steps a fix changes and the
// exact values that change, and the replay compares against the recording with those values swapped in.

type Path = ReadonlyArray<string | number>;
/**
 * One changed value: where it is in the resolved recorded step, and the value the fixed editor shows instead (or a
 * function from the recorded value to it, for edits like "the same list without the bar's buttons").
 */
export type Change = readonly [path: Path, value: unknown];

/** A change value that maps the recorded value instead of replacing it. */
export function mapRecorded<T>(map: (recorded: T) => T): (recorded: unknown) => unknown {
  return map as (recorded: unknown) => unknown;
}

/** A change for a text value: the recorded text with `from` (which must be in it) replaced by `to`. */
export function replaceText(from: string, to: string): (recorded: unknown) => unknown {
  return (recorded) => {
    if (typeof recorded !== "string" || !recorded.includes(from))
      throw new Error(`recorded text lacks ${JSON.stringify(from)}`);
    return recorded.replace(from, to);
  };
}

export interface IntendedChange {
  /** The follow-up(s) the change closes, as numbered in the module's spec. */
  followUps: string;
  /** Step index → the values that step changes. */
  steps: Readonly<Record<number, ReadonlyArray<Change>>>;
}

function read(target: unknown, path: Path): unknown {
  let current = target;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/**
 * The recorded step with `changes` applied (on a copy; recordings share pooled objects). Every change must replace a
 * value that is in the recording and differs from it, so a stale entry fails instead of passing quietly.
 */
export function withIntendedChanges<T>(recorded: T, changes: ReadonlyArray<Change> | undefined, label: string): T {
  if (!changes?.length) return recorded;
  const copy = structuredClone(recorded);
  for (const [path, value] of changes) {
    const parent = read(copy, path.slice(0, -1));
    const key = path.at(-1)!;
    if (typeof parent !== "object" || parent === null || !(key in parent)) {
      throw new Error(`${label}: intended change at ${JSON.stringify(path)} has no recorded value`);
    }
    const before = (parent as Record<string | number, unknown>)[key];
    const after = typeof value === "function" ? (value as (recorded: unknown) => unknown)(before) : value;
    if (JSON.stringify(before) === JSON.stringify(after)) {
      throw new Error(`${label}: intended change at ${JSON.stringify(path)} equals the recording`);
    }
    (parent as Record<string | number, unknown>)[key] = structuredClone(after);
  }
  return copy;
}

/** Every intended step must exist in its scenario; returns the steps' change lists by index. */
export function intendedStepsFor(
  table: Readonly<Record<string, IntendedChange>>,
  scenarioId: string,
  stepCount: number,
): Readonly<Record<number, ReadonlyArray<Change>>> {
  const entry = table[scenarioId];
  if (!entry) return {};
  for (const index of Object.keys(entry.steps)) {
    if (Number(index) >= stepCount) throw new Error(`${scenarioId}: intended step ${index} is past the recording`);
  }
  return entry.steps;
}
