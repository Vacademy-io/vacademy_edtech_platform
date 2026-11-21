import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATEGORY_LINK_PATTERN,
  DEFAULT_STREAM_LINK_PATTERN,
  carrySearchParams,
  fillTextPattern,
  linkFromPattern,
  routeHeaderLink,
  safeAccentColor,
  safeHeaderLink,
  safeImageSrc,
  toAppHref,
} from "./header-links";

describe("safeHeaderLink", () => {
  it("accepts site paths and full http(s) URLs", () => {
    expect(safeHeaderLink("/courses?stream=shiksha")).toEqual({ href: "/courses?stream=shiksha", external: false });
    expect(safeHeaderLink("  /  ")).toEqual({ href: "/", external: false });
    expect(safeHeaderLink("https://example.com/a?b=1")).toEqual({ href: "https://example.com/a?b=1", external: true });
    expect(safeHeaderLink("HTTP://example.com")).toEqual({ href: "HTTP://example.com", external: true });
  });

  it("refuses script, data, protocol-relative and backslash tricks", () => {
    for (const bad of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "data:text/html;base64,AAAA",
      "mailto:a@b.c",
      "//evil.example/x",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "courses",
      "#pricing",
      "https://",
      "",
      "   ",
    ]) {
      expect(safeHeaderLink(bad)).toBeNull();
    }
  });

  it("refuses non-strings", () => {
    expect(safeHeaderLink(undefined)).toBeNull();
    expect(safeHeaderLink(null)).toBeNull();
    expect(safeHeaderLink(42)).toBeNull();
    expect(safeHeaderLink({ href: "/x" })).toBeNull();
  });

  it("reads a bare page route (the link picker's page form) as a site path", () => {
    expect(routeHeaderLink("find-your-path")).toEqual({ href: "/find-your-path", external: false });
    expect(routeHeaderLink("homepage")).toEqual({ href: "/", external: false });
    expect(routeHeaderLink("/about")).toEqual({ href: "/about", external: false });
    expect(routeHeaderLink("https://x.example")).toEqual({ href: "https://x.example", external: true });
    for (const bad of ["javascript:alert(1)", "//evil.example", "-x", "a b", "", undefined]) {
      expect(routeHeaderLink(bad)).toBeNull();
    }
  });

  it("applies the same rule to image sources", () => {
    expect(safeImageSrc("https://cdn.example/img.png")).toBe("https://cdn.example/img.png");
    expect(safeImageSrc("/assets/x.svg")).toBe("/assets/x.svg");
    expect(safeImageSrc("javascript:alert(1)")).toBeNull();
    expect(safeImageSrc(null)).toBeNull();
  });
});

describe("safeAccentColor", () => {
  it("keeps #rgb, #rrggbb and #rrggbbaa", () => {
    expect(safeAccentColor("#F59E0B")).toBe("#F59E0B"); // design-lint-ignore: test fixture colour
    expect(safeAccentColor(" #abc ")).toBe("#abc"); // design-lint-ignore: test fixture colour
    expect(safeAccentColor("#11223344")).toBe("#11223344"); // design-lint-ignore: test fixture colour
  });

  it("drops anything else", () => {
    for (const bad of ["red", "#12", "#12345", "rgb(0,0,0)", "url(x)", "", null, 7]) {
      expect(safeAccentColor(bad)).toBeNull();
    }
  });
});

describe("linkFromPattern", () => {
  it("fills the default patterns with encoded slugs", () => {
    expect(linkFromPattern(undefined, DEFAULT_STREAM_LINK_PATTERN, { stream: "shiksha" })).toEqual({
      href: "/courses?stream=shiksha",
      external: false,
    });
    expect(
      linkFromPattern("", DEFAULT_CATEGORY_LINK_PATTERN, { stream: "shiksha", category: "vedic maths" }),
    ).toEqual({ href: "/courses?stream=shiksha&category=vedic%20maths", external: false });
  });

  it("uses an authored pattern, and refuses one that is not a safe link", () => {
    expect(linkFromPattern("/streams/{stream}", DEFAULT_STREAM_LINK_PATTERN, { stream: "kala" })?.href).toBe(
      "/streams/kala",
    );
    expect(linkFromPattern("javascript:{stream}", DEFAULT_STREAM_LINK_PATTERN, { stream: "kala" })).toBeNull();
  });
});

describe("fillTextPattern", () => {
  it("replaces known placeholders and leaves unknown ones visible", () => {
    expect(fillTextPattern("Explore {stream}", { stream: "Education" })).toBe("Explore Education");
    expect(fillTextPattern("{title} · {stream}", { stream: "Education", title: "शिक्षा" })).toBe("शिक्षा · Education");
    expect(fillTextPattern("Explore {strem}", { stream: "Education" })).toBe("Explore {strem}");
  });
});

describe("toAppHref", () => {
  const classic = (route: string) => (route ? `/new/${route}` : "/new");
  const rootMounted = (route: string) => (route ? `/${route}` : "/");

  it("maps a site path onto the host and keeps the query and hash", () => {
    expect(toAppHref("/courses?stream=shiksha", { tagName: "new", pagePath: classic })).toBe(
      "/new/courses?stream=shiksha",
    );
    expect(toAppHref("/courses?stream=shiksha#list", { tagName: "new", pagePath: rootMounted })).toBe(
      "/courses?stream=shiksha#list",
    );
    expect(toAppHref("/", { tagName: "new", pagePath: classic })).toBe("/new");
  });

  it("drops a tag the author pasted into the path", () => {
    expect(toAppHref("/new/courses?stream=kala", { tagName: "new", pagePath: rootMounted })).toBe("/courses?stream=kala");
    expect(toAppHref("/NEW/about", { tagName: "new", pagePath: classic })).toBe("/new/about");
    // Only a whole segment is a tag: "/newsletter" is a page of its own.
    expect(toAppHref("/newsletter", { tagName: "new", pagePath: classic })).toBe("/new/newsletter");
  });

  it("ignores an empty query or hash", () => {
    expect(toAppHref("/about?#", { tagName: "new", pagePath: classic })).toBe("/new/about");
  });
});

describe("carrySearchParams", () => {
  it("keeps the visitor's ?lang= on a link that does not set it", () => {
    expect(carrySearchParams("/new/courses?stream=kala", "?lang=hi&utm_source=x")).toBe(
      "/new/courses?stream=kala&lang=hi",
    );
    expect(carrySearchParams("/new/about#team", "lang=hi")).toBe("/new/about?lang=hi#team");
  });

  it("leaves the link alone when it already has one or there is none to carry", () => {
    expect(carrySearchParams("/new/courses?lang=en", "?lang=hi")).toBe("/new/courses?lang=en");
    expect(carrySearchParams("/new/courses?stream=a%20b", "?utm_source=x")).toBe("/new/courses?stream=a%20b");
    expect(carrySearchParams("/new", "")).toBe("/new");
  });
});
