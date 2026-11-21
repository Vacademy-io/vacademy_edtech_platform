import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge taught this app's design tokens. Stock tailwind-merge reads
 * the custom type sizes (`text-caption`, `text-body`, ...) as text COLOURS, so
 * `cn("text-caption text-muted-foreground")` silently dropped one of them —
 * 42 class lists across the app rendered at the wrong size or colour (form
 * hints and errors, chips, cards, chatbot chips). Same token list as the
 * engagement module's `ecn()`, which hit this first.
 */
const mergeClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "h1",
            "h2",
            "h3",
            "h1-semibold",
            "h2-semibold",
            "h3-semibold",
            "title",
            "subtitle",
            "body",
            "caption",
            "display",
            "display-sm",
            "2xs",
            "3xs",
            "play-badge",
          ],
        },
      ],
      p: [{ p: ["card", "card-lg", "page"] }],
      gap: [{ gap: ["stack", "section"] }],
      h: [{ h: ["control"] }],
      "min-h": [{ "min-h": ["control"] }],
      rounded: [{ rounded: ["play-card", "play-card-sm", "play-btn"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs));
}

export function isNullOrEmptyOrUndefined<T>(
  value: T | null | undefined
): value is null | undefined {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value === "")
  );
}

export function convertCapitalToTitleCase(str: string) {
  // Split the text into words
  const words = str?.split(" ");

  // Capitalize the first letter of each word and convert the rest to lowercase
  const titleCaseWords = words?.map(
    (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );

  // Join the words back into a string
  const titleCaseText = titleCaseWords?.join(" ");

  return titleCaseText;
}

export function parseHtmlToString(html: string) {
  if (!html) return "";
  // Decode HTML entities (handles double-encoded content like &lt;span&gt;)
  const decoded = decodeHtmlEntities(html);
  // Parse and extract clean text, handling KaTeX/MathML
  return extractCleanText(decoded);
}

/**
 * Returns true when a rich-text/HTML value has no visible content — e.g. "",
 * "<p></p>", "<p><br></p>", "&nbsp;", or whitespace-only markup that a TipTap/
 * rich-text editor emits for an empty field. Media-only content (img, video,
 * iframe, audio, svg) counts as non-empty so we never hide a real explanation.
 * Use this instead of a bare `!html` truthiness check before rendering an
 * "Explanation" / rich-text box. (`\s` matches the &nbsp; codepoint too.)
 */
export function isRichTextEmpty(html?: string | null): boolean {
  if (!html) return true;
  if (/<(img|video|iframe|audio|svg)[\s/>]/i.test(html)) return false;
  return /^\s*$/.test(parseHtmlToString(html));
}

/**
 * Decodes HTML entities repeatedly until stable.
 * Handles double-encoded content like &amp;lt;span&amp;gt; → <span>
 */
function decodeHtmlEntities(text: string): string {
  if (!text) return "";
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  let decoded = textarea.value;
  // Decode again if still has encoded entities
  if (decoded.includes("&lt;") || decoded.includes("&gt;") || decoded.includes("&amp;")) {
    textarea.innerHTML = decoded;
    decoded = textarea.value;
  }
  return decoded;
}

/**
 * Extracts clean readable text from HTML that may contain KaTeX/MathML.
 * For KaTeX: extracts data-latex attribute or annotation text.
 * For regular HTML: uses textContent.
 */
function extractCleanText(html: string): string {
  if (!html.includes("<")) return html;

  const doc = new DOMParser().parseFromString(html, "text/html");

  // Replace each math-inline or katex span with its LaTeX source
  const mathInlines = doc.querySelectorAll('span.math-inline, span.katex');
  mathInlines.forEach((el) => {
    // Try data-latex attribute first (most reliable)
    const latex = el.getAttribute("data-latex");
    if (latex) {
      el.replaceWith(` ${latex} `);
      return;
    }
    // Try annotation tag
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation?.textContent) {
      el.replaceWith(` ${annotation.textContent} `);
      return;
    }
  });

  // Also handle any remaining MathML that wasn't inside katex spans
  const mathElements = doc.querySelectorAll("math");
  mathElements.forEach((el) => {
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation?.textContent) {
      el.replaceWith(` ${annotation.textContent} `);
    } else {
      el.replaceWith(` ${el.textContent || ""} `);
    }
  });

  const text = doc.body.textContent || doc.body.innerText || "";
  return latexToPlainText(text.replace(/\s+/g, " ").trim());
}

/**
 * Converts LaTeX math notation to readable plain text with Unicode.
 * e.g. \frac{3}{y} → 3/y, x^{2} → x², \sqrt{4} → √(4)
 */
function latexToPlainText(text: string): string {
  if (!text || !text.includes("\\")) return text;

  let r = text;

  // \frac{a}{b} → a/b
  while (r.includes("\\frac{")) {
    const idx = r.indexOf("\\frac{");
    const numEnd = findMatchingBrace(r, idx + 5);
    if (numEnd < 0) break;
    const numerator = r.substring(idx + 6, numEnd);
    if (numEnd + 1 >= r.length || r[numEnd + 1] !== "{") break;
    const denEnd = findMatchingBrace(r, numEnd + 1);
    if (denEnd < 0) break;
    const denominator = r.substring(numEnd + 2, denEnd);
    r = r.substring(0, idx) + numerator + "/" + denominator + r.substring(denEnd + 1);
  }

  // \sqrt{x} → √(x)
  while (r.includes("\\sqrt{")) {
    const idx = r.indexOf("\\sqrt{");
    const end = findMatchingBrace(r, idx + 5);
    if (end < 0) break;
    const content = r.substring(idx + 6, end);
    r = r.substring(0, idx) + "√(" + content + ")" + r.substring(end + 1);
  }

  // Superscripts: ^{2} → ²
  const superscripts: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "n": "ⁿ", "i": "ⁱ",
  };

  while (r.includes("^{")) {
    const idx = r.indexOf("^{");
    const end = findMatchingBrace(r, idx + 1);
    if (end < 0) break;
    const exp = r.substring(idx + 2, end);
    let sup = "";
    let allConverted = true;
    for (const c of exp) {
      if (superscripts[c]) {
        sup += superscripts[c];
      } else {
        allConverted = false;
        break;
      }
    }
    r = allConverted
      ? r.substring(0, idx) + sup + r.substring(end + 1)
      : r.substring(0, idx) + "^(" + exp + ")" + r.substring(end + 1);
  }

  // Simple ^n for single chars
  for (const [ch, sup] of Object.entries(superscripts)) {
    r = r.split("^" + ch).join(sup);
  }

  // Subscripts: _{n} → ₍n₎
  while (r.includes("_{")) {
    const idx = r.indexOf("_{");
    const end = findMatchingBrace(r, idx + 1);
    if (end < 0) break;
    const sub = r.substring(idx + 2, end);
    r = r.substring(0, idx) + "₍" + sub + "₎" + r.substring(end + 1);
  }

  // Common LaTeX commands → symbols
  const replacements: [string, string][] = [
    ["\\times", "×"], ["\\div", "÷"], ["\\pm", "±"],
    ["\\leq", "≤"], ["\\geq", "≥"], ["\\neq", "≠"],
    ["\\infty", "∞"], ["\\pi", "π"], ["\\theta", "θ"],
    ["\\alpha", "α"], ["\\beta", "β"], ["\\gamma", "γ"],
    ["\\delta", "δ"], ["\\lambda", "λ"], ["\\mu", "μ"],
    ["\\sigma", "σ"], ["\\omega", "ω"], ["\\phi", "φ"],
    ["\\rightarrow", "→"], ["\\leftarrow", "←"],
    ["\\Rightarrow", "⇒"], ["\\Leftarrow", "⇐"],
    ["\\cdot", "·"], ["\\ldots", "…"], ["\\dots", "…"],
    ["\\sum", "Σ"], ["\\prod", "Π"], ["\\int", "∫"],
    ["\\log", "log"], ["\\ln", "ln"],
    ["\\sin", "sin"], ["\\cos", "cos"], ["\\tan", "tan"],
  ];
  for (const [from, to] of replacements) {
    r = r.split(from).join(to);
  }

  // Remove \text{}, \mathrm{}, \left, \right etc.
  r = r.replace(/\\(text|mathrm|mathit|mathbf|left|right|Big|big)\b/g, "");

  // Remove remaining grouping braces
  r = r.replace(/\{/g, "").replace(/\}/g, "");

  // Clean spacing commands
  r = r.replace(/\\[,;!]/g, " ").replace(/\\\s/g, " ");

  return r.replace(/\s+/g, " ").trim();
}

function findMatchingBrace(s: string, openIdx: number): number {
  if (openIdx < 0 || openIdx >= s.length || s[openIdx] !== "{") return -1;
  let depth = 1;
  for (let i = openIdx + 1; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Sanitizes an HTML string by removing dangerous tags/attributes while allowing
 * a conservative set of formatting elements.
 *
 * Note: This is a lightweight, client-side sanitizer to protect common cases
 * such as inline event handlers, javascript: URLs, <script> and <style> tags.
 * If untrusted HTML is accepted broadly, consider using a mature sanitizer
 * library. This helper keeps our bundle small and covers our dashboard pins use.
 */
export function sanitizeHtml(dirtyHtml: string): string {
  if (!dirtyHtml || typeof dirtyHtml !== "string") return "";

  const allowedTags = new Set([
    "b", "i", "em", "strong", "u", "br", "p", "span", "div", "ul", "ol", "li",
    "blockquote", "code", "pre", "a", "img", "h1", "h2", "h3", "h4", "h5", "h6",
    // Tables — authored in the admin rich-text editor and styled by .richtext-content.
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col"
  ]);

  const allowedAttrsByTag: Record<string, Set<string>> = {
    a: new Set(["href", "title", "target", "rel"]),
    img: new Set(["src", "alt", "title"]),
    // Numbering carried by the markup itself: the admin editor emits
    // <ol start="2"> when instructions continue a list across blocks, so
    // dropping `start` silently renumbers the list from 1. Presentational
    // only — no script vector.
    ol: new Set(["start", "type", "reversed"]),
    li: new Set(["value"]),
    th: new Set(["colspan", "rowspan", "scope"]),
    td: new Set(["colspan", "rowspan"]),
    col: new Set(["span"]),
    colgroup: new Set(["span"]),
    '*': new Set(["style", "class"]),
  };

  // Create a detached document to avoid executing anything
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${dirtyHtml}</div>`, "text/html");
  const container = doc.body.firstElementChild as HTMLElement | null;
  if (!container) return "";

  const isSafeUrl = (url: string | null) => {
    if (!url) return false;
    const trimmed = url.trim().toLowerCase();
    if (trimmed.startsWith("javascript:")) return false;
    if (trimmed.startsWith("data:")) return false;
    return true;
  };

  const sanitizeNode = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      // Remove script/style and unknown tags entirely
      const tagName = el.tagName.toLowerCase();
      if (tagName === "script" || tagName === "style") {
        el.remove();
        return;
      }
      if (!allowedTags.has(tagName)) {
        // Replace unknown element with its children (unwrap)
        const parent = el.parentNode;
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
        }
        return;
      }

      // Remove dangerous attributes
      // Copy attr names first since we'll mutate during iteration
      const attrNames = Array.from(el.attributes).map(a => a.name);
      for (const attrName of attrNames) {
        const lower = attrName.toLowerCase();
        // Block inline event handlers and srcdoc
        if (lower.startsWith("on") || lower === "srcdoc") {
          el.removeAttribute(attrName);
          continue;
        }

        const allowedForTag = allowedAttrsByTag[tagName] || new Set<string>();
        const allowedForAll = allowedAttrsByTag['*'] || new Set<string>();
        if (!allowedForTag.has(lower) && !allowedForAll.has(lower)) {
          el.removeAttribute(attrName);
          continue;
        }

        // Extra validation for URL-bearing attributes
        if ((tagName === "a" && lower === "href") || (tagName === "img" && lower === "src")) {
          const val = el.getAttribute(attrName);
          if (!isSafeUrl(val)) {
            el.removeAttribute(attrName);
            continue;
          }
        }

        // For anchors, enforce safe rel when target=_blank
        if (tagName === "a" && lower === "target") {
          const target = el.getAttribute("target");
          if (target === "_blank") {
            const rel = el.getAttribute("rel") || "";
            if (!/\bnoopener\b/.test(rel) || !/\bnoreferrer\b/.test(rel)) {
              el.setAttribute("rel", "noopener noreferrer");
            }
          }
        }
      }

      // Recurse to children after sanitizing this node
      Array.from(el.childNodes).forEach(sanitizeNode);
    }
  };

  Array.from(container.childNodes).forEach(sanitizeNode);
  return container.innerHTML;
}

export const processHtmlString = (htmlString: string) => {
  // Create a temporary div to parse the HTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlString;
  // Array to store processed content
  const processedContent: Array<{ type: "text" | "image"; content: string }> =
    [];
  // Iterate through child nodes
  tempDiv.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Process text nodes
      const trimmedText = node.textContent?.trim();
      if (trimmedText) {
        processedContent.push({
          type: "text",
          content: trimmedText,
        });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      // Process image nodes
      if (element.tagName.toLowerCase() === "img") {
        const src = element.getAttribute("src");
        if (src) {
          processedContent.push({
            type: "image",
            content: src,
          });
        }
      } else {
        // Process other elements' text content
        const text = element.textContent?.trim();
        if (text) {
          processedContent.push({
            type: "text",
            content: text,
          });
        }
      }
    }
  });
  return processedContent;
};

/**
 * Converts a string to title case.
 *
 * Words that are already all-uppercase are treated as acronyms and left
 * untouched, so admin-entered names keep their intended casing:
 *   "PDF Notes"  -> "PDF Notes"   (not "Pdf Notes")
 *   "class 9"    -> "Class 9"
 *   "IIT jee"    -> "IIT Jee"
 *
 * @param text - The string to convert to title case
 * @returns The string in title case format
 */
export function toTitleCase(text: string): string {
  if (!text) return "";
  return text
    .split(/[\s_-]+/)
    .map((word) => {
      // Preserve acronyms already typed in all caps (e.g. "PDF", "IIT").
      if (word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Title-cases a package/genre tag while preserving separators.
 * Bulk-create stores tags as trim().toLowerCase(), keeping spaces and
 * hyphens intact. This helper capitalizes each word without flattening
 * hyphens into spaces (which toTitleCase does).
 *
 * Examples:
 *   "sci-fi"           -> "Sci-Fi"
 *   "science fiction"  -> "Science Fiction"
 *   "rom-com thriller" -> "Rom-Com Thriller"
 */
export function formatTagForDisplay(tag: string): string {
  if (!tag) return "";
  const cap = (s: string) =>
    s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
  return tag
    .trim()
    .split(/\s+/)
    .map((word) => word.split("-").map(cap).join("-"))
    .join(" ");
}

/**
 * Case-insensitive natural comparator for lists of `{ name }` objects, so
 * numbered items order the way people expect: "Class 9" before "Class 10"
 * (not after "Class 1"), then non-numeric names alphabetically. Use it to
 * sort filter option lists (e.g. levels) that would otherwise inherit an
 * arbitrary API/insertion order.
 */
export function compareByNameNatural<T extends { name: string }>(
  a: T,
  b: T,
): number {
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
