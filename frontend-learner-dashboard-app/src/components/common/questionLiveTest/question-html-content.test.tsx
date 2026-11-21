// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuestionHtmlContent } from "./question-html-content";

// React only flushes effects synchronously inside act() when this is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (html: string) => {
  act(() => root.render(<QuestionHtmlContent html={html} />));
  return container;
};

/** The LaTeX source of every formula KaTeX produced. */
const formulas = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('annotation[encoding="application/x-tex"]')).map(
    (a) => a.textContent,
  );

describe("QuestionHtmlContent dollar maths", () => {
  it("leaves money in an accounting question as text", () => {
    const html =
      "<p>list price $80,000 less a 5% trade discount; delivery $2,000; installation $3,500</p>";
    const el = render(html);
    expect(formulas(el)).toEqual([]);
    expect(el.textContent).toBe(
      "list price $80,000 less a 5% trade discount; delivery $2,000; installation $3,500",
    );
  });

  it("leaves a sum of money with operators as text", () => {
    const el = render("<p>One notebook costs $18 ÷ 6 = $3.</p>");
    expect(formulas(el)).toEqual([]);
  });

  it("leaves price ranges as text", () => {
    for (const html of [
      "<p>from $5-$10</p>",
      "<p>pay with a $5,$10 or $20 bill</p>",
      "<p>costs $5/$10</p>",
    ]) {
      expect(formulas(render(html))).toEqual([]);
    }
  });

  it("renders a plain number wrapped in its own pair", () => {
    expect(formulas(render("<p>$526$</p>"))).toEqual(["526"]);
    expect(formulas(render("<p>$-1080$</p>"))).toEqual(["-1080"]);
    expect(formulas(render("<p>$1/2$</p>"))).toEqual(["1/2"]);
    expect(formulas(render("<p>$0.000666...$</p>"))).toEqual(["0.000666..."]);
    expect(formulas(render("<p>does not contain $1$ are $3^4$</p>"))).toEqual(["1", "3^4"]);
  });

  it("still renders real maths", () => {
    expect(formulas(render("<p>Solve $x^2+3x=0$ at $(2,0)$</p>"))).toEqual([
      "x^2+3x=0",
      "(2,0)",
    ]);
    expect(formulas(render("<p>\\(\\sqrt{2}\\)</p>"))).toEqual(["\\sqrt{2}"]);
  });
});
