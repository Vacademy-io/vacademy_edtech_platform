import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import generated from './generated/design-patterns.json';
import {
    buildDesignRecipeTemplates,
    isLookKey,
    lookForBlock,
    mergeChromeOnto,
    mergeOnto,
    patternVariantsFor,
    stripPlaceholders,
} from './design-pattern-presets';
import { COMPONENT_VARIANTS, getComponentVariants } from './component-variants';
import { PAGE_TEMPLATES } from './page-templates';

/**
 * The registry's recipes and whole-block looks as editor presets. What matters:
 * no AI placeholder ("<headline>", "<libraryId: leave empty …>") ever reaches a
 * page, ids stay empty for the admin to pick, the looks keep the admin's content,
 * and the editor's existing templates and variants are untouched.
 */

const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as unknown as TFunction;
const PLACEHOLDER_TEXT = /<[^<>]*>/;
const ID_KEYS = /^(libraryId|audienceId|productPageCode|courseId|enrollInviteId|packageSessionId|storeProductPageCode)$/;

const walk = (value: unknown, visit: (key: string, v: unknown) => void, key = ''): void => {
    visit(key, value);
    if (Array.isArray(value)) value.forEach((v) => walk(v, visit, key));
    else if (value && typeof value === 'object')
        for (const [k, v] of Object.entries(value)) walk(v, visit, k);
};

const recipe = (id: string) => {
    const tpl = buildDesignRecipeTemplates().find((r) => r.id === `recipe:${id}`);
    if (!tpl) throw new Error(`no recipe ${id}`);
    return tpl;
};

describe('stripPlaceholders', () => {
    it('drops placeholder values, items holding one, and what that empties — keeps what was empty', () => {
        expect(
            stripPlaceholders({
                title: '<headline>',
                keep: 'All courses',
                ids: { libraryId: '<libraryId: leave empty>' },
                stats: [{ kind: 'courses', label: 'courses' }, { kind: 'streams', label: '<label>' }],
                checklist: ['<benefit>', '<benefit>'],
                filtersConfig: [],
                nested: {},
            })
        ).toEqual({ keep: 'All courses', stats: [{ kind: 'courses', label: 'courses' }], filtersConfig: [], nested: {} });
    });
});

describe('mergeOnto / mergeChromeOnto', () => {
    it('merges objects key by key; chrome keeps the base list and the admin text, not the look', () => {
        const base = { a: { x: 1, y: 2 }, nav: [{ label: 'Mine' }], col: { title: 'Quick Links' }, navStyle: 'plain' };
        const patch = { a: { y: 3 }, nav: [{ label: 'Courses' }], col: { title: 'Explore' }, navStyle: 'editorial' };
        expect(mergeOnto(base, patch)).toEqual({ ...patch, a: { x: 1, y: 3 } });
        expect(mergeChromeOnto(base, patch)).toEqual({
            a: { x: 1, y: 3 }, nav: [{ label: 'Mine' }], col: { title: 'Quick Links' }, navStyle: 'editorial',
        });
        // An empty text or list is filled.
        expect(mergeChromeOnto({ col: { title: '' }, nav: [] }, patch)).toMatchObject({ col: { title: 'Explore' }, nav: [{ label: 'Courses' }] });
    });

    it('look keys are the variant / layout family and *Style, *Size, *Width, *Display keys', () => {
        for (const k of ['variant', 'layout', 'listLayout', 'mode', 'navStyle', 'barSize', 'contentWidth', 'cartDisplay', 'megaMenuStyle']) {
            expect(isLookKey(k), k).toBe(true);
        }
        for (const k of ['title', 'moreTitle', 'heading', 'tagline', 'label', 'route', 'logo']) expect(isLookKey(k), k).toBe(false);
    });
});

describe('design recipe templates', () => {
    it('adds the three registry recipes after the editor templates, which stay as they were', () => {
        const ids = PAGE_TEMPLATES.map((p) => p.id);
        expect(ids.slice(0, 15)).toEqual([
            'landing-page', 'course-landing', 'about-page', 'book-store', 'hero-centered', 'social-proof',
            'course-showcase', 'media-carousel', 'coaching-institute-home', 'course-catalogue-multi-pick',
            'programs-directory', 'enquiry-page', 'programs-section', 'course-basket-section', 'enquiry-section',
        ]);
        expect(ids.slice(-4)).toEqual(['lead-hero', 'recipe:editorial-catalogue', 'recipe:learning-paths', 'recipe:brand-chrome']);
        expect(PAGE_TEMPLATES.filter((p) => p.id.startsWith('recipe:')).map((p) => p.name)).toEqual([
            'Editorial catalogue', 'Learning paths', 'Brand chrome',
        ]);
    });

    it('Editorial catalogue: one courseCatalog with the editorial opt-ins, then a band', () => {
        const comps = recipe('editorial-catalogue').getComponents(t);
        expect(comps.map((c) => c.type)).toEqual(['courseCatalog', 'ctaBanner']);
        const props = comps[0]!.props as Record<string, any>;
        expect(props.render.cardStyle).toBe('editorial');
        expect(props.hero.enabled).toBe(true);
        expect(props.streams.variant).toBe('icons');
        expect(props.filterSidebar.variant).toBe('editorial');
        expect(props.render.pagination.mode).toBe('loadMore');
        // The recipe's own section props: the hero carries the H1, the legacy filter groups are off.
        expect(props.title).toBe('');
        expect(props.filtersConfig).toEqual([]);
        // Several patterns' lists are concatenated; the template's own defaults survive underneath.
        expect(props.columnSections.map((s: { kind: string }) => s.kind)).toEqual(['free-courses', 'coming-soon']);
        expect(props.render.layout).toBe('grid');
        expect(props.streams.libraryId).toBe('');
        expect(comps[1]!.props.variant).toBe('band');
    });

    it('Learning paths: the fixture page order, with the featured section hiding its grid', () => {
        const comps = recipe('learning-paths').getComponents(t);
        expect(comps.map((c) => c.type)).toEqual([
            'heroSection', 'learningPath', 'ctaBanner', 'learningPath', 'ctaBanner', 'stepsProcess', 'ctaBanner',
        ]);
        expect(comps[0]!.props.variant).toBe('editorial');
        expect(comps[1]!.props.listLayout).toBe('featured');
        expect(comps[1]!.props.showGrid).toBe(false);
        expect(comps[3]!.props.showFeatured).toBe(false);
        expect(comps[5]!.props.variant).toBe('cards');
        expect(new Set(comps.map((c) => c.id)).size).toBe(comps.length);
    });

    it('never inserts a placeholder, and leaves every id empty', () => {
        for (const tpl of buildDesignRecipeTemplates()) {
            const written = [tpl.getComponents(t), tpl.applyLayout?.(undefined, t) ?? {}];
            walk(written, (key, v) => {
                if (typeof v === 'string') expect(v, `${tpl.id} ${key}`).not.toMatch(PLACEHOLDER_TEXT);
                if (ID_KEYS.test(key)) expect(v ?? '', `${tpl.id} ${key}`).toBe('');
            });
        }
    });

    it('Brand chrome sets the editorial header and brand footer, keeping the admin content', () => {
        const tpl = recipe('brand-chrome');
        expect(tpl.getComponents(t)).toEqual([]);
        expect(tpl.description).toMatch(/Also set in Settings: .*Site languages/);

        const fresh = tpl.applyLayout!(undefined, t);
        expect(fresh.header.type).toBe('header');
        expect(fresh.header.props.navStyle).toBe('editorial');
        expect(fresh.header.props.megaMenuStyle).toBe('editorial');
        expect(fresh.footer.props.variant).toBe('brand');
        expect(fresh.footer.props.newsletter.enabled).toBe(true);

        const mine = {
            header: { id: 'h', type: 'header', enabled: false, props: { logo: 'https://cdn/logo.png', navigation: [{ label: 'Home', route: 'home' }] } },
            footer: { id: 'f', type: 'footer', enabled: true, props: { rightSection1: { title: 'Main', links: [{ label: 'FAQ', route: 'faq' }] } } },
            other: 1,
        };
        const merged = tpl.applyLayout!(mine, t);
        expect(merged.other).toBe(1);
        expect(merged.header.id).toBe('h');
        expect(merged.header.enabled).toBe(false);
        expect(merged.header.props.logo).toBe('https://cdn/logo.png');
        expect(merged.header.props.navigation).toEqual([{ label: 'Home', route: 'home' }]);
        expect(merged.header.props.navStyle).toBe('editorial');
        expect(merged.footer.props.rightSection1.links).toEqual([{ label: 'FAQ', route: 'faq' }]);
        expect(merged.footer.props.rightSection1.title).toBe('Main');
        expect(merged.footer.props.variant).toBe('brand');
        // The site has a logo, so the logo-only bar is safe.
        expect(merged.header.props.logoOnly).toBe(true);
    });

    it('Brand chrome never hides the site name of a header without a logo', () => {
        const tpl = recipe('brand-chrome');
        const noLogo = { header: { id: 'h', type: 'header', enabled: true, props: { title: 'Acme Academy' } } };
        const merged = tpl.applyLayout!(noLogo, t);
        expect(merged.header.props.logoOnly).toBe(false);
        expect(merged.header.props.title).toBe('Acme Academy');
        expect(tpl.applyLayout!(undefined, t).header.props.logoOnly).toBe(false);
    });
});

describe('registry looks in the variant switcher', () => {
    it('labels whole-block looks with the registry label', () => {
        const label = (id: string) => (generated.patterns as Array<{ id: string; label: string }>).find((p) => p.id === id)!.label;
        expect(patternVariantsFor('heroSection').map((v) => v.label)).toEqual([label('hero.editorial')]);
        expect(patternVariantsFor('header').map((v) => v.label)).toEqual([label('header.editorial')]);
        expect(patternVariantsFor('footer').map((v) => v.label)).toEqual([label('footer.brand')]);
    });

    it('a look carries style, not content: no lists, text placeholders or ids', () => {
        expect(patternVariantsFor('heroSection')[0]!.props).toEqual({ variant: 'editorial', layout: 'split', eyebrow: { style: 'rule' } });
        const header = patternVariantsFor('header')[0]!.props;
        expect(header).toMatchObject({ navStyle: 'editorial', barSize: 'compact', logoOnly: true });
        expect(header.navigation).toBeUndefined();
        expect(header.logo).toBeUndefined();
        expect(patternVariantsFor('footer')[0]!.props).toEqual({ variant: 'brand', layout: 'four-column' });
    });

    it('a header look never hides the site name on a header with no logo', () => {
        const look = patternVariantsFor('header')[0]!.props;
        expect(lookForBlock('header', { title: 'Acme' }, look).logoOnly).toBe(false);
        expect(lookForBlock('header', { title: 'Acme', logoOnly: true }, look).logoOnly).toBe(true);
        expect(lookForBlock('header', { logo: 'https://cdn/logo.png' }, look).logoOnly).toBe(true);
        expect(lookForBlock('footer', {}, { logoOnly: true }).logoOnly).toBe(true);
    });

    it('a look never carries the pattern text, even at the top level', () => {
        expect(patternVariantsFor('learningPath').map((v) => v.props)).toEqual([
            { mode: 'list', listLayout: 'featured' },
            { mode: 'list', listLayout: 'featured', showGoals: false, showFeatured: false },
        ]);
        for (const type of ['heroSection', 'header', 'footer', 'learningPath', 'ctaBanner', 'stepsProcess']) {
            for (const v of patternVariantsFor(type)) {
                for (const [k, value] of Object.entries(v.props)) {
                    if (typeof value === 'string') expect(isLookKey(k), `${v.id} ${k}`).toBe(true);
                }
            }
        }
    });

    it('keeps the editor presets first and unchanged', () => {
        for (const [type, presets] of Object.entries(COMPONENT_VARIANTS)) {
            expect(getComponentVariants(type).slice(0, presets.length)).toEqual(presets);
        }
        expect(getComponentVariants('mediaShowcase')).toEqual(COMPONENT_VARIANTS.mediaShowcase);
        expect(getComponentVariants('unknownBlock')).toEqual([]);
    });
});
