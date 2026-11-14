/**
 * Drift guards for the design-pattern registry (design-patterns.ts):
 *  - every variant literal of the opt-in unions in -types/* (and the two
 *    component prop types that carry one) has a pattern whose minimal uses it;
 *  - every `fullFrom` resolves in the Brahm Varchas fixture, on the component
 *    the pattern names, with the minimal's keys present;
 *  - every `bound` path reaches a value, and the scrubbed full example carries
 *    no fixture id, uploaded-asset URL, absolute link or brand name;
 *  - every id placeholder tells the AI to leave the id empty (writes do not
 *    check ids; link_lead_form or the admin fills them);
 *  - every minimal switches its opt-in on, read through the renderer's own
 *    config resolvers (the same code the components call);
 *  - recipes and contracts only name patterns that exist.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHROME_CONTRACT,
  DESIGN_PATTERNS,
  DESIGN_RECIPES,
  FIXTURE_BRAND_NAMES,
  GLOBAL_SETTINGS_CONTRACT,
  UUID_PATTERN,
  boundPathExists,
  findDesignPattern,
  fullExampleOf,
  readPointer,
  scrubExample,
  type DesignPattern,
} from "./design-patterns";
import { resolveCatalogHero } from "../-components/components/catalog/catalog-hero-config";
import { resolveStreamIconTabs } from "../-components/components/catalog/stream-icon-tabs-config";
import { resolveFilterSidebar } from "../-components/components/catalog/catalog-sidebar-config";
import { resolveCatalogDiscovery } from "../-components/components/catalog/catalog-config";
import { resolveCustomFilters } from "../-components/components/catalog/catalog-custom-filters";
import { resolveCardDesign, resolveGridHeading, resolveLoadMore } from "../-components/components/catalog/catalog-card-view";
import { resolveColumnSections } from "../-components/components/catalog/catalog-column-sections";
import { hasHeaderChrome, resolveHeaderChrome } from "../-components/header/header-chrome";
import { PALETTE_KEYS, buildPaletteVars, resolveContentMaxWidth } from "../-utils/catalogue-palette";
import { resolveCourseFormats } from "../-utils/course-format";
import { normaliseLanguages } from "../-components/components/catalog/catalog-config";
import { localesOf } from "../-utils/catalogue-i18n";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAG_ROOT = path.resolve(HERE, "..");
const FIXTURE_PATH = path.resolve(
  HERE,
  "../../../../../frontend-admin-dashboard/src/routes/manage-pages/-components/__fixtures__/brahm-varchas-site.json",
);
const FIXTURE = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;
/** The generated outputs (scripts/export-catalogue-schema-catalog.mjs). */
const CATALOG_PATH = path.resolve(HERE, "../../../../../ai_service/app/data/catalogue_schema_catalog.json");
const ADMIN_COPY_PATH = path.resolve(
  HERE,
  "../../../../../frontend-admin-dashboard/src/routes/manage-pages/-utils/generated/design-patterns.json",
);
const source = (rel: string) => fs.readFileSync(path.join(TAG_ROOT, rel), "utf8");
const BRANDS = FIXTURE_BRAND_NAMES["brahm-varchas-site"];
/** A pattern's full example as the exporter writes it. */
const scrubbedFull = (p: DesignPattern) => scrubExample(fullExampleOf(FIXTURE, p.fullFrom!), p.bound, FIXTURE_BRAND_NAMES[p.fullFrom!.fixture]);

type Json = Record<string, unknown>;
const asJson = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/* ── reading literal unions out of the type sources ──────────────────── */

const literals = (text: string): string[] => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);

const typeAliasLiterals = (file: string, name: string): string[] => {
  const m = source(file).match(new RegExp(`export type ${name}\\s*=([^;]+);`));
  if (!m) throw new Error(`type ${name} not found in ${file}`);
  return literals(m[1]!);
};

const interfaceBody = (text: string, name: string): string => {
  const start = text.search(new RegExp(`interface ${name}\\b`));
  if (start < 0) throw new Error(`interface ${name} not found`);
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`interface ${name} is not closed`);
};

const propLiterals = (file: string, iface: string, prop: string): string[] => {
  const body = interfaceBody(source(file), iface);
  const m = body.match(new RegExp(`\\n\\s*${prop}\\??:\\s*([^;]+);`));
  if (!m) throw new Error(`${iface}.${prop} not found in ${file}`);
  return literals(m[1]!);
};

/** Values at a dotted path ("a[].b") of a minimal. */
const valuesAt = (root: unknown, dotted: string): unknown[] => {
  let nodes: unknown[] = [root];
  for (const seg of dotted.split(".")) {
    const each = seg.endsWith("[]");
    const key = each ? seg.slice(0, -2) : seg;
    const next: unknown[] = [];
    for (const n of nodes) {
      const v = asJson(n)[key];
      if (v === undefined) continue;
      if (each) next.push(...(Array.isArray(v) ? v : []));
      else next.push(v);
    }
    nodes = next;
  }
  return nodes;
};

interface VariantUnion {
  label: string;
  literals: () => string[];
  component: DesignPattern["component"];
  paths: string[];
  /** The original look: absent = this literal; it needs no pattern. */
  defaults: string[];
}

const VARIANT_UNIONS: VariantUnion[] = [
  { label: "CatalogStreamTabsVariant", literals: () => typeAliasLiterals("-types/catalog-tabs-types.ts", "CatalogStreamTabsVariant"), component: "courseCatalog", paths: ["streams.variant"], defaults: [] },
  { label: "CatalogFilterSidebarConfig.variant", literals: () => propLiterals("-types/catalog-sidebar-types.ts", "CatalogFilterSidebarConfig", "variant"), component: "courseCatalog", paths: ["filterSidebar.variant"], defaults: ["default"] },
  { label: "CatalogPriceFilterExtension.control", literals: () => propLiterals("-types/catalog-sidebar-types.ts", "CatalogPriceFilterExtension", "control"), component: "courseCatalog", paths: ["priceFilter.control"], defaults: ["radio"] },
  { label: "CatalogCustomFilterConfig.source", literals: () => propLiterals("-types/catalog-sidebar-types.ts", "CatalogCustomFilterConfig", "source"), component: "courseCatalog", paths: ["customFilters[].source"], defaults: [] },
  { label: "CatalogCategoryFilterExtension.scope", literals: () => propLiterals("-types/catalog-sidebar-types.ts", "CatalogCategoryFilterExtension", "scope"), component: "courseCatalog", paths: ["categoryFilter.scope"], defaults: ["stream"] },
  { label: "CatalogCardsRenderExtension.cardStyle", literals: () => propLiterals("-types/catalog-cards-types.ts", "CatalogCardsRenderExtension", "cardStyle"), component: "courseCatalog", paths: ["render.cardStyle"], defaults: ["default"] },
  { label: "CatalogCardsPaginationConfig.mode", literals: () => propLiterals("-types/catalog-cards-types.ts", "CatalogCardsPaginationConfig", "mode"), component: "courseCatalog", paths: ["render.pagination.mode"], defaults: ["pages"] },
  { label: "CatalogQuickFilterBarConfig.variant", literals: () => propLiterals("-types/catalog-hero-types.ts", "CatalogQuickFilterBarConfig", "variant"), component: "courseCatalog", paths: ["hero.quickFilterBar.variant"], defaults: ["tint"] },
  { label: "CatalogQuickFilterKind", literals: () => typeAliasLiterals("-types/course-catalogue-types.ts", "CatalogQuickFilterKind"), component: "courseCatalog", paths: ["quickFilters[].kind"], defaults: [] },
  {
    label: "CatalogColumnSectionConfig.kind",
    literals: () =>
      ["FreeCoursesSectionConfig", "SpotlightSectionConfig", "ComingSoonSectionConfig"].flatMap((i) =>
        propLiterals("-types/catalog-sections-types.ts", i, "kind"),
      ),
    component: "courseCatalog",
    paths: ["columnSections[].kind"],
    defaults: [],
  },
  { label: "HeroSectionProps.variant", literals: () => propLiterals("-components/components/HeroSectionComponent.tsx", "HeroSectionProps", "variant"), component: "heroSection", paths: ["variant"], defaults: ["default"] },
  { label: "LearningPathFeaturedOptions.listLayout", literals: () => propLiterals("-components/components/LearningPathFeatured.tsx", "LearningPathFeaturedOptions", "listLayout"), component: "learningPath", paths: ["listLayout"], defaults: ["cards"] },
  { label: "CtaBannerBandProps.variant", literals: () => propLiterals("-types/site-chrome-types.ts", "CtaBannerBandProps", "variant"), component: "ctaBanner", paths: ["variant"], defaults: [] },
  { label: "CtaBannerBandProps.bandSize", literals: () => propLiterals("-types/site-chrome-types.ts", "CtaBannerBandProps", "bandSize"), component: "ctaBanner", paths: ["bandSize"], defaults: ["md"] },
  { label: "CtaBandButtonStyle", literals: () => typeAliasLiterals("-types/site-chrome-types.ts", "CtaBandButtonStyle"), component: "ctaBanner", paths: ["button.style", "secondaryButton.style"], defaults: [] },
  { label: "CtaBandMockup.kind", literals: () => propLiterals("-types/site-chrome-types.ts", "CtaBandMockup", "kind"), component: "ctaBanner", paths: ["mockup.kind"], defaults: [] },
  { label: "StepsCardsProps.variant", literals: () => propLiterals("-types/site-chrome-types.ts", "StepsCardsProps", "variant"), component: "stepsProcess", paths: ["variant"], defaults: [] },
  { label: "HeaderBarSize", literals: () => typeAliasLiterals("-types/site-chrome-types.ts", "HeaderBarSize"), component: "header", paths: ["barSize"], defaults: ["default"] },
  { label: "HeaderContentWidth", literals: () => typeAliasLiterals("-types/site-chrome-types.ts", "HeaderContentWidth"), component: "header", paths: ["contentWidth"], defaults: ["full"] },
  { label: "HeaderNavStyle", literals: () => typeAliasLiterals("-types/site-chrome-types.ts", "HeaderNavStyle"), component: "header", paths: ["navStyle"], defaults: ["default"] },
  { label: "HeaderLanguageSwitcherStyle", literals: () => typeAliasLiterals("-types/site-chrome-types.ts", "HeaderLanguageSwitcherStyle"), component: "header", paths: ["languageSwitcherStyle"], defaults: ["pill"] },
  { label: "HeaderCartDisplay", literals: () => typeAliasLiterals("-types/site-chrome-types.ts", "HeaderCartDisplay"), component: "header", paths: ["cartDisplay"], defaults: ["always"] },
  { label: "HeaderMegaMenuStyle", literals: () => typeAliasLiterals("-types/site-chrome-types.ts", "HeaderMegaMenuStyle"), component: "header", paths: ["megaMenuStyle"], defaults: ["default"] },
  { label: "HeaderActiveStyle", literals: () => typeAliasLiterals("-types/course-catalogue-types.ts", "HeaderActiveStyle"), component: "header", paths: ["activeStyle"], defaults: ["pill"] },
  { label: "HeaderNavItem.type", literals: () => propLiterals("-types/course-catalogue-types.ts", "HeaderNavItem", "type"), component: "header", paths: ["navigation[].type"], defaults: ["link"] },
  { label: "FooterBrandProps.variant", literals: () => propLiterals("-types/site-chrome-types.ts", "FooterBrandProps", "variant"), component: "footer", paths: ["variant"], defaults: [] },
];

describe("design-pattern registry: shape", () => {
  it("has unique ids and complete entries", () => {
    const ids = DESIGN_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(30);
    for (const p of DESIGN_PATTERNS) {
      expect(p.id, p.id).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/);
      for (const field of [p.propPath, p.looksLike, p.useWhen, p.avoidWhen]) expect(field.trim().length, p.id).toBeGreaterThan(0);
      expect(p.figmaCues.length, p.id).toBeGreaterThan(0);
      expect(p.pitfalls.length, p.id).toBeGreaterThan(0);
      expect(Object.keys(asJson(p.minimal)).length, p.id).toBeGreaterThan(0);
    }
  });

  it("has a short, unique label per pattern (the editor shows it on a button)", () => {
    const labels = DESIGN_PATTERNS.map((p) => p.label.trim());
    expect(new Set(labels.map((l) => l.toLowerCase())).size).toBe(labels.length);
    for (const p of DESIGN_PATTERNS) {
      expect(p.label.trim().length, p.id).toBeGreaterThan(0);
      expect(p.label.length, p.id).toBeLessThanOrEqual(28);
      expect(p.label, p.id).not.toMatch(/[<>]/);
    }
  });
});

describe("design-pattern registry: every variant literal has a pattern", () => {
  it.each(VARIANT_UNIONS.map((u) => [u.label, u] as const))("%s", (_label: string, union: VariantUnion) => {
    const values = union.literals();
    expect(values.length).toBeGreaterThan(0);
    const used = new Set(
      DESIGN_PATTERNS.filter((p) => p.component === union.component).flatMap((p) =>
        union.paths.flatMap((dotted: string) => valuesAt(p.minimal, dotted)),
      ),
    );
    const missing = values.filter((v: string) => !union.defaults.includes(v) && !used.has(v));
    expect(missing).toEqual([]);
  });
});

describe("design-pattern registry: full examples from the Brahm Varchas fixture", () => {
  const withFull = DESIGN_PATTERNS.filter((p) => p.fullFrom);

  it("most patterns point at the real site", () => {
    expect(withFull.length).toBeGreaterThanOrEqual(DESIGN_PATTERNS.length - 2);
  });

  it.each(withFull.map((p) => [p.id, p] as const))("%s resolves, on the right component, with the minimal's keys", (_id: string, p: DesignPattern) => {
    const from = p.fullFrom!;
    const full = fullExampleOf(FIXTURE, from);
    expect(full).toBeDefined();
    const section = from.pointer.match(/^(\/pages\/\d+\/components\/\d+)\/props$/);
    if (section) expect(asJson(readPointer(FIXTURE, section[1]!)).type).toBe(p.component);
    else if (p.component === "header" || p.component === "footer") expect(from.pointer).toBe(`/globalSettings/layout/${p.component}/props`);
    else expect(from.pointer).toBe("/globalSettings");
    for (const key of Object.keys(asJson(p.minimal))) expect(asJson(full), `${p.id}: ${key}`).toHaveProperty(key);
  });

  // A bound path may be optional (a CTA without a form has no audienceId), so each must be
  // anchored in the example and at least one must reach a real value.
  it.each(DESIGN_PATTERNS.filter((p) => p.bound.length).map((p) => [p.id, p] as const))("%s: bound paths are anchored and reach values", (_id: string, p: DesignPattern) => {
    const full = p.fullFrom ? fullExampleOf(FIXTURE, p.fullFrom) : undefined;
    const reaches = (b: string) => boundPathExists(p.minimal, b) || boundPathExists(full, b);
    for (const b of p.bound) {
      const head = b.split(".")[0]!.replace(/(\[\]|\{\})$/, "");
      expect(head in asJson(p.minimal) || head in asJson(full), `${p.id}: ${b}`).toBe(true);
    }
    expect(p.bound.some(reaches), p.id).toBe(true);
  });

  it.each(withFull.map((p) => [p.id, p] as const))("%s: the scrubbed example carries no fixture id, asset URL, link or brand", (_id: string, p: DesignPattern) => {
    const scrubbed = JSON.stringify(scrubbedFull(p));
    expect(scrubbed.match(UUID_PATTERN)).toBeNull();
    expect(scrubbed).not.toMatch(/cloudfront\.net/);
    expect(scrubbed).not.toMatch(/https?:\/\//i);
    expect(scrubbed).not.toMatch(/brahm ?varchas|bvshiksha|ब्रह्म/i);
    expect(scrubbed).not.toMatch(/Translate Knowledge/i);
    for (const code of ["forbvy", "ks61g1", "7pc4tl"]) expect(scrubbed).not.toContain(`"${code}"`);
  });

  it("no minimal or pattern text names the fixture's brand", () => {
    for (const p of DESIGN_PATTERNS) {
      const { fullFrom: _from, ...authored } = p;
      expect(JSON.stringify(authored), p.id).not.toMatch(/brahm ?varchas|bvshiksha|ब्रह्म/i);
    }
  });

  it("every id placeholder says to leave the id empty", () => {
    for (const p of DESIGN_PATTERNS) {
      const values = [p.minimal, p.fullFrom ? scrubbedFull(p) : undefined].flatMap((root) =>
        p.bound.flatMap((b) => valuesAt(root, b.replace(/\{\}$/, ""))),
      );
      const strings = values.flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flat(2) : Object.keys(asJson(v))));
      for (const v of strings.filter((x): x is string => typeof x === "string" && x !== "")) {
        expect(v, `${p.id}: ${v}`).toMatch(/^<[^<>]*leave empty[^<>]*>$/);
      }
    }
  });

  it("scrubbing replaces links, taglines and brand names", () => {
    const out = asJson(
      scrubExample(
        {
          route: "https://brahmvarchas.org/blogs/",
          local: "/courses",
          text: "See https://x.example/a for Brahm Varchas news",
          tagline: "Translate Knowledge",
          bottomNote: "© 2026 ब्रह्म वर्चस",
        },
        [],
        BRANDS,
      ),
    );
    expect(String(out.route)).toMatch(/^<link/);
    expect(out.local).toBe("/courses");
    expect(out.text).toBe("See <url> for <institute name> news");
    expect(String(out.tagline)).toMatch(/^<the institute's tagline>$/);
    expect(out.bottomNote).toBe("© 2026 <institute name>");
  });

  it("scrubbing keeps empty ids empty and leaves the fixture untouched", () => {
    const before = JSON.stringify(FIXTURE);
    const out = asJson(scrubExample({ libraryId: "", audienceId: "a", nested: { audienceId: "b" } }, ["libraryId", "audienceId", "nested.audienceId"]));
    expect(out.libraryId).toBe("");
    expect(String(out.audienceId)).toMatch(/^<audienceId/);
    expect(String(asJson(out.nested).audienceId)).toMatch(/^<audienceId/);
    expect(JSON.stringify(FIXTURE)).toBe(before);
  });

  it("pick builds the nested shape and compacts array items", () => {
    const fx = { a: { list: [{ id: "x" }, { id: "y" }, { id: "z" }], keep: 1, drop: 2 } };
    expect(fullExampleOf(fx, { fixture: "brahm-varchas-site", pointer: "/a", pick: ["list/2", "keep"] })).toEqual({ list: [{ id: "z" }], keep: 1 });
    expect(fullExampleOf(fx, { fixture: "brahm-varchas-site", pointer: "/a", pick: ["nope"] })).toBeUndefined();
  });
});

describe("design-pattern registry: every minimal switches its opt-in on", () => {
  const gsMinimal = (id: string) => asJson(findDesignPattern(id)!.minimal);
  const SITE = { ...gsMinimal("global.courseFormats"), ...gsMinimal("global.courseLanguages") };
  const m = (id: string) => asJson(findDesignPattern(id)!.minimal);

  const CHECKS: Record<string, (minimal: Json) => boolean> = {
    "catalog.hero": (p) => !!resolveCatalogHero(p.hero)?.band,
    "catalog.resultsHeader": (p) => !!resolveCatalogHero(p.hero)?.resultsHeader,
    "catalog.quickFilters": (p) =>
      resolveCatalogHero(p.hero)?.quickFilterBar?.variant === "filled" &&
      resolveCatalogDiscovery(p, SITE).quickFilters.length === (p.quickFilters as unknown[]).length,
    "catalog.streams.icons": (p) => !!resolveStreamIconTabs(p.streams) && !!resolveCatalogDiscovery(p, {}).streams,
    "catalog.streams.pills": (p) => !resolveStreamIconTabs(p.streams) && !!resolveCatalogDiscovery(p, {}).streams,
    "catalog.filterSidebar.editorial": (p) =>
      !!resolveFilterSidebar(p.filterSidebar) && resolveCatalogDiscovery(p, SITE).priceFilter.control === "checkbox",
    "catalog.filterSidebar.promo": (p) => !!resolveFilterSidebar(p.filterSidebar)?.promo,
    "catalog.customFilters": (p) => resolveCustomFilters(p.customFilters, SITE).length === (p.customFilters as unknown[]).length,
    "catalog.cards.editorial": (p) => !!resolveCardDesign(p.render),
    "catalog.pagination.loadMore": (p) => !!resolveLoadMore(p.render) && !!resolveGridHeading(p.render),
    "catalog.languageVersions": (p) => resolveCatalogDiscovery(p, SITE).grouping && resolveCatalogDiscovery(p, {}).grouping === false,
    "catalog.sections.freeCourses": (p) => resolveColumnSections(p.columnSections)[0]?.kind === "free-courses",
    "catalog.sections.spotlight": (p) => resolveColumnSections(p.columnSections)[0]?.kind === "spotlight",
    "catalog.sections.comingSoon": (p) => resolveColumnSections(p.columnSections)[0]?.kind === "coming-soon",
    "hero.editorial": (p) => p.variant === "editorial" && !!asJson(p.left).titleAccent,
    "learningPath.featured": (p) => p.mode === "list" && p.listLayout === "featured" && !!p.libraryId && !!asJson(p.featured).code,
    "learningPath.moreGrid": (p) => p.listLayout === "featured" && p.showGoals === false && p.showFeatured === false,
    "learningPath.pathExtras": (p) => Array.isArray(p.pathExtras) && !!asJson(p.pathExtras[0]).code,
    "cta.band": (p) => p.variant === "band" && !!asJson(p.secondaryButton).enabled,
    "cta.band.light": (p) => p.variant === "band" && p.bandSize === "lg",
    "cta.band.app": (p) => p.variant === "band" && asJson(p.mockup).kind === "phone",
    "steps.cards": (p) => p.variant === "cards" && Array.isArray(p.steps) && p.steps.length > 0,
    "header.editorial": (p) => {
      const c = resolveHeaderChrome(p);
      return hasHeaderChrome(c) && c.compact && c.contained && c.editorialNav && c.logoOnly && c.segmentedSwitcher && c.cartWhenNotEmpty;
    },
    "header.megaMenu": (p) =>
      resolveHeaderChrome(p).editorialMega && (p.navigation as Json[]).some((n) => n.type === "megaMenu" && !!asJson(n.megaMenu).libraryId),
    "footer.brand": (p) => p.variant === "brand",
    "footer.newsletter": (p) => p.variant === "brand" && asJson(p.newsletter).enabled === true,
    // Colours are placeholders in the minimal; the real palette is checked on the fixture below.
    "global.palette": (p) => Object.keys(asJson(asJson(p.theme).palette)).length > 1 && asJson(asJson(p.theme).palette).applyToTokens === true,
    "global.contentMaxWidth": (p) => resolveContentMaxWidth(asJson(p.theme).contentMaxWidth) === 1152,
    "global.fonts": (p) => asJson(p.fonts).enabled === true && !("headingFamily" in asJson(p.fonts)),
    "global.courseFormats": (p) => (resolveCourseFormats(p)?.list.length ?? 0) === 2,
    "global.courseLanguages": (p) => normaliseLanguages(asJson(p.courseLanguages) as never).length === 2,
    "global.naming": (p) => !!asJson(p.naming).level,
    "global.siteCart": (p) => asJson(p.siteCart).enabled === true && !!asJson(p.siteCart).storeProductPageCode,
    "global.i18n": (p) => localesOf(p.i18n as never).length === 2,
  };

  it("has a check for every pattern", () => {
    expect(DESIGN_PATTERNS.map((p) => p.id).filter((id) => !CHECKS[id])).toEqual([]);
  });

  it.each(DESIGN_PATTERNS.map((p) => [p.id] as const))("%s", (id: string) => {
    expect(CHECKS[id]!(m(id))).toBe(true);
  });

  it("the fixture's full palette yields a CSS variable for every palette key", () => {
    const full = asJson(fullExampleOf(FIXTURE, findDesignPattern("global.palette")!.fullFrom!));
    const vars = buildPaletteVars(asJson(full.theme).palette as never);
    expect(Object.keys(vars).length).toBeGreaterThanOrEqual(PALETTE_KEYS.length);
  });
});

describe("design-pattern registry: recipes and contracts", () => {
  it("recipes name existing patterns on the right component", () => {
    for (const r of DESIGN_RECIPES) {
      for (const page of r.pages)
        for (const s of page.sections)
          for (const id of s.patterns) expect(findDesignPattern(id)?.component, `${r.id}: ${id}`).toBe(s.component);
      for (const id of r.site) expect(["header", "footer", "globalSettings"]).toContain(findDesignPattern(id)?.component);
    }
  });

  it("a recipe page the fixture has is laid out as the fixture is, with the same section props", () => {
    const fixturePages = FIXTURE.pages as Array<{ route: string; components: Array<{ type: string; props: Record<string, unknown> }> }>;
    let checked = 0;
    for (const r of DESIGN_RECIPES) {
      for (const page of r.pages) {
        const real = fixturePages.find((p) => p.route === page.route);
        if (!real) continue;
        checked += 1;
        expect(page.sections.map((s) => s.component), `${r.id}/${page.route}`).toEqual(real.components.map((c) => c.type));
        page.sections.forEach((s, i) => {
          for (const [key, value] of Object.entries(s.props ?? {}))
            expect(real.components[i]!.props[key], `${r.id}/${page.route}#${i}.${key}`).toEqual(value);
        });
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it("contracts name existing patterns", () => {
    const named = [...Object.values(GLOBAL_SETTINGS_CONTRACT), ...Object.values(CHROME_CONTRACT)].flatMap((e) => e.patterns);
    expect(named.filter((id) => !findDesignPattern(id))).toEqual([]);
  });

  it("the header contract lists every HeaderChromeProps key", () => {
    const keys = [...interfaceBody(source("-types/site-chrome-types.ts"), "HeaderChromeProps").matchAll(/\n\s*(\w+)\??:/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((k) => !(k in CHROME_CONTRACT.header.fields))).toEqual([]);
  });

  it("the palette contract lists every palette key", () => {
    for (const key of PALETTE_KEYS) expect(GLOBAL_SETTINGS_CONTRACT["theme.palette"]!.type).toContain(key);
  });
});

describe("generated outputs are fresh (re-run scripts/export-catalogue-schema-catalog.mjs when this fails)", () => {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")) as Json;
  const adminCopy = JSON.parse(fs.readFileSync(ADMIN_COPY_PATH, "utf8")) as Json;
  const expected = DESIGN_PATTERNS.map((p) => {
    const { fullFrom, ...rest } = p;
    const full = fullFrom ? scrubbedFull(p) : undefined;
    return JSON.parse(
      JSON.stringify({ ...rest, ...(full !== undefined ? { full, fullSource: `${fullFrom!.fixture}#${fullFrom!.pointer}` } : {}) }),
    ) as Json;
  });

  it("the AI catalog's patterns match the registry and the fixture", () => {
    expect(catalog.patterns).toEqual(expected);
  });

  it("the admin copy's patterns match the registry and the fixture", () => {
    expect(adminCopy.patterns).toEqual(expected);
  });

  it("recipes and contracts match", () => {
    expect(catalog.recipes).toEqual(JSON.parse(JSON.stringify(DESIGN_RECIPES)));
    expect(adminCopy.recipes).toEqual(JSON.parse(JSON.stringify(DESIGN_RECIPES)));
    expect(asJson(catalog.globalSettingsContract).fields).toEqual(JSON.parse(JSON.stringify(GLOBAL_SETTINGS_CONTRACT)));
    for (const [kind, contract] of Object.entries(CHROME_CONTRACT)) {
      const { exampleProps: _example, ...generated } = asJson(asJson(catalog.chrome)[kind]);
      expect(generated).toEqual(JSON.parse(JSON.stringify(contract)));
    }
  });
});
