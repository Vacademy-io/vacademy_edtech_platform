// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import i18next, { type BackendModule, type i18n as I18nInstance } from "i18next";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { LANGUAGE_SETTING_STORAGE_KEY } from "@/services/language-settings";
import { NAMING_SETTINGS_KEY, type LocalizedNamingSettings } from "@/types/naming-settings";
import { siteI18nInstance } from "@/routes/$tagName/-utils/catalogue-i18n-instance";
import {
  NAMING_SETTINGS_UPDATED_EVENT,
  clearSiteTermScope,
  ensureSiteTermsCatalog,
  getAppTerminology,
  getTerminology,
  getTerminologyPlural,
  setSiteTermScope,
  siteTermsCatalogReady,
  type SiteTermScope,
} from "./utils";

/**
 * The site language scope of getTerminology() / getTerminologyPlural(): what a
 * public site with languages reads while CatalogueLocaleProvider holds it, and
 * that nothing changes without one. Real terms catalogs (en, hi).
 */

/** The app's real terms catalog for `lng` (src/locales/<lng>/terms.json). */
const realTerms = (lng: string): object =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../../locales/${lng}/terms.json`), "utf8"));

const CATALOGS: Record<string, Record<string, object>> = {
  en: { common: {}, terms: realTerms("en") },
  hi: { common: {}, terms: realTerms("hi") },
};

/** Every catalog read, as "lng/ns". */
const reads: string[] = [];
/** Reads held back until the test releases them ("lng/ns" → pending callbacks). */
const held = new Map<string, Array<() => void>>();
const holding = new Set<string>();
/** Reads that fail the first time they are made ("lng/ns"). */
const failOnce = new Set<string>();

/** The app's lazy backend, asynchronous like the real one; unknown catalogs fail. */
const backend: BackendModule = {
  type: "backend",
  init() {},
  read(lng, ns, callback) {
    const name = `${lng}/${ns}`;
    reads.push(name);
    const answer = () => {
      const data = CATALOGS[lng]?.[ns];
      if (failOnce.delete(name) || !data) callback(new Error(`no catalog ${name}`), false);
      else callback(null, data as never);
    };
    if (holding.has(name)) held.set(name, [...(held.get(name) ?? []), answer]);
    else setTimeout(answer, 1);
  },
};

const release = (name: string) => {
  holding.delete(name);
  for (const answer of held.get(name) ?? []) answer();
  held.delete(name);
};

const options = {
  fallbackLng: "en",
  supportedLngs: [...SUPPORTED_LOCALES],
  nonExplicitSupportedLngs: true,
  load: "languageOnly" as const,
  ns: ["common"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
};

/** A stand-in for the app's instance, as a site clones it. */
const makeApp = async (lng = "en"): Promise<I18nInstance> => {
  const app = i18next.createInstance();
  await app.use(backend).init({ ...options, lng });
  return app;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** The institute's naming settings, as fetchAndStoreInstituteDetails caches them. */
const naming = (entries: LocalizedNamingSettings[]) =>
  localStorage.setItem(NAMING_SETTINGS_KEY, JSON.stringify(entries));

const PROGRAMME: LocalizedNamingSettings = {
  key: "Course",
  customValue: "Programme",
  customPluralValue: "Programmes",
};

let token: object;
const scoped = (scope: SiteTermScope) => {
  token = {};
  setSiteTermScope(token, scope);
};

beforeAll(async () => {
  // The app's own (global) instance — the one the app path reads.
  await i18next.use(backend).init({ ...options, lng: "en" });
});

beforeEach(async () => {
  localStorage.clear();
  reads.length = 0;
  await i18next.changeLanguage("en");
});

afterEach(() => {
  clearSiteTermScope(token);
  holding.clear();
  held.clear();
  failOnce.clear();
});

describe("a हिन्दी page on an English app", () => {
  it("reads the course word in the site language", async () => {
    const site = siteI18nInstance(await makeApp("en"), "hi");
    await settle();
    scoped({ locale: "hi", i18n: site });

    expect(getTerminology("Course", "Course")).toBe("कोर्स");
    expect(getTerminologyPlural("Course", "Course")).toBe("कोर्स");
    expect(getTerminologyPlural("Level", "Level")).toBe("स्तर");
    expect(getTerminologyPlural("Session", "Session")).toBe("सत्र");
    expect(getTerminologyPlural("PopularTag", "Popular Tag")).toBe("लोकप्रिय टैग");
    expect(getTerminology("Teacher", "Instructor")).toBe("प्रशिक्षक");
    // The app keeps its own language.
    expect(i18next.language).toBe("en");
  });

  it("prefers the institute's own word for that language", async () => {
    naming([{ ...PROGRAMME, locales: { hi: { customValue: "पाठ्यक्रम", customPluralValue: "पाठ्यक्रमों" } } }]);
    const site = siteI18nInstance(await makeApp("en"), "hi");
    await settle();
    scoped({ locale: "hi", i18n: site });

    expect(getTerminology("Course", "Course")).toBe("पाठ्यक्रम");
    expect(getTerminologyPlural("Course", "Course")).toBe("पाठ्यक्रमों");
  });

  it("keeps the caller's own fallback until the site language's catalog is in", async () => {
    // Only the English catalog is in: answering from it would replace the
    // institute's "Programme" with the system "Course".
    naming([PROGRAMME]);
    const app = await makeApp("en");
    await app.loadNamespaces("terms");
    holding.add("hi/terms");
    const site = app.cloneInstance({ lng: "hi", ns: ["common"], initAsync: false });
    await settle();
    const scope = { locale: "hi", i18n: site };
    scoped(scope);

    expect(siteTermsCatalogReady(scope)).toBe(false);
    expect(getTerminology("Course", "Course")).toBe("Programme");

    const loaded = ensureSiteTermsCatalog(scope);
    await settle();
    release("hi/terms");
    expect(await loaded).toBe(true);
    expect(siteTermsCatalogReady(scope)).toBe(true);
    expect(getTerminology("Course", "Course")).toBe("कोर्स");
  });

  it("never translates the Learner word, which is also stored as a placeholder name", async () => {
    const site = siteI18nInstance(await makeApp("en"), "hi");
    await settle();
    scoped({ locale: "hi", i18n: site });

    expect(getTerminology("Learner", "Learner")).toBe("Learner");
  });
});

describe("an English page on a Hindi app", () => {
  beforeEach(async () => {
    await i18next.changeLanguage("hi");
    await i18next.loadNamespaces("terms");
    await settle();
  });

  it("reads the English word, not the app's Hindi one", async () => {
    // Without the scope: the app's language, as before.
    expect(getTerminology("Course", "Course")).toBe("कोर्स");

    scoped({ locale: "en", i18n: siteI18nInstance(await makeApp("hi"), "en") });
    expect(getTerminology("Course", "Course")).toBe("Course");
    expect(getTerminologyPlural("Course", "Course")).toBe("Courses");
  });

  it("keeps the institute's own English word (the content source language)", async () => {
    naming([PROGRAMME]);
    scoped({ locale: "en", i18n: siteI18nInstance(await makeApp("hi"), "en") });

    expect(getTerminology("Course", "Course")).toBe("Programme");
    expect(getTerminologyPlural("Course", "Course")).toBe("Programmes");
  });

  it("treats a language the app does not support like the app's fallback (English)", async () => {
    scoped({ locale: "de", i18n: siteI18nInstance(await makeApp("hi"), "de") });

    expect(getTerminology("Course", "Course")).toBe("Course");
  });
});

describe("an institute that writes its terms in Hindi", () => {
  beforeEach(() => {
    localStorage.setItem(LANGUAGE_SETTING_STORAGE_KEY, JSON.stringify({ content_source_locale: "hi" }));
    naming([{ key: "Course", customValue: "पाठ्यक्रम", customPluralValue: "पाठ्यक्रम" }]);
  });

  it("shows its own word on the हिन्दी page and the English system word on the English one", async () => {
    const app = await makeApp("en");
    const hi = siteI18nInstance(app, "hi");
    const en = siteI18nInstance(app, "en");
    await settle();

    scoped({ locale: "hi", i18n: hi });
    expect(getTerminology("Course", "Course")).toBe("पाठ्यक्रम");

    const scope = { locale: "en", i18n: en };
    scoped(scope);
    expect(await ensureSiteTermsCatalog(scope)).toBe(true);
    expect(getTerminology("Course", "Course")).toBe("Course");
  });
});

describe("ensureSiteTermsCatalog", () => {
  it("loads the SITE language through a clone whose own catalogs are still loading", async () => {
    const app = await makeApp("en");
    holding.add("hi/common");
    // A new clone keeps the language it was cloned from until its catalogs
    // are in — a plain loadNamespaces() would fetch the English terms.
    const site = app.cloneInstance({ lng: "hi", ns: ["common"], initAsync: false });
    expect(site.language).toBe("en");
    const notified = vi.fn();
    window.addEventListener(NAMING_SETTINGS_UPDATED_EVENT, notified);

    expect(await ensureSiteTermsCatalog({ locale: "hi", i18n: site })).toBe(true);

    expect(reads).toContain("hi/terms");
    expect(site.hasResourceBundle("hi", "terms")).toBe(true);
    expect(notified).toHaveBeenCalledTimes(1);
    window.removeEventListener(NAMING_SETTINGS_UPDATED_EVENT, notified);
    release("hi/common");
  });

  it("loads nothing for the content source language", async () => {
    const site = siteI18nInstance(await makeApp("hi"), "en");
    await settle();
    reads.length = 0;

    expect(await ensureSiteTermsCatalog({ locale: "en", i18n: site })).toBe(false);
    expect(siteTermsCatalogReady({ locale: "en", i18n: site })).toBe(true);
    expect(reads).toEqual([]);
  });

  it("leaves the caller's fallback in place when the language has no catalog", async () => {
    naming([PROGRAMME]);
    const site = siteI18nInstance(await makeApp("en"), "mr");
    await settle();
    const scope = { locale: "mr", i18n: site };
    scoped(scope);

    expect(await ensureSiteTermsCatalog(scope)).toBe(false);
    expect(getTerminology("Course", "Course")).toBe("Programme");
    expect(getTerminologyPlural("Course", "Course")).toBe("Programmes");
  });

  it("reads the catalog again when the clone's own read of it failed", async () => {
    const app = await makeApp("en");
    failOnce.add("hi/terms");
    const site = siteI18nInstance(app, "hi");
    await settle();
    // The read the clone made as it started failed, and i18next skips a
    // catalog whose read failed on every later load, reloads included.
    expect(reads.filter((read) => read === "hi/terms")).toHaveLength(1);
    expect(site.hasResourceBundle("hi", "terms")).toBe(false);
    const scope = { locale: "hi", i18n: site };

    expect(await ensureSiteTermsCatalog(scope)).toBe(true);
    expect(reads.filter((read) => read === "hi/terms")).toHaveLength(2);
    scoped(scope);
    expect(getTerminology("Course", "Course")).toBe("कोर्स");
  });

  it("reads it once more when the read it waited for fails", async () => {
    const app = await makeApp("en");
    failOnce.add("hi/terms");
    holding.add("hi/terms");
    // The clone asks for the catalog as it starts; that read is still out
    // when the provider asks for the catalog.
    const site = siteI18nInstance(app, "hi");
    const loaded = ensureSiteTermsCatalog({ locale: "hi", i18n: site });
    release("hi/terms");

    expect(await loaded).toBe(true);
    // The read it waited for, then one more — never a duplicate of a read
    // still on its way.
    expect(reads.filter((read) => read === "hi/terms")).toHaveLength(2);
    expect(site.hasResourceBundle("hi", "terms")).toBe(true);
  });

  it("waits for a read still on its way instead of starting another", async () => {
    const app = await makeApp("en");
    holding.add("hi/terms");
    const site = siteI18nInstance(app, "hi");
    const loaded = ensureSiteTermsCatalog({ locale: "hi", i18n: site });
    release("hi/terms");

    expect(await loaded).toBe(true);
    expect(reads.filter((read) => read === "hi/terms")).toHaveLength(1);
  });
});

describe("getAppTerminology", () => {
  it("reads the app's language whatever site is on screen", async () => {
    scoped({ locale: "hi", i18n: siteI18nInstance(await makeApp("en"), "hi") });
    await settle();
    expect(getTerminology("Course", "Course")).toBe("कोर्स");
    expect(getAppTerminology("Course", "Course")).toBe("Course");
    clearSiteTermScope(token);

    await i18next.changeLanguage("hi");
    await i18next.loadNamespaces("terms");
    scoped({ locale: "en", i18n: siteI18nInstance(await makeApp("hi"), "en") });
    expect(getTerminology("Course", "Course")).toBe("Course");
    expect(getAppTerminology("Course", "Course")).toBe("कोर्स");
  });

  it("keeps the app's language for the institute's own words too", async () => {
    naming([{ ...PROGRAMME, locales: { hi: { customValue: "पाठ्यक्रम" } } }]);
    scoped({ locale: "hi", i18n: siteI18nInstance(await makeApp("en"), "hi") });
    await settle();

    expect(getTerminology("Course", "Course")).toBe("पाठ्यक्रम");
    expect(getAppTerminology("Course", "Course")).toBe("Programme");
  });

  it("is getTerminology() when no site has set a scope", async () => {
    naming([PROGRAMME]);
    expect(getAppTerminology("Course", "Course")).toBe("Programme");
    expect(getAppTerminology("Level", "Level")).toBe("Level");

    await i18next.changeLanguage("hi");
    await i18next.loadNamespaces("terms");
    expect(getAppTerminology("Course", "Course")).toBe(getTerminology("Course", "Course"));
    expect(getAppTerminology("Level", "Level")).toBe("स्तर");
  });
});

describe("the scope's lifetime", () => {
  it("is lifted only by the token that set it", async () => {
    await i18next.changeLanguage("hi");
    await i18next.loadNamespaces("terms");
    const app = await makeApp("en");
    const hiSite = siteI18nInstance(app, "hi");
    const enSite = siteI18nInstance(app, "en");
    await settle();

    const leaving = {};
    const arriving = {};
    setSiteTermScope(leaving, { locale: "hi", i18n: hiSite });
    // The next page sets its own before the old one's cleanup runs…
    setSiteTermScope(arriving, { locale: "en", i18n: enSite });
    // …so the old one lifts nothing.
    expect(clearSiteTermScope(leaving)).toBe(false);
    expect(getTerminology("Course", "Course")).toBe("Course");

    expect(clearSiteTermScope(arriving)).toBe(true);
    // Back to the app's own language.
    expect(getTerminology("Course", "Course")).toBe("कोर्स");
    expect(clearSiteTermScope(arriving)).toBe(false);
  });

  it("changes nothing for the app when no site has set one", async () => {
    naming([PROGRAMME]);
    expect(getTerminology("Course", "Course")).toBe("Programme");
    expect(getTerminologyPlural("Course", "Course")).toBe("Programmes");
    expect(getTerminology("Level", "Level")).toBe("Level");
    expect(getTerminologyPlural("Level", "Level")).toBe("Levels");

    await i18next.changeLanguage("hi");
    await i18next.loadNamespaces("terms");
    expect(getTerminology("Course", "Course")).toBe("कोर्स");
    expect(getTerminologyPlural("Level", "Level")).toBe("स्तर");
    expect(getTerminology("Learner", "Learner")).toBe("शिक्षार्थी");
  });
});
