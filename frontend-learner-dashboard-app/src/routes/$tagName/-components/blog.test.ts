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

  it("reads a leading number badge as '1 Title', not '1Title'", () => {
    const { headings } = sanitizeBlogArticle('<h2 class="h"><span class="num">1</span>What is UPPSC?</h2>');
    expect(headings[0]).toEqual({ id: "toc-1-what-is-uppsc", text: "1 What is UPPSC?", level: 2 });
  });
});

describe("sanitizeBlogArticle (the post's own <style>)", () => {
  const pasted = `<!-- Elementor widget -->
<style>
.pcm *{box-sizing:border-box;margin:0}
.pcm{--ink:#0e2742;color:var(--ink)}
.pcm .hero:after{content:"}";position:absolute}
:root{--x:1px} body .pcm{font-size:16px}
h2, .pcm :is(p, li){line-height:1.6}
@media(max-width:760px){.pcm .stats{grid-template-columns:repeat(2,1fr)}}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@import url("https://evil.example/x.css");
.pcm .bg{background:url(https://evil.example/t.png)}
</style>
<div class="pcm"><h2>Hello</h2></div>`;

  it("lifts the stylesheet out of the body and scopes every selector to the article", () => {
    const { html, css } = sanitizeBlogArticle(pasted);
    expect(html).not.toContain("<style");
    expect(html).toContain('<div class="pcm">');
    expect(css).toContain(".catalogue-blog-article .pcm *{");
    expect(css).toContain('.catalogue-blog-article .pcm .hero:after{content:"}";position:absolute}');
    expect(css).toContain(".catalogue-blog-article{--x:1px}");
    expect(css).toContain(".catalogue-blog-article .pcm{font-size:16px}");
    expect(css).toContain(".catalogue-blog-article h2,.catalogue-blog-article .pcm :is(p, li){");
    expect(css).toContain("@media(max-width:760px){.catalogue-blog-article .pcm .stats{");
    expect(css).toContain("@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}");
  });

  it("scrubs the stylesheet like a page block's CSS", () => {
    const { css } = sanitizeBlogArticle(pasted);
    expect(css).not.toContain("@import");
    expect(css).not.toContain("evil.example");
    expect(sanitizeBlogArticle("<style>.a{color:red}</style ><p>x</p>").css).not.toContain("</");
  });

  it("keeps a full-bleed 100vw breakout inside the article column", () => {
    const { css, html } = sanitizeBlogArticle(`<style>
.g{width:100vw !important;max-width:100vw;margin-left:calc(-50vw + 50%) !important;margin-right:calc(50% - 50dvw);padding:0 5vw}
.g h1{font-size:clamp(32px,5vw,54px)}
.g{--w:100vw}
@media (min-width:880px){.g .s{min-width:80vw}}
</style><div class="g" style="width:100vw;margin-left:calc(50% - 50vw);height:50vh"><h1>Hi</h1></div>`);
    expect(css).toContain(
      ".catalogue-blog-article .g{width:100% !important;max-width:100%;margin-left:calc(-50% + 50%) !important;margin-right:calc(50% - 50%);padding:0 5%}"
    );
    expect(css).toContain("font-size:clamp(32px,5vw,54px)");
    expect(css).toContain("--w:100vw");
    expect(css).toContain("@media (min-width:880px){.catalogue-blog-article .g .s{min-width:80%}}");
    expect(html).toContain('style="width:100%;margin-left:calc(50% - 50%);height:50vh"');
  });

  it("returns no css for a body without a stylesheet, and keeps CSS out of card previews", () => {
    expect(sanitizeBlogArticle("<p>plain</p>").css).toBe("");
    expect(blogPlainText(pasted)).toBe("Hello");
    expect(sanitizeBlogHtml(pasted)).not.toContain("<style");
  });

  // A real AI-drafted post opened with the usual Google Fonts import. The
  // `;` inside `wght@400;500` ended the import early, and the leftover quote
  // swallowed the whole sheet: the post rendered with no styling at all.
  it("drops a font @import whose URL holds a ';' without losing the rest of the sheet", () => {
    const { css } = sanitizeBlogArticle(`<style>
@import url('https://fonts.googleapis.com/css2?family=Marcellus&family=Inter:wght@400;500;600;700;800&display=swap');
.pcm-ga { font-family:'Inter',sans-serif; color:#1F2937; }
.pcm-num { display:flex; }
</style><div class="pcm-ga"><div class="pcm-num">1</div></div>`);
    expect(css).not.toMatch(/@import|googleapis|display=swap/);
    expect(css).toContain(".catalogue-blog-article .pcm-ga{ font-family:'Inter',sans-serif; color:#1F2937; }");
    expect(css).toContain(".catalogue-blog-article .pcm-num{ display:flex; }");
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
    expect((el.sheet as CSSStyleSheet).cssRules.length).toBe(2);
    el.remove();
  });

  it("drops quoted, unquoted and media-qualified imports whole", () => {
    const { css } = sanitizeBlogArticle(`<style>
@import "https://x.test/a;b.css" screen;
@import url(https://x.test/c?w=400;700);
@import 'tailwindcss';
.a{color:red}
</style><p>x</p>`);
    expect(css).toBe(".catalogue-blog-article .a{color:red}");
  });
});

describe("sanitizeBlogArticle (inline SVG and nav)", () => {
  it("keeps inline SVG icons and a <nav> contents box", () => {
    const { html } = sanitizeBlogArticle(
      '<nav class="pcm-toc" aria-label="Contents"><ol><li><a href="#s1">One</a></li></ol></nav>' +
        '<svg class="ic" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" fill="#FFF3E6"/>' +
        '<path d="M24 10v28" stroke="#F97316" stroke-width="2" stroke-linecap="round"/></svg>'
    );
    expect(html).toContain('<nav class="pcm-toc" aria-label="Contents">');
    expect(html).toContain('<svg class="ic" viewBox="0 0 48 48" fill="none">');
    expect(html).toContain('<circle cx="24" cy="24" r="22" fill="#FFF3E6"></circle>');
    expect(html).toContain('stroke-linecap="round"');
  });

  it("still strips script and event handlers hidden in an SVG", () => {
    const { html } = sanitizeBlogArticle(
      '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><rect width="5" height="5"/></a></svg>'
    );
    expect(html).not.toMatch(/onload|<script|alert|javascript:/);
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
