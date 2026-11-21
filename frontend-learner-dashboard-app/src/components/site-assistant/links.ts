/**
 * Every href the assistant shows comes from model-driven tool output, so it
 * is treated as untrusted: SPEC §4.4 allows https or site-relative only.
 * Anything else (javascript:, data:, protocol-relative "//host", http:,
 * mailto: spelled into a card field…) is dropped, never rendered.
 */
export const safeHref = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const href = raw.trim();
  if (!href) return null;
  // Control characters and whitespace inside a URL are how scheme filters get dodged.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s\\]/.test(href)) return null;
  if (href.startsWith("/")) return href.startsWith("//") ? null : href;
  if (href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/** Only https images (no data:/http mixed content, no tracking via odd schemes). */
export const safeImageUrl = (raw: unknown): string | null => {
  const href = safeHref(raw);
  return href && href.startsWith("https://") ? href : null;
};

export type LinkTarget =
  /** A page of this hosted site: navigate with the router. */
  | { kind: "internal"; path: string }
  /** A page of the embedding site: the loader navigates the parent window. */
  | { kind: "parent"; url: string }
  /** Anywhere else: a normal link in a new tab. */
  | { kind: "external"; url: string };

export interface HostedLinkContext {
  mode: "hosted";
  /** window.location.origin of the hosted site. */
  origin: string;
  /** "/<tag>" for a classic site, "" when the site is mounted at the host's root. */
  basePath: string;
}

export interface EmbedLinkContext {
  mode: "embed";
  /** Origin of the page that embedded the assistant (recorded at the handshake). */
  parentOrigin: string;
}

const withBase = (path: string, basePath: string): string => {
  if (!basePath) return path;
  if (path === basePath || path.startsWith(`${basePath}/`) || path.startsWith(`${basePath}?`) || path.startsWith(`${basePath}#`)) {
    return path;
  }
  return path === "/" ? basePath : `${basePath}${path}`;
};

/**
 * Where a (sanitised) href leads. Site-relative hrefs are relative to the
 * SITE: on a hosted classic site ("/<tag>/…") the tag base is added unless the
 * href already carries it; in the embed they resolve against the embedding
 * page's origin. Absolute https links on the same origin are treated like
 * relative ones.
 */
export const classifyHref = (
  raw: unknown,
  ctx: HostedLinkContext | EmbedLinkContext,
): LinkTarget | null => {
  const href = safeHref(raw);
  if (!href) return null;
  if (ctx.mode === "hosted") {
    if (href.startsWith("/")) return { kind: "internal", path: withBase(href, ctx.basePath) };
    if (href.startsWith("#")) return { kind: "internal", path: href };
    const url = new URL(href);
    if (url.origin === ctx.origin) return { kind: "internal", path: `${url.pathname}${url.search}${url.hash}` };
    return { kind: "external", url: href };
  }
  if (!ctx.parentOrigin) return href.startsWith("https://") ? { kind: "external", url: href } : null;
  const parentUrl = href.startsWith("/") || href.startsWith("#") ? new URL(href, ctx.parentOrigin).toString() : href;
  if (new URL(parentUrl).origin === ctx.parentOrigin) return { kind: "parent", url: parentUrl };
  return { kind: "external", url: parentUrl };
};
