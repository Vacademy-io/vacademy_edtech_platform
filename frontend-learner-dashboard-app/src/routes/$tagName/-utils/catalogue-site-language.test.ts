import { describe, expect, it } from "vitest";
import { LOCALE_PARAM } from "./catalogue-i18n";
import { SITE_LANGUAGE_PARAM } from "./catalogue-route-search";
import {
  hasVisibleWhenRules,
  localizeComponentProps,
  repairRetainedLocaleHref,
  sectionVisibility,
  siteUsesDevanagari,
  withLocaleParam,
} from "./catalogue-site-language";

const HI = {
  "Learn the Indian way of learning.": "सीखने का भारतीय तरीका।",
  "Explore Education": "शिक्षा देखें",
  Courses: "पाठ्यक्रम",
  "Start free": "मुफ़्त शुरू करें",
};

describe("localizeComponentProps", () => {
  it("returns the very same props object when there is no dictionary", () => {
    const props = { title: "Courses", button: { text: "Explore Education", link: "/courses" } };
    expect(localizeComponentProps(props, undefined)).toBe(props);
  });

  it("translates authored text and leaves links, colours and enums alone", () => {
    const props = {
      title: "Learn the Indian way of learning.",
      backgroundColor: "rgb(250, 250, 250)",
      defaultSort: "Newest",
      button: { text: "Explore Education", link: "/courses?stream=shiksha" },
    };
    const out = localizeComponentProps(props, HI);
    expect(out).not.toBe(props);
    expect(out.title).toBe("सीखने का भारतीय तरीका।");
    expect(out.button.text).toBe("शिक्षा देखें");
    expect(out.button.link).toBe("/courses?stream=shiksha");
    expect(out.backgroundColor).toBe(props.backgroundColor);
    expect(out.defaultSort).toBe("Newest");
    // The base props are never mutated (they are shared, cached catalogue data).
    expect(props.title).toBe("Learn the Indian way of learning.");
  });

  it("is memoised per props object and dictionary", () => {
    const props = { title: "Courses" };
    const first = localizeComponentProps(props, HI);
    expect(localizeComponentProps(props, HI)).toBe(first);
    // A different dictionary (the visitor switched language, or the admin
    // edited a translation) is a different result.
    const other = { Courses: "अभ्यासक्रम" };
    const second = localizeComponentProps(props, other);
    expect(second).not.toBe(first);
    expect(second.title).toBe("अभ्यासक्रम");
  });

  it("returns the same object when nothing in the props has a translation", () => {
    const props = { title: "Untranslated heading", items: [{ label: "Also untranslated" }] };
    expect(localizeComponentProps(props, HI)).toBe(props);
  });

  it("leaves nested sections (slots) and visibility rules for later", () => {
    const child = { id: "c1", type: "textBlock", props: { title: "Courses" } };
    const rules = [{ param: "stream", op: "equals", value: "Courses" }];
    const props = {
      title: "Courses",
      slots: [[child]],
      items: [{ title: "Courses", slot: [child] }],
      visibleWhen: rules,
    };
    const out = localizeComponentProps(props, HI);
    expect(out.title).toBe("पाठ्यक्रम");
    expect(out.slots).toBe(props.slots);
    expect(out.items[0].title).toBe("पाठ्यक्रम");
    expect(out.items[0].slot).toBe(props.items[0].slot);
    expect(out.visibleWhen).toBe(rules);
  });

  it("passes through props that are not objects", () => {
    expect(localizeComponentProps(undefined, HI)).toBeUndefined();
    expect(localizeComponentProps(null, HI)).toBeNull();
  });
});

describe("hasVisibleWhenRules", () => {
  it("is true only for a section with at least one rule", () => {
    expect(hasVisibleWhenRules({ id: "a", visibleWhen: [{ param: "stream", op: "empty" }] })).toBe(true);
    expect(hasVisibleWhenRules({ id: "a", visibleWhen: [] })).toBe(false);
    expect(hasVisibleWhenRules({ id: "a" })).toBe(false);
    expect(hasVisibleWhenRules({ id: "a", visibleWhen: "stream" })).toBe(false);
    expect(hasVisibleWhenRules(null)).toBe(false);
    expect(hasVisibleWhenRules(undefined)).toBe(false);
  });
});

describe("sectionVisibility", () => {
  const startFree = { id: "free", visibleWhen: [{ param: "stream", op: "empty" as const }] };

  it("always shows a section without rules", () => {
    expect(sectionVisibility({ id: "x" }, "?stream=shiksha", false)).toBe("show");
    expect(sectionVisibility({ id: "x", visibleWhen: [] }, "", false)).toBe("show");
  });

  it("skips a section whose rules fail for this URL", () => {
    expect(sectionVisibility(startFree, "", false)).toBe("show");
    expect(sectionVisibility(startFree, "?lang=hi", false)).toBe("show");
    expect(sectionVisibility(startFree, "?stream=shiksha", false)).toBe("hide");
  });

  it("keeps a hidden section on the builder preview, marked", () => {
    expect(sectionVisibility(startFree, "?stream=shiksha", true)).toBe("hint");
    expect(sectionVisibility(startFree, "", true)).toBe("show");
  });

  it("never hides content because of a malformed rule", () => {
    expect(sectionVisibility({ visibleWhen: [{ op: "equals" }] }, "?stream=x", false)).toBe("show");
    expect(sectionVisibility({ visibleWhen: [null] as unknown[] }, "?stream=x", false)).toBe("show");
    expect(sectionVisibility({ visibleWhen: "stream" }, "?stream=x", false)).toBe("show");
  });

  it("compares values without regard to case", () => {
    const onlyShiksha = { visibleWhen: [{ param: "stream", op: "equals", value: "Shiksha" }] };
    expect(sectionVisibility(onlyShiksha, "?stream=shiksha", false)).toBe("show");
    expect(sectionVisibility(onlyShiksha, "?stream=kala", false)).toBe("hide");
  });
});

describe("withLocaleParam", () => {
  it("leaves links untouched when there is no language to carry", () => {
    expect(withLocaleParam("/new/about", null)).toBe("/new/about");
    expect(withLocaleParam("/new/about", undefined)).toBe("/new/about");
    expect(withLocaleParam("/new/courses?stream=x", "")).toBe("/new/courses?stream=x");
  });

  it("adds ?lang= and keeps the authored query string byte for byte", () => {
    expect(withLocaleParam("/new/about", "hi")).toBe("/new/about?lang=hi");
    expect(withLocaleParam("/new/courses?stream=shiksha&category=a,b", "hi")).toBe(
      "/new/courses?stream=shiksha&category=a,b&lang=hi",
    );
    expect(withLocaleParam("/new/courses?", "hi")).toBe("/new/courses?lang=hi");
  });

  it("puts the parameter before a #hash", () => {
    expect(withLocaleParam("/new/about#team", "hi")).toBe("/new/about?lang=hi#team");
    expect(withLocaleParam("/new/courses?stream=x#grid", "hi")).toBe("/new/courses?stream=x&lang=hi#grid");
  });

  it("keeps a language the link names itself", () => {
    expect(withLocaleParam("/new/about?lang=en", "hi")).toBe("/new/about?lang=en");
  });
});

describe("siteUsesDevanagari", () => {
  it("is true only for multi-language sites offering a Devanagari language", () => {
    expect(siteUsesDevanagari(undefined)).toBe(false);
    expect(siteUsesDevanagari({ enabled: false, locales: [{ code: "en", label: "EN" }, { code: "hi", label: "हिन्दी" }] })).toBe(
      false,
    );
    expect(siteUsesDevanagari({ enabled: true, locales: [{ code: "en", label: "EN" }, { code: "hi", label: "हिन्दी" }] })).toBe(
      true,
    );
    expect(siteUsesDevanagari({ enabled: true, locales: [{ code: "en", label: "EN" }, { code: "mr", label: "मराठी" }] })).toBe(
      true,
    );
    expect(siteUsesDevanagari({ enabled: true, locales: [{ code: "en", label: "EN" }, { code: "ta", label: "தமிழ்" }] })).toBe(
      false,
    );
  });

  it("uses the default English / Hindi pair when the site lists no languages", () => {
    expect(siteUsesDevanagari({ enabled: true })).toBe(true);
  });
});

describe("retainSiteLanguage", () => {
  it("retains the same parameter the site language is read from", () => {
    expect(SITE_LANGUAGE_PARAM).toBe(LOCALE_PARAM);
  });
});

describe("repairRetainedLocaleHref", () => {
  it("joins a carried ?lang= that landed after the link's own query string", () => {
    expect(repairRetainedLocaleHref("/site/courses?stream=shiksha?lang=hi")).toBe("/site/courses?stream=shiksha&lang=hi");
    expect(repairRetainedLocaleHref("/courses?stream=shiksha&category=vedic?lang=hi")).toBe(
      "/courses?stream=shiksha&category=vedic&lang=hi",
    );
    // Encoded authored values are kept byte for byte.
    expect(repairRetainedLocaleHref("/courses?q=a%20b?lang=hi")).toBe("/courses?q=a%20b&lang=hi");
  });

  it("moves a carried ?lang= out of the link's #hash", () => {
    expect(repairRetainedLocaleHref("/site/about#team?lang=hi")).toBe("/site/about?lang=hi#team");
    expect(repairRetainedLocaleHref("/courses?stream=x#grid?lang=hi")).toBe("/courses?stream=x&lang=hi#grid");
  });

  it("keeps a language the link named itself", () => {
    expect(repairRetainedLocaleHref("/about?lang=en?lang=hi")).toBe("/about?lang=en");
    expect(repairRetainedLocaleHref("/courses?stream=x&lang=en?lang=hi")).toBe("/courses?stream=x&lang=en");
  });

  it("handles an empty query string", () => {
    expect(repairRetainedLocaleHref("/courses??lang=hi")).toBe("/courses?lang=hi");
  });

  it("leaves every well-formed or unrelated address alone", () => {
    expect(repairRetainedLocaleHref("")).toBeNull();
    expect(repairRetainedLocaleHref(undefined)).toBeNull();
    expect(repairRetainedLocaleHref("/site/about")).toBeNull();
    expect(repairRetainedLocaleHref("/site/about?lang=hi")).toBeNull();
    expect(repairRetainedLocaleHref("/courses?stream=shiksha&lang=hi")).toBeNull();
    expect(repairRetainedLocaleHref("/courses?stream=shiksha&lang=hi#grid")).toBeNull();
    expect(repairRetainedLocaleHref("/courses?q=what?")).toBeNull();
    expect(repairRetainedLocaleHref("/courses?a=1?b=2")).toBeNull();
    expect(repairRetainedLocaleHref("/courses?a=1?lang=hi&b=2")).toBeNull();
    // The router's own (re-encoded) form cannot be told apart from a real value.
    expect(repairRetainedLocaleHref("/courses?stream=x%3Flang%3Dhi")).toBeNull();
  });
});
