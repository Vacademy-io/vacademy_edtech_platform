import { v4 as uuidv4 } from 'uuid';
import type { TFunction } from 'i18next';
import { Page, Component } from '../-types/editor-types';
import { buildComponentTemplates } from './component-templates';
import { buildDesignRecipeTemplates } from './design-pattern-presets';

// Helper to create a component from a template with a fresh ID
const makeComponent = (t: TFunction, type: string, overrides?: Partial<Component>): Component => {
    const componentTemplates = buildComponentTemplates(t);
    return {
        id: uuidv4(),
        type,
        enabled: true,
        ...componentTemplates[type],
        ...overrides,
        props: {
            ...componentTemplates[type]?.props,
            ...overrides?.props,
        },
    };
};

export interface PageTemplate {
    id: string;
    name: string;
    description: string;
    category: 'page' | 'section';
    getComponents: (t: TFunction) => Component[];
    /**
     * Site-chrome templates: the globalSettings.layout (header / footer) they produce
     * from the current one. The page's own components are left alone.
     */
    applyLayout?: (layout: Record<string, any> | undefined, t: TFunction) => Record<string, any>;
}

export const PAGE_TEMPLATES: PageTemplate[] = [
    // ─────────── FULL PAGE TEMPLATES ───────────
    {
        id: 'landing-page',
        name: 'Landing Page',
        description: 'Header + Hero + Stats + Course Catalog + Testimonials + Footer',
        category: 'page',
        getComponents: (t) => [
            makeComponent(t, 'header'),
            makeComponent(t, 'heroSection', {
                props: {
                    ...buildComponentTemplates(t)['heroSection']?.props,
                    layout: 'split',
                    left: {
                        title: 'Learn Something New Today',
                        description: 'Join thousands of learners and unlock your potential.',
                        button: { enabled: true, text: 'Browse Courses', action: 'navigate', target: 'courses' },
                    },
                },
            }),
            makeComponent(t, 'statsHighlights'),
            makeComponent(t, 'courseCatalog'),
            makeComponent(t, 'testimonialSection'),
            makeComponent(t, 'footer'),
        ],
    },
    {
        id: 'course-landing',
        name: 'Course Landing',
        description: 'Header + Hero (course-focused) + Course Catalog + Buy/Rent + Footer',
        category: 'page',
        getComponents: (t) => [
            makeComponent(t, 'header'),
            makeComponent(t, 'heroSection', {
                props: {
                    ...buildComponentTemplates(t)['heroSection']?.props,
                    layout: 'centered',
                    left: {
                        title: 'Master Your Skills',
                        description: 'Expert-led courses with lifetime access.',
                        button: { enabled: true, text: 'Explore Courses', action: 'navigate', target: 'courses' },
                    },
                },
            }),
            makeComponent(t, 'courseCatalog'),
            makeComponent(t, 'buyRentSection'),
            makeComponent(t, 'footer'),
        ],
    },
    {
        id: 'about-page',
        name: 'About Page',
        description: 'Header + Hero + Stats + Testimonials + Footer',
        category: 'page',
        getComponents: (t) => [
            makeComponent(t, 'header'),
            makeComponent(t, 'heroSection', {
                props: {
                    ...buildComponentTemplates(t)['heroSection']?.props,
                    layout: 'centered',
                    left: {
                        title: 'About Us',
                        description: 'We help learners achieve their goals through quality education.',
                        button: { enabled: false, text: '', action: 'navigate', target: '' },
                    },
                },
            }),
            makeComponent(t, 'statsHighlights'),
            makeComponent(t, 'testimonialSection'),
            makeComponent(t, 'footer'),
        ],
    },
    {
        id: 'book-store',
        name: 'Book Store',
        description: 'Header + Hero + Book Catalog + Footer',
        category: 'page',
        getComponents: (t) => [
            makeComponent(t, 'header'),
            makeComponent(t, 'heroSection'),
            makeComponent(t, 'bookCatalogue'),
            makeComponent(t, 'footer'),
        ],
    },

    // ─────────── SECTION TEMPLATES ───────────
    {
        id: 'hero-centered',
        name: 'Hero (Centered)',
        description: 'Fullscreen centered hero section',
        category: 'section',
        getComponents: (t) => [
            makeComponent(t, 'heroSection', {
                props: {
                    ...buildComponentTemplates(t)['heroSection']?.props,
                    layout: 'centered',
                },
            }),
        ],
    },
    {
        id: 'social-proof',
        name: 'Social Proof',
        description: 'Stats + Testimonials block',
        category: 'section',
        getComponents: (t) => [
            makeComponent(t, 'statsHighlights'),
            makeComponent(t, 'testimonialSection'),
        ],
    },
    {
        id: 'course-showcase',
        name: 'Course Showcase',
        description: 'Course grid catalog section',
        category: 'section',
        getComponents: (t) => [
            makeComponent(t, 'courseCatalog'),
        ],
    },
    {
        id: 'media-carousel',
        name: 'Media Carousel',
        description: 'Sliding image/video showcase',
        category: 'section',
        getComponents: (t) => [
            makeComponent(t, 'mediaShowcase'),
        ],
    },
    // ── Niche kits ──────────────────────────────────────────────────────
    // These wire up the components a coaching/tuition site actually converts
    // with — dense programme blocks, a campaign-backed enquiry form, an
    // urgency ticker — rather than leaving an admin to discover them one by
    // one. Data-bound pieces (leadForm/productPageOffer) ship unset ON
    // PURPOSE: the admin picks their campaign / product page, and the
    // pre-publish check now tells them if they forget.
    {
        id: 'coaching-institute-home',
        name: 'Coaching Institute — Home',
        description: 'Announcement ticker + hero + why-us + programme blocks + enquiry form + FAQ + CTA',
        category: 'page',
        getComponents: (t) => [
            makeComponent(t, 'marquee'),
            makeComponent(t, 'heroSection', {
                props: {
                    ...buildComponentTemplates(t)['heroSection']?.props,
                    layout: 'split',
                    left: {
                        eyebrow: 'Admissions open',
                        title: 'Coaching that gets results',
                        description: 'Live, exam-focused classes taught by faculty who have taken the exam themselves.',
                        buttons: [
                            { text: 'Book a free demo', variant: 'primary', action: 'openForm', audienceId: '' },
                            { text: 'See our programs', variant: 'secondary', action: 'navigate', target: 'programs' },
                        ],
                    },
                },
            }),
            makeComponent(t, 'statsHighlights'),
            makeComponent(t, 'sectionHeading', {
                props: { ...buildComponentTemplates(t)['sectionHeading']?.props, eyebrow: 'Why us', title: 'Built around how students actually learn' },
            }),
            makeComponent(t, 'featureGrid'),
            makeComponent(t, 'sectionHeading', {
                props: { ...buildComponentTemplates(t)['sectionHeading']?.props, eyebrow: 'Our programs', title: 'Every batch, in detail' },
            }),
            makeComponent(t, 'detailBlocks'),
            makeComponent(t, 'testimonialSection'),
            makeComponent(t, 'leadForm', {
                props: {
                    ...buildComponentTemplates(t)['leadForm']?.props,
                    title: 'Book your free demo class',
                    subtitle: 'Tell us your class and we will call you back today.',
                },
            }),
            makeComponent(t, 'faqSection'),
            makeComponent(t, 'ctaBanner'),
        ],
    },
    // The shape a subject/level catalogue converges on: one hero, one live
    // course block a visitor can pick SEVERAL courses from, and the reassurance
    // blocks that answer "why you" before they reach checkout. Built from the
    // iThinkers Olympiad catalogue, which had to be hand-assembled block by
    // block (and its cart hand-written into the page JSON) the first time.
    {
        id: 'course-catalogue-multi-pick',
        name: 'Course Catalogue — Multi-pick',
        description: 'Hero + course rail with a basket + why-us + FAQ + CTA. For sites where one visitor buys several courses.',
        category: 'page',
        getComponents: (t) => [
            makeComponent(t, 'heroSection', {
                props: {
                    ...buildComponentTemplates(t)['heroSection']?.props,
                    layout: 'split',
                    eyebrow: { text: 'ADMISSIONS OPEN', style: 'badge' },
                    left: {
                        title: 'Pick the courses that fit',
                        description:
                            '<p>Choose a class, add the subjects you want, and enrol for all of them in one go.</p>',
                        buttons: [
                            { text: 'Browse courses', variant: 'primary', action: 'navigate', target: '#courses' },
                            { text: 'Talk to us', variant: 'secondary', action: 'openLeadCollection' },
                        ],
                    },
                },
            }),
            // The one block that has to be wired by hand — it needs a product
            // page, and the pre-publish check says so if it is left unset.
            makeComponent(t, 'productPageOffer', {
                props: {
                    ...buildComponentTemplates(t)['productPageOffer']?.props,
                    title: 'Our Courses',
                    subtitle: 'Pick the ones you want — add as many as you like, then check out once.',
                    layout: 'carousel',
                    columns: 4,
                    align: 'left',
                    headerScale: 'md',
                    // A basket only earns its place when a visitor genuinely
                    // buys more than one; that is the whole premise here, so it
                    // ships on rather than as something to discover later.
                    enableCart: true,
                    // Every course in the rail: with a Course Finder narrowing
                    // the list to one class, the whole class fits in one row.
                    pageSize: 0,
                    railMaxCards: 12,
                    showDescription: false,
                },
            }),
            makeComponent(t, 'featureGrid', {
                props: {
                    ...buildComponentTemplates(t)['featureGrid']?.props,
                    headerText: 'Why learners choose us',
                },
            }),
            makeComponent(t, 'statsHighlights'),
            makeComponent(t, 'faqSection'),
            makeComponent(t, 'ctaBanner'),
        ],
    },
    {
        id: 'programs-directory',
        name: 'Programs Directory',
        description: 'Compact header + one detailed block per programme + CTA (no prices)',
        category: 'page',
        getComponents: (t) => [
            makeComponent(t, 'sectionHeading', {
                props: {
                    ...buildComponentTemplates(t)['sectionHeading']?.props,
                    eyebrow: 'Everything we teach',
                    title: 'All our programs, in full detail',
                    lead: 'What each program covers, who it is for, and how it runs.',
                },
            }),
            makeComponent(t, 'detailBlocks'),
            makeComponent(t, 'ctaBanner'),
        ],
    },
    {
        id: 'enquiry-page',
        name: 'Enquiry / Contact',
        description: 'Campaign enquiry form + contact details + map',
        category: 'page',
        getComponents: (t) => [
            makeComponent(t, 'sectionHeading', {
                props: {
                    ...buildComponentTemplates(t)['sectionHeading']?.props,
                    eyebrow: 'Talk to us',
                    title: 'Ask us anything',
                    lead: 'Fill this in and our counsellors will get back to you.',
                },
            }),
            makeComponent(t, 'leadForm'),
            makeComponent(t, 'contactForm'),
            makeComponent(t, 'mapEmbed'),
        ],
    },
    {
        id: 'programs-section',
        name: 'Programme Blocks',
        description: 'Heading + one detailed block per programme',
        category: 'section',
        getComponents: (t) => [
            makeComponent(t, 'sectionHeading', {
                props: { ...buildComponentTemplates(t)['sectionHeading']?.props, eyebrow: 'Our programs', title: 'What we offer' },
            }),
            makeComponent(t, 'detailBlocks'),
        ],
    },
    {
        id: 'course-basket-section',
        name: 'Course Basket',
        description: 'One course rail a visitor can pick several courses from, checking out once',
        category: 'section',
        getComponents: (t) => [
            makeComponent(t, 'productPageOffer', {
                props: {
                    ...buildComponentTemplates(t)['productPageOffer']?.props,
                    title: 'Our Courses',
                    subtitle: 'Pick the ones you want — add as many as you like, then check out once.',
                    enableCart: true,
                },
            }),
        ],
    },
    {
        id: 'enquiry-section',
        name: 'Enquiry Form',
        description: 'A campaign-backed lead form section',
        category: 'section',
        getComponents: (t) => [makeComponent(t, 'leadForm')],
    },
    {
        id: 'lead-hero',
        name: 'Lead Hero',
        description: 'Hero + Stats to drive lead capture',
        category: 'section',
        getComponents: (t) => [
            makeComponent(t, 'heroSection'),
            makeComponent(t, 'statsHighlights'),
        ],
    },
    // ── Design recipes (generated from the learner's design-pattern registry) ──
    // "Editorial catalogue", "Learning paths", "Brand chrome": the opt-in looks the
    // Brahm Varchas site was built from, with every id left for the admin to pick.
    ...buildDesignRecipeTemplates(),
];

/** Apply a template to a page: replaces all components */
export const applyPageTemplate = (page: Page, template: PageTemplate, t: TFunction): Page => ({
    ...page,
    components: template.getComponents(t),
});

/** Apply a section template: inserts components before footer (or at end) */
export const applySectionTemplate = (page: Page, template: PageTemplate, t: TFunction): Page => {
    const footerIndex = page.components.findIndex((c) => c.type === 'footer');
    const newComponents = template.getComponents(t);
    if (footerIndex >= 0) {
        const updated = [...page.components];
        updated.splice(footerIndex, 0, ...newComponents);
        return { ...page, components: updated };
    }
    return { ...page, components: [...page.components, ...newComponents] };
};
