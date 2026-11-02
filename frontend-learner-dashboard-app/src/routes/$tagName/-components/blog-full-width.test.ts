// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Full width article layout: a post designed as a page of its own (banner,
 * title and background bands in its HTML) renders edge to edge with no
 * column, sidebar or second title; loose paragraphs still get the title
 * block and a readable column. A blog section's `articleTemplate` overrides
 * every post's own layout, so posts written later follow it too.
 */

const post = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({ tagName: "school" }),
  useLocation: () => ({ pathname: "/school/blog/a-guide", searchStr: "" }),
  useRouter: () => ({ navigate: () => {} }),
  Link: () => null,
}));
vi.mock("../-services/blog-service", () => ({
  BlogService: {
    listPosts: () => new Promise(() => {}),
    getPost: () => Promise.resolve(post.current),
  },
}));

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BlogComponent } from "./components/BlogComponent";
import { resolveBlogTemplate } from "../-utils/blog-template";
import { sanitizeBlogArticle } from "../-utils/blog-html";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const DESIGNED =
  '<div class="guide" style="background:#FFF8F0"><header class="hero"><h2>Exam 2026: Complete Guide</h2></header>' +
  "<h2>Eligibility</h2><p>Graduates.</p><h2>Pattern</h2><p>Two stages.</p></div>";
const PLAIN = "<p>First paragraph.</p><h2>Part one</h2><p>More.</p><h2>Part two</h2><p>End.</p>";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const renderArticle = async (contentHtml: string, ownTemplate: string, articleTemplate = "") => {
  post.current = {
    id: "p1",
    slug: "a-guide",
    title: "A Guide",
    content_html: contentHtml,
    template: ownTemplate,
    published_at: "2026-10-01T00:00:00Z",
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      React.createElement(BlogComponent, {
        instituteId: "inst",
        tagName: "school",
        pageRoute: "blog",
        articleTemplate: articleTemplate as never,
      })
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return host;
};

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("sanitizeBlogArticle page detection", () => {
  it("treats a wrapped or h1-titled body as a page of its own, loose paragraphs as not", () => {
    expect(sanitizeBlogArticle(DESIGNED)).toMatchObject({ isSelfContained: true, hasOwnH1: false });
    expect(sanitizeBlogArticle("<p>x</p><h1>Title</h1>")).toMatchObject({ isSelfContained: true, hasOwnH1: true });
    expect(sanitizeBlogArticle(PLAIN)).toMatchObject({ isSelfContained: false, hasOwnH1: false });
    // The post's own <style> block is lifted out before the first element is read.
    expect(sanitizeBlogArticle("<style>.a{color:red}</style><article class='a'><p>x</p></article>").isSelfContained).toBe(
      true
    );
  });
});

describe("resolveBlogTemplate", () => {
  it("lets the section's layout win, then the post's, then Classic", () => {
    expect(resolveBlogTemplate("FULL_WIDTH", "SIDEBAR_TOC")).toBe("FULL_WIDTH");
    expect(resolveBlogTemplate("", "SIDEBAR_TOC")).toBe("SIDEBAR_TOC");
    expect(resolveBlogTemplate(undefined, "FULL_WIDTH")).toBe("FULL_WIDTH");
    expect(resolveBlogTemplate("NOPE", "ALSO_NOPE")).toBe("CLASSIC");
  });
});

describe("Full width article", () => {
  it("shows a designed post edge to edge: no sidebar, no visible second title", async () => {
    const el = await renderArticle(DESIGNED, "FULL_WIDTH");
    const article = el.querySelector("article.catalogue-blog-full");
    expect(article).not.toBeNull();
    expect(el.querySelector(".catalogue-blog-article--full .guide")).not.toBeNull();
    expect(el.querySelector(".catalogue-blog-toc")).toBeNull();
    // Body is not inside a narrow column.
    expect(el.querySelector(".catalogue-shell-prose .catalogue-blog-article")).toBeNull();
    // One h1 for SEO / screen readers, visually hidden: the banner shows the title.
    const h1s = el.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0].className).toContain("sr-only");
    expect(h1s[0].textContent).toBe("A Guide");
  });

  it("adds no h1 when the post brings its own", async () => {
    const el = await renderArticle('<div class="guide"><h1>Own title</h1><p>x</p></div>', "FULL_WIDTH");
    const h1s = el.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("Own title");
  });

  it("keeps the title block for loose paragraphs", async () => {
    const el = await renderArticle(PLAIN, "FULL_WIDTH");
    const h1 = el.querySelector("h1");
    expect(h1?.className).not.toContain("sr-only");
    expect(h1?.textContent).toBe("A Guide");
    expect(el.querySelector(".catalogue-blog-article--full")).not.toBeNull();
  });

  it("follows the section's layout over the post's own", async () => {
    const el = await renderArticle(DESIGNED, "SIDEBAR_TOC", "FULL_WIDTH");
    expect(el.querySelector("article.catalogue-blog-full")).not.toBeNull();
    expect(el.querySelector(".catalogue-blog-toc")).toBeNull();
  });

  it("keeps the post's own layout when the section sets none", async () => {
    const el = await renderArticle(DESIGNED, "SIDEBAR_TOC");
    expect(el.querySelector("article.catalogue-blog-full")).toBeNull();
    expect(el.querySelector(".catalogue-blog-toc")).not.toBeNull();
  });
});
