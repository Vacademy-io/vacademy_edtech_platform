/**
 * Extra course-page content for an HTML course template (Manage Pages → a `course-details`
 * HTML page that uses `{{course.*}}` tokens). The admin enters plain text, lists and images;
 * the public site turns them into markup (see the learner app's course-template-content.ts).
 *
 * Stored inside `course_page_json` under `template`:
 *   {
 *     tagline, short_description,
 *     framework: { heading, intro, cards: [{ title, body, points: [..], takeaway }] },
 *     learning_experience: { heading, intro, cards: [{ title, body }], callout },
 *     testimonials: [{ quote, name, details, review }],
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
    { key: 'duration', label: 'Duration label' },
    { key: 'highlights', label: 'Highlights heading' },
    { key: 'about', label: 'About heading' },
    { key: 'who', label: 'Who it is for heading' },
    { key: 'testimonials', label: 'Testimonials heading' },
    { key: 'instructors', label: 'Instructors heading' },
    { key: 'enrolment', label: 'Small line above the enrolment title' },
    { key: 'original_price', label: 'Text before the original price' },
    { key: 'discount', label: 'Text after the discount %' },
    { key: 'faq', label: 'FAQ heading' },
] as const;

export type CourseTemplateLabelKey = (typeof COURSE_TEMPLATE_LABELS)[number]['key'];
export type CourseTemplateLabels = Record<CourseTemplateLabelKey, string>;

export const emptyCourseTemplateLabels = (): CourseTemplateLabels =>
    Object.fromEntries(COURSE_TEMPLATE_LABELS.map(({ key }) => [key, ''])) as CourseTemplateLabels;

export interface FrameworkCard {
    title: string;
    body: string;
    /** One point per line. */
    points: string;
    takeaway: string;
}

export interface LearningCard {
    title: string;
    body: string;
}

export interface Testimonial {
    quote: string;
    name: string;
    details: string;
    review: string;
}

export interface CoursePageTemplate {
    tagline: string;
    shortDescription: string;
    framework: { heading: string; intro: string; cards: FrameworkCard[] };
    learning: { heading: string; intro: string; cards: LearningCard[]; callout: string };
    testimonials: Testimonial[];
    enrolment: { description: string; imageId: string };
    /** `items`: one inclusion per line. */
    inclusions: { heading: string; items: string };
    /** Headings and button text; see COURSE_TEMPLATE_LABELS. */
    labels: CourseTemplateLabels;
}

export const emptyFrameworkCard = (): FrameworkCard => ({
    title: '',
    body: '',
    points: '',
    takeaway: '',
});
export const emptyLearningCard = (): LearningCard => ({ title: '', body: '' });
export const emptyTestimonial = (): Testimonial => ({ quote: '', name: '', details: '', review: '' });

export const emptyCoursePageTemplate = (): CoursePageTemplate => ({
    tagline: '',
    shortDescription: '',
    framework: { heading: '', intro: '', cards: [] },
    learning: { heading: '', intro: '', cards: [], callout: '' },
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
    ![c.title, c.body, c.points, c.takeaway].some((v) => (v ?? '').trim());
export const isEmptyLearningCard = (c: Partial<LearningCard>): boolean =>
    ![c.title, c.body].some((v) => (v ?? '').trim());
export const isEmptyTestimonial = (t: Partial<Testimonial>): boolean =>
    ![t.quote, t.name, t.details, t.review].some((v) => (v ?? '').trim());

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
        framework: {
            heading: str(fw.heading),
            intro: str(fw.intro),
            cards: arr(fw.cards)
                .map((c) => ({
                    title: str(c.title),
                    body: str(c.body),
                    points: lines(c.points),
                    takeaway: str(c.takeaway),
                }))
                .slice(0, COURSE_TEMPLATE_MAX_CARDS),
        },
        learning: {
            heading: str(le.heading),
            intro: str(le.intro),
            cards: arr(le.cards)
                .map((c) => ({ title: str(c.title), body: str(c.body) }))
                .slice(0, COURSE_TEMPLATE_MAX_CARDS),
            callout: str(le.callout),
        },
        testimonials: arr(t.testimonials)
            .map((r) => ({
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
        framework: {
            heading: t.framework?.heading,
            intro: t.framework?.intro,
            cards: (t.framework?.cards ?? [])
                .filter((c) => !isEmptyFrameworkCard(c))
                .slice(0, COURSE_TEMPLATE_MAX_CARDS)
                .map((c) => ({
                    title: c.title,
                    body: c.body,
                    points: toLines(c.points ?? ''),
                    takeaway: c.takeaway,
                })),
        },
        learning_experience: {
            heading: t.learning?.heading,
            intro: t.learning?.intro,
            cards: (t.learning?.cards ?? [])
                .filter((c) => !isEmptyLearningCard(c))
                .slice(0, COURSE_TEMPLATE_MAX_CARDS)
                .map((c) => ({ title: c.title, body: c.body })),
            callout: html(t.learning?.callout ?? ''),
        },
        testimonials: (t.testimonials ?? [])
            .filter((r) => !isEmptyTestimonial(r))
            .slice(0, COURSE_TEMPLATE_MAX_TESTIMONIALS)
            .map((r) => ({ quote: r.quote, name: r.name, details: r.details, review: r.review })),
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
