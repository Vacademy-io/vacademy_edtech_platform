// @vitest-environment jsdom
//
// The suite-wide default is `node`; the hero body goes through DOMPurify,
// which needs a real window to build its sanitizer.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORM_APPEARANCE,
  hasStructuredHeroContent,
  MAX_FORM_HIGHLIGHTS,
  parseAudienceFormAppearance,
  resolveFormSubtitle,
  resolveFormSubtitleHtml,
  resolveHeadline,
  resolveHeadlineHtml,
  resolveHeroBodyHtml,
  resolveHeroHtml,
  sanitizeCustomCss,
} from "./form-appearance";

const wrap = (appearance: unknown) => JSON.stringify({ formAppearance: appearance });

describe("parseAudienceFormAppearance — a public form must always render", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace", "   "],
    ["malformed JSON", "{not json"],
    ["a JSON array", "[1,2,3]"],
    ["a JSON scalar", '"hello"'],
    ["an unrelated blob", '{"postSubmitConfiguration":{"enabled":true}}'],
    ["a null appearance", '{"formAppearance":null}'],
    ["an appearance array", '{"formAppearance":[]}'],
  ])("falls back to the defaults for %s", (_label, settingJson) => {
    expect(parseAudienceFormAppearance(settingJson as string | null | undefined)).toEqual(
      DEFAULT_FORM_APPEARANCE
    );
  });

  it("ignores enum values it does not recognise", () => {
    const parsed = parseAudienceFormAppearance(
      wrap({
        layout: "carousel",
        width: "gigantic",
        background: "rainbow",
        accent: "chartreuse",
        cardStyle: "brutalist",
      })
    );
    expect(parsed.layout).toBe(DEFAULT_FORM_APPEARANCE.layout);
    expect(parsed.width).toBe(DEFAULT_FORM_APPEARANCE.width);
    expect(parsed.background).toBe(DEFAULT_FORM_APPEARANCE.background);
    expect(parsed.accent).toBe(DEFAULT_FORM_APPEARANCE.accent);
    expect(parsed.cardStyle).toBe(DEFAULT_FORM_APPEARANCE.cardStyle);
  });

  it("keeps the enum values it does recognise", () => {
    const parsed = parseAudienceFormAppearance(
      wrap({
        layout: "split",
        width: "narrow",
        background: "muted",
        accent: "info",
        cardStyle: "outlined",
      })
    );
    expect(parsed).toMatchObject({
      layout: "split",
      width: "narrow",
      background: "muted",
      accent: "info",
      cardStyle: "outlined",
    });
  });

  it("renders the standard page unless a known template is picked", () => {
    expect(parseAudienceFormAppearance(wrap({})).template).toBe("standard");
    expect(parseAudienceFormAppearance(wrap({ template: "neon" })).template).toBe(
      "standard"
    );
    for (const template of [
      "banner",
      "split",
      "framed",
      "minimal",
      "gradient",
      "dark",
      "logo",
    ]) {
      expect(parseAudienceFormAppearance(wrap({ template })).template).toBe(template);
    }
  });

  it("honours booleans in both directions", () => {
    // Each of these flips its own default, so the assertion cannot pass by
    // accidentally falling through to the fallback.
    const parsed = parseAudienceFormAppearance(
      wrap({ showObjective: false, showProgress: true, showRequiredLegend: true })
    );
    expect(parsed.showObjective).toBe(false);
    expect(parsed.showProgress).toBe(true);
    expect(parsed.showRequiredLegend).toBe(true);
  });

  it("shows the header bar and page heading unless switched off", () => {
    expect(parseAudienceFormAppearance(wrap({}))).toMatchObject({
      showHeader: true,
      showHeadline: true,
    });
    expect(
      parseAudienceFormAppearance(wrap({ showHeader: false, showHeadline: false }))
    ).toMatchObject({ showHeader: false, showHeadline: false });
    expect(
      parseAudienceFormAppearance(wrap({ showHeader: "no", showHeadline: 0 }))
    ).toMatchObject({ showHeader: true, showHeadline: true });
  });

  it("ignores non-booleans", () => {
    const parsed = parseAudienceFormAppearance(
      wrap({ showObjective: "no", showProgress: "yes", showRequiredLegend: 1 })
    );
    expect(parsed.showObjective).toBe(DEFAULT_FORM_APPEARANCE.showObjective);
    expect(parsed.showProgress).toBe(DEFAULT_FORM_APPEARANCE.showProgress);
    expect(parsed.showRequiredLegend).toBe(
      DEFAULT_FORM_APPEARANCE.showRequiredLegend
    );
  });

  it("caps a runaway string rather than rendering it", () => {
    const parsed = parseAudienceFormAppearance(
      wrap({ eyebrow: "x".repeat(5000), headline: "x".repeat(9000) })
    );
    expect(parsed.eyebrow).toHaveLength(500);
    // Rich-text fields get a larger cap: markup is longer than its words.
    expect(parsed.headline).toHaveLength(5000);
  });
});

describe("cover image URLs", () => {
  it.each([
    ["javascript:alert(1)"],
    ["data:text/html;base64,PHNjcmlwdD4="],
    ["//evil.example.com/pixel.png"],
    ["ftp://example.com/a.png"],
    ["   "],
  ])("drops the unsafe/blank source %s", (url) => {
    expect(parseAudienceFormAppearance(wrap({ coverImageUrl: url })).coverImageUrl).toBe("");
  });

  it.each([
    ["https://cdn.example.com/cover.png"],
    ["http://cdn.example.com/cover.png"],
    ["/assets/cover.png"],
  ])("keeps the safe source %s", (url) => {
    expect(parseAudienceFormAppearance(wrap({ coverImageUrl: url })).coverImageUrl).toBe(url);
  });

  it("ignores a non-string source", () => {
    expect(parseAudienceFormAppearance(wrap({ coverImageUrl: 42 })).coverImageUrl).toBe("");
  });
});

describe("highlights", () => {
  it("drops entries with no text — a bullet with nothing beside it", () => {
    const parsed = parseAudienceFormAppearance(
      wrap({
        highlights: [
          { id: "a", icon: "shield", text: "Your data stays private" },
          { id: "b", icon: "clock", text: "   " },
          { id: "c", icon: "clock" },
        ],
      })
    );
    expect(parsed.highlights).toEqual([
      { id: "a", icon: "shield", text: "Your data stays private" },
    ]);
  });

  it("falls back to a known icon and a generated id", () => {
    const parsed = parseAudienceFormAppearance(
      wrap({ highlights: [{ icon: "explosion", text: "Fast" }] })
    );
    expect(parsed.highlights).toEqual([{ id: "highlight-0", icon: "check", text: "Fast" }]);
  });

  it(`renders at most ${MAX_FORM_HIGHLIGHTS}`, () => {
    const parsed = parseAudienceFormAppearance(
      wrap({
        highlights: Array.from({ length: 20 }, (_, i) => ({ text: `h${i}` })),
      })
    );
    expect(parsed.highlights).toHaveLength(MAX_FORM_HIGHLIGHTS);
  });

  it("ignores a non-array", () => {
    expect(parseAudienceFormAppearance(wrap({ highlights: "nope" })).highlights).toEqual([]);
  });
});

describe("resolveHeadline", () => {
  it("uses the campaign name when no override is set", () => {
    expect(resolveHeadline(DEFAULT_FORM_APPEARANCE, "Summer Intake")).toBe("Summer Intake");
  });

  it("prefers the admin override", () => {
    const appearance = { ...DEFAULT_FORM_APPEARANCE, headline: "Join us" };
    expect(resolveHeadline(appearance, "Summer Intake")).toBe("Join us");
  });

  it("treats a whitespace override as unset", () => {
    const appearance = { ...DEFAULT_FORM_APPEARANCE, headline: "   " };
    expect(resolveHeadline(appearance, "Summer Intake")).toBe("Summer Intake");
  });

  it("survives a campaign with no name", () => {
    expect(resolveHeadline(DEFAULT_FORM_APPEARANCE, null)).toBe("");
  });
});

describe("rich-text heading and sub-heading", () => {
  it("renders a rich headline as sanitized HTML and strips it for the text form", () => {
    const appearance = {
      ...DEFAULT_FORM_APPEARANCE,
      headline: '<p>Join <strong>us</strong></p><script>alert(1)</script>',
    };
    const html = resolveHeadlineHtml(appearance);
    expect(html).toContain("<strong>us</strong>");
    expect(html).not.toContain("script");
    expect(resolveHeadline(appearance, "Summer Intake")).toBe("Join us");
  });

  it("treats an emptied editor as unset, so the campaign name comes back", () => {
    const appearance = { ...DEFAULT_FORM_APPEARANCE, headline: "<p></p>" };
    expect(resolveHeadlineHtml(appearance)).toBe("");
    expect(resolveHeadline(appearance, "Summer Intake")).toBe("Summer Intake");
  });

  it("keeps a plain headline on the text path, untouched", () => {
    const appearance = { ...DEFAULT_FORM_APPEARANCE, headline: "Ages <5 & >3" };
    expect(resolveHeadlineHtml(appearance)).toBe("");
    expect(resolveHeadline(appearance, "x")).toBe("Ages <5 & >3");
  });

  it("does the same for the form sub-heading", () => {
    const rich = { ...DEFAULT_FORM_APPEARANCE, formSubtitle: "<p>We <em>reply</em> fast</p>" };
    expect(resolveFormSubtitleHtml(rich)).toContain("<em>reply</em>");
    const blank = { ...DEFAULT_FORM_APPEARANCE, formSubtitle: "<p><br></p>" };
    expect(resolveFormSubtitleHtml(blank)).toBe("");
    expect(resolveFormSubtitle(blank)).toBe("");
    const plain = { ...DEFAULT_FORM_APPEARANCE, formSubtitle: " Call us " };
    expect(resolveFormSubtitle(plain)).toBe("Call us");
  });

  it("does not cut a long rich headline at the 500-character label cap", () => {
    const long = `<p>${"word ".repeat(150)}</p>`;
    expect(parseAudienceFormAppearance(wrap({ headline: long })).headline).toBe(long);
  });

  it("parses alignment and rejects unknown values", () => {
    const parsed = parseAudienceFormAppearance(
      wrap({ headingAlign: "center", formHeaderAlign: "justify" })
    );
    expect(parsed.headingAlign).toBe("center");
    expect(parsed.formHeaderAlign).toBe("left");
  });
});

describe("resolveHeroBodyHtml", () => {
  it("falls back to the campaign description", () => {
    expect(resolveHeroBodyHtml(DEFAULT_FORM_APPEARANCE, "<p>Apply now</p>")).toBe(
      "<p>Apply now</p>"
    );
  });

  it("prefers the admin subheadline", () => {
    const appearance = { ...DEFAULT_FORM_APPEARANCE, subheadline: "<p>Overridden</p>" };
    expect(resolveHeroBodyHtml(appearance, "<p>Apply now</p>")).toBe("<p>Overridden</p>");
  });

  it("returns nothing when the block is switched off, so the page emits no empty div", () => {
    const appearance = { ...DEFAULT_FORM_APPEARANCE, showDescription: false };
    expect(resolveHeroBodyHtml(appearance, "<p>Apply now</p>")).toBe("");
  });

  it("returns nothing when there is nothing to say", () => {
    expect(resolveHeroBodyHtml(DEFAULT_FORM_APPEARANCE, "   ")).toBe("");
    expect(resolveHeroBodyHtml(DEFAULT_FORM_APPEARANCE, null)).toBe("");
  });

  it("strips script out of admin-authored copy", () => {
    const html = resolveHeroBodyHtml(
      DEFAULT_FORM_APPEARANCE,
      '<p>Hi</p><script>alert(1)</script>'
    );
    expect(html).toContain("<p>Hi</p>");
    expect(html).not.toContain("script");
  });
});

describe("sanitizeCustomCss", () => {
  it.each([["", ""], ["   ", ""]])("returns nothing for blank input (%j)", (input, expected) => {
    expect(sanitizeCustomCss(input)).toBe(expected);
  });

  it("keeps ordinary CSS, child combinator included", () => {
    const css = ".vac-af-card > .vac-af-field { color: red; }";
    expect(sanitizeCustomCss(css)).toBe(css);
  });

  it("closes the only way out of a <style> element", () => {
    // `</style` is what turns CSS back into HTML — stripping `</` kills it
    // while leaving `>` (the child combinator) alone.
    const out = sanitizeCustomCss('.a{color:red}</style><script>alert(1)</script>');
    expect(out).not.toContain("</style");
    expect(out).not.toContain("</script");
  });

  it("drops @import so the page cannot pull in a third-party sheet", () => {
    expect(sanitizeCustomCss('@import url("https://evil.example.com/x.css"); .a{color:red}')).toBe(
      ".a{color:red}"
    );
  });

  it.each(["expression(alert(1))", "behavior: url(#x)", "-moz-binding: url(#x)"])(
    "strips the legacy script vector %s",
    (snippet) => {
      const out = sanitizeCustomCss(`.a{ ${snippet} }`);
      expect(out.toLowerCase()).not.toContain("expression(");
      expect(out.toLowerCase()).not.toContain("behavior:");
      expect(out.toLowerCase()).not.toContain("-moz-binding:");
    }
  );

  it.each([
    "url(https://cdn.example.com/a.png)",
    "url('/assets/a.png')",
    "url(data:image/png;base64,AAA)",
  ])("keeps the safe asset reference %s", (url) => {
    expect(sanitizeCustomCss(`.a{background:${url}}`)).toContain(url);
  });

  it.each(["url(javascript:alert(1))", "url(data:text/html;base64,AAA)"])(
    "neutralises the unsafe asset reference %s",
    (url) => {
      const out = sanitizeCustomCss(`.a{background:${url}}`);
      expect(out).not.toContain(url);
      expect(out).toContain("none");
    }
  );

  it("caps a runaway stylesheet", () => {
    expect(sanitizeCustomCss(".a{}".repeat(20000)).length).toBeLessThanOrEqual(20000);
  });
});

describe("resolveHeroHtml", () => {
  it("is blank unless the admin authored one — the structured hero is the default", () => {
    expect(resolveHeroHtml(DEFAULT_FORM_APPEARANCE)).toBe("");
    expect(resolveHeroHtml({ ...DEFAULT_FORM_APPEARANCE, heroHtml: "   " })).toBe("");
  });

  it("sanitizes what it returns", () => {
    const html = resolveHeroHtml({
      ...DEFAULT_FORM_APPEARANCE,
      heroHtml: '<h1 class="x">Hi</h1><script>alert(1)</script>',
    });
    expect(html).toContain("Hi");
    expect(html).not.toContain("script");
  });

  it("keeps class and style attributes so custom CSS has something to target", () => {
    const html = resolveHeroHtml({
      ...DEFAULT_FORM_APPEARANCE,
      heroHtml: '<div class="my-hero" style="text-align:center">Hi</div>',
    });
    expect(html).toContain('class="my-hero"');
    expect(html).toContain("text-align");
  });
});

describe("hasStructuredHeroContent", () => {
  const campaign = { name: "GLP1-Nutrition-IN", description: "", objective: "Lead" };
  const allOff = {
    ...DEFAULT_FORM_APPEARANCE,
    showHeadline: false,
    showDescription: false,
    showObjective: false,
  };

  it("is true by default — the campaign name is the heading", () => {
    expect(hasStructuredHeroContent(DEFAULT_FORM_APPEARANCE, campaign)).toBe(true);
  });

  it("is false once heading, intro and objective are all switched off", () => {
    expect(hasStructuredHeroContent(allOff, campaign)).toBe(false);
  });

  it("stays true while any other block is authored", () => {
    expect(hasStructuredHeroContent({ ...allOff, eyebrow: "Admissions" }, campaign)).toBe(true);
    expect(
      hasStructuredHeroContent({ ...allOff, showObjective: true }, campaign)
    ).toBe(true);
    expect(
      hasStructuredHeroContent(
        { ...allOff, highlights: [{ id: "a", icon: "check", text: "Free" }] },
        campaign
      )
    ).toBe(true);
  });
});
