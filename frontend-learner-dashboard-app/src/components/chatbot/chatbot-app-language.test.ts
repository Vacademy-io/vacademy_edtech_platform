// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { clearSiteTermScope, setSiteTermScope } from "@/components/common/layout-container/sidebar/utils";
import { siteI18nInstance } from "@/routes/$tagName/-utils/catalogue-i18n-instance";
import { ToolIndicator } from "./ToolIndicator";
import { QuickActions } from "./QuickActions";

/**
 * The chatbot is mounted at the app root, outside every site's pages, and
 * speaks the app's language. While a public site in another language is on
 * screen (its term scope is up), the course word in the chatbot's sentences
 * stays the app's: "Searching your Course materials...", never "Searching
 * your कोर्स materials...". Real en / hi chatFeatureB and terms catalogs.
 */

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realCatalog = (lng: string, ns: string): object =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../locales/${lng}/${ns}.json`), "utf8"));

let root: Root | null = null;
let host: HTMLElement;
const siteToken = {};

const render = async (tree: React.ReactElement) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(e(I18nextProvider, { i18n: i18next }, tree));
  });
};

/** What the chatbot shows while it searches the course, and its first suggestion on a course page. */
const chatbot = () =>
  e(
    "div",
    null,
    e(ToolIndicator, { toolName: "semantic_search_content" }),
    e(QuickActions, { pathname: "/courses/neet", onAction: () => {} }),
  );

const searching = () => host.querySelector("span")?.textContent;
const firstSuggestion = () => host.querySelector("button")?.textContent;

/** A public site in `locale` on screen, as its CatalogueLocaleProvider scopes the terms. */
const siteOnScreen = (locale: string) => setSiteTermScope(siteToken, { locale, i18n: siteI18nInstance(i18next, locale) });

beforeAll(async () => {
  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LOCALES],
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    resources: {
      en: { common: {}, chatFeatureB: realCatalog("en", "chatFeatureB"), terms: realCatalog("en", "terms") },
      hi: { common: {}, chatFeatureB: realCatalog("hi", "chatFeatureB"), terms: realCatalog("hi", "terms") },
    },
  });
});

beforeEach(async () => {
  localStorage.clear();
  await i18next.changeLanguage("en");
});

afterEach(() => {
  clearSiteTermScope(siteToken);
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("the chatbot over a public site in another language", () => {
  it("a हिन्दी site, English app: the chatbot names the course in English", async () => {
    siteOnScreen("hi");
    await render(chatbot());

    expect(searching()).toBe("Searching your Course materials...");
    expect(firstSuggestion()).toBe("Course overview");
  });

  it("an English site, Hindi app: the chatbot names the course in Hindi", async () => {
    await i18next.changeLanguage("hi");
    siteOnScreen("en");
    await render(chatbot());

    expect(searching()).toBe("आपकी कोर्स सामग्री खोजी जा रही है...");
    expect(firstSuggestion()).toBe("कोर्स अवलोकन");
  });

  it("with no site on screen, as before", async () => {
    await render(chatbot());
    expect(searching()).toBe("Searching your Course materials...");
    act(() => root?.unmount());
    root = null;

    await i18next.changeLanguage("hi");
    await render(chatbot());
    expect(searching()).toBe("आपकी कोर्स सामग्री खोजी जा रही है...");
  });
});
