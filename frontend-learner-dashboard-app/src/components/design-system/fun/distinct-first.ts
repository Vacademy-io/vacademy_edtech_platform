/*
 * The line under a course tile or Learn row is one line, cut with an ellipsis on a
 * narrow card. When rows share a course name, that line is what tells them apart, so
 * the part that differs between them goes first and the part they all share goes
 * last: "2026-27 · Class 12 Science" rather than "Class 12 Science · 2026-27", whose
 * session is the first thing a phone tile cuts.
 */

const fold = (text: string) => text.trim().toLocaleLowerCase();

/**
 * Each row's parts, in the same order, except that a part every row of the group
 * also has (case and spaces ignored) moves after the parts that differ. Pass the
 * parts of one group of rows that share a name; a group of one is left as it is.
 */
export function distinctPartsFirst(group: ReadonlyArray<ReadonlyArray<string>>): string[][] {
  if (group.length < 2) return group.map((parts) => [...parts]);
  const sharedByAll = (part: string) => group.every((parts) => parts.some((other) => fold(other) === fold(part)));
  return group.map((parts) => [
    ...parts.filter((part) => !sharedByAll(part)),
    ...parts.filter((part) => sharedByAll(part)),
  ]);
}
