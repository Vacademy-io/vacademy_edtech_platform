// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const location = { pathname: "/school/blog", searchStr: "" };
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({ tagName: "school" }),
  useLocation: () => location,
  useRouter: () => ({ navigate: () => {} }),
  Link: () => null,
}));
vi.mock("../-services/blog-service", () => ({
  BlogService: {
    listPosts: () => new Promise(() => {}),
    getPost: () => new Promise(() => {}),
  },
}));
import React from "react";
import { renderToString } from "react-dom/server";
import { JsonRenderer } from "./JsonRenderer";
import { blogPlainText, sanitizeBlogArticle, sanitizeBlogHtml } from "../-utils/blog-html";
import { blogPostSlugFor } from "../-utils/blog-route";

/**
 * The `blog` section reads posts live and renders either the list or one
 * article depending on the URL. SSR never resolves the fetch, so what these
 * pin down is the wiring: the section is in the renderer, its heading paints,
 * a URL with a trailing slug flips it into article mode (skeleton with no
 * list heading), and the body sanitiser keeps what an article needs and
 * drops what it must not carry onto the learner domain.
 */
const page = (props: Record<string, unknown>) => ({
  id: "blog", route: "blog", title: "Blog",
  components: [{ id: "b1", type: "blog", enabled: true, props }],
});

const render = (props: Record<string, unknown>) =>
  renderToString(
    React.createElement(JsonRenderer, {
      page: page(props) as never,
      globalSettings: {} as never,
      instituteId: "inst",
      tagName: "school",
    }),
  );

describe("blog section", () => {
  it("renders the list face with its heading on the page URL", () => {
    location.pathname = "/school/blog";
    location.searchStr = "";
    const html = render({ heading: "From our desk", subheading: "Notes and news" });
    expect(html).toContain("From our desk");
    expect(html).toContain("Notes and news");
    expect(html).toContain('aria-busy="true"');
  });

  it("switches to the article face when the URL carries a post slug", () => {
    location.pathname = "/school/blog/how-to-crack-neet";
    location.searchStr = "";
    const html = render({ heading: "From our desk" });
    expect(html).not.toContain("From our desk");
    expect(html).toContain('aria-busy="true"');
  });

  it("also reads the slug from ?post= for a blog on the home page", () => {
    location.pathname = "/school";
    location.searchStr = "?post=hello";
    const html = renderToString(
      React.createElement(JsonRenderer, {
        page: { id: "home", route: "homepage", components: [{ id: "b", type: "blog", enabled: true, props: { heading: "H" } }] } as never,
        globalSettings: {} as never,
        instituteId: "inst",
        tagName: "school",
      }),
    );
    expect(html).not.toContain(">H<");
  });
});

describe("sanitizeBlogHtml", () => {
  it("keeps article markup: headings, images with captions, tables, code", () => {
    const out = sanitizeBlogHtml(
      '<h2>Plan</h2><figure><img src="https://cdn.example.com/a.png" alt="a"><figcaption>cap</figcaption></figure>' +
        "<table><tr><th>A</th><td>1</td></tr></table><pre><code>x = 1</code></pre>",
    );
    expect(out).toContain("<h2>Plan</h2>");
    expect(out).toContain("<figcaption>cap</figcaption>");
    expect(out).toContain('loading="lazy"');
    expect(out).toContain("<th>A</th>");
    expect(out).toContain("<code>x = 1</code>");
  });

  it("drops scripts, handlers and javascript: links", () => {
    const out = sanitizeBlogHtml(
      '<p onclick="steal()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><form><input></form>',
    );
    expect(out).not.toContain("script");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<input");
  });

  it("allows only video-host iframes and opens external links safely", () => {
    const out = sanitizeBlogHtml(
      '<iframe src="https://www.youtube.com/embed/abc"></iframe>' +
        '<iframe src="https://evil.example.com/x"></iframe>' +
        '<a href="https://example.com">out</a><a href="/school/about">in</a>',
    );
    expect(out).toContain("youtube.com/embed/abc");
    expect(out).not.toContain("evil.example.com");
    expect(out).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
    expect(out).toContain('href="/school/about">in</a>');
  });

  it("makes a plain-text teaser", () => {
    expect(blogPlainText("<p>Hello&nbsp;<b>world</b> &amp; friends</p>", 50)).toBe("Hello world & friends");
    expect(blogPlainText("<p>" + "word ".repeat(100) + "</p>", 20).endsWith("…")).toBe(true);
  });
});

describe("sanitizeBlogArticle (table of contents)", () => {
  it("gives every H2/H3 a unique id and returns the outline in order", () => {
    const { html, headings } = sanitizeBlogArticle(
      "<h2>Why NEET?</h2><p>a</p><h3>Syllabus</h3><h2>Why NEET?</h2><h4>skip</h4><h2>  </h2>"
    );
    expect(headings).toEqual([
      { id: "toc-why-neet", text: "Why NEET?", level: 2 },
      { id: "toc-syllabus", text: "Syllabus", level: 3 },
      { id: "toc-why-neet-2", text: "Why NEET?", level: 2 },
    ]);
    expect(html).toContain('id="toc-why-neet-2"');
  });

  it("keeps an authored heading id and Hindi text", () => {
    const { headings } = sanitizeBlogArticle('<h2 id="intro">Start</h2><h2>पढ़ाई कैसे करें</h2>');
    expect(headings[0].id).toBe("intro");
    expect(headings[1].id).toBe("toc-पढ़ाई-कैसे-करें");
  });
});

describe("blogPostSlugFor", () => {
  it("reads the slug after the blog page, or ?post= on the home page", () => {
    expect(blogPostSlugFor("/school/free-resources/my-post", "", "school", "free-resources")).toBe("my-post");
    expect(blogPostSlugFor("/school/free-resources", "", "school", "free-resources")).toBeNull();
    expect(blogPostSlugFor("/school/other/my-post", "", "school", "free-resources")).toBeNull();
    expect(blogPostSlugFor("/school", "?post=hi", "school", "homepage")).toBe("hi");
  });
});
