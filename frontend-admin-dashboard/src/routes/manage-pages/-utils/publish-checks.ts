/**
 * Pre-publish checks — the "are you sure this is ready?" pass.
 *
 * WHY: the builder happily publishes a broken page without a word, and every
 * failure below shipped to a live institute site during our own field testing:
 * popup buttons with no campaign chosen, template placeholder copy left in,
 * product-page offers pointing nowhere, pages with no meta description, dead
 * nav links. A layman has no way to know any of it happened.
 *
 * These WARN, never block. The admin stays in charge; we just stop silent
 * mistakes from reaching visitors.
 */

import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { localesOf } from './catalogue-i18n';
import { collectSiteStrings, coverageOf, languageName } from '../-components/i18n/site-strings';

export type CheckSeverity = 'error' | 'warning';

export interface PublishIssue {
    severity: CheckSeverity;
    /** Short, plain-language problem statement. */
    title: string;
    /** What to do about it, in the admin's words. */
    fix: string;
    pageId?: string;
    pageName?: string;
    componentId?: string;
}

/** Copy shipped in templates/AI scaffolds that must never reach a visitor. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
    /lorem ipsum/i,
    /\byour (?:institute|company|school) name\b/i,
    /\breplace (?:this|with)\b/i,
    /\bplaceholder\b/i,
    /\bexample\.com\b/i,
    /\bnew program\b/i,
    /\bsecond program\b/i,
    /\bdetail (?:one|two)\b/i,
    /\bwho can join\b/i,
];

const walk = (components: any[], visit: (c: any) => void) => {
    for (const c of components || []) {
        if (!c) continue;
        visit(c);
        const slots = c?.props?.slots;
        if (Array.isArray(slots)) {
            for (const slot of slots) if (Array.isArray(slot)) walk(slot, visit);
        }
    }
};

/** Collect every string value in a props tree, for placeholder scanning. */
const collectStrings = (node: any, out: string[], depth = 0) => {
    if (depth > 6 || node == null) return;
    if (typeof node === 'string') {
        out.push(node);
    } else if (Array.isArray(node)) {
        for (const v of node) collectStrings(v, out, depth + 1);
    } else if (typeof node === 'object') {
        for (const v of Object.values(node)) collectStrings(v, out, depth + 1);
    }
};

/** ctaBanner variant "band" draws its secondaryButton only when enabled and labelled. */
const bandSecondaryButton = (c: any): boolean => {
    const b = c?.props?.secondaryButton;
    return (
        c?.type === 'ctaBanner' &&
        c?.props?.variant === 'band' &&
        !!b &&
        typeof b === 'object' &&
        b.enabled !== false &&
        !!String(b.text || '').trim()
    );
};

/** A catalogue spotlight button that opens a form ('open-form') with no campaign: not drawn at all. */
const hasUnwiredSpotlightButton = (c: any): boolean => {
    if (c?.type !== 'courseCatalog' || !Array.isArray(c?.props?.columnSections)) return false;
    return c.props.columnSections.some(
        (section: any) =>
            section?.kind === 'spotlight' &&
            Array.isArray(section.slides) &&
            section.slides.some(
                (slide: any) =>
                    slide?.cta?.action === 'open-form' && !String(slide.cta.audienceId || '').trim(),
            ),
    );
};

export const runPublishChecks = (config: any): PublishIssue[] => {
    const issues: PublishIssue[] = [];
    const pages: any[] = config?.pages || [];
    const routes = new Set(
        pages.map((p) => String(p?.route || '').replace(/^\//, '').toLowerCase()),
    );

    for (const page of pages) {
        const pageName = page?.title || page?.route || 'Untitled page';
        const ctx = { pageId: page?.id, pageName };

        // SEO — the fields exist and are now actually served to crawlers.
        if (!page?.seo?.metaDescription?.trim()) {
            issues.push({
                severity: 'warning',
                title: `“${pageName}” has no meta description`,
                fix: 'Add one in Properties → SEO. It becomes the text under your link on Google and in WhatsApp previews.',
                ...ctx,
            });
        }

        walk(page?.components || [], (c) => {
            const p = c?.props || {};
            const cctx = { ...ctx, componentId: c?.id };

            // Capture surfaces wired to nothing: a bare action, the single
            // `button` (CTA banner, media showcase…) and each hero button.
            const formButtons: Array<{ action?: string; audienceId?: string }> = [
                { action: p.action, audienceId: p.audienceId },
                ...(p.button ? [p.button] : []),
                ...(bandSecondaryButton(c) ? [p.secondaryButton] : []),
                ...(p.left?.buttons || []),
            ];
            const unwiredButton = formButtons.some(
                (b) => b?.action === 'openForm' && !String(b?.audienceId || '').trim(),
            );
            if (unwiredButton) {
                issues.push({
                    severity: 'error',
                    title: 'A button opens a form but no campaign is selected',
                    fix: 'Pick a campaign for it, or change the button back to a link. Right now it does nothing when tapped.',
                    ...cctx,
                });
            }
            if (hasUnwiredSpotlightButton(c)) {
                issues.push({
                    severity: 'error',
                    title: 'A spotlight button opens a form but no campaign is selected',
                    fix: 'Pick a campaign for it, or change it to a link. Until then the button is hidden from visitors.',
                    ...cctx,
                });
            }
            if (c?.type === 'leadForm' && !String(p.audienceId || '').trim()) {
                issues.push({
                    severity: 'error',
                    title: 'A Lead Form section has no campaign selected',
                    fix: 'Choose a campaign so its fields render — the section is invisible to visitors until then.',
                    ...cctx,
                });
            }
            if (c?.type === 'productPageOffer' && !String(p.productPageCode || '').trim()) {
                issues.push({
                    severity: 'error',
                    title: `A ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} section has no product page selected`,
                    fix: 'Pick a product page in its properties, or remove the section. It is hidden from visitors as-is.',
                    ...cctx,
                });
            }
            if (c?.type === 'folderBrowser' && !String(p.libraryId || '').trim()) {
                issues.push({
                    severity: 'error',
                    title: 'A Folder Browser section has no folder library selected',
                    fix: 'Pick a library in its properties (or create one with the Folders button), or remove the section. It is hidden from visitors as-is.',
                    ...cctx,
                });
            }
            // Learning path: one path needs its product page, a list needs its library.
            if (c?.type === 'learningPath') {
                if (p.mode === 'list' ? !String(p.libraryId || '').trim() : !String(p.productPageCode || '').trim()) {
                    issues.push({
                        severity: 'error',
                        title:
                            p.mode === 'list'
                                ? 'A Learning Path list has no folder library selected'
                                : 'A Learning Path section has no product page selected',
                        fix:
                            p.mode === 'list'
                                ? 'Pick the folder library that holds your paths in its properties, or remove the section. It shows nothing as-is.'
                                : 'Pick the product page that holds the path in its properties, or remove the section. It shows nothing as-is.',
                        ...cctx,
                    });
                }
            }
            // Visibility rules: a rule with no parameter is silently ignored by the site.
            if (
                Array.isArray(c?.visibleWhen) &&
                c.visibleWhen.some((r: any) => !r || typeof r.param !== 'string' || !r.param.trim())
            ) {
                issues.push({
                    severity: 'warning',
                    title: 'A section has a visibility rule with no parameter',
                    fix: 'Open the section’s “Show on” rules and fill in the address parameter (for example “stream”) or remove the rule. Until then it is ignored and the section always shows.',
                    ...cctx,
                });
            }
            // A blog on the home page still works (?post=<slug>), but every
            // article then shares the home URL — no clean links, no sitemap entries.
            if (c?.type === 'blog' && c?.enabled !== false) {
                const route = String(page?.route || '').replace(/^\//, '').toLowerCase();
                if (route === '' || route === 'home' || route === 'homepage' || page?.id === 'home') {
                    issues.push({
                        severity: 'warning',
                        title: 'The Blog section is on the home page',
                        fix: 'Move it to its own page (for example "blog") so each article gets a clean URL of its own and appears in the sitemap.',
                        ...cctx,
                    });
                }
            }

            // Header/footer nav pointing at pages that do not exist.
            for (const link of [...(p.navLinks || []), ...(p.authLinks || [])]) {
                const raw = String(link?.route || '').replace(/^\//, '').toLowerCase();
                if (!raw) continue;
                if (/^(https?:|mailto:|tel:|#)/.test(raw)) continue;
                if (['login', 'signup', 'get-started', 'getstarted'].includes(raw)) continue;
                if (String(link?.audienceId || '').trim()) continue;
                if (!routes.has(raw)) {
                    issues.push({
                        severity: 'warning',
                        title: `Menu link “${link?.label || raw}” points to a page that doesn’t exist`,
                        fix: `Nothing on this site has the address “${raw}”. Fix the link or create that page.`,
                        ...cctx,
                    });
                }
            }

            // Template/AI placeholder copy left behind.
            const strings: string[] = [];
            collectStrings(p, strings);
            const hit = strings.find((s) =>
                s.length < 400 && PLACEHOLDER_PATTERNS.some((re) => re.test(s)),
            );
            if (hit) {
                issues.push({
                    severity: 'warning',
                    title: 'Placeholder text is still on the page',
                    fix: `“${hit.slice(0, 60)}${hit.length > 60 ? '…' : ''}” looks like sample copy. Replace it with your own words.`,
                    ...cctx,
                });
            }
        });
    }

    // Site cart switched on with no store page: the site quietly has no cart.
    const siteCart = config?.globalSettings?.siteCart;
    if (siteCart?.enabled === true && !String(siteCart?.storeProductPageCode || '').trim()) {
        issues.push({
            severity: 'error',
            title: 'The site cart is on but has no store page',
            fix: 'Choose a store product page in Global Settings → Site cart (then sync the catalogue into it), or switch the cart off. Visitors see no cart until then.',
        });
    }

    // Site languages: an untranslated text shows in the base language to a
    // visitor who picked another one. Only for sites that switched languages on.
    const i18n = config?.globalSettings?.i18n;
    if (i18n?.enabled) {
        const sources = collectSiteStrings(config);
        const [base, ...others] = localesOf(i18n);
        const baseName = base ? languageName(base.code, base.label) : 'the base language';
        for (const locale of others) {
            const { total, translated } = coverageOf(sources, i18n.strings?.[locale.code]);
            if (total > 0 && translated < total) {
                const name = languageName(locale.code, locale.label);
                issues.push({
                    severity: 'warning',
                    title: `${name}: ${total - translated} of ${total} texts are not translated yet`,
                    fix: `Visitors who choose ${name} see these in ${baseName}. Finish them in Global Settings → Languages → Translations.`,
                });
            }
        }
    }

    // Site-wide: measurement is the difference between a website and a
    // marketing asset, so nudge once (never per page).
    const t = config?.globalSettings?.tracking || {};
    if (!t.ga4MeasurementId && !t.metaPixelId && !t.gtmId) {
        issues.push({
            severity: 'warning',
            title: 'No analytics connected',
            fix: 'Add a Google Analytics or Meta Pixel ID in Global Settings → Tracking to see where your enquiries come from.',
        });
    }

    // Errors first, then warnings; stable within group.
    return issues.sort((a, b) =>
        a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1,
    );
};
