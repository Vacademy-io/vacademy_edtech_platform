/**
 * The Cloudflare edge middleware's crawler branch (functions/_middleware.ts),
 * run against mocked backends: a site without languages must get exactly the
 * tags it got before; a site with हिन्दी gets localized tags, a ?lang= canonical,
 * hreflang alternates and <html lang>.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type OnRequest = (context: {
  request: Request;
  env: unknown;
  params: Record<string, string>;
  next: () => Promise<Response>;
}) => Promise<Response>;

// Imported by computed path: the middleware is not part of the app's
// TypeScript project (it uses Cloudflare's global types).
const MIDDLEWARE = new URL("../../../../functions/_middleware.ts", import.meta.url).href;
let onRequest: OnRequest;

beforeAll(async () => {
  ({ onRequest } = (await import(/* @vite-ignore */ MIDDLEWARE)) as { onRequest: OnRequest });
});

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta name="description" content="Learning Platform" />
    <title>Course Catalogue</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const PAGES = [
  { id: "home", route: "homepage", title: "Home", components: [] },
  { id: "about", route: "about", title: "About", seo: { metaTitle: "About Gurukul", metaDescription: "Our story" }, components: [] },
];

const I18N = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: { hi: { "About Gurukul": "गुरुकुल के बारे में", "Our story": "हमारी कहानी" } },
};

const crawl = async (url: string, globalSettings: Record<string, unknown>): Promise<string> => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const target = String(input);
    if (target.includes("/domain-routing/v1/resolve")) {
      return new Response(
        JSON.stringify({ instituteId: "inst-1", instituteName: "Gurukul Academy", instituteLogoFileId: "", tabText: "Gurukul" }),
        { headers: { "content-type": "application/json" } },
      );
    }
    if (target.includes("/course-catalogue/v1/institute/get/by-tag")) {
      return new Response(JSON.stringify({ catalogue_json: JSON.stringify({ pages: PAGES, globalSettings }) }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 404 });
  });
  const response = await onRequest({
    request: new Request(url, { headers: { "user-agent": "Googlebot/2.1" } }),
    env: {},
    params: {},
    next: async () => new Response(INDEX_HTML, { headers: { "content-type": "text/html; charset=utf-8" } }),
  });
  return response.text();
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("edge SEO on a site without languages", () => {
  // og:url always echoes the request URL (query included) — that is the one
  // line a different URL is expected to change.
  const withoutOgUrl = (html: string) => html.replace(/<meta property="og:url"[^>]*>/, "");

  it("ignores ?lang= entirely", async () => {
    const plain = await crawl("https://learn.example.com/shiksha/about", { seo: {} });
    const withLang = await crawl("https://learn.example.com/shiksha/about?lang=hi", { seo: {} });
    expect(withoutOgUrl(withLang)).toBe(withoutOgUrl(plain));
    expect(withLang).toContain('<html lang="en">');
    expect(withLang).toContain("<title>About Gurukul</title>");
    expect(withLang).toContain('<link rel="canonical" href="https://learn.example.com/shiksha/about" />');
    expect(withLang).not.toContain("hreflang");
  });

  it("treats a disabled language setup as no languages", async () => {
    const url = "https://learn.example.com/shiksha/about?lang=hi";
    const off = await crawl(url, { seo: {}, i18n: { ...I18N, enabled: false } });
    expect(off).toBe(await crawl(url, { seo: {} }));
  });
});

describe("edge SEO on a हिन्दी / EN site", () => {
  it("keeps the base page as it was, plus hreflang alternates", async () => {
    const html = await crawl("https://learn.example.com/shiksha/about", { seo: {}, i18n: I18N });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>About Gurukul</title>");
    expect(html).toContain('<link rel="canonical" href="https://learn.example.com/shiksha/about" />');
    expect(html).toContain('<link rel="alternate" hreflang="hi" href="https://learn.example.com/shiksha/about?lang=hi" />');
    expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://learn.example.com/shiksha/about" />');
  });

  it("serves the Hindi page with its own title, canonical and language", async () => {
    const html = await crawl("https://learn.example.com/shiksha/about?lang=hi&utm_source=ad", { seo: {}, i18n: I18N });
    expect(html).toContain('<html lang="hi">');
    expect(html).toContain("<title>गुरुकुल के बारे में</title>");
    expect(html).toContain('<meta name="description" content="हमारी कहानी" />');
    expect(html).toContain('<meta property="og:title" content="गुरुकुल के बारे में" />');
    // Tracking params are still dropped; only the language stays.
    expect(html).toContain('<link rel="canonical" href="https://learn.example.com/shiksha/about?lang=hi" />');
  });

  it("serves the base page for a language that has no translations yet", async () => {
    const untranslated = { ...I18N, strings: {} };
    const html = await crawl("https://learn.example.com/shiksha/about?lang=hi", { seo: {}, i18n: untranslated });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>About Gurukul</title>");
    expect(html).toContain('<link rel="canonical" href="https://learn.example.com/shiksha/about" />');
    expect(html).not.toContain("hreflang");
  });

  it("serves the base page for a language the site does not offer", async () => {
    const html = await crawl("https://learn.example.com/shiksha/about?lang=fr", { seo: {}, i18n: I18N });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>About Gurukul</title>");
    expect(html).toContain('<link rel="canonical" href="https://learn.example.com/shiksha/about" />');
  });
});
