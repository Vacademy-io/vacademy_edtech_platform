// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { SiteAssistantCardView } from "./SiteAssistantCards";
import { MarkdownLite } from "./MarkdownLite";
import { AssistantLinkContext, type AssistantLinkHandler } from "./link-context";
import { SiteAssistantUiContext } from "./context";
import { createSiteAssistantController } from "./controller";
import { classifyHref, safeHref } from "./links";
import { normalizeCard } from "./cards-normalize";
import { parseMarkdownLite } from "./markdown-lite";
import type { SiteAssistantApi } from "./api";
import type { LinkTarget } from "./links";
import type { SiteAssistantCard } from "./types";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const catalog = (lng: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../locales/${lng}/siteAssistant.json`), "utf8"));

const ORIGIN = "https://learn.example";
let root: Root | null = null;
let host: HTMLElement;
const navigate = vi.fn<(t: LinkTarget) => void>();

const handler: AssistantLinkHandler = {
  resolve: (href) => classifyHref(href, { mode: "hosted", origin: ORIGIN, basePath: "/brahm" }),
  navigate,
};

const controller = createSiteAssistantController({
  api: {} as SiteAssistantApi,
  source: { get: () => new Promise(() => {}), refresh: () => new Promise(() => {}) },
  getPage: () => ({ url: "", route: "", title: "" }),
});

const render = async (tree: React.ReactElement) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      e(
        I18nextProvider,
        { i18n: i18next },
        e(
          SiteAssistantUiContext.Provider,
          { value: { controller, consentText: null } },
          e(AssistantLinkContext.Provider, { value: handler }, tree),
        ),
      ),
    );
  });
};

const card = (raw: unknown): SiteAssistantCard => {
  const c = normalizeCard(raw);
  if (!c) throw new Error("card rejected");
  return c;
};

const renderCard = (raw: unknown) => render(e(SiteAssistantCardView, { card: card(raw), cardKey: "k" }));

beforeAll(async () => {
  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    defaultNS: "common",
    ns: ["common", "siteAssistant"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    resources: { en: { common: {}, siteAssistant: catalog("en") }, hi: { common: {}, siteAssistant: catalog("hi") } },
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  navigate.mockClear();
});

const course = {
  id: "c1",
  title: "Vedic Parenting",
  subtitle: "For new parents",
  image_url: "https://cdn.example/c1.jpg",
  price_label: "₹2,999",
  url: "https://learn.example/brahm/c1",
  badges: ["Bestseller"],
  languages: ["Hindi"],
  format_labels: ["Live"],
  availability: null,
};

describe("cards", () => {
  it("course: links to the course page through the router, with price, badges and image", async () => {
    await renderCard({ type: "course", ...course });
    const links = Array.from(host.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/brahm/c1", "/brahm/c1"]);
    expect(host.textContent).toContain("₹2,999");
    expect(host.textContent).toContain("Bestseller");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/c1.jpg");
    await act(async () => links[1].click());
    expect(navigate).toHaveBeenCalledWith({ kind: "internal", path: "/brahm/c1" });
  });

  it("course_list: one row per course and a See all link", async () => {
    await renderCard({ type: "course_list", items: [course, { ...course, id: "c2", title: "Garbha Sanskar" }], more_url: "/courses" });
    expect(host.querySelectorAll('[data-card="course"]')).toHaveLength(2);
    const seeAll = Array.from(host.querySelectorAll("a")).find((a) => a.textContent?.includes("See all"));
    expect(seeAll?.getAttribute("href")).toBe("/brahm/courses");
  });

  it("page_link: 'Take me there' navigates within the site (tag base added)", async () => {
    await renderCard({ type: "page_link", title: "About us", href: "/about#team", snippet: "Our founders" });
    const link = Array.from(host.querySelectorAll("a")).find((a) => a.textContent?.includes("Take me there"))!;
    expect(link.getAttribute("href")).toBe("/brahm/about#team");
    await act(async () => link.click());
    expect(navigate).toHaveBeenCalledWith({ kind: "internal", path: "/brahm/about#team" });
  });

  it("live_class_list: date, free/paid label and a Register link (other origin → new tab)", async () => {
    await renderCard({
      type: "live_class_list",
      items: [
        { title: "Free intro class", starts_at: "2026-10-25T10:30:00Z", is_paid: false, registration_url: "https://portal.example/register/live-class?x=1" },
        { title: "Masterclass", starts_at: "2026-10-26T10:30:00Z", is_paid: true, price_label: "₹499", registration_url: null },
      ],
    });
    expect(host.textContent).toContain("Free");
    expect(host.textContent).toContain("₹499");
    expect(host.querySelectorAll("time")).toHaveLength(2);
    const register = Array.from(host.querySelectorAll("a")).filter((a) => a.textContent === "Register");
    expect(register).toHaveLength(1);
    expect(register[0].getAttribute("target")).toBe("_blank");
    expect(register[0].getAttribute("rel")).toContain("noopener");
  });

  it("contact_info: tel, WhatsApp and mailto links, address as text, login via the router", async () => {
    await renderCard({
      type: "contact_info",
      phone: "+91 98956 03342",
      whatsapp: "919895603342",
      email: "hello@bv.org",
      address: "Haridwar",
      login_url: "/login",
    });
    const hrefs = Array.from(host.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["tel:+919895603342", "https://wa.me/919895603342", "mailto:hello@bv.org", "/brahm/login"]);
    expect(host.textContent).toContain("Haridwar");
  });

  it("compare: a table with one column per course", async () => {
    await renderCard({
      type: "compare",
      courses: [course, { ...course, id: "c2", title: "Garbha Sanskar" }],
      rows: [{ label: "Price", values: ["₹2,999", "₹1,499"] }, { label: "Language", values: ["Hindi"] }],
    });
    const headers = Array.from(host.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers.slice(1)).toEqual(["Vedic Parenting", "Garbha Sanskar"]);
    const cells = Array.from(host.querySelectorAll("tbody tr:nth-child(2) td")).map((td) => td.textContent);
    expect(cells).toEqual(["Hindi", "—"]);
  });

  it("path and notice", async () => {
    await renderCard({ type: "path", name: "Parenting path", steps: [{ position: 2, title: "Step two" }, { position: 1, title: "Step one", url: "/c1" }] });
    expect(Array.from(host.querySelectorAll("ol > li")).map((li) => li.textContent)).toEqual([
      expect.stringContaining("Step one"),
      expect.stringContaining("Step two"),
    ]);
    await act(async () => root?.unmount());
    await renderCard({ type: "notice", title: "Diwali break", body: "Classes resume on 3 Nov", ends_at: "2026-11-03" });
    expect(host.textContent).toContain("Diwali break");
    expect(host.textContent).toContain("Until");
  });

  it("follows the site language", async () => {
    await i18next.changeLanguage("hi");
    await renderCard({ type: "page_link", title: "About", href: "/about" });
    expect(host.textContent).toContain("वहाँ ले चलें");
    await act(async () => {
      await i18next.changeLanguage("en");
    });
  });
});

describe("unsafe links never render", () => {
  it("safeHref allows https and site-relative only", () => {
    expect(safeHref("https://a.example/x")).toBe("https://a.example/x");
    expect(safeHref("/about")).toBe("/about");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(" JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeHref("//evil.example/x")).toBeNull();
    expect(safeHref("http://a.example")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("/\\evil.example")).toBeNull();
  });

  it("cards drop their unsafe links (and the card when the link IS the card)", () => {
    expect(normalizeCard({ type: "course", ...course, url: "javascript:alert(1)" })).toBeNull();
    const info = normalizeCard({ type: "contact_info", email: "a@b.co", login_url: "javascript:x" });
    expect(info).toMatchObject({ email: "a@b.co", login_url: null });
    expect(normalizeCard({ type: "course", ...course, image_url: "http://cdn/x.jpg" })).toMatchObject({ image_url: null });
    expect(normalizeCard({ type: "unknown_card" })).toBeNull();
  });

  it("classifyHref: embed sends same-site links to the parent, everything else to a new tab", () => {
    const ctx = { mode: "embed" as const, parentOrigin: "https://www.brahmvarchas.org" };
    expect(classifyHref("/courses", ctx)).toEqual({ kind: "parent", url: "https://www.brahmvarchas.org/courses" });
    expect(classifyHref("https://www.brahmvarchas.org/about", ctx)).toEqual({ kind: "parent", url: "https://www.brahmvarchas.org/about" });
    expect(classifyHref("https://learning.brahmvarchas.org/c/1", ctx)).toEqual({ kind: "external", url: "https://learning.brahmvarchas.org/c/1" });
    expect(classifyHref("javascript:alert(1)", ctx)).toBeNull();
  });
});

describe("markdown-lite", () => {
  it("parses paragraphs, bold, lists and links", () => {
    const blocks = parseMarkdownLite("We have **two** options:\n- Live class\n- Recorded\n\n1. Pick one\n2. Enrol at [our page](/courses)");
    expect(blocks.map((b) => b.t)).toEqual(["p", "ul", "ol"]);
    expect(blocks[0]).toMatchObject({ t: "p", lines: [[{ t: "text", v: "We have " }, { t: "strong" }, { t: "text", v: " options:" }]] });
    expect(blocks[2]).toMatchObject({ t: "ol", start: 1 });
  });

  it("renders as elements only — markup in model text stays text; unsafe links are plain text", async () => {
    await render(
      e(MarkdownLite, {
        text: "**Bold** <img src=x onerror=alert(1)> [click](javascript:alert(1)) and [About](/about) https://bv.example/x.",
      }),
    );
    expect(host.querySelector("strong")?.textContent).toBe("Bold");
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
    const hrefs = Array.from(host.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/brahm/about", "https://bv.example/x"]);
  });
});
