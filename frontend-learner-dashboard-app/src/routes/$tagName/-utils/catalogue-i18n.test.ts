import { describe, expect, it } from "vitest";
import {
  applyLocalizedEdit,
  collectTranslatableStrings,
  dictionaryFor,
  isTextKey,
  keyInItemOf,
  localesOf,
  localizeDeep,
  localizeRenderTexts,
  mergeTranslations,
  renderTextEntries,
  resolveSiteLocale,
  splitRenderEdit,
  translateText,
  translationCoverage,
} from "./catalogue-i18n";

const HI = {
  "Learn the Indian way of learning.": "सीखने का भारतीय तरीका।",
  Education: "शिक्षा",
  "Explore Education": "शिक्षा देखें",
  Courses: "पाठ्यक्रम",
};

describe("isTextKey", () => {
  it("treats prose keys as text and ids/links/colours/enums as data", () => {
    for (const k of ["title", "subtitle", "description", "label", "buttonText", "tagline", "showMoreLabel", "html", "alt"]) {
      expect(isTextKey(k)).toBe(true);
    }
    for (const k of ["id", "route", "href", "backgroundColor", "productPageCode", "image_url", "layout", "audienceId", "css", "tags"]) {
      expect(isTextKey(k)).toBe(false);
    }
  });

  it("treats badge type lists and anchor-id prefixes as data", () => {
    expect(isTextKey("types")).toBe(false);
    expect(isTextKey("anchorPrefix")).toBe(false);
  });
});

describe("keys that are copy only inside one list's items", () => {
  const DICT = {
    News: "समाचार",
    "Flagship Program": "प्रमुख कार्यक्रम",
    Featured: "विशेष",
    Latest: "ताज़ा",
    "fees-": "शुल्क-",
    Popular: "लोकप्रिय",
  };

  it("resolves 'tag' as text inside announcements[] and blocks[] items only", () => {
    expect(keyInItemOf("tag", "announcements")).toBeUndefined();
    expect(keyInItemOf("tag", "blocks")).toBeUndefined();
    expect(keyInItemOf("Tag", "Blocks")).toBeUndefined();
    expect(keyInItemOf("tag", "items")).toBe("tag");
    expect(keyInItemOf("tag", undefined)).toBe("tag");
    expect(keyInItemOf("title", "announcements")).toBe("title");
    // A plain lookup table: list names like 'constructor' are not special.
    expect(keyInItemOf("tag", "constructor")).toBe("tag");
  });

  it("translates an announcement's pill and a detail block's eyebrow, never a course tag to filter by", () => {
    const feed = { announcements: [{ title: "Latest", tag: "News", date: "2025-01-15" }] };
    expect(localizeDeep(feed, DICT).announcements[0]).toEqual({ title: "ताज़ा", tag: "समाचार", date: "2025-01-15" });

    const blocks = { anchorPrefix: "fees-", blocks: [{ title: "Flagship Program", tag: "Flagship Program", anchor: "flagship" }] };
    const out = localizeDeep(blocks, DICT);
    expect(out.blocks[0]).toEqual({ title: "प्रमुख कार्यक्रम", tag: "प्रमुख कार्यक्रम", anchor: "flagship" });
    expect(out.anchorPrefix).toBe("fees-");

    // courseShowcase.tag / streams.items[].tag pick courses by tag: data.
    const showcase = {
      tag: "Featured",
      streams: { items: [{ tag: "Featured", label: "Featured" }] },
      announcements: [{ meta: { tag: "Featured" } }],
      badges: { types: ["bestseller", "Popular"] },
    };
    const shown = localizeDeep(showcase, DICT);
    expect(shown.tag).toBe("Featured");
    expect(shown.streams.items[0]).toEqual({ tag: "Featured", label: "विशेष" });
    // Only the item's OWN tag is copy, not one nested deeper.
    expect(shown.announcements).toBe(showcase.announcements);
    expect(shown.badges).toBe(showcase.badges);
  });

  it("offers those pills for translation, but not filter tags, badge types or anchor prefixes", () => {
    const props = {
      announcements: [{ title: "Latest", tag: "News" }],
      blocks: [{ title: "Flagship Program", tag: "Featured" }],
      tag: "Popular",
      badges: { types: ["bestseller", "Popular"] },
      anchorPrefix: "fees-",
    };
    expect(collectTranslatableStrings(props)).toEqual(["Latest", "News", "Flagship Program", "Featured"]);
  });

  it("routes a Hindi edit of an announcement's tag into the dictionary and keeps the English base", () => {
    const base = { tag: "Popular", announcements: [{ title: "Latest", tag: "News" }] };
    const localized = localizeDeep(base, DICT);
    const edited = { ...localized, announcements: [{ ...localized.announcements[0], tag: "खबर" }] };
    const res = applyLocalizedEdit(base, localized, edited);
    expect(res.base).toEqual(base);
    expect(res.translations).toEqual({ News: "खबर" });
    // The course filter tag is shared data: an edit goes to the base.
    const filter = applyLocalizedEdit(base, localized, { ...localized, tag: "featured" });
    expect(filter.base.tag).toBe("featured");
    expect(filter.translations).toEqual({});
  });
});

describe("data that looks like text is never translated", () => {
  // Real catalogue props whose string VALUES are logic, not copy.
  const DICT = {
    Newest: "नवीनतम",
    Buy: "खरीदें",
    Facebook: "फेसबुक",
    "Price: Low to High": "कीमत: कम से ज़्यादा",
    Email: "ईमेल",
    true: "सत्य",
  };

  it("leaves enum-like and mapping props alone", () => {
    const props = {
      defaultSort: "Newest",
      levelFilterValue: "Buy",
      render: { cardFields: ["package_name", "price"], layout: "grid" },
      fields: { title: "package_name", price: "price" },
      socials: [{ platform: "facebook", label: "Facebook" }],
      badgeTone: "success",
      marqueeSpeed: "slow",
      headerScale: "md",
      borderRadius: "lg",
      columnFr: ["1fr", "2fr"],
      category: "Exam tips",
    };
    const out = localizeDeep(props, DICT);
    expect(out.defaultSort).toBe("Newest");
    expect(out.levelFilterValue).toBe("Buy");
    expect(out.render).toBe(props.render);
    expect(out.fields).toEqual({ title: "package_name", price: "price" });
    expect(out.socials).toEqual([{ platform: "facebook", label: "फेसबुक" }]);
    expect(out.badgeTone).toBe("success");
    expect(out.category).toBe("Exam tips");
  });

  it("keeps form field names and visibility rules intact while translating labels", () => {
    const props = {
      formFields: [{ name: "email", label: "Email", type: "email" }],
      showCondition: { field: "courseCatalogeType.enabled", value: "true" },
      style: { padding: "lg", note: "Newest" },
      slots: [[{ id: "x", props: { title: "Newest" } }]],
    };
    const out = localizeDeep(props, DICT);
    expect(out.formFields).toEqual([{ name: "email", label: "ईमेल", type: "email" }]);
    expect(out.showCondition).toBe(props.showCondition);
    expect(out.style).toBe(props.style);
    expect(out.slots).toBe(props.slots);
  });

  it("keeps icon names exact and treats the mega menu's CTA pattern as copy", () => {
    const dict = { Rocket: "रॉकेट", "Explore {stream}": "{stream} देखें" };
    const props = { features: [{ iconName: "Rocket", title: "Rocket" }], megaMenu: { ctaLabelPattern: "Explore {stream}", libraryName: "Rocket" } };
    const out = localizeDeep(props, dict);
    expect(out.features[0]).toEqual({ iconName: "Rocket", title: "रॉकेट" });
    expect(out.megaMenu).toEqual({ ctaLabelPattern: "{stream} देखें", libraryName: "Rocket" });
  });

  it("keeps a picked product page's cached name as stored, so picking another page in Hindi edits the base", () => {
    // The learning path puts it through siteT itself when it is the title.
    const dict = { "JEE Store": "जेईई स्टोर", "Learning paths": "सीखने के रास्ते" };
    const props = { productPageCode: "jee-store", productPageName: "JEE Store", title: "Learning paths" };
    expect(isTextKey("productPageName")).toBe(false);
    const localized = localizeDeep(props, dict);
    expect(localized).toEqual({ ...props, title: "सीखने के रास्ते" });
    expect(collectTranslatableStrings(props)).toEqual(["Learning paths"]);
    const picked = { ...localized, productPageCode: "neet-store", productPageName: "NEET Store" };
    expect(applyLocalizedEdit(props, localized, picked)).toEqual({
      base: { ...props, productPageCode: "neet-store", productPageName: "NEET Store" },
      translations: {},
    });
  });

  it("does not offer data strings for translation", () => {
    const props = { defaultSort: "Price: Low to High", title: "Courses", formFields: [{ name: "email", label: "Email" }] };
    expect(collectTranslatableStrings(props)).toEqual(["Courses", "Email"]);
  });

  it("routes edits of data strings to the base, even in a non-base language", () => {
    const base = { defaultSort: "Newest", heading: "Newest" };
    const localized = localizeDeep(base, DICT);
    expect(localized).toEqual({ defaultSort: "Newest", heading: "नवीनतम" });
    const res = applyLocalizedEdit(base, localized, { ...localized, defaultSort: "Price: Low to High" });
    expect(res.base.defaultSort).toBe("Price: Low to High");
    expect(res.translations).toEqual({});
  });
});

describe("resolveSiteLocale", () => {
  const settings = { enabled: true, defaultLocale: "en", locales: [{ code: "en", label: "EN" }, { code: "hi", label: "हिन्दी" }] };

  it("prefers ?lang=, then the remembered choice, then the base language", () => {
    expect(resolveSiteLocale({ settings, urlLocale: "hi", storedLocale: "en" })).toBe("hi");
    expect(resolveSiteLocale({ settings, urlLocale: null, storedLocale: "hi" })).toBe("hi");
    expect(resolveSiteLocale({ settings })).toBe("en");
  });

  it("ignores unknown languages and disabled sites", () => {
    expect(resolveSiteLocale({ settings, urlLocale: "fr" })).toBe("en");
    expect(resolveSiteLocale({ settings: { ...settings, enabled: false }, urlLocale: "hi" })).toBe("en");
    expect(resolveSiteLocale({ settings: undefined, urlLocale: "hi" })).toBe("en");
  });

  it("always lists the base language first, once", () => {
    expect(localesOf({ defaultLocale: "hi", locales: [{ code: "en", label: "EN" }, { code: "hi", label: "हिन्दी" }] }).map((l) => l.code)).toEqual(["hi", "en"]);
    expect(localesOf(undefined).map((l) => l.code)).toEqual(["en", "hi"]);
  });
});

describe("dictionaryFor", () => {
  it("is undefined for the base language, disabled sites and empty dictionaries", () => {
    const settings = { enabled: true, strings: { hi: HI, mr: {} } };
    expect(dictionaryFor(settings, "en")).toBeUndefined();
    expect(dictionaryFor(settings, "mr")).toBeUndefined();
    expect(dictionaryFor({ ...settings, enabled: false }, "hi")).toBeUndefined();
    expect(dictionaryFor(settings, "hi")).toBe(HI);
  });
});

describe("localizeDeep", () => {
  it("swaps translated text, leaves untranslated text and data alone", () => {
    const props = {
      title: "Education",
      subtitle: "Not translated yet",
      route: "Courses",
      backgroundColor: "rgb(255, 255, 255)",
      button: { text: "Explore Education", route: "/courses?stream=shiksha" },
      items: [{ label: "Courses" }, "Education"],
      tags: ["Education"],
    };
    const out = localizeDeep(props, HI);
    expect(out.title).toBe("शिक्षा");
    expect(out.subtitle).toBe("Not translated yet");
    expect(out.route).toBe("Courses");
    expect(out.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(out.button).toEqual({ text: "शिक्षा देखें", route: "/courses?stream=shiksha" });
    expect(out.items).toEqual([{ label: "पाठ्यक्रम" }, "शिक्षा"]);
    expect(out.tags).toEqual(["Education"]);
  });

  it("returns the same references when nothing changes", () => {
    const props = { title: "Untranslated", nested: { a: [1, 2], b: "x" } };
    expect(localizeDeep(props, HI)).toBe(props);
    expect(localizeDeep(props, undefined)).toBe(props);
    const mixed = { title: "Education", nested: { b: "x" } };
    expect(localizeDeep(mixed, HI).nested).toBe(mixed.nested);
  });

  it("keeps surrounding whitespace when only the trimmed text is translated", () => {
    expect(translateText("  Education ", HI)).toBe("  शिक्षा ");
  });
});

describe("collectTranslatableStrings", () => {
  it("lists distinct prose only, skipping links, colours and numbers", () => {
    const props = {
      title: "Education",
      price: "₹1,000",
      link: "https://x.io",
      stats: [{ value: "1,200+", label: "Learners" }, { label: "Education" }],
      href: "/courses",
      color: "rgb(255, 255, 255)",
    };
    expect(collectTranslatableStrings(props)).toEqual(["Education", "Learners"]);
  });

  it("reports coverage against a dictionary", () => {
    expect(translationCoverage(["Education", "New"], HI)).toEqual({ total: 2, translated: 1, missing: ["New"] });
  });
});

describe("applyLocalizedEdit", () => {
  const base = {
    title: "Education",
    subtitle: "Learn the Indian way of learning.",
    backgroundColor: "rgb(255, 255, 255)",
    items: [{ label: "Courses", route: "/courses" }, { label: "Paths", route: "/paths" }],
  };

  it("routes a text edit into the dictionary and keeps the English base", () => {
    const localized = localizeDeep(base, HI);
    const edited = { ...localized, subtitle: "भारतीय तरीके से सीखें।" };
    const res = applyLocalizedEdit(base, localized, edited);
    expect(res.base).toEqual(base);
    expect(res.translations).toEqual({ "Learn the Indian way of learning.": "भारतीय तरीके से सीखें।" });
  });

  it("applies non-text edits to the shared base", () => {
    const localized = localizeDeep(base, HI);
    const edited = { ...localized, backgroundColor: "rgb(0, 0, 0)" };
    const res = applyLocalizedEdit(base, localized, edited);
    expect(res.base.backgroundColor).toBe("rgb(0, 0, 0)");
    expect(res.base.title).toBe("Education");
    expect(res.translations).toEqual({});
  });

  it("edits a text field inside an item without touching its link", () => {
    const localized = localizeDeep(base, HI);
    const items = localized.items.map((it, i) => (i === 1 ? { ...it, label: "पथ" } : it));
    const res = applyLocalizedEdit(base, localized, { ...localized, items });
    expect(res.base.items).toEqual(base.items);
    expect(res.translations).toEqual({ Paths: "पथ" });
  });

  it("removes and reorders items in the base by identity", () => {
    const localized = localizeDeep(base, HI);
    const removed = applyLocalizedEdit(base, localized, { ...localized, items: [localized.items[1]] });
    expect(removed.base.items).toEqual([base.items[1]]);
    const reordered = applyLocalizedEdit(base, localized, { ...localized, items: [localized.items[1], localized.items[0]] });
    expect(reordered.base.items).toEqual([base.items[1], base.items[0]]);
    expect(reordered.translations).toEqual({});
  });

  it("adds a new item to the base", () => {
    const localized = localizeDeep(base, HI);
    const added = applyLocalizedEdit(base, localized, { ...localized, items: [...localized.items, { label: "New", route: "/new" }] });
    expect(added.base.items).toHaveLength(3);
    expect(added.base.items[0]).toBe(base.items[0]);
    expect(added.base.items[2]).toEqual({ label: "New", route: "/new" });
  });

  it("clearing or retyping the English removes the translation", () => {
    const localized = localizeDeep(base, HI);
    const cleared = applyLocalizedEdit(base, localized, { ...localized, title: "" });
    expect(cleared.translations).toEqual({ Education: "" });
    expect(mergeTranslations(HI, cleared.translations)).not.toHaveProperty("Education");
    const same = applyLocalizedEdit(base, localized, { ...localized, title: "Education" });
    expect(same.translations).toEqual({ Education: "" });
  });
});

describe("maps whose values are always text (formatLabels, ctaLabels, sortLabels, descriptions)", () => {
  const HI_FORMATS = { Video: "वीडियो", Animation: "एनिमेशन", "E-book": "ई-पुस्तक" };
  const props = { formatLabels: { video: "Video", animation: "Animation", ebook: "E-book" } };

  it("collects and localizes every label, whatever its key ('video' is a data key, 'animation' an opaque one)", () => {
    expect(collectTranslatableStrings(props)).toEqual(["Video", "Animation", "E-book"]);
    expect(localizeDeep(props, HI_FORMATS)).toEqual({ formatLabels: { video: "वीडियो", animation: "एनिमेशन", ebook: "ई-पुस्तक" } });
  });

  it("a Hindi edit of formatLabels.video is a translation; the English base keeps 'Video'", () => {
    const localized = localizeDeep(props, HI_FORMATS);
    const edit = applyLocalizedEdit(props, localized, { formatLabels: { ...localized.formatLabels, video: "वीडियो देखें" } });
    expect(edit.base).toEqual(props);
    expect(edit.translations).toEqual({ Video: "वीडियो देखें" });
  });

  it("still skips data values inside the map", () => {
    expect(collectTranslatableStrings({ ctaLabels: { paid: "View course", link: "https://x.org" } })).toEqual(["View course"]);
  });
});

describe("values that are the same in every language", () => {
  it("a sidebar's group order, a CTA rule's formats and category slugs are never collected", () => {
    const props = {
      filterSidebar: { order: ["priceRange", "Levels"] },
      columnSections: [{ ctaRules: [{ formats: ["Video", "eBook"], label: "Watch now" }] }],
      comingSoon: { categorySlugs: ["Vedic Maths"] },
    };
    expect(collectTranslatableStrings(props)).toEqual(["Watch now"]);
  });

  it("a title in its own script (titleNative) and a placeholder-only text ('{price}') are data", () => {
    const props = { slides: [{ title: "Menstrual care", titleNative: "रजस्वला परिचर्या", steps: [{ label: "Fee", meta: "{price}" }, { meta: "{{count}}" }] }] };
    expect(collectTranslatableStrings(props)).toEqual(["Menstrual care", "Fee"]);
    expect(collectTranslatableStrings({ countLabel: "Showing {{shown}} of {{total}}" })).toEqual(["Showing {{shown}} of {{total}}"]);
  });
});

describe("texts inside a course grid's opaque render", () => {
  const render = {
    layout: "grid",
    cardFields: ["package_name", "price"],
    cardStyle: "editorial",
    styles: { backgroundColor: "var(--surface)" },
    card: {
      streamLabel: "subtitle",
      formatLabels: { video: "Video", ebook: "E-book" },
      freeCtaByFormat: { video: "watch" },
      ctaLabels: { paid: "View course" },
      freeLabel: "Free",
      descriptions: { "pkg-1": "The Vedic science of conception." },
      colors: { divider: "var(--line)" },
    },
    pagination: { mode: "loadMore", pageSize: 9, loadMoreLabel: "Load more", countLabel: "Showing {{shown}} of {{total}}" },
    gridHeading: { title: "All courses", showSort: true, sortLabels: { Popular: "Sorted by most popular" } },
  };
  const HI_RENDER = { "View course": "पाठ्यक्रम देखें", Video: "वीडियो", "Load more": "और देखें" };

  it("lists the card labels, descriptions, Load more texts and grid heading — never settings", () => {
    expect(renderTextEntries(render)).toEqual([
      { path: ["card", "formatLabels", "video"], text: "Video" },
      { path: ["card", "formatLabels", "ebook"], text: "E-book" },
      { path: ["card", "ctaLabels", "paid"], text: "View course" },
      { path: ["card", "freeLabel"], text: "Free" },
      { path: ["card", "descriptions", "pkg-1"], text: "The Vedic science of conception." },
      { path: ["pagination", "loadMoreLabel"], text: "Load more" },
      { path: ["pagination", "countLabel"], text: "Showing {{shown}} of {{total}}" },
      { path: ["gridHeading", "title"], text: "All courses" },
      { path: ["gridHeading", "sortLabels", "Popular"], text: "Sorted by most popular" },
    ]);
    expect(renderTextEntries(undefined)).toEqual([]);
  });

  it("stays opaque to the site's localizer (the site shows these through its dictionary itself)", () => {
    const props = { render };
    expect(localizeDeep(props, HI_RENDER)).toBe(props);
    expect(collectTranslatableStrings(props)).toEqual([]);
  });

  it("localizeRenderTexts translates only the texts, and returns the same object when nothing is translated", () => {
    const shown = localizeRenderTexts(render, HI_RENDER);
    expect(shown.card.ctaLabels.paid).toBe("पाठ्यक्रम देखें");
    expect(shown.card.formatLabels).toEqual({ video: "वीडियो", ebook: "E-book" });
    expect(shown.pagination).toEqual({ ...render.pagination, loadMoreLabel: "और देखें" });
    expect(shown.card.freeCtaByFormat).toBe(render.card.freeCtaByFormat);
    expect(render.card.ctaLabels.paid).toBe("View course");
    expect(localizeRenderTexts(render, { Nothing: "कुछ नहीं" })).toBe(render);
  });

  it("a Hindi edit of a card text is saved as a translation, never over the English base", () => {
    const base = { title: "All courses", render: { card: { ctaLabels: { paid: "View course" } } } };
    const localized = localizeDeep(base, HI_RENDER);
    const edit = applyLocalizedEdit(base, localized, { ...localized, render: { card: { ctaLabels: { paid: "कोर्स देखें" } } } });
    expect(edit.base).toEqual(base);
    expect(edit.translations).toEqual({ "View course": "कोर्स देखें" });
  });

  it("a settings change in a translated render keeps the English texts and applies the setting", () => {
    const view = localizeRenderTexts(render, HI_RENDER);
    const edited = { ...view, pagination: { ...view.pagination, pageSize: 12 } };
    const split = splitRenderEdit(render, view, edited);
    expect(split.render).toEqual({ ...render, pagination: { ...render.pagination, pageSize: 12 } });
    expect(split.translations).toEqual({});
    expect(split.problem).toBeUndefined();
  });

  it("clearing a translated label clears the translation; text typed where English has none is a problem", () => {
    const view = localizeRenderTexts(render, HI_RENDER);
    const cleared = splitRenderEdit(render, view, { ...view, card: { ...view.card, ctaLabels: { paid: "" } } });
    expect(cleared.translations).toEqual({ "View course": "" });
    expect((cleared.render as typeof render).card.ctaLabels).toEqual({ paid: "View course" });
    expect(cleared.problem).toBeUndefined();
    const typed = splitRenderEdit(render, view, { ...view, card: { ...view.card, descriptions: { ...view.card.descriptions, "pkg-2": "नया विवरण" } } });
    expect(typed.problem).toBe("emptySource");
  });

  it("removing a label entry is a structure problem: no shared translation is cleared", () => {
    const view = localizeRenderTexts(render, HI_RENDER);
    const removed = splitRenderEdit(render, view, { ...view, card: { ...view.card, formatLabels: { ebook: "E-book" } } });
    expect(removed.problem).toBe("structure");
    expect(removed.translations).toEqual({});
    const edit = applyLocalizedEdit({ render }, { render: view }, { render: { ...view, card: { ...view.card, ctaLabels: {} } } });
    expect(edit.problem).toBe("structure");
    expect(edit.translations).toEqual({});
  });
});
