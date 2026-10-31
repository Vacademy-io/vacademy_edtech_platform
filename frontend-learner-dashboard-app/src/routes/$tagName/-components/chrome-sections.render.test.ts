// @vitest-environment jsdom
/**
 * Opt-in chrome sections rendered through JsonRenderer, as a site sees them:
 * ctaBanner variant "band" (dark help band, light institutions band, app
 * banner with the phone), stepsProcess variant "cards", footer variant
 * "brand" with its newsletter, and the compact header's page offset. Also
 * pins that the newsletterSignup section still submits exactly as before
 * through the shared hook, and that a हिन्दी visitor gets translated copy.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  location: { pathname: "/site/learning-paths", searchStr: "", search: {}, href: "/site/learning-paths", hash: "" },
  submit: vi.fn(async () => ({ ok: true })),
  spam: false,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ tagName: "site" }),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: "/site/learning-paths" } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) =>
    opts?.select ? opts.select(mocks.location) : mocks.location,
  Link: () => null,
}));
vi.mock("react-i18next", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
    i18n: undefined,
  }),
}));
vi.mock("./../-utils/website-lead", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  submitWebsiteLead: mocks.submit,
  isSpamSubmission: () => mocks.spam,
}));
vi.mock("@/constants/urls", () => ({ BASE_URL: "https://api.test", urlCourseDetails: "https://api.test/v2/search" }));
vi.mock("@/hooks/use-domain-routing", () => ({
  useDomainRouting: () => ({ instituteId: "inst-1", instituteName: "Test", instituteLogoFileId: null, homeIconClickRoute: null }),
}));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: vi.fn(async (id: string) => `https://files.test/${id}`) }));
vi.mock("@/services/domain-routing", () => ({ getCachedRootCatalogueTag: () => null }));
vi.mock("../-stores/cart-store", () => ({
  useCartStore: () => ({ getItemCountByMode: async () => 0, items: [], syncCart: async () => {} }),
}));
vi.mock("@/hooks/useIsIOS", () => ({ isIOSPlatform: () => false }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "web" } }));
vi.mock("@/lib/auth/sessionUtility", () => ({ getAccessToken: async () => null, isTokenExpired: () => true }));
vi.mock("@/components/announcements", () => ({ SystemAlertsBar: () => null }));
vi.mock("@/components/common/layout-container/sidebar/logoutSidebar", () => ({ LogoutSidebar: () => null }));
vi.mock("@/components/common/layout-container/sidebar/useSidebar", () => ({
  default: () => ({ setSidebarOpen: vi.fn() }),
}));
vi.mock("@/components/common/auth/modal/AuthModal", () => ({ AuthModal: () => null }));
vi.mock("@/services/student-display-settings", () => ({
  getStudentDisplaySettings: async () => ({ signup: { enabled: true, presentation: "page" } }),
}));

import { JsonRenderer } from "./JsonRenderer";
import { CatalogueLocaleProvider } from "../-utils/catalogue-locale";

const h = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

type Section = Record<string, unknown>;

const HI: Record<string, string> = {
  "For schools & institutions": "विद्यालयों और संस्थानों के लिए",
  "Partner with us": "हमारे साथ साझेदारी करें",
  "Get the app": "ऐप पाएँ",
  About: "परिचय",
  "Translate Knowledge • Transform Society": "ज्ञान का अनुवाद • समाज का रूपांतरण",
  "No clutter. Just thoughtful updates from Brahm Varchas.": "कोई भीड़ नहीं।",
  "How a learning path works": "लर्निंग पाथ कैसे काम करता है",
};

const i18n = (withHindi: boolean) => ({
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: { hi: withHindi ? HI : {} },
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const renderPage = async (components: Section[], { hindi = false, pageId = "learning-paths" } = {}) => {
  if (hindi) mocks.location = { ...mocks.location, searchStr: "?lang=hi" };
  const settings = i18n(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = { id: pageId, route: pageId, title: pageId, components };
  await act(async () => {
    root!.render(
      h(
        QueryClientProvider,
        { client },
        h(CatalogueLocaleProvider, {
          settings,
          scope: "site",
          persist: false,
          children: h(JsonRenderer, {
            page,
            globalSettings: { i18n: settings } as never,
            instituteId: "inst-1",
            tagName: "site",
            catalogueData: { globalSettings: { i18n: settings }, pages: [page] } as never,
          } as never),
        } as never),
      ),
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return container;
};

const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = async (form: HTMLFormElement) => {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

beforeEach(() => {
  mocks.location = { pathname: "/site/learning-paths", searchStr: "", search: {}, href: "/site/learning-paths", hash: "" };
  mocks.submit.mockClear();
  mocks.spam = false;
  memoryStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

/* ── fixtures (the Knowledge Streams site JSON) ───────────────────────── */

const HELP_BAND: Section = {
  id: "courses-not-sure",
  type: "ctaBanner",
  enabled: true,
  props: {
    variant: "band",
    backgroundColor: "#1A1208", // design-lint-ignore: fixture colour
    textColor: "#FFFFFF", // design-lint-ignore: fixture colour
    subheadingColor: "#A89C80", // design-lint-ignore: fixture colour
    heading: "Not sure which course is right for you?",
    subheading: "Answer one question about where you are in life and we'll suggest where to begin.",
    button: { enabled: true, text: "Find your path", action: "navigate", target: "/learning-paths", style: "olive", icon: "arrow" },
    secondaryButton: { enabled: true, text: "Talk to us", action: "openForm", audienceId: "aud-talk", formTitle: "Talk to us", style: "outline-light" },
  },
};

const INSTITUTIONS: Section = {
  id: "lp-institutions",
  type: "ctaBanner",
  enabled: true,
  props: {
    variant: "band",
    bandSize: "lg",
    backgroundColor: "#F5EAC9", // design-lint-ignore: fixture colour
    eyebrow: "For schools & institutions",
    heading: "Need a path for your teachers or students?",
    subheading: "We design custom learning paths.",
    button: { enabled: true, text: "Talk to us", action: "openForm", audienceId: "aud-talk", formTitle: "Talk to us", style: "outline-dark" },
    secondaryButton: { enabled: true, text: "Partner with us", action: "openForm", audienceId: "aud-talk", formTitle: "Partner with us", style: "primary" },
  },
};

const APP: Section = {
  id: "lp-app",
  type: "ctaBanner",
  enabled: true,
  props: {
    variant: "band",
    backgroundColor: "#1A1208", // design-lint-ignore: fixture colour
    eyebrow: "Brahm Varchas app",
    heading: "Walk your path, one step at a time, from your phone.",
    subheading: "Open your next step wherever you are.",
    mockup: { kind: "phone", image: "https://cdn.test/app.jpg", alt: "The app on a phone" },
    button: { enabled: true, text: "Get the app", action: "navigate", target: "/login", style: "olive", icon: "arrow" },
  },
};

const STEPS: Section = {
  id: "lp-how",
  type: "stepsProcess",
  enabled: true,
  props: {
    variant: "cards",
    headerText: "How a learning path works",
    backgroundColor: "#F5EAC9", // design-lint-ignore: fixture colour
    textColor: "#1A1208", // design-lint-ignore: fixture colour
    steps: [
      { number: "1", title: "Start with step one", description: "Most paths open with a free course." },
      { number: "2", title: "Learn in order, at your pace", description: "Each step builds on the last." },
      { number: "3", title: "Finish and keep going", description: "Pick a related path." },
    ],
  },
};

const column = (title: string, labels: string[]) => ({
  title,
  links: labels.map((label, i) => ({ label, route: i % 2 ? `https://example.test/${i}` : `/x-${i}`, openInSameTab: true })),
});

const FOOTER: Section = {
  id: "footer-1",
  type: "footer",
  enabled: true,
  props: {
    variant: "brand",
    layout: "four-column",
    backgroundColor: "#F5EAC9", // design-lint-ignore: fixture colour
    leftSection: {
      title: "Brahm Varchas",
      logo: "logo-file-id",
      text: "<p>A modern learning platform rooted in Bharatiya Knowledge Systems.</p>",
      tagline: "Translate Knowledge • Transform Society",
      socials: [
        { platform: "YouTube", icon: "youtube", url: "https://youtube.test/bv" },
        { platform: "Instagram", icon: "instagram", url: "https://instagram.test/bv" },
        { platform: "Facebook", icon: "facebook", url: "https://facebook.test/bv" },
        { platform: "Twitter", icon: "twitter", url: "https://twitter.test/bv" },
      ],
    },
    newsletter: {
      heading: "Stay connected",
      subheading: "Join us for new courses.",
      placeholder: "Your email address",
      buttonText: "Subscribe",
      note: "No clutter. Just thoughtful updates from Brahm Varchas.",
      successMessage: "Thank you.",
      audienceId: "aud-news",
    },
    rightSection1: column("Explore", ["Knowledge Streams", "Courses"]),
    rightSection2: column("Learn", ["E-books"]),
    rightSection3: column("About", ["About Us", "Team"]),
    rightSection4: column("Support", ["FAQ"]),
    bottomNote: "© 2026 Brahm Varchas. All rights reserved.",
    bottomTagline: "Translate Knowledge → Transform Society",
    showLanguageSwitcher: true,
  },
};

/* ── tests ─────────────────────────────────────────────────────────────── */

describe("ctaBanner variant band", () => {
  it("dark help band: heading, subheading colour, olive button with an arrow and an outline button", async () => {
    const el = await renderPage([HELP_BAND]);
    const band = el.querySelector('[data-cta-band="md"]') as HTMLElement;
    expect(band.className).toContain("lg:py-16");
    expect(band.style.backgroundColor).toBe("rgb(26, 18, 8)");
    expect(band.querySelector("h2")!.textContent).toBe("Not sure which course is right for you?");
    expect((band.querySelector("h2") as HTMLElement).style.color).toBe("rgb(255, 255, 255)");
    expect((band.querySelector("p") as HTMLElement).style.color).toBe("rgb(168, 156, 128)");
    const [find, talk] = Array.from(band.querySelectorAll("a, button")) as HTMLElement[];
    expect(find.tagName).toBe("A");
    expect(find.getAttribute("href")).toBe("/site/learning-paths");
    expect(find.className).toContain("bg-palette-olive");
    expect(find.textContent).toBe("Find your path→");
    expect(talk.className).toContain("border-palette-sand text-palette-sand");
    const heard: unknown[] = [];
    const onOpen = (e: Event) => heard.push((e as CustomEvent).detail);
    window.addEventListener("openAudienceForm", onOpen);
    await act(async () => talk.click());
    window.removeEventListener("openAudienceForm", onOpen);
    expect(heard).toEqual([{ audienceId: "aud-talk", title: "Talk to us" }]);
  });

  it("light institutions band: gold eyebrow, 72px padding, outline-dark then primary", async () => {
    const el = await renderPage([INSTITUTIONS]);
    const band = el.querySelector('[data-cta-band="lg"]')!;
    expect(band.className).toContain("lg:py-[72px]"); // design-lint-ignore: asserts the exact Figma class
    const eyebrow = band.querySelector("p")!;
    expect(eyebrow.textContent).toBe("For schools & institutions");
    expect(eyebrow.className).toContain("text-palette-gold");
    expect(band.querySelector("h2")!.className).toContain("text-palette-text");
    const buttons = Array.from(band.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Talk to us", "Partner with us"]);
    expect(buttons[0].className).toContain("border-palette-outline");
    expect(buttons[1].className).toContain("bg-palette-primary");
  });

  it("app banner: the phone shows the picture (hidden on phones) and the eyebrow uses the on-dark accent", async () => {
    const el = await renderPage([APP]);
    const band = el.querySelector('[data-cta-band="app"]')!;
    const phone = band.querySelector("[data-phone-mockup]")!;
    expect(phone.className).toContain("hidden md:block");
    expect(phone.querySelector("img")!.getAttribute("alt")).toBe("The app on a phone");
    expect(band.querySelector("p")!.className).toContain("text-palette-accent-on-dark");
    expect(band.querySelector("a")!.getAttribute("href")).toBe("/site/login");
  });

  it("a हिन्दी visitor gets the translated eyebrow and button text", async () => {
    const el = await renderPage([INSTITUTIONS, APP], { hindi: true });
    expect(el.textContent).toContain("विद्यालयों और संस्थानों के लिए");
    expect(el.textContent).toContain("हमारे साथ साझेदारी करें");
    expect(el.textContent).toContain("ऐप पाएँ");
  });

  it("a band without a background colour gets the dark ink and light text, so the heading stays readable", async () => {
    const props = { ...(HELP_BAND.props as Record<string, unknown>) };
    delete props.backgroundColor;
    delete props.textColor;
    delete props.subheadingColor;
    const el = await renderPage([{ ...HELP_BAND, props: { ...props, eyebrow: "Need help?" } }]);
    const band = el.querySelector('[data-cta-band="md"]') as HTMLElement;
    expect(band.className).toContain("bg-palette-text");
    expect(band.style.backgroundColor).toBe("");
    const h2 = band.querySelector("h2")!;
    expect(h2.className).toContain("text-white");
    expect(h2.className).not.toContain("text-palette-text");
    const [eyebrow, sub] = Array.from(band.querySelectorAll("p"));
    expect(eyebrow.className).toContain("text-palette-accent-on-dark");
    expect(sub.className).toContain("text-palette-body-on-dark");
  });

  it("a band with a light author colour keeps dark text", async () => {
    const el = await renderPage([INSTITUTIONS]);
    expect(el.querySelector("h2")!.className).toContain("text-palette-text");
    expect(el.querySelector("h2")!.className).not.toContain("text-white");
  });

  it("a banner without the variant keeps the original renderer and its white button", async () => {
    const el = await renderPage([{ ...HELP_BAND, props: { ...(HELP_BAND.props as object), variant: undefined } }]);
    expect(el.querySelector("[data-cta-band]")).toBeNull();
    expect(el.querySelector("section")!.className).toBe("catalogue-section");
    expect(el.querySelector("a")!.className).toContain("bg-white");
    expect(el.textContent).not.toContain("Talk to us");
  });
});

describe("stepsProcess variant cards", () => {
  it("one row of numbered cards under a centred heading, no connectors", async () => {
    const el = await renderPage([STEPS]);
    const section = el.querySelector("[data-steps-cards]")!;
    const cards = section.querySelectorAll("article");
    expect(cards).toHaveLength(3);
    expect(Array.from(cards).map((c) => c.querySelector("span")!.textContent)).toEqual(["1", "2", "3"]);
    expect(cards[0].className).toContain("rounded-[20px]"); // design-lint-ignore: asserts the exact Figma class
    expect(cards[0].querySelector("span")!.className).toContain("bg-palette-primary");
    expect(cards[1].querySelector("h3")!.textContent).toBe("Learn in order, at your pace");
    expect((section.querySelector("h2") as HTMLElement).style.color).toBe("rgb(26, 18, 8)");
    expect(section.querySelector(".h-0\\.5")).toBeNull();
  });

  it("translates the heading for a हिन्दी visitor", async () => {
    const el = await renderPage([STEPS], { hindi: true });
    expect(el.querySelector("h2")!.textContent).toBe("लर्निंग पाथ कैसे काम करता है");
  });
});

describe("footer variant brand", () => {
  it("logo, wordmark, tagline, socials, four columns in order and the bottom bar", async () => {
    const el = await renderPage([FOOTER], { pageId: "footer" });
    const footer = el.querySelector('footer[data-footer-variant="brand"]')!;
    expect(footer.querySelector("img")!.getAttribute("src")).toBe("https://files.test/logo-file-id");
    expect(footer.textContent).toContain("Brahm Varchas");
    expect(footer.textContent).toContain("Translate Knowledge • Transform Society");
    expect(Array.from(footer.querySelectorAll("nav h3")).map((x) => x.textContent)).toEqual([
      "Explore",
      "Learn",
      "About",
      "Support",
    ]);
    expect(Array.from(footer.querySelectorAll("ul[aria-label] a")).map((a) => a.getAttribute("aria-label"))).toEqual([
      "YouTube",
      "Instagram",
      "Facebook",
      "Twitter",
    ]);
    expect(footer.textContent).toContain("© 2026 Brahm Varchas. All rights reserved.");
    expect(footer.textContent).toContain("Translate Knowledge → Transform Society");
    const toggle = footer.querySelector('[role="group"]')!;
    expect(Array.from(toggle.querySelectorAll("button")).map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["हिन्दी", "false"],
      ["EN", "true"],
    ]);
    expect(toggle.querySelector("button")!.className).not.toContain("bg-");
  });

  it("column links are real links: internal ones carry the site prefix, external ones open a new tab", async () => {
    const el = await renderPage([FOOTER], { pageId: "footer" });
    const links = Array.from(el.querySelectorAll("footer nav a")) as HTMLAnchorElement[];
    expect(el.querySelectorAll("footer nav button")).toHaveLength(0);
    // column(): even index = internal "/x-<i>", odd = external.
    expect(links[0].textContent).toBe("Knowledge Streams");
    expect(links[0].getAttribute("href")).toBe("/site/x-0");
    expect(links[0].getAttribute("target")).toBeNull();
    expect(links[1].getAttribute("href")).toBe("https://example.test/1");
    expect(links[0].className).toBe(links[1].className);
  });

  it("an internal link keeps a हिन्दी visitor's language in its address", async () => {
    const el = await renderPage([FOOTER], { pageId: "footer", hindi: true });
    expect((el.querySelector("footer nav a") as HTMLAnchorElement).getAttribute("href")).toBe("/site/x-0?lang=hi");
  });

  it("a social link without a platform is still named for screen readers", async () => {
    const left = (FOOTER.props as { leftSection: Record<string, unknown> }).leftSection;
    const el = await renderPage(
      [
        {
          ...FOOTER,
          props: {
            ...(FOOTER.props as object),
            leftSection: {
              ...left,
              socials: [
                { icon: "youtube", url: "https://youtube.test/bv" },
                { url: "https://example.test/profile" },
              ],
            },
          },
        },
      ],
      { pageId: "footer" },
    );
    const socials = Array.from(el.querySelectorAll("footer ul[aria-label] a"));
    expect(socials.map((a) => a.getAttribute("aria-label"))).toEqual(["youtube", "https://example.test/profile"]);
    expect(socials.map((a) => a.getAttribute("title"))).toEqual(["youtube", "https://example.test/profile"]);
  });

  it("the newsletter submits a NEWSLETTER lead to its campaign, tagged as the footer's", async () => {
    const el = await renderPage([FOOTER], { pageId: "footer" });
    const form = el.querySelector("footer form") as HTMLFormElement;
    await typeInto(form.querySelector('input[type="email"]') as HTMLInputElement, "a@b.test");
    await submit(form);
    expect(mocks.submit).toHaveBeenCalledWith({
      instituteId: "inst-1",
      audienceId: "aud-news",
      email: "a@b.test",
      sourceType: "NEWSLETTER",
      sourceId: "site:footer-newsletter",
    });
    expect(el.querySelector('footer [role="status"]')!.textContent).toBe("Thank you.");
  });

  it("a bot (honeypot) sees success without a lead", async () => {
    mocks.spam = true;
    const el = await renderPage([FOOTER], { pageId: "footer" });
    const form = el.querySelector("footer form") as HTMLFormElement;
    await typeInto(form.querySelector('input[type="email"]') as HTMLInputElement, "bot@b.test");
    await submit(form);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(el.querySelector('footer [role="status"]')).not.toBeNull();
  });

  it("a हिन्दी visitor gets the translated tagline, note and column title", async () => {
    const el = await renderPage([FOOTER], { pageId: "footer", hindi: true });
    const footer = el.querySelector("footer")!;
    expect(footer.textContent).toContain("ज्ञान का अनुवाद • समाज का रूपांतरण");
    expect(footer.textContent).toContain("कोई भीड़ नहीं।");
    expect(Array.from(footer.querySelectorAll("nav h3")).map((x) => x.textContent)).toContain("परिचय");
  });

  it("a footer without the variant keeps the original layout", async () => {
    const el = await renderPage([{ ...FOOTER, props: { ...(FOOTER.props as object), variant: undefined } }], {
      pageId: "footer",
    });
    expect(el.querySelector("[data-footer-variant]")).toBeNull();
    expect(el.querySelector("footer form")).toBeNull();
    expect(el.querySelector("footer h3")!.className).toBe("text-sm font-semibold mb-3 text-primary-500");
  });
});

describe("newsletterSignup section (shared hook)", () => {
  it("still submits with its original sourceId", async () => {
    const el = await renderPage([
      { id: "n", type: "newsletterSignup", enabled: true, props: { heading: "News", audienceId: "aud-2" } },
    ]);
    const form = el.querySelector("form") as HTMLFormElement;
    await typeInto(form.querySelector('input[type="email"]') as HTMLInputElement, "c@d.test");
    await submit(form);
    expect(mocks.submit).toHaveBeenCalledWith({
      instituteId: "inst-1",
      audienceId: "aud-2",
      email: "c@d.test",
      sourceType: "NEWSLETTER",
      sourceId: "site:newsletter",
    });
  });
});

describe("page offset under the header", () => {
  const header = (props: Record<string, unknown>) => ({
    id: "header-1",
    type: "header",
    enabled: true,
    props: { navigation: [{ label: "Home", route: "home" }], ...props },
  });
  it("64px everywhere for a compact bar, the original 64/80px otherwise", async () => {
    let el = await renderPage([header({ barSize: "compact" })]);
    expect(el.querySelector(".page")!.className).toBe("page w-full pt-16");
    act(() => root?.unmount());
    container?.remove();
    el = await renderPage([header({})]);
    expect(el.querySelector(".page")!.className).toBe("page w-full pt-16 md:pt-20");
  });
});
