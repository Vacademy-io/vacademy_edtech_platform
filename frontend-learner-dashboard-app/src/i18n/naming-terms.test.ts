/**
 * Institute renames reach the catalog strings that spell the term out — see
 * naming-terms.ts (mirrors the admin app's suite).
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import i18next from "i18next";
import { NAMING_SETTINGS_KEY } from "@/types/naming-settings";
import {
  NAMING_TERMS_CHANGED_EVENT,
  applyNamingTerms,
  buildNamingRulesForTests,
  reapplyNamingTerms,
  resetNamingTermsForTests,
  rewriteTemplate,
} from "./naming-terms";

// The suite runs in the node environment: no DOM storage.
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

// Modelled on Agilore's live NAMING_SETTING (raw backend shape, 2026-09-29).
const AGILORE = [
  { key: "Course", customValue: "Training Module", systemValue: "Course" },
  { key: "Course_plural", customValue: "Training Modules", systemValue: null },
  { key: "Chapter", customValue: "Sub Module", systemValue: null },
  { key: "Chapter_plural", customValue: "Sub Modules", systemValue: null },
  { key: "Teacher", customValue: "Facilitator", systemValue: "Teacher" },
  { key: "Teacher_plural", customValue: "Facilitators", systemValue: null },
  { key: "LiveSession", customValue: "Live Session", systemValue: "Live Session" },
  { key: "Learner", customValue: "Learner", systemValue: null },
];

const setNaming = (settings: unknown[]) =>
  localStorage.setItem(NAMING_SETTINGS_KEY, JSON.stringify(settings));

const rewrite = (value: string) =>
  rewriteTemplate(value, buildNamingRulesForTests("en"));

beforeEach(() => {
  localStorage.clear();
  resetNamingTermsForTests();
});

describe("rewriteTemplate", () => {
  beforeEach(() => setNaming(AGILORE));

  it("renames renamed terms with matching case and plural", () => {
    expect(rewrite("View Course")).toBe("View Training Module");
    expect(rewrite("Show all courses")).toBe("Show all training modules");
    expect(rewrite("Next Chapter")).toBe("Next Sub Module");
    expect(rewrite("Instructor")).toBe("Facilitator");
  });

  it("treats the admin app's saved defaults as not renamed", () => {
    // "Live Session" is the admin default the Naming Settings page saves.
    expect(rewrite("Join Live Class")).toBe("Join Live Class");
    setNaming([{ key: "Teacher", customValue: "Teacher" }]);
    expect(rewrite("Instructor notes")).toBe("Instructor notes");
  });

  it("uses the backend's separate _plural entry first", () => {
    setNaming([
      { key: "Course", customValue: "Programme" },
      { key: "Course_plural", customValue: "Programmes offered" },
    ]);
    expect(rewrite("All Courses")).toBe("All Programmes offered");
  });

  it("leaves interpolations, identifiers and role codes alone", () => {
    expect(rewrite("View {{course}} or Course")).toBe(
      "View {{course}} or Training Module"
    );
    expect(rewrite("https://x.com/course and #courses")).toBe(
      "https://x.com/course and #courses"
    );
    expect(rewrite("course-id")).toBe("course-id");
    expect(rewrite("Grants TEACHER role")).toBe("Grants TEACHER role");
  });
});

describe("applyNamingTerms", () => {
  it("is a no-op until something is renamed", () => {
    const catalog = { a: "View Course" };
    expect(applyNamingTerms("en", "x", catalog)).toBe(catalog);
    setNaming([{ key: "Course", customValue: "Course" }]);
    expect(applyNamingTerms("en", "x", catalog)).toBe(catalog);
    setNaming(AGILORE);
    expect(applyNamingTerms("hi", "x", catalog)).toBe(catalog);
    expect(applyNamingTerms("en", "terms", catalog)).toBe(catalog);
  });

  it("only changes wording in the real English catalogs — never placeholders", () => {
    setNaming(AGILORE);
    const dir = path.resolve(__dirname, "../locales/en");
    const tokens = (value: string) =>
      (value.match(/\{\{[^}]*\}\}|\$t\([^)]*\)|<[^>]*>/g) ?? []).join("|");
    let changed = 0;
    const walk = (before: unknown, after: unknown) => {
      if (typeof before === "string") {
        expect(tokens(after as string)).toBe(tokens(before));
        if (after !== before) changed += 1;
        return;
      }
      if (before && typeof before === "object") {
        for (const key of Object.keys(before)) {
          walk(
            (before as Record<string, unknown>)[key],
            (after as Record<string, unknown>)[key]
          );
        }
      }
    };
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const catalog = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      walk(catalog, applyNamingTerms("en", file.slice(0, -5), catalog));
    }
    expect(changed).toBeGreaterThan(20);
  });
});

describe("reapplyNamingTerms", () => {
  it("follows settings changes on already-loaded catalogs", async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: "en", resources: {} });
    i18n.addResourceBundle(
      "en",
      "courses",
      applyNamingTerms("en", "courses", { cta: "View Course" })
    );
    let emitted = 0;
    i18n.on(NAMING_TERMS_CHANGED_EVENT, () => (emitted += 1));

    setNaming(AGILORE);
    reapplyNamingTerms(i18n);
    expect(i18n.t("courses:cta")).toBe("View Training Module");

    reapplyNamingTerms(i18n);
    expect(emitted).toBe(1);

    setNaming([]);
    reapplyNamingTerms(i18n);
    expect(i18n.t("courses:cta")).toBe("View Course");
    expect(emitted).toBe(2);
  });
});
