/**
 * Where a link the assistant sent may go. Hrefs come from model output, so
 * nothing is trusted: only an in-app path or an https URL becomes clickable.
 */
export type ChatHrefTarget =
  | { kind: "internal"; href: string }
  | { kind: "external"; href: string }
  | { kind: "none" };

interface ClassifyOptions {
  /**
   * Markdown links in replies also accept http:// and mailto: (they rendered
   * as plain anchors before). Cards accept only "/..." and "https://...".
   */
  lenient?: boolean;
}

export const classifyHref = (
  href: unknown,
  { lenient = false }: ClassifyOptions = {},
): ChatHrefTarget => {
  if (typeof href !== "string") return { kind: "none" };
  const value = href.trim();
  if (!value) return { kind: "none" };

  // "?x=1" keeps the learner on this page with extra params (e.g. ?openQueries=1).
  if (value.startsWith("?")) return { kind: "internal", href: value };

  // "/path?x=1" is an app route; "//host" and "/\host" are protocol-relative
  // URLs to another site in every browser, so they are not.
  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.startsWith("/\\")) return { kind: "none" };
    return { kind: "internal", href: value };
  }

  const lower = value.toLowerCase();
  if (lower.startsWith("https://") || (lenient && lower.startsWith("http://"))) {
    try {
      // Reject strings that only look like URLs ("https://" alone, spaces...).
      new URL(value);
      return { kind: "external", href: value };
    } catch {
      return { kind: "none" };
    }
  }

  if (lenient && lower.startsWith("mailto:")) return { kind: "external", href: value };

  return { kind: "none" };
};
