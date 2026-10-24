// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * IntroPageComponent's authored captions in the visitor's language, without
 * changing the markup of a caption-less slide (no alt="" that would mark the
 * image decorative).
 */

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: { lang: "hi" } },
    history: { push: () => {}, replace: () => {}, location: { href: "/site?lang=hi" } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: "/site", searchStr: "?lang=hi", search: { lang: "hi" }, hash: "", href: "/site?lang=hi" };
    return opts?.select ? opts.select(location) : location;
  },
}));
vi.mock("react-i18next", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key: string) => key, i18n: undefined }),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "web" } }));
vi.mock("@/hooks/use-domain-routing", () => ({ useDomainRouting: () => ({ instituteName: "Gurukul" }) }));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: async () => null }));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: (_term: string, fallback: string) => fallback,
}));

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntroPageComponent } from "./IntroPageComponent";
import { CatalogueLocaleProvider } from "../-utils/catalogue-locale";
import type { IntroPage } from "../-types/course-catalogue-types";
import type { CatalogueI18nSettings } from "../-utils/catalogue-i18n";

const h = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HINDI_SITE: CatalogueI18nSettings = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: { hi: { "Learn the Indian way of learning.": "सीखने का भारतीय तरीका।" } },
};

const INTRO: IntroPage = {
  enabled: true,
  fullScreen: false,
  showHeader: false,
  imageSlider: {
    autoPlay: false,
    interval: 5000,
    images: [
      // A slide saved without a caption (older configs).
      { source: "https://cdn.example.com/a.png", caption: undefined as unknown as string },
      { source: "https://cdn.example.com/b.png", caption: "Learn the Indian way of learning." },
    ],
    styles: { height: "60vh", objectFit: "cover", transitionEffect: "fade" },
  },
  actions: { alignment: "center", buttons: [] },
  afterIntro: { action: "loadAllSections", target: "" },
};

let root: Root | null = null;

const renderIntro = async (settings?: CatalogueI18nSettings) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const intro = h(IntroPageComponent, {
    introPage: INTRO,
    onGetStarted: () => {},
    onLogin: () => {},
    onComplete: () => {},
    onClose: () => {},
  });
  await act(async () => {
    root!.render(settings ? h(CatalogueLocaleProvider, { settings, scope: "site", children: intro }) : intro);
  });
  return Array.from(host.querySelectorAll<HTMLImageElement>("img[src^='https://cdn.example.com/']"));
};

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe("IntroPageComponent captions", () => {
  it("keeps a caption-less slide without an alt attribute", async () => {
    const [bare, captioned] = await renderIntro();
    expect(bare.hasAttribute("alt")).toBe(false);
    expect(captioned.getAttribute("alt")).toBe("Learn the Indian way of learning.");
  });

  it("translates captions for a हिन्दी visitor", async () => {
    const [bare, captioned] = await renderIntro(HINDI_SITE);
    expect(bare.hasAttribute("alt")).toBe(false);
    expect(captioned.getAttribute("alt")).toBe("सीखने का भारतीय तरीका।");
  });
});
