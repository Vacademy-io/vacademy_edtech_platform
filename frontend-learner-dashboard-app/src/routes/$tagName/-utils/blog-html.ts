/**
 * Blog post body sanitiser.
 *
 * A post body is authored HTML — the dashboard's visual editor, pasted HTML,
 * or an AI app over MCP — and renders on the learner domain, so it goes
 * through DOMPurify at render time like every other custom HTML on a
 * catalogue site (catalogue-html.ts). The profile is wider than a page
 * section's because an article legitimately carries what a marketing block
 * does not: images with captions, tables, code, and embedded video. Scripts,
 * forms, inline event handlers and unknown iframe hosts stay out.
 */
import DOMPurify from "dompurify";

const MAX_HTML = 400_000;

const ALLOWED_TAGS = [
  "a", "abbr", "article", "aside", "b", "blockquote", "br", "caption", "cite",
  "code", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption",
  "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "iframe", "img",
  "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "section", "small",
  "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot",
  "th", "thead", "time", "tr", "u", "ul", "video", "source", "audio",
];

const ALLOWED_ATTR = [
  "class", "id", "style", "title", "role", "aria-label", "aria-hidden",
  "href", "target", "rel",
  "src", "alt", "width", "height", "loading", "srcset", "sizes",
  "datetime", "colspan", "rowspan", "scope", "start", "type",
  "controls", "poster", "preload", "muted", "playsinline",
  "allow", "allowfullscreen", "frameborder", "referrerpolicy",
];

/** Video embeds are the one iframe use an article needs; nothing else gets a frame. */
const EMBED_HOST_RE =
  /^https:\/\/(www\.)?(youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/)/i;

const sanitizeToDom = (html: string): HTMLElement => {
  // RETURN_DOM rather than DOMPurify hooks: hooks are registered on the
  // global instance that catalogue-html.ts shares, and a link/iframe rule
  // added here would silently change how every htmlBlock renders too.
  const body = DOMPurify.sanitize((html || "").slice(0, MAX_HTML), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM: true,
  }) as unknown as HTMLElement;

  body.querySelectorAll("iframe").forEach((frame) => {
    if (!EMBED_HOST_RE.test(frame.getAttribute("src") || "")) {
      frame.remove();
      return;
    }
    // A pasted embed rarely sets these; without them the frame is a fixed
    // 560×315 box, so the article's CSS sizes it via .catalogue-blog-article.
    frame.setAttribute("loading", "lazy");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  });
  body.querySelectorAll("a[href]").forEach((a) => {
    if (/^https?:\/\//i.test(a.getAttribute("href") || "")) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  });
  body.querySelectorAll("img").forEach((img) => {
    if (!img.getAttribute("loading")) img.setAttribute("loading", "lazy");
  });
  return body;
};

export const sanitizeBlogHtml = (html: string): string => sanitizeToDom(html).innerHTML;

export interface BlogHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

/** "Why NEET?" → "toc-why-neet"; letters of any script survive (Hindi titles). */
const headingId = (text: string) => {
  const s = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `toc-${s || "section"}`;
};

/**
 * The sanitised body plus its H2/H3 outline, for the table of contents. Every
 * H2/H3 gets an id the contents can link to: an authored id is kept (in-article
 * links may point at it), otherwise one is made from the heading text and
 * de-duplicated. The `toc-` prefix keeps a heading called "location" or
 * "forms" from shadowing a document property.
 */
export const sanitizeBlogArticle = (html: string): { html: string; headings: BlogHeading[] } => {
  const body = sanitizeToDom(html);
  const used = new Set<string>();
  const headings: BlogHeading[] = [];
  body.querySelectorAll("h2, h3").forEach((h) => {
    const text = (h.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    let id = h.getAttribute("id") || "";
    if (!id || used.has(id)) {
      const base = headingId(text);
      id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      h.setAttribute("id", id);
    }
    used.add(id);
    headings.push({ id, text, level: h.tagName === "H2" ? 2 : 3 });
  });
  return { html: body.innerHTML, headings };
};

/** Plain-text preview of a body, for cards that have no excerpt. */
export const blogPlainText = (html: string, max = 180): string => {
  const text = (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};
