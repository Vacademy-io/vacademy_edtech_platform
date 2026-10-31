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
 *
 * A pasted post often brings its own `<style>` block (an AI draft, an
 * Elementor HTML widget). DOMPurify drops it, so the post rendered unstyled
 * while the same file looked right opened in a browser. The stylesheet is
 * now lifted out, scrubbed like a page block's CSS, and every selector is
 * scoped under the article body so it cannot restyle the rest of the site.
 */
import DOMPurify from "dompurify";
import { scrubCss, wrapBareColourTokens } from "./catalogue-html";

const MAX_HTML = 400_000;

/** The element BlogArticle renders the body into; post CSS is scoped to it. */
export const BLOG_CSS_SCOPE = ".catalogue-blog-article";

const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi;

/** Index just past the quoted string starting at `i`, or past the end. */
const skipString = (css: string, i: number): number => {
  const quote = css[i];
  for (let j = i + 1; j < css.length; j++) {
    if (css[j] === "\\") j++;
    else if (css[j] === quote) return j + 1;
  }
  return css.length;
};

/** Split on `sep` outside strings and brackets — `:is(a, b)` stays one selector. */
const splitTopLevel = (text: string, sep: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i = skipString(text, i) - 1;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
};

// :root / html / body (scrubCss's page mode turns the first two into :host)
// stand for the document; inside a post the article body is the document.
const DOC_ROOT_RE = /^(?:(?::root|:host|html|body)(?![\w-])\s*>?\s*)+/i;

const scopeSelector = (selector: string, scope: string): string => {
  const s = selector.trim();
  if (!s) return "";
  const root = s.match(DOC_ROOT_RE)?.[0];
  if (!root) return `${scope} ${s}`;
  const rest = s.slice(root.length);
  if (!rest) return scope;
  // `body.dark .x` keeps its qualifier on the scope; `body .x` descends.
  if (/>\s*$/.test(root)) return `${scope} > ${rest}`;
  return /\s$/.test(root) ? `${scope} ${rest}` : `${scope}${rest}`;
};

// Group rules whose bodies hold more rules; everything else starting with @
// (keyframes, font-face, property, page) is kept as written.
const GROUP_AT_RULE_RE = /^@(media|supports|container|layer|document)\b/i;

/** Prefix every style rule's selectors with `scope`, recursing into @media & co. */
export const scopeBlogCss = (css: string, scope: string = BLOG_CSS_SCOPE): string => {
  let out = "";
  let i = 0;
  while (i < css.length) {
    let j = i;
    let depth = 0;
    while (j < css.length && !(depth === 0 && (css[j] === "{" || css[j] === ";"))) {
      if (css[j] === '"' || css[j] === "'") {
        j = skipString(css, j);
        continue;
      }
      if (css[j] === "(") depth++;
      else if (css[j] === ")") depth = Math.max(0, depth - 1);
      j++;
    }
    const prelude = css.slice(i, j).trim();
    if (j >= css.length) break; // trailing junk without a block
    if (css[j] === ";") {
      // A bare at-statement (`@layer a, b;`); a stray declaration is dropped.
      if (prelude.startsWith("@")) out += `${prelude};`;
      i = j + 1;
      continue;
    }
    let k = j + 1;
    for (let open = 1; k < css.length && open > 0; k++) {
      if (css[k] === '"' || css[k] === "'") {
        k = skipString(css, k) - 1;
      } else if (css[k] === "{") open++;
      else if (css[k] === "}") open--;
    }
    const body = css.slice(j + 1, Math.max(j + 1, k - 1));
    if (GROUP_AT_RULE_RE.test(prelude) && !/^@layer\b[^{]*,/.test(prelude)) {
      out += `${prelude}{${scopeBlogCss(body, scope)}}`;
    } else if (prelude.startsWith("@")) {
      out += `${prelude}{${body}}`;
    } else if (prelude) {
      const selectors = splitTopLevel(prelude, ",")
        .map((sel) => scopeSelector(sel, scope))
        .filter(Boolean);
      if (selectors.length) out += `${selectors.join(",")}{${body}}`;
    }
    i = k;
  }
  return out;
};

/** The post's own `<style>` blocks, scrubbed and scoped; "" when it has none. */
const extractBlogCss = (html: string): { html: string; css: string } => {
  const sheets: string[] = [];
  const rest = html.replace(STYLE_BLOCK_RE, (_m, css: string) => {
    sheets.push(css);
    return "";
  });
  if (!sheets.length) return { html, css: "" };
  return { html: rest, css: scopeBlogCss(scrubCss(wrapBareColourTokens(sheets.join("\n")), true)) };
};

const ALLOWED_TAGS = [
  "a", "abbr", "article", "aside", "b", "blockquote", "br", "caption", "cite",
  "code", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption",
  "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i",
  "iframe", "img", "ins", "kbd", "li", "main", "mark", "ol", "p", "pre", "q",
  "s", "section", "small",
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

export const sanitizeBlogHtml = (html: string): string => sanitizeToDom(extractBlogCss(html || "").html).innerHTML;

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
 * "forms" from shadowing a document property. `css` is the post's own
 * stylesheet, already scoped to BLOG_CSS_SCOPE ("" when it has none).
 */
export const sanitizeBlogArticle = (html: string): { html: string; css: string; headings: BlogHeading[] } => {
  const own = extractBlogCss(html || "");
  const body = sanitizeToDom(own.html);
  const used = new Set<string>();
  const headings: BlogHeading[] = [];
  body.querySelectorAll("h2, h3").forEach((h) => {
    // A number badge (`<span>1</span>What is…`) has no space after it in
    // textContent, so the contents would read "1What is…".
    const badge = h.firstElementChild;
    const text = (
      badge && h.firstChild === badge && /^\s*[\d.)]+\s*$/.test(badge.textContent || "")
        ? `${(badge.textContent || "").trim()} ${(h.textContent || "").slice((badge.textContent || "").length)}`
        : h.textContent || ""
    )
      .replace(/\s+/g, " ")
      .trim();
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
  return { html: body.innerHTML, css: own.css, headings };
};

/** Plain-text preview of a body, for cards that have no excerpt. */
export const blogPlainText = (html: string, max = 180): string => {
  const text = (html || "")
    .replace(/<(style|script)\b[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};
