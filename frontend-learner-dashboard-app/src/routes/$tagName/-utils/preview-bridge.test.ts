// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/domain-routing", () => ({ getCachedRootCatalogueTag: () => null }));

import {
  blockTypeLabel,
  isEditorMessage,
  isFramed,
  isShownRoute,
  leavesDocument,
  parseAdminOrigins,
  previewRouteFromHref,
  readyTargets,
  scrubPreviewConfig,
} from "./preview-bridge";

/** The editor preview obeys only the frame that embeds it. */

const editor = { postMessage: () => {} } as unknown as Window;
const framed = { parent: editor } as unknown as Window;
const topLevel = { location: { origin: "https://learn.acme.in" } } as { parent: unknown; location: { origin: string } };
topLevel.parent = topLevel;

describe("isEditorMessage", () => {
  it("accepts the embedding frame from any origin while no admin origins are set", () => {
    expect(isEditorMessage({ source: editor, origin: "https://admin.acme.in" }, framed, [])).toBe(true);
  });

  it("ignores a message from another window or frame", () => {
    const other = { postMessage: () => {} } as unknown as Window;
    expect(isEditorMessage({ source: other, origin: "https://admin.acme.in" }, framed, [])).toBe(false);
    expect(isEditorMessage({ source: null, origin: "https://admin.acme.in" }, framed, [])).toBe(false);
  });

  it("accepts the page's own same-origin post when not framed (the headless AI preview)", () => {
    const win = topLevel as unknown as Window;
    expect(isFramed(win)).toBe(false);
    expect(isEditorMessage({ source: win, origin: "https://learn.acme.in" }, win, [])).toBe(true);
    // Whatever origins are listed for the editor.
    expect(isEditorMessage({ source: win, origin: "https://learn.acme.in" }, win, ["https://dash.vacademy.io"])).toBe(true);
  });

  it("not framed, ignores another window (a site that opened this page) and other origins", () => {
    const win = topLevel as unknown as Window;
    const opener = { postMessage: () => {} } as unknown as Window;
    expect(isEditorMessage({ source: opener, origin: "https://evil.example" }, win, [])).toBe(false);
    expect(isEditorMessage({ source: opener, origin: "https://learn.acme.in" }, win, [])).toBe(false);
    expect(isEditorMessage({ source: win, origin: "https://evil.example" }, win, [])).toBe(false);
  });

  it("with admin origins set, ignores the parent when its origin is not listed", () => {
    const allowed = ["https://dash.vacademy.io"];
    expect(isEditorMessage({ source: editor, origin: "https://evil.example" }, framed, allowed)).toBe(false);
    expect(isEditorMessage({ source: editor, origin: "https://dash.vacademy.io" }, framed, allowed)).toBe(true);
  });
});

describe("admin origins", () => {
  it("parses a comma-separated list, trimming spaces and trailing slashes", () => {
    expect(parseAdminOrigins(" https://dash.vacademy.io/, https://admin.acme.in ,,")).toEqual([
      "https://dash.vacademy.io",
      "https://admin.acme.in",
    ]);
    expect(parseAdminOrigins(undefined)).toEqual([]);
  });

  it("announces READY to each listed origin, or to any when none are listed", () => {
    expect(readyTargets([])).toEqual(["*"]);
    expect(readyTargets(["https://a.io", "https://b.io"])).toEqual(["https://a.io", "https://b.io"]);
  });
});

describe("previewRouteFromHref", () => {
  const base = { origin: "https://learn.acme.in", tagName: "acme" };

  it("gives the page route after the catalogue base", () => {
    expect(previewRouteFromHref("https://learn.acme.in/acme/courses?format=live", base)).toBe("courses");
    expect(previewRouteFromHref("/acme/learning-paths", base)).toBe("learning-paths");
    expect(previewRouteFromHref("/acme/blog/first-post", base)).toBe("blog/first-post");
    expect(previewRouteFromHref("/acme", base)).toBe("");
  });

  it("is null for a link that leaves the site", () => {
    expect(previewRouteFromHref("https://wa.me/9199", base)).toBeNull();
    expect(previewRouteFromHref("mailto:hi@acme.in", base)).toBeNull();
  });
});

describe("blockTypeLabel", () => {
  it("reads a block type as words", () => {
    expect(blockTypeLabel("heroSection")).toBe("Hero section");
    expect(blockTypeLabel("ctaBanner")).toBe("Cta banner");
    expect(blockTypeLabel(undefined)).toBe("");
  });
});

describe("isShownRoute", () => {
  it("matches the page shown, home by any of its names, ignoring query and hash", () => {
    expect(isShownRoute("", undefined)).toBe(true);
    expect(isShownRoute("homepage", "")).toBe(true);
    expect(isShownRoute("courses", "courses")).toBe(true);
    expect(isShownRoute("courses/", "courses")).toBe(true);
    expect(isShownRoute("courses", "")).toBe(false);
    expect(isShownRoute("", "courses")).toBe(false);
  });
});

describe("leavesDocument", () => {
  const nav = (over: Record<string, unknown>) => ({
    cancelable: true,
    navigationType: "push",
    destination: { sameDocument: false, url: "https://learn.acme.in/login" },
    ...over,
  });

  it("is true for a navigation that replaces the page", () => {
    expect(leavesDocument(nav({}))).toBe(true);
  });

  it("is false for router (same-document) moves, reloads and what cannot be held", () => {
    expect(leavesDocument(nav({ destination: { sameDocument: true } }))).toBe(false);
    expect(leavesDocument(nav({ navigationType: "reload" }))).toBe(false);
    expect(leavesDocument(nav({ cancelable: false }))).toBe(false);
  });
});

describe("scrubPreviewConfig", () => {
  it("strips script from HTML text anywhere in the posted draft", () => {
    const out = scrubPreviewConfig({
      pages: [{ components: [{ type: "textBlock", props: { content: '<p>Hi<img src="x" onerror="alert(1)"></p>' } }] }],
      items: ["<b>ok</b><script>alert(1)</script>"],
    });
    const content = out.pages[0]!.components[0]!.props.content;
    expect(content).toContain("<p>Hi");
    expect(content).not.toContain("onerror");
    expect(out.items[0]).toBe("<b>ok</b>");
  });

  it("a text the scrub changed still finds its Hindi translation", async () => {
    const { translateText } = await import("./catalogue-i18n");
    const source = '<p>Pay <a href="javascript:alert(1)">here</a></p>';
    const out = scrubPreviewConfig({
      globalSettings: { i18n: { enabled: true, strings: { hi: { [source]: "<p>यहाँ भुगतान करें</p>" } } } },
      pages: [{ components: [{ type: "textBlock", props: { content: source } }] }],
    });
    const shown = out.pages[0]!.components[0]!.props.content;
    expect(shown).not.toContain("javascript:");
    expect(translateText(shown, out.globalSettings.i18n.strings.hi)).toBe("<p>यहाँ भुगतान करें</p>");
  });

  it("leaves YouTube's embed code and UPI / WhatsApp links whole", () => {
    const config = {
      embed:
        '<iframe src="https://www.youtube.com/embed/x" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>',
      pay: '<a href="upi://pay?pa=acme@upi">Pay by UPI</a> or <a href="whatsapp://send?phone=91">chat</a>',
    };
    expect(scrubPreviewConfig(config)).toEqual(config);
  });

  it("keeps safe text exactly as written, and leaves self-sanitized html/css alone", () => {
    const config = {
      title: "Fees < ₹500 & more",
      content: '<p>Hello <a href="/acme/courses" target="_blank">courses</a></p>',
      embed: '<iframe src="https://www.youtube.com/embed/x" allowfullscreen></iframe>',
      html: "<div onclick=\"go()\">kept for htmlBlock's own sanitizer</div>",
      count: 3,
      on: true,
    };
    expect(scrubPreviewConfig(config)).toEqual(config);
  });
});
