import { describe, expect, it } from "vitest";
import { wrapBareColourTokens } from "./catalogue-html";
import { externalHref } from "./catalogue-route-search";

/**
 * Two things a page built through the website MCP could not do without
 * workarounds: colour a custom-HTML block with the site theme, and point a
 * typed button at an off-site link (an invite / payment link).
 */
describe("wrapBareColourTokens", () => {
  it("reads a bare theme colour token as the colour it names", () => {
    expect(wrapBareColourTokens(".a{color:var(--primary-500);background:var(--palette-cream)}")).toBe(
      ".a{color:hsl(var(--primary-500));background:hsl(var(--palette-cream))}",
    );
    expect(wrapBareColourTokens(".a{border:1px solid var( --catalogue-border )}")).toBe(
      ".a{border:1px solid hsl(var(--catalogue-border))}",
    );
  });

  it("leaves tokens already in hsl(), non-colour tokens and the block's own properties alone", () => {
    const css =
      ".a{color:hsl(var(--primary-500));opacity:1}.b{color:hsla(var(--primary-400) / .5)}" +
      ".c{font-family:var(--catalogue-heading-font, inherit);border-radius:var(--catalogue-radius-md)}" +
      ":host{--palette-primary:#883000}.d{color:var(--palette-primary)}.e{color:var(--brand)}";
    expect(wrapBareColourTokens(css)).toBe(css);
  });
});

describe("externalHref", () => {
  it("opens full addresses instead of routing them", () => {
    expect(externalHref("https://u.vacademy.io/s/A5ACyY")).toBe("https://u.vacademy.io/s/A5ACyY");
    expect(externalHref("mailto:rp@example.org")).toBe("mailto:rp@example.org");
    expect(externalHref("//cdn.example.org/x")).toBe("//cdn.example.org/x");
  });

  it("keeps site routes and anchors on the router and never follows script schemes", () => {
    expect(externalHref("courses")).toBeNull();
    expect(externalHref("/courses?stream=x")).toBeNull();
    expect(externalHref("javascript:alert(1)")).toBe("");
    expect(externalHref("data:text/html,x")).toBe("");
  });
});
