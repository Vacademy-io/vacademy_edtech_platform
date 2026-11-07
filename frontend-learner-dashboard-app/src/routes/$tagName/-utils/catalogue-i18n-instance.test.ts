import { describe, expect, it, vi } from "vitest";
import i18next, { type BackendModule } from "i18next";
import { SITE_I18N_NAMESPACES, forwardedEvents, siteI18nInstance } from "./catalogue-i18n-instance";

/** A stand-in for the app's global instance (src/i18n.ts), with in-memory catalogs. */
const makeAppI18n = async () => {
  const app = i18next.createInstance();
  await app.init({
    lng: "en",
    fallbackLng: "en",
    ns: ["common"],
    defaultNS: "common",
    resources: {
      en: { common: { ok: "OK" }, coursePlayerA: { hello: "Hello" } },
      hi: { common: { ok: "ठीक" }, coursePlayerA: { hello: "नमस्ते" } },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false, bindI18n: "languageChanged namingTermsChanged" },
  });
  return app;
};

describe("siteI18nInstance", () => {
  it("renders the site language without changing the app's language", async () => {
    const app = await makeAppI18n();
    const onAppLanguageChanged = vi.fn();
    app.on("languageChanged", onAppLanguageChanged);

    const site = siteI18nInstance(app, "hi");
    expect(site).not.toBe(app);
    expect(site.language).toBe("hi");
    expect(site.t("coursePlayerA:hello")).toBe("नमस्ते");

    // The app (dashboard, Accept-Language) is untouched.
    expect(app.language).toBe("en");
    expect(app.t("coursePlayerA:hello")).toBe("Hello");
    expect(onAppLanguageChanged).not.toHaveBeenCalled();
  });

  it("reuses one clone per language", async () => {
    const app = await makeAppI18n();
    const hi = siteI18nInstance(app, "hi");
    expect(siteI18nInstance(app, "hi")).toBe(hi);
    const en = siteI18nInstance(app, "en");
    expect(en).not.toBe(hi);
    expect(en.language).toBe("en");
  });

  it("asks for the public site's namespaces on top of the app's", async () => {
    const app = await makeAppI18n();
    const ns = siteI18nInstance(app, "hi").options.ns as string[];
    expect(ns).toEqual(expect.arrayContaining(["common", ...SITE_I18N_NAMESPACES]));
    // The app's own namespace list is not modified.
    expect(app.options.ns).toEqual(["common"]);
  });

  it("fetches the site language's terms catalog as it starts, with the chrome's", async () => {
    // The app's lazy backend: catalogs arrive asynchronously, one read each.
    const reads: string[] = [];
    const backend: BackendModule = {
      type: "backend",
      init() {},
      read(lng, ns, callback) {
        reads.push(`${lng}/${ns}`);
        setTimeout(() => callback(null, ns === "terms" ? { Course: lng === "hi" ? "कोर्स" : "Course" } : {}), 1);
      },
    };
    const app = i18next.createInstance();
    await app.use(backend).init({ lng: "en", fallbackLng: "en", ns: ["common"], defaultNS: "common" });

    const site = siteI18nInstance(app, "hi");
    expect(reads).toEqual(expect.arrayContaining(["hi/terms", "hi/coursePlayerB"]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The getTerminology() site scope reads it from here (sidebar/utils).
    expect(site.t("terms:Course")).toBe("कोर्स");
  });
});

describe("forwardedEvents", () => {
  it("forwards the app's re-render events except language changes", async () => {
    const app = await makeAppI18n();
    expect(forwardedEvents(app)).toEqual(["namingTermsChanged"]);
  });
});
