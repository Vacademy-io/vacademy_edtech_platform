#!/usr/bin/env node
/**
 * Exports the catalogue page-builder component vocabulary as a JSON "schema
 * catalog" for the AI Page Builder (ai_service composer prompt).
 *
 * Single source of truth: the admin editor's component-templates.ts (every
 * component type + canonical props), the shared style engine / decorations
 * vocabulary, and the learner design-pattern registry
 * (frontend-learner-dashboard-app/src/routes/$tagName/-ai/design-patterns.ts:
 * patterns, page recipes, the header/footer and site-settings contracts, with
 * full examples taken from the Brahm Varchas fixture and scrubbed of its ids).
 * Regenerate whenever templates, the engine or the registry change:
 *
 *   node scripts/export-catalogue-schema-catalog.mjs
 *   node scripts/export-catalogue-schema-catalog.mjs --check   # exit 1 when an output is stale (CI)
 *
 * Outputs:
 *   ai_service/app/data/catalogue_schema_catalog.json
 *   frontend-admin-dashboard/src/routes/manage-pages/-utils/generated/design-patterns.json
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = path.join(ROOT, 'frontend-admin-dashboard');
const LEARNER = path.join(ROOT, 'frontend-learner-dashboard-app');
const OUT = path.join(ROOT, 'ai_service/app/data/catalogue_schema_catalog.json');
const ADMIN_PATTERNS_OUT = path.join(ADMIN, 'src/routes/manage-pages/-utils/generated/design-patterns.json');
const PATTERN_REGISTRY = path.join(LEARNER, 'src/routes/$tagName/-ai/design-patterns.ts');
const FIXTURES = {
    'brahm-varchas-site': path.join(ADMIN, 'src/routes/manage-pages/-components/__fixtures__/brahm-varchas-site.json'),
};
const CHECK = process.argv.includes('--check');

// pnpm nests esbuild under vite — resolve it through vite's own require.
const adminRequire = createRequire(path.join(ADMIN, 'package.json'));
const viteRequire = createRequire(adminRequire.resolve('vite/package.json'));
const esbuild = viteRequire('esbuild');

/** Bundle a TS/TSX module (a path relative to the admin app, or absolute) and import it. */
async function importTs(relPath) {
    // Emit inside the admin app so bare imports (react) resolve at import time
    const outfile = path.join(ADMIN, `.tmp-schema-export-${path.basename(relPath).replace(/\W/g, '_')}.mjs`);
    await esbuild.build({
        entryPoints: [path.isAbsolute(relPath) ? relPath : path.join(ADMIN, relPath)],
        bundle: true,
        format: 'esm',
        platform: 'node',
        outfile,
        jsx: 'transform',
        external: ['react'],
        logLevel: 'silent',
    });
    const mod = await import(`${outfile}?t=${Date.now()}`);
    fs.unlinkSync(outfile);
    return mod;
}

// Templates are built through i18next (`buildComponentTemplates(t)`) so the
// editor can translate the default copy. The composer prompt wants the ENGLISH
// defaults as example props, so resolve every key against the English catalog
// here — a raw key like "blog.heading" would otherwise become example text.
const { buildComponentTemplates } = await importTs('src/routes/manage-pages/-utils/component-templates.ts');
const EN_TEMPLATES = JSON.parse(
    fs.readFileSync(path.join(ADMIN, 'public/locales/en/managePagesComponentTemplates.json'), 'utf8')
);
const t = (key, opts) => {
    const value = key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), EN_TEMPLATES);
    if (typeof value === 'string') return value;
    if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue;
    throw new Error(`Missing English template copy for "${key}"`);
};
const componentTemplates = buildComponentTemplates(t);
const { ORNAMENT_PRESETS } = await importTs('src/routes/manage-pages/-utils/catalogue-decorations.tsx');
const {
    DESIGN_PATTERNS,
    DESIGN_RECIPES,
    CHROME_CONTRACT,
    GLOBAL_SETTINGS_CONTRACT,
    FIXTURE_BRAND_NAMES,
    UUID_PATTERN,
    fullExampleOf,
    scrubExample,
} = await importTs(PATTERN_REGISTRY);

/* ─── Which component types the AI may emit ────────────────────────────── */

// Data-bound / structural / risky types the composer must NOT invent content
// for. Data components (courseCatalog etc.) ARE allowed — they render live
// institute data — but get a special note. htmlBlock is a governed escape
// hatch: allowed, sanitized server-side (nh3 + CSS scrub) and rendered in a
// contained shadow root; usage rules live in the composer's design doctrine.
// productCourseGrid is inherited from the product-pages designer, where the page
// itself supplies the product context. On a catalogue page there is none, so the
// learner renderer aliases it to the full institute catalog — it looks like a
// product-page component but cannot be scoped to one, which misled admins when
// the composer emitted it. Use courseCatalog (full grid) or productPageOffer
// (one product page's courses) instead.
// htmlPage is a whole pasted page, created only by the Add Page flow and
// always a page's sole component. The composer must never emit one.
const FORBIDDEN = new Set(['productCourseGrid', 'htmlPage']);
const ESCAPE_HATCH_NOTES = {
    htmlBlock:
        'ESCAPE HATCH for bespoke sections only. props {html, css, prompt}. Sanitized + rendered in a scoped sandbox: ' +
        'no scripts/iframes/svg/forms; style via the css prop with class selectors using the theme CSS variables ' +
        '(var(--primary-500), var(--catalogue-text-primary), var(--catalogue-heading-font)); must include @media rules; ' +
        'images only from provided URLs. Max 3 per page (one block may contain many repeated sub-blocks, so prefer one ' +
        'well-built block over several). Prefer typed components for ordinary marketing sections; for dense data tables this IS the right tool.',
};
// Per-component "when to reach for this" notes. _build_prompt dumps each
// component object verbatim, so a new key here reaches the composer prompt with
// no Python change.
const USAGE = {
    detailBlocks:
        'THE component for a reference/DIRECTORY page — "details of our programs", a course index, a services ' +
        'or plans breakdown. Renders ONE dense block per item: eyebrow tag, real title, description, a gapless ' +
        'hairline table of 4-6 detail items, a strip of 3-4 label:value specs, an optional note, and a ' +
        'deep-link anchor. Give exactly ONE block headerVariant "solid" if there is a flagship. Use it INSTEAD ' +
        'of sectionHeading+featureGrid whenever the job is to DOCUMENT offerings rather than sell them: one ' +
        'block per offering, keeping every real name — never merge or summarise a list of offerings into a few ' +
        'generic buckets. It has no price/image/enrol fields by design, so it is safe on informational pages.',
    jobOpenings:
        'For a CAREERS page (route "careers"): a card per job, each job on its own page /<page>/<slug> with an ' +
        'external Apply link. Only jobs the admin gave; never invent roles, pay or form links.',
};
// The FULL prop surface the renderers actually read, per component.
//
// `exampleProps` below is the editor's default template — one arrangement, not
// the capability. Anything absent from it was invisible to the composer, so it
// could only use what the design doctrine happened to spell out in prose. That
// cost real output: asked to rebuild a reference whose feature row used large
// illustrations and whose testimonials were a carousel with circular avatars,
// the composer produced grey icons and no testimonials at all — both were
// buildable, neither was discoverable.
//
// Values here are read off the learner renderers (JsonRenderer.tsx and
// -components/components/*.tsx). Re-check against them when a renderer changes;
// a value listed here that the renderer does not implement is worse than an
// omission, because the composer will confidently emit it.
const CAPABILITIES = {
    heroSection:
        'layout: split (image right) | centered | fullwidth (overlay text on a background image). ' +
        'left: {title, subheading, description (HTML), tags[], button, buttons[{text,action,target,variant:primary|secondary}]}. ' +
        'eyebrow: {text, style: badge|plain}. statChips[{value,label}] — proof numbers under the copy. ' +
        'right: {image, alt, imageCollage[]} — with NO image, use layout centered, because the split grid ' +
        'collapses to a single column and a half-empty fold looks broken. ' +
        'variant "editorial" (only when the design shows it): breadcrumb[{label,route}], eyebrow.style "rule" (a short ' +
        'line before an uppercase eyebrow), left.titleAccent (a second headline line in the accent colour), ' +
        'left.checklist[] (check bullets), left.buttons[], right.image unframed, mediaWidth (px), outlineColor — pattern hero.editorial.',
    featureGrid:
        'style: cards | tinted | glass | gradient-border | panel | bordered | minimal | plain | PHOTO. columns: 2|3|4. ' +
        'iconSize: small|medium|large. ' +
        'features[] take MUCH more than an icon and text: {iconName (icon library), icon (emoji — avoid), ' +
        'image (a real illustration or photo for this feature — use it whenever the design shows pictures ' +
        'rather than icons), title, description, chips[] (a small label above the title), bullets[] (a list ' +
        'inside the card body), badge, link {text,url}, headerVariant: tint|solid, headerColor}. ' +
        'style "panel" + one feature with headerVariant "solid" is the comparison/pillars pattern. ' +
        'style "photo" is the OFFERING-CARD pattern: each feature\'s image fills its card with the title, ' +
        'description and link-as-button laid over it, and any feature WITHOUT an image falls back to a ' +
        'tinted colour card carrying the same content — so one section can alternate photo cards and ' +
        'colour cards the way course/programme rails usually do. Add layout: "carousel" to make it one ' +
        'swipeable full-bleed row instead of a grid. Reach for photo+carousel whenever the reference ' +
        'shows a row of picture cards rather than an icon grid.',
    testimonialSection:
        'layout: grid-scroll (default) | carousel (prev/next arrows + dots). ' +
        'testimonials[]: {name, role, quote (or text/feedback), avatar (the student photo — an image URL), rating (1-5), highlight}. ' +
        'Carousel only: cardsPerView 1-4 (cards in view on desktop; tablets show at most 2, phones 1; default 1 = one ' +
        'large quote at a time), autoplay (advance one card on a timer, pauses on hover), autoplayIntervalMs (default 5000). ' +
        'Use carousel + cardsPerView 3 for many short quotes in a row; carousel alone when the reference shows a single large quote.',
    stepsProcess:
        'variant: timeline-cards | alternating | cards (plain numbered steps look dated). nodeStyle: icon|dot. ' +
        'connectorStyle: line|dashed|dots|none. steps[]: {number, title, description, icon/iconName, chips[], meta, state}. ' +
        'variant "cards" is one row of white numbered cards on a tinted band (a "How it works" row): headerText, subheading, ' +
        'backgroundColor, textColor, accentColor (number circles), steps[{number,title,description}] — pattern steps.cards.',
    logoCloud:
        'layout: grid (static partner wall) | marquee (a moving ticker). display: logo|label-pill. ' +
        'marqueeSpeed: slow|medium|fast. logos[]: {image, alt, label, url} — label-only entries make it an ' +
        'announcement ticker with no images needed.',
    sectionHeading:
        'align: left|center. size: sm|md|lg|xl. highlight: {text, style: underline | mark | gradient} — the ' +
        'style is applied to the first occurrence of `text` inside `title`, so `text` MUST be a substring of it.',
    mediaShowcase:
        'layout: grid | carousel | slider. media[]: {type: image|video, url, caption, heading, backgroundImage}. ' +
        'Use it for a swipeable row of photos or videos; it carries no per-item button, so for cards that need ' +
        'a CTA use featureGrid with per-feature image + link.',
    marquee:
        'A continuously scrolling strip of short claims. items[]: {icon (emoji is correct here), text, link, image, label}. ' +
        'link (optional) makes the item clickable: a page slug, "#anchorId" of a section on the page, or a full URL. ' +
        'speed: slow|medium|fast. direction: left|right. pauseOnHover. Emoji icons are the intended style for ' +
        'this component only.',
    tabsAccordion:
        'variant: boxed | split. items[]: {title, content (HTML), icon, meta, slot}. The FAQ and ' +
        '"what you get" workhorse.',
    imageGallery: 'columns: 2|3|4. gap. showCaptions. images[]: {src, alt, caption}.',
    ctaBanner:
        'layout: centered | split. {heading, subheading, button {enabled,text,action,target,style: white|primary|outline}}. ' +
        'The renderer reads exactly these keys — headerText/buttonText are ignored and produce an empty band. ' +
        'variant "band" (only when the design shows it): a full-width band with eyebrow, heading, subheading, button and ' +
        'secondaryButton {enabled,text,action: navigate|openForm,target,audienceId,formTitle,style: primary|olive|outline-light|' +
        'outline-dark,icon: arrow}, bandSize md|lg, mockup {kind: phone, image} (an app banner), backgroundColor, textColor, ' +
        'eyebrowColor, subheadingColor — patterns cta.band, cta.band.light, cta.band.app. Leave every audienceId EMPTY: ' +
        'link_lead_form wires the primary button, and the admin picks the secondary button\'s campaign in the editor.',
    courseCatalog:
        'Every look below is OPT-IN (absent = the original grid) — use one only when the design shows it, and see the ' +
        'catalog.* patterns for exact JSON. hero {enabled, breadcrumb[], title, lead, stats[{kind: courses|streams|categories, ' +
        'label}] (LIVE numbers — never author them), search{enabled,placeholder,buttonText}, popular[{label, searchValue | ' +
        'streamSlug+categorySlug | quickFilterId | route}], resultsHeader{enabled}, quickFilterBar{label, variant: tint|filled}}; ' +
        'quickFilters[{id,label,kind: popular|new|free|bestseller|language|priceMax,value}]; streams {enabled, source: ' +
        'folderLibrary|tags, libraryId, items[], variant: pills|icons, showCounts, labelMode: title|subtitle|both, allLabel, ' +
        'allSubtitle, sticky}; filterSidebar {variant: editorial, order[], width, promo{enabled,eyebrow,title,text,button,' +
        'screenImage}}; priceFilter.control checkbox; categoryFilter {scope: all, labelMode, sort: count, hideComingSoon, ' +
        'visibleCount}; customFilters[{id,label,source: courseFormats|options,options[{id,label,tags[],levels[]}]}]; ' +
        'render.cardStyle editorial + render.card{streamLabel,formatLabels,freeCtaByFormat}; render.pagination{mode: loadMore,' +
        'pageSize}; render.gridHeading{title,showSort}; groupLanguageVersions; columnSections[{id, kind: free-courses|spotlight|' +
        'coming-soon, placement: before-grid|after-grid, showWhen, title, subtitle, …}]. Ids (streams.libraryId, spotlight ' +
        'cta ids) are chosen by the admin — leave them empty, never invent one.',
    learningPath:
        'mode single (one product page as numbered steps) | list (a folder library\'s product pages as path cards). ' +
        'listLayout "featured" (only when the design shows it): goals[{key,label,tags[]}] chips, featured{code,badge,image}, ' +
        'pathExtras[{code,stepLabels[],mergeSteps[[1,2]],comingSoon[{title,position,audienceId}],goalTags[]}], ' +
        'showGoals/showFeatured/showGrid (split one list over two sections around a band), moreTitle, moreNote, sharedWith ' +
        '(the id of the section holding goals/featured/pathExtras) — patterns learningPath.*.',
    header:
        'Site chrome: the header shared by every page, kept in globalSettings.layout (over the MCP: website_edit(set_layout)). ' +
        'Opt-in looks (absent = the original header; use only ' +
        'when the design shows them): barSize compact (64px bar), contentWidth contained, navStyle editorial (13px text nav, ' +
        'current page bold), logoOnly, languageSwitcherStyle segmented (हिन्दी | EN), cartDisplay whenNotEmpty, activeStyle ' +
        'pill|underline, megaMenuStyle editorial, navigation[{label,route,type: link|megaMenu,megaMenu{libraryId,eyebrow,' +
        'helpLabel,helpRoute,categoriesHeading,showLegend,footnote}}] — patterns header.editorial, header.megaMenu. ' +
        'megaMenu.libraryId is a folder library the admin picks: leave it empty, never invent one.',
    jobOpenings:
        'template classic|poster|list|editorial|dark|minimal|spotlight|split (cards + job page). jobs[]: {title, slug, ' +
        'image, summary, location, jobType, compensation, details[{label,value}], description (HTML), applyUrl (https), enabled}.',
    footer:
        'Site chrome: the footer shared by every page, kept in globalSettings.layout (over the MCP: website_edit(set_layout)). ' +
        'layout two-column|three-column|four-column, ' +
        'leftSection{title,text,socials[]}, rightSection1-3{title,links[]}, bottomNote. variant "brand" (only when the design ' +
        'shows it): leftSection.logo, leftSection.tagline, rightSection4, newsletter{enabled,heading,subheading,placeholder,' +
        'buttonText,note,successMessage,audienceId}, bottomTagline, showLanguageSwitcher — patterns footer.brand, footer.newsletter. ' +
        'newsletter.audienceId is a campaign the admin picks: leave it empty, never invent one.',
};

const DATA_BOUND = {
    leadForm:
        "Embeds an Audience campaign's LIVE registration form (fields defined in the CRM's Audience " +
        "Manager) and submits leads into that campaign. Set ONLY title/subtitle/submitLabel/" +
        "successMessage/layout/align — audienceId must be chosen by the admin from their existing " +
        "campaigns, so leave it as an empty string and NEVER invent one. Use it for event " +
        "registrations, demo bookings and enquiry sections; contactForm remains fine for a simple " +
        "authored name/email/message form.",
    productPageOffer:
        "Renders a LIVE Product Page's sellable courses (names, prices, images) and deep-links each " +
        "card into that page's cart. Set ONLY title/subtitle/ctaLabel/columns, the header props " +
        "(align: left|center — left with headerScale 'md' and showViewAll true is the app-style rail " +
        "look; headerScale: md|lg; viewAllLabel), the browse props " +
        "(layout: grid|carousel — carousel is one swipeable edge-to-edge row, pair it with align 'left'; " +
        "pageSize — courses per page, 9 is a good default, 0 disables paging; showSearch; scrollable + " +
        "scrollMaxHeight to cap a grid's height) and the display toggles — " +
        "productPageCode must be chosen by the admin from their existing product pages, so leave it as " +
        "an empty string and NEVER invent a code or course entries. Use it when the brief mentions " +
        "selling/enrolling a specific set of paid programs; use courseCatalog for the full course grid.",
    folderBrowser:
        "Renders a LIVE folder library (Class → Subject → …) that visitors open one level at a time; a " +
        "product page inside the open folder shows its courses with add-to-cart. The folders live in a " +
        "shared library the admin builds in Manage Pages → Folders and binds by hand, so NEVER ADD this " +
        "section to a page (a generated one has no library and renders as nothing). When a page already " +
        "has one, keep its libraryId/rootFolderId exactly as they are; you may change only title/subtitle/" +
        "align and the look (layout: cards|tiles|list, imageShape: landscape|square|portrait|none, columns " +
        "2-5, show* toggles). For a generated course listing use courseCatalog or productPageOffer.",
    accessPassGrid:
        "Renders the institute's LIVE published Access Passes (one purchase that unlocks several courses) " +
        "as cards with a details dialog and a Buy button into the pass's checkout. Passes are created by the " +
        "admin in LMS → Access Passes, so NEVER invent pass names, prices or courses. Set ONLY " +
        "title/subtitle/buyLabel/columns (2-4) and the showCourses/showPrice toggles; leave tag as an empty " +
        "string unless the admin names a pass tag to filter by. Use it when the brief mentions memberships, " +
        "passes or all-access bundles; it renders nothing until a pass is published.",
    learningPath:
        "Renders LIVE learning paths: one product page's courses as numbered steps (mode 'single', productPageCode) " +
        "or the product pages of a folder library as path cards (mode 'list', libraryId/folderId). The product page " +
        "and library are chosen by the admin, so NEVER ADD this section (a generated one renders as nothing). When a " +
        "page already has one, keep productPageCode/libraryId/folderId exactly as they are; you may change only " +
        "title/subtitle/labels/showStepNumbers/showTotal/streamFromUrl, and the featured-layout look (listLayout, goals, " +
        "featured.badge, showGoals/showFeatured/showGrid, moreTitle, moreNote) when the design shows it.",
    courseCatalog: 'Renders the institute\'s LIVE course grid. Configure filters/title only — never invent course entries.',
    bookCatalogue: 'Renders the LIVE book store. Configure presentation only.',
    cartComponent: 'Live cart. Placement only.',
    courseDetails: 'Live single-course detail context. Only on course sub-pages.',
    bookDetails: 'Live single-book detail context.',
    buyRentSection: 'Live buy/rent controls.',
    policyRenderer: 'Renders stored policy documents. Placement only.',
    blog:
        'Live blog: reads the institute\'s PUBLISHED posts (written in Manage Pages → Blog or by an AI app over ' +
        'the MCP `blog_edit` tool). Renders the post list on the page it sits on and one article at ' +
        '/<page>/<post-slug>, so put it on a DEDICATED page (route "blog"), never on the home page. Placement + ' +
        'look only: heading, subheading, layout grid|list, columns 2|3, pageSize, category ("" = all), show* toggles. ' +
        'Never invent posts — there are none in the page JSON.',
};

// Collapse the columnLayout template variants into one canonical entry.
const LAYOUT_ALIASES = new Set(['columnLayout2asymLeft', 'columnLayout3', 'columnLayout4']);

const components = [];
for (const [key, tpl] of Object.entries(componentTemplates)) {
    if (FORBIDDEN.has(tpl.type) || LAYOUT_ALIASES.has(key)) continue;
    components.push({
        type: tpl.type,
        templateKey: key,
        exampleProps: tpl.props,
        ...(CAPABILITIES[tpl.type] ? { capabilities: CAPABILITIES[tpl.type] } : {}),
        ...(USAGE[tpl.type] ? { usage: USAGE[tpl.type] } : {}),
        ...(DATA_BOUND[tpl.type] ? { dataBound: DATA_BOUND[tpl.type] } : {}),
        ...(ESCAPE_HATCH_NOTES[tpl.type] ? { escapeHatch: ESCAPE_HATCH_NOTES[tpl.type] } : {}),
    });
}

/* ─── ComponentStyle vocabulary (kept in prose — the engine is the schema) ── */

const styleSchema = {
    description:
        'Every component may carry an optional "style" object (ComponentStyle). All fields optional; omit for defaults. Use PRESETS over raw values.',
    fields: {
        padding_margin: 'paddingTop/Bottom/Left/Right, marginTop/Bottom — CSS lengths like "48px".',
        background:
            'backgroundColor (hex), backgroundImage (URL from provided media only), backgroundSize, backgroundPosition, overlayPreset: scrim-dark|scrim-bottom|scrim-light|brand-tint (legible text over images).',
        backgroundLayers:
            'Array of composed layers [{type: linear|radial|color, from,to,angle | color,posX,posY,size}]. Radial size must be a percentage like "60%". Use for mesh/glow backdrops.',
        effects:
            'glass:{blur:sm|md|lg}, glow:{intensity:sm|md|lg}, borderGradient:{from,to,angle,width}, boxShadow: sm|md|lg|xl|2xl.',
        ornaments:
            'Ambient decorative shapes behind content. STRONGLY prefer the preset arrays below (copy one verbatim into style.ornaments).',
        dividers:
            'Shaped section edges: {top?:{shape:wave|angle|curve,height?,flip?}, bottom?:{...}}. Cut in the page background color.',
        layout:
            'Section shell: {width: text|narrow|default|wide|full, contentMaxWidth?, zIndex?, overlapTop?: "-80px"} — full-bleed background with centered content column. Use for hero/CTA/atmosphere sections.',
        position:
            'sticky:{enabled,top} (rails inside column layouts), minHeight ("60vh"|"80vh"|"100svh"), contentAlign: start|center|end (vertical centering within minHeight).',
        animation:
            'animation.entrance:{type: fade-up|fade-in|slide-left|slide-right|zoom-in, stagger?:{interval:60|100|160}} — stagger cascades list items. Use sparingly; motion personality is global.',
        typography: 'typography:{fontFamily,fontSize,fontWeight,textColor,textAlign} — prefer theme defaults.',
        responsive: 'responsive:{tablet:{...},mobile:{...}} partial overrides; visibility:{desktop,tablet,mobile}.',
    },
    ornamentPresets: ORNAMENT_PRESETS,
    meshBackgroundHint:
        'For hero atmosphere prefer globalSettings theme.atmosphere (flat|soft|mesh|aurora + intensity) over per-component layers.',
};

const globalSettingsSchema = {
    description: 'Site-wide settings. In Phase A the composer should NOT change theme/fonts unless explicitly asked — pages inherit the institute theme.',
    fields: {
        theme: '{preset, atmosphere:{canvas:flat|soft|mesh|aurora, intensity:subtle|medium|bold}, headingScale, borderRadius:sharp|rounded|pill}',
        fonts: '{enabled, family} — from the registered font list.',
        motion: '{personality: none|calm|balanced|dynamic}',
    },
};

const doctrine = [
    'Output is a single Page object: {id, name, route, components: Component[]}. Component = {id, type, enabled:true, props, style?}.',
    'ids: kebab-case unique strings.',
    'htmlBlock (see its note) covers what the typed components cannot — bespoke editorial layouts and DENSE INFORMATION TABLES ' +
        '(hairline-bordered spec grids, label:value detail strips). Typed components first for ordinary marketing sections, but on an ' +
        'information-heavy reference page htmlBlock is often the RIGHT choice, and ONE htmlBlock may hold many repeated blocks. ' +
        'NEVER invent image URLs — only use media URLs provided in the source pack (or leave image fields empty).',
    'Data-bound components render live institute data; configure, do not fabricate their entries.',
    'Rhythm: open with ONE hero; use sectionHeading before dense sections; alternate section surface tints; end with a CTA and/or contact section.',
    'Copy: concise, benefit-led, in the institute\'s voice; use the institute\'s configured terminology for Course/Batch/etc. when provided.',
    'Styling: presets first; theme tokens over raw hex except where the brand demands a specific color.',
];

/* ─── Design patterns, recipes and contracts (learner registry) ─────────── */

const fixtureCache = new Map();
const readFixture = (name) => {
    if (!fixtureCache.has(name)) {
        if (!FIXTURES[name]) throw new Error(`Unknown pattern fixture "${name}"`);
        fixtureCache.set(name, JSON.parse(fs.readFileSync(FIXTURES[name], 'utf8')));
    }
    return fixtureCache.get(name);
};

// A full example is the real Brahm Varchas JSON with every institute id,
// display name, uploaded-asset URL, absolute link, tagline and brand name
// replaced by a placeholder, so an AI can copy its shape but never another
// institute's records, links or name.
const patterns = DESIGN_PATTERNS.map((p) => {
    let full;
    if (p.fullFrom) {
        const raw = fullExampleOf(readFixture(p.fullFrom.fixture), p.fullFrom);
        if (raw === undefined) throw new Error(`Pattern ${p.id}: fullFrom ${JSON.stringify(p.fullFrom)} does not resolve`);
        const brandNames = FIXTURE_BRAND_NAMES[p.fullFrom.fixture] ?? [];
        full = scrubExample(raw, p.bound, brandNames);
        const text = JSON.stringify(full);
        if (new RegExp(UUID_PATTERN.source, 'i').test(text) || /cloudfront\.net|https?:\/\//i.test(text)) {
            throw new Error(`Pattern ${p.id}: the full example still carries a fixture id, asset URL or link`);
        }
        const leaked = brandNames.find((name) => text.toLowerCase().includes(name.toLowerCase()));
        if (leaked) throw new Error(`Pattern ${p.id}: the full example still names the fixture's brand ("${leaked}")`);
    }
    const { fullFrom, ...rest } = p;
    return {
        ...rest,
        ...(full !== undefined ? { full, fullSource: `${fullFrom.fixture}#${fullFrom.pointer}` } : {}),
    };
});

const templateProps = (type) => components.find((c) => c.type === type)?.exampleProps;
const chrome = Object.fromEntries(
    Object.entries(CHROME_CONTRACT).map(([type, contract]) => [type, { ...contract, exampleProps: templateProps(type) }])
);

const globalSettingsContract = {
    description:
        'Opt-in site settings a design may need beyond the theme preset / fonts / motion (globalSettingsSchema). ' +
        'Each is absent on an ordinary site; set one only when the design calls for it. See `patterns` for exact JSON.',
    fields: GLOBAL_SETTINGS_CONTRACT,
};

const catalog = {
    _generated: 'scripts/export-catalogue-schema-catalog.mjs — do not edit by hand',
    version: 2,
    components,
    styleSchema,
    globalSettingsSchema,
    globalSettingsContract,
    chrome,
    patterns,
    recipes: DESIGN_RECIPES,
    doctrine,
};

// The admin editor's copy (template library / variant labels read it).
const adminPatterns = {
    _generated: 'scripts/export-catalogue-schema-catalog.mjs — do not edit by hand',
    source: 'frontend-learner-dashboard-app/src/routes/$tagName/-ai/design-patterns.ts',
    patterns,
    recipes: DESIGN_RECIPES,
};

const outputs = [
    [OUT, `${JSON.stringify(catalog, null, 2)}`],
    [ADMIN_PATTERNS_OUT, `${JSON.stringify(adminPatterns, null, 2)}\n`],
];

if (CHECK) {
    const stale = outputs.filter(([file, body]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body);
    if (stale.length) {
        for (const [file] of stale) console.error(`stale: ${path.relative(ROOT, file)}`);
        console.error('Run: node scripts/export-catalogue-schema-catalog.mjs  and commit the outputs.');
        process.exit(1);
    }
    console.log(`up to date — ${components.length} component types, ${patterns.length} patterns`);
} else {
    for (const [file, body] of outputs) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
    }
    console.log(`wrote ${path.relative(ROOT, OUT)} — ${components.length} component types, ${patterns.length} patterns`);
    console.log(`wrote ${path.relative(ROOT, ADMIN_PATTERNS_OUT)}`);
}
