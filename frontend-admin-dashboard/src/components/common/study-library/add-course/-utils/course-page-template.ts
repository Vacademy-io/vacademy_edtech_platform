/**
 * Extra course-page content for an HTML course template (Manage Pages → a `course-details`
 * HTML page that uses `{{course.*}}` tokens). The admin enters plain text, lists and images;
 * the public site turns them into markup (see the learner app's course-template-content.ts).
 *
 * Stored inside `course_page_json` under `template`:
 *   {
 *     tagline, short_description, hero_image_id, about_image_id,
 *     framework: { eyebrow, heading, intro, cards: [{ title, subtitle, body, points: [..], takeaway }] },
 *     learning_experience: { eyebrow, heading, intro, cards: [{ label, title, body }],
 *                            callout_eyebrow, callout_heading, callout },
 *     testimonials: [{ stars, quote, name, details, review }],
 *     enrolment: { description, image_id },
 *     inclusions: { heading, items: [..] },
 *     labels: { eyebrow, enrol_button, … }   // the page's fixed words: headings, button text
 *   }
 * Each label becomes `{{course.label_<key>}}` on the public page, so no wording has to be
 * typed into the template itself.
 * Empty values are left out, so a course that uses none of this stores nothing extra.
 *
 * In the form, list-like fields (`points`, `items`) are one entry per line — a textarea is
 * far quicker to fill than a row per bullet.
 */

/** Same rule as course-page-content's isBlankHtml (kept local to avoid an import cycle). */
const isBlankHtml = (value: string): boolean =>
    !/<img\b/i.test(value) &&
    value
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;|&#160;/gi, ' ') // design-lint-ignore: HTML entity, not a colour
        .trim().length === 0;

export const COURSE_TEMPLATE_MAX_CARDS = 12;
export const COURSE_TEMPLATE_MAX_TESTIMONIALS = 20;
export const COURSE_TEMPLATE_LABEL_MAX_LENGTH = 120;

/**
 * The template's headings and button text, in the order they appear on the page. The key is
 * the token name (`{{course.label_<key>}}`); keep keys lower-case with underscores.
 */
export const COURSE_TEMPLATE_LABELS = [
    { key: 'eyebrow', label: 'Small line above the title' },
    { key: 'enrol_button', label: 'Enrol button' },
    { key: 'explore_button', label: 'Second button (scrolls down the page)' },
    { key: 'duration', label: 'Duration label (empty hides the duration)' },
    { key: 'hero_note', label: 'Small line below the buttons' },
    { key: 'hero_caption', label: 'Caption below the main image' },
    { key: 'highlights', label: 'Highlights heading' },
    { key: 'about_eyebrow', label: 'Small line above the About heading' },
    { key: 'about', label: 'About heading' },
    { key: 'points_heading', label: 'Heading above the framework card points' },
    { key: 'takeaway', label: 'Text before the framework card takeaway' },
    { key: 'who', label: 'Who it is for heading' },
    { key: 'testimonials_eyebrow', label: 'Small line above the Testimonials heading' },
    { key: 'testimonials', label: 'Testimonials heading' },
    { key: 'instructors', label: 'Instructors heading' },
    { key: 'instructor_eyebrow', label: 'Small line above the instructor name' },
    { key: 'instructor_signature', label: 'Signature below the name (one instructor only)' },
    { key: 'enrolment', label: 'Small line above the enrolment title' },
    { key: 'enrolment_heading', label: 'Enrolment title (empty uses the course name)' },
    { key: 'enrolment_button', label: 'Enrolment button (empty uses the Enrol button)' },
    { key: 'original_price', label: 'Text before the original price' },
    { key: 'discount', label: 'Text after the discount %' },
    { key: 'faq_eyebrow', label: 'Small line above the FAQ heading' },
    { key: 'faq', label: 'FAQ heading' },
    { key: 'closing_heading', label: 'Closing box heading (empty hides the box)' },
    { key: 'closing_text', label: 'Closing box text' },
    { key: 'closing_button', label: 'Closing box button' },
    { key: 'end_heading', label: 'Last line of the page (empty hides it)' },
    { key: 'end_text', label: 'Small text below the last line' },
] as const;

export type CourseTemplateLabelKey = (typeof COURSE_TEMPLATE_LABELS)[number]['key'];
export type CourseTemplateLabels = Record<CourseTemplateLabelKey, string>;

export const emptyCourseTemplateLabels = (): CourseTemplateLabels =>
    Object.fromEntries(COURSE_TEMPLATE_LABELS.map(({ key }) => [key, ''])) as CourseTemplateLabels;

export interface FrameworkCard {
    title: string;
    subtitle: string;
    body: string;
    /** One point per line. */
    points: string;
    takeaway: string;
}

export interface LearningCard {
    label: string;
    title: string;
    body: string;
}

export interface Testimonial {
    /** Text in the form ('' or 1 to 5); stored as a number. */
    stars: string;
    quote: string;
    name: string;
    details: string;
    review: string;
}

export interface CoursePageTemplate {
    tagline: string;
    shortDescription: string;
    /** Main image for this page only; empty uses the course Preview Image. */
    heroImageId: string;
    /** About-section image for this page only; empty uses the course Banner Image. */
    aboutImageId: string;
    framework: { eyebrow: string; heading: string; intro: string; cards: FrameworkCard[] };
    learning: {
        eyebrow: string;
        heading: string;
        intro: string;
        cards: LearningCard[];
        calloutEyebrow: string;
        calloutHeading: string;
        callout: string;
    };
    testimonials: Testimonial[];
    enrolment: { description: string; imageId: string };
    /** `items`: one inclusion per line. */
    inclusions: { heading: string; items: string };
    /** Headings and button text; see COURSE_TEMPLATE_LABELS. */
    labels: CourseTemplateLabels;
}

export const emptyFrameworkCard = (): FrameworkCard => ({
    title: '',
    subtitle: '',
    body: '',
    points: '',
    takeaway: '',
});
export const emptyLearningCard = (): LearningCard => ({ label: '', title: '', body: '' });
export const emptyTestimonial = (): Testimonial => ({
    stars: '',
    quote: '',
    name: '',
    details: '',
    review: '',
});

export const emptyCoursePageTemplate = (): CoursePageTemplate => ({
    tagline: '',
    shortDescription: '',
    heroImageId: '',
    aboutImageId: '',
    framework: { eyebrow: '', heading: '', intro: '', cards: [] },
    learning: {
        eyebrow: '',
        heading: '',
        intro: '',
        cards: [],
        calloutEyebrow: '',
        calloutHeading: '',
        callout: '',
    },
    testimonials: [],
    enrolment: { description: '', imageId: '' },
    inclusions: { heading: '', items: '' },
    labels: emptyCourseTemplateLabels(),
});

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').map(obj) : [];
const lines = (v: unknown): string =>
    Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string').join('\n')
        : str(v);
const toLines = (text: string): string[] =>
    text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
const html = (v: string): string => (isBlankHtml(v) ? '' : v.trim());

export const isEmptyFrameworkCard = (c: Partial<FrameworkCard>): boolean =>
    ![c.title, c.subtitle, c.body, c.points, c.takeaway].some((v) => (v ?? '').trim());
export const isEmptyLearningCard = (c: Partial<LearningCard>): boolean =>
    ![c.label, c.title, c.body].some((v) => (v ?? '').trim());
export const isEmptyTestimonial = (t: Partial<Testimonial>): boolean =>
    ![t.stars, t.quote, t.name, t.details, t.review].some((v) => (v ?? '').trim());

/** Stored stars → form text; anything outside 1 to 5 reads as empty. */
const starsText = (v: unknown): string => {
    const stars = Number(v);
    return Number.isInteger(stars) && stars >= 1 && stars <= 5 ? String(stars) : '';
};

/** Reads `course_page_json.template`; anything malformed reads as empty. */
export const parseCoursePageTemplate = (raw: unknown): CoursePageTemplate => {
    const t = obj(raw);
    const fw = obj(t.framework);
    const le = obj(t.learning_experience);
    const en = obj(t.enrolment);
    const inc = obj(t.inclusions);
    const lab = obj(t.labels);
    return {
        tagline: str(t.tagline),
        shortDescription: str(t.short_description),
        heroImageId: str(t.hero_image_id),
        aboutImageId: str(t.about_image_id),
        framework: {
            eyebrow: str(fw.eyebrow),
            heading: str(fw.heading),
            intro: str(fw.intro),
            cards: arr(fw.cards)
                .map((c) => ({
                    title: str(c.title),
                    subtitle: str(c.subtitle),
                    body: str(c.body),
                    points: lines(c.points),
                    takeaway: str(c.takeaway),
                }))
                .slice(0, COURSE_TEMPLATE_MAX_CARDS),
        },
        learning: {
            eyebrow: str(le.eyebrow),
            heading: str(le.heading),
            intro: str(le.intro),
            cards: arr(le.cards)
                .map((c) => ({ label: str(c.label), title: str(c.title), body: str(c.body) }))
                .slice(0, COURSE_TEMPLATE_MAX_CARDS),
            calloutEyebrow: str(le.callout_eyebrow),
            calloutHeading: str(le.callout_heading),
            callout: str(le.callout),
        },
        testimonials: arr(t.testimonials)
            .map((r) => ({
                stars: starsText(r.stars),
                quote: str(r.quote),
                name: str(r.name),
                details: str(r.details),
                review: str(r.review),
            }))
            .slice(0, COURSE_TEMPLATE_MAX_TESTIMONIALS),
        enrolment: { description: str(en.description), imageId: str(en.image_id) },
        inclusions: { heading: str(inc.heading), items: lines(inc.items) },
        labels: Object.fromEntries(
            COURSE_TEMPLATE_LABELS.map(({ key }) => [key, str(lab[key])])
        ) as CourseTemplateLabels,
    };
};

/** Drops undefined / empty-string / empty-array / empty-object values, recursively. */
const compact = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        const out = value.map(compact).filter((v) => v !== undefined);
        return out.length ? out : undefined;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        Object.entries(value).forEach(([k, v]) => {
            const c = compact(v);
            if (c !== undefined) out[k] = c;
        });
        return Object.keys(out).length ? out : undefined;
    }
    if (typeof value === 'string') return value.trim() ? value.trim() : undefined;
    return value ?? undefined;
};

/**
 * The stored `template` object, or null when nothing is filled in. Empty cards and
 * reviews are dropped; the form validates half-filled ones before this runs.
 */
export const serializeCoursePageTemplate = (
    state: Partial<CoursePageTemplate> | null | undefined
): Record<string, unknown> | null => {
    const t = { ...emptyCoursePageTemplate(), ...(state ?? {}) };
    const value = compact({
        tagline: t.tagline,
        short_description: t.shortDescription,
        hero_image_id: t.heroImageId,
        about_image_id: t.aboutImageId,
        framework: {
            eyebrow: t.framework?.eyebrow,
            heading: t.framework?.heading,
            intro: t.framework?.intro,
            cards: (t.framework?.cards ?? [])
                .filter((c) => !isEmptyFrameworkCard(c))
                .slice(0, COURSE_TEMPLATE_MAX_CARDS)
                .map((c) => ({
                    title: c.title,
                    subtitle: c.subtitle,
                    body: c.body,
                    points: toLines(c.points ?? ''),
                    takeaway: c.takeaway,
                })),
        },
        learning_experience: {
            eyebrow: t.learning?.eyebrow,
            heading: t.learning?.heading,
            intro: t.learning?.intro,
            cards: (t.learning?.cards ?? [])
                .filter((c) => !isEmptyLearningCard(c))
                .slice(0, COURSE_TEMPLATE_MAX_CARDS)
                .map((c) => ({ label: c.label, title: c.title, body: c.body })),
            callout_eyebrow: t.learning?.calloutEyebrow,
            callout_heading: t.learning?.calloutHeading,
            callout: html(t.learning?.callout ?? ''),
        },
        testimonials: (t.testimonials ?? [])
            .filter((r) => !isEmptyTestimonial(r))
            .slice(0, COURSE_TEMPLATE_MAX_TESTIMONIALS)
            .map((r) => ({
                stars: starsText(r.stars) ? Number(r.stars) : undefined,
                quote: r.quote,
                name: r.name,
                details: r.details,
                review: r.review,
            })),
        enrolment: {
            description: html(t.enrolment?.description ?? ''),
            image_id: t.enrolment?.imageId,
        },
        inclusions: {
            heading: t.inclusions?.heading,
            items: toLines(t.inclusions?.items ?? ''),
        },
        labels: Object.fromEntries(COURSE_TEMPLATE_LABELS.map(({ key }) => [key, t.labels?.[key]])),
    });
    return (value as Record<string, unknown> | undefined) ?? null;
};

/** How many template blocks are filled — for the section's header summary. */
export const countTemplateBlocks = (state: Partial<CoursePageTemplate> | null | undefined) => {
    const value = serializeCoursePageTemplate(state);
    return value ? Object.keys(value).length : 0;
};
