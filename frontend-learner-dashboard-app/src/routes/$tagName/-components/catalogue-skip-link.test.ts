// @vitest-environment jsdom
/**
 * The catalogue skip link must paint nothing until it takes focus. It used to
 * be parked above the page with translateY(-200%), outline and shadow on;
 * browsers paint content above the page top during a top overscroll bounce
 * (macOS trackpads, iOS), so its outlined box showed over the fixed header's
 * logo while scrolling. These tests load the real skip-link rules from the
 * catalogue stylesheet into the DOM and read the computed style.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const CSS_PATH = path.resolve(__dirname, "../../../styles/catalogue-tokens.css");

/** Every top-level-in-layer rule whose selector list mentions the skip link. */
function skipLinkRules(css: string): string[] {
  const rules: string[] = [];
  const re = /(^|\n)\s*(\.catalogue-skip-link[^{]*)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) rules.push(`${match[2].trim()} {${match[3]}}`);
  return rules;
}

let rules: string[] = [];

beforeAll(() => {
  rules = skipLinkRules(fs.readFileSync(CSS_PATH, "utf8"));
  const style = document.createElement("style");
  style.textContent = rules.join("\n");
  document.head.appendChild(style);
});

afterEach(() => {
  document.body.innerHTML = "";
});

function mountLink(): HTMLAnchorElement {
  document.body.innerHTML =
    '<a href="#catalogue-main" class="catalogue-skip-link">Skip to main content</a><main id="catalogue-main" tabindex="-1"></main>';
  return document.querySelector<HTMLAnchorElement>(".catalogue-skip-link")!;
}

describe("catalogue skip link", () => {
  it("has a resting rule and a focus rule in the stylesheet", () => {
    expect(rules).toHaveLength(2);
    expect(rules[1]).toMatch(/:focus/);
  });

  it("is clipped to nothing before focus, outline and shadow included", () => {
    const style = getComputedStyle(mountLink());
    expect(style.clipPath).toBe("inset(50%)");
    expect(style.width).toBe("1px");
    expect(style.height).toBe("1px");
    expect(style.overflow).toBe("hidden");
    expect(style.getPropertyValue("outline")).toBe("none");
    expect(style.boxShadow).toBe("none");
  });

  it("does not hide by moving the box above the page", () => {
    // A transform-based hide is what overscroll revealed.
    expect(rules[0]).not.toMatch(/transform/);
    expect(rules[1]).not.toMatch(/transform/);
  });

  it("shows on focus, pinned to the viewport above the header", () => {
    const link = mountLink();
    link.focus();
    expect(document.activeElement).toBe(link);
    const style = getComputedStyle(link);
    expect(style.clipPath).toBe("none");
    expect(style.position).toBe("fixed");
    expect(style.width).toBe("auto");
    expect(style.overflow).toBe("visible");
    expect(Number(style.zIndex)).toBeGreaterThan(30); // above --catalogue-z-fixed
    expect(style.getPropertyValue("outline")).toMatch(/^2px solid /);
  });

  it("hides again on blur", () => {
    const link = mountLink();
    link.focus();
    link.blur();
    expect(getComputedStyle(link).clipPath).toBe("inset(50%)");
  });

  it("the page still renders the link and its focusable main target", () => {
    const page = fs.readFileSync(path.resolve(__dirname, "CourseCataloguePage.tsx"), "utf8");
    expect(page).toContain('<a href="#catalogue-main" className="catalogue-skip-link">');
    expect(page).toMatch(/<main id="catalogue-main" tabIndex=\{-1\}/);
  });
});
