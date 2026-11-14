// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * On a हिन्दी / EN site JsonRenderer shows the translated text, but anything
 * that is LOGIC keyed on authored text must keep using the authored values:
 * the contact form's submitted keys and lead identity, the stat icons and the
 * detail-block anchor ids (deep links). Also pins that an announcement's pill
 * and a detail block's eyebrow — copy stored under `tag` — are translated.
 */

const nav = vi.hoisted(() => ({ searchStr: "" }));
const lead = vi.hoisted(() => ({ submit: vi.fn(async () => ({ ok: true })) }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ tagName: "site" }),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: `/site/courses${nav.searchStr}` } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: "/site/courses", searchStr: nav.searchStr, search: {}, hash: "" };
    return opts?.select ? opts.select(location) : location;
  },
  Link: () => null,
}));
vi.mock("react-i18next", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
    i18n: undefined,
  }),
}));
// The submission itself (and the "too fast = bot" check) are not under test.
vi.mock("../-utils/website-lead", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  submitWebsiteLead: lead.submit,
  isSpamSubmission: () => false,
}));

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JsonRenderer } from "./JsonRenderer";
import { CatalogueLocaleProvider } from "../-utils/catalogue-locale";
import type { CatalogueI18nSettings } from "../-utils/catalogue-i18n";

const h = React.createElement;

const memoryStorage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memoryStorage.get(k) ?? null,
    setItem: (k: string, v: string) => void memoryStorage.set(k, String(v)),
    removeItem: (k: string) => void memoryStorage.delete(k),
    clear: () => memoryStorage.clear(),
  },
});

const HINDI_SITE: CatalogueI18nSettings = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: {
    hi: {
      "Your name": "आपका नाम",
      "Email address": "ईमेल पता",
      "Mobile number": "मोबाइल नंबर",
      Message: "संदेश",
      // A camelCase field name reads as text to the classifier, so AI
      // translation can produce an entry for it too.
      fullName: "पूरा नाम",
      Students: "छात्र",
      "40 Courses": "40 पाठ्यक्रम",
      "Expert teachers": "विशेषज्ञ शिक्षक",
      "New Program": "नया कार्यक्रम",
      "Weekend Batch": "सप्ताहांत बैच",
      Flagship: "प्रमुख",
      "fees-": "शुल्क-",
      News: "समाचार",
      "Admissions open": "प्रवेश खुले",
    },
  },
};

type Section = Record<string, unknown>;
const pageOf = (...components: Section[]) => ({ id: "courses", route: "courses", title: "Courses", components });
const rendererOf = (components: Section[]) =>
  h(JsonRenderer, {
    page: pageOf(...components),
    globalSettings: {} as never,
    instituteId: "inst",
    tagName: "site",
  } as never);
const withLanguages = (components: Section[], settings: CatalogueI18nSettings | undefined = HINDI_SITE) =>
  h(CatalogueLocaleProvider, { settings, scope: "site", children: rendererOf(components) });

beforeEach(() => {
  nav.searchStr = "";
  lead.submit.mockClear();
  localStorage.clear();
});

/* ── contact form ───────────────────────────────────────────────────── */

const CONTACT: Section = {
  id: "contact",
  type: "contactForm",
  enabled: true,
  props: {
    heading: "Ask us",
    audienceId: "aud-1",
    fields: [
      { name: "fullName", label: "Your name", type: "text", required: true },
      // Recognised as the email / phone only by its label.
      { name: "field1", label: "Email address", type: "text", required: true },
      { name: "field2", label: "Mobile number", type: "text", required: false },
      { name: "message", label: "Message", type: "textarea", required: false },
    ],
  },
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const mount = async (element: React.ReactElement) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  return host;
};

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Types into a controlled input the way a visitor does (React listens to `input`). */
const type = async (el: Element | null, value: string) => {
  if (!el) throw new Error("field not found");
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** The control of the n-th field, in authored order (the hidden honeypot box is skipped). */
const control = (form: HTMLFormElement, n: number) =>
  form.querySelectorAll('input:not([tabindex="-1"]), textarea')[n] ?? null;

const fillAndSubmit = async (el: HTMLElement) => {
  const form = el.querySelector("form") as HTMLFormElement;
  await type(control(form, 0), "Asha Verma");
  await type(control(form, 1), "asha@example.org");
  await type(control(form, 3), "Call me after 6");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

describe("contact form on a हिन्दी / EN site", () => {
  it("shows the translated labels but submits under the authored labels, as an English visitor's form does", async () => {
    nav.searchStr = "?lang=hi";
    const el = await mount(withLanguages([CONTACT]));
    expect(el.textContent).toContain("ईमेल पता");
    expect(el.textContent).toContain("संदेश");
    expect(el.textContent).not.toContain("Email address");
    await fillAndSubmit(el);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(lead.submit).toHaveBeenCalledTimes(1);
    expect(lead.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        instituteId: "inst",
        audienceId: "aud-1",
        fullName: "Asha Verma",
        email: "asha@example.org",
        mobileNumber: "",
        customFieldValues: { Message: "Call me after 6" },
      }),
    );
  });

  it("sends exactly the same lead for an English visitor", async () => {
    const el = await mount(withLanguages([CONTACT]));
    expect(el.textContent).toContain("Email address");
    await fillAndSubmit(el);
    expect(lead.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "Asha Verma",
        email: "asha@example.org",
        customFieldValues: { Message: "Call me after 6" },
      }),
    );
  });

  it("recognises a phone field by its authored label in every language", async () => {
    nav.searchStr = "?lang=hi";
    const el = await mount(withLanguages([CONTACT]));
    expect(el.textContent).toContain("मोबाइल नंबर");
    // react-phone-input-2 (country code picker), not a bare text box.
    expect(el.querySelectorAll(".react-tel-input")).toHaveLength(1);
  });
});

/* ── stat icons, detail-block anchors, tag pills ───────────────────── */

const STATS: Section = {
  id: "stats",
  type: "statsHighlights",
  enabled: true,
  props: {
    headerText: "Our reach",
    stats: [{ value: "1,200+", label: "Students" }, { label: "40 Courses" }],
    groups: [],
  },
};
const STAT_GROUPS: Section = {
  id: "stat-groups",
  type: "statsHighlights",
  enabled: true,
  props: {
    headerText: "Our reach",
    groups: [{ description: "Admissions open", stats: [{ value: "25", label: "Expert teachers" }] }],
  },
};

const iconsOf = (html: string) => html.match(/<svg[\s\S]*?<\/svg>/g) ?? [];

describe("stat icons", () => {
  it("are picked from the authored labels, so a हिन्दी page shows the same icons", () => {
    const english = renderToString(withLanguages([STATS, STAT_GROUPS]));
    nav.searchStr = "?lang=hi";
    const hindi = renderToString(withLanguages([STATS, STAT_GROUPS]));
    expect(hindi).toContain("छात्र");
    expect(hindi).toContain("पाठ्यक्रम");
    expect(hindi).toContain("विशेषज्ञ शिक्षक");
    expect(iconsOf(english)).toHaveLength(3);
    expect(iconsOf(hindi)).toEqual(iconsOf(english));
  });
});

const BLOCKS: Section = {
  id: "programs",
  type: "detailBlocks",
  enabled: true,
  props: {
    anchorPrefix: "fees-",
    // The editor adds blocks without an anchor: the id comes from the title.
    blocks: [{ title: "New Program", tag: "Flagship" }, { title: "Weekend Batch", anchor: "weekend" }],
  },
};

describe("detail blocks", () => {
  it("keep their English anchor ids on a हिन्दी page, so deep links still land", () => {
    nav.searchStr = "?lang=hi";
    const html = renderToString(withLanguages([BLOCKS]));
    expect(html).toContain("नया कार्यक्रम");
    expect(html).toContain('id="fees-new-program"');
    expect(html).toContain('id="fees-weekend"');
    expect(html).not.toContain("शुल्क-");
  });

  it("translate the eyebrow (stored under `tag`)", () => {
    nav.searchStr = "?lang=hi";
    const html = renderToString(withLanguages([BLOCKS]));
    expect(html).toContain("प्रमुख");
    expect(html).not.toContain("Flagship");
  });
});

describe("announcement pills", () => {
  it("are translated like the rest of the announcement", () => {
    nav.searchStr = "?lang=hi";
    const html = renderToString(
      withLanguages([
        {
          id: "feed",
          type: "announcementFeed",
          enabled: true,
          props: { announcements: [{ title: "Admissions open", date: "2025-01-15", tag: "News" }] },
        },
      ]),
    );
    expect(html).toContain("प्रवेश खुले");
    expect(html).toContain("समाचार");
    expect(html).not.toContain(">News<");
  });
});

describe("a site without languages", () => {
  it("renders these sections exactly as without the language provider", () => {
    const sections = [STATS, STAT_GROUPS, BLOCKS, CONTACT];
    const bare = renderToString(rendererOf(sections));
    expect(renderToString(withLanguages(sections, undefined))).toBe(bare);
    expect(bare).toContain('id="fees-new-program"');
    expect(bare).toContain("Email address");
  });
});
