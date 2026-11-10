import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface QuestionHtmlContentProps {
  html: string;
  className?: string;
  inline?: boolean;
  /**
   * Treat `$…$` / `$$…$$` as LaTeX (default true). Turn off for money-heavy
   * text such as accounting scenarios, where "$3,200 … $1,100" would otherwise
   * be typeset as one italic formula. `\(…\)`, `\[…\]` and math spans still render.
   */
  dollarMath?: boolean;
}

const decodeHtml = (input: string): string => {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = input;
  const once = textarea.value || textarea.textContent || "";

  if (
    once.includes("&lt;") ||
    once.includes("&gt;") ||
    once.includes("&amp;")
  ) {
    textarea.innerHTML = once;
    return textarea.value || textarea.textContent || "";
  }

  return once;
};

const LATEX_PATTERN = /(\\\[(.+?)\\\]|\\\((.+?)\\\)|\$\$(.+?)\$\$|\$(.+?)\$)/gs;
// Same five groups (the replacer reads them by position) but the dollar
// alternative can never match: `(?!)` always fails.
const LATEX_PATTERN_NO_DOLLAR = /(\\\[(.+?)\\\]|\\\((.+?)\\\)|(?!)()())/gs;

const renderLatexDelimiters = (text: string, dollarMath = true): string => {
  const pattern = dollarMath ? LATEX_PATTERN : LATEX_PATTERN_NO_DOLLAR;

  return text.replace(
    pattern,
    (match, _full, bracket, paren, displayDollar, inlineDollar) => {
      const latex = (
        bracket ||
        paren ||
        displayDollar ||
        inlineDollar ||
        ""
      ).trim();
      if (!latex) return match;

      const displayMode = Boolean(bracket || displayDollar);
      try {
        return katex.renderToString(latex, {
          throwOnError: false,
          displayMode,
        });
      } catch {
        return match;
      }
    },
  );
};

const renderHtmlWithMath = (html: string, dollarMath = true): string => {
  if (!html) return "";

  const decoded = html.includes("&lt;") ? decodeHtml(html) : html;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(decoded, "text/html");

    doc.querySelectorAll("script").forEach((node) => node.remove());

    const mathNodes = doc.querySelectorAll(
      "span.math-inline, span.math-display, div.math-display, span[data-latex], div[data-latex], span[latex], div[latex]",
    );

    mathNodes.forEach((node) => {
      const element = node as HTMLElement;
      const latex =
        element.getAttribute("data-latex") ||
        element.getAttribute("latex") ||
        element.textContent ||
        "";

      if (!latex.trim()) return;

      const displayMode =
        element.classList.contains("math-display") ||
        element.tagName.toLowerCase() === "div";

      try {
        element.innerHTML = katex.renderToString(latex.trim(), {
          throwOnError: false,
          displayMode,
        });
      } catch {
        // Keep original content if KaTeX rendering fails.
      }
    });

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];

    let currentNode = walker.nextNode();
    while (currentNode) {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        textNodes.push(currentNode as Text);
      }
      currentNode = walker.nextNode();
    }

    textNodes.forEach((textNode) => {
      const value = textNode.nodeValue || "";
      if (
        !((dollarMath && value.includes("$")) || value.includes("\\(") || value.includes("\\["))
      ) {
        return;
      }

      const rendered = renderLatexDelimiters(value, dollarMath);
      if (rendered === value) return;

      const span = doc.createElement("span");
      span.innerHTML = rendered;
      textNode.replaceWith(span);
    });

    return doc.body.innerHTML;
  } catch {
    return decoded;
  }
};

export function QuestionHtmlContent({
  html,
  className = "",
  inline = false,
  dollarMath = true,
}: QuestionHtmlContentProps) {
  const renderedHtml = useMemo(() => renderHtmlWithMath(html, dollarMath), [html, dollarMath]);

  if (inline) {
    return (
      <span
        className={className}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    );
  }

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
}
