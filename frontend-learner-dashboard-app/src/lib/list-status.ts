/**
 * The one rule for a list that comes from the server: what to show is decided by
 * how the request ended, never by the list merely being empty.
 *
 * `undefined` means no request has been made yet, which is still "loading": the
 * first paint happens before any effect has run, and nothing is known at that point.
 */
export type RequestStatus = "loading" | "error" | "success";

export type ListView = "loading" | "error" | "empty" | "data";

export function resolveListView(
  status: RequestStatus | undefined,
  itemCount: number
): ListView {
  if (status === "error") return "error";
  if (status !== "success") return "loading";
  return itemCount > 0 ? "data" : "empty";
}

/**
 * Reads a page of results out of a 200 answer. A body with no list in it, such as
 * a wifi sign-in page, is a failed request: this throws so the caller's error path
 * handles it, instead of the screen reading it as an empty list.
 */
export function requireListPage<T extends { content: unknown[] }>(body: unknown): T {
  const content = (body as { content?: unknown } | null | undefined)?.content;
  if (!Array.isArray(content)) throw new Error("Unexpected list response");
  return body as T;
}
