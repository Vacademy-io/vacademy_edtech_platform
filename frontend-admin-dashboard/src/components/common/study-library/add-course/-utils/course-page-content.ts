/**
 * Public course-page extras (delivery mode + FAQs) that the Add / Edit Course form collects.
 *
 * Stored by the backend as one opaque string, `course_page_json`:
 *   {"v":1,"mode":"SELF_PACED"|"LIVE"|null,"faqs":[{"q":"…","a":"<p>…</p>"}]}
 *
 * Update semantics (backend contract): absent / null keeps what is stored, "" clears it.
 * Everything here is pure so the payload rules can be tested without the form.
 */

export const COURSE_PAGE_JSON_VERSION = 1;
export const COURSE_PAGE_MAX_FAQS = 30;

export const COURSE_PAGE_MODES = ['SELF_PACED', 'LIVE'] as const;
export type CoursePageMode = (typeof COURSE_PAGE_MODES)[number];

export interface CoursePageFaq {
    /** Question — plain text, single line. */
    q: string;
    /** Answer — rich-text HTML from the editor. */
    a: string;
}

export interface CoursePageContent {
    mode: CoursePageMode | null;
    faqs: CoursePageFaq[];
}

export const emptyCoursePageContent = (): CoursePageContent => ({ mode: null, faqs: [] });

const isMode = (value: unknown): value is CoursePageMode =>
    typeof value === 'string' && (COURSE_PAGE_MODES as readonly string[]).includes(value);

/** True when an editor value has no visible text (TipTap's empty value is "<p></p>"). */
export const isBlankHtml = (html: string | null | undefined): boolean => {
    if (!html) return true;
    const text = html
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;|&#160;/gi, ' ') // design-lint-ignore: HTML entity, not a colour
        .trim();
    // An answer that is only an image / embed still counts as content.
    return text.length === 0 && !/<(img|iframe|video|audio)\b/i.test(html);
};

/** A row the admin never typed into: dropped on save rather than flagged. */
export const isEmptyFaq = (faq: Partial<CoursePageFaq> | null | undefined): boolean =>
    !faq || (!(faq.q ?? '').trim() && isBlankHtml(faq.a));

/**
 * Trims every row, drops empty ones and caps the list. A row with only one side filled is
 * kept here — the form validates it — so nothing the admin typed is ever silently lost.
 */
export const normalizeFaqs = (faqs: ReadonlyArray<Partial<CoursePageFaq>> | null | undefined) =>
    (faqs ?? [])
        .filter((faq) => !isEmptyFaq(faq))
        .map((faq) => ({
            q: (faq.q ?? '').trim(),
            a: isBlankHtml(faq.a) ? '' : (faq.a ?? '').trim(),
        }))
        .slice(0, COURSE_PAGE_MAX_FAQS);

/**
 * Reads the stored value defensively: anything that is not the expected shape (null,
 * "", invalid JSON, wrong types) reads as empty instead of breaking the form.
 */
export const parseCoursePageJson = (raw: unknown): CoursePageContent => {
    let value: unknown = raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return emptyCoursePageContent();
        try {
            value = JSON.parse(trimmed);
        } catch {
            return emptyCoursePageContent();
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return emptyCoursePageContent();
    }

    const record = value as { mode?: unknown; faqs?: unknown };
    const faqs = Array.isArray(record.faqs)
        ? record.faqs
              .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
              .map((item) => ({
                  q: typeof item.q === 'string' ? item.q : '',
                  a: typeof item.a === 'string' ? item.a : '',
              }))
        : [];

    return {
        mode: isMode(record.mode) ? record.mode : null,
        faqs: normalizeFaqs(faqs),
    };
};

/**
 * Builds the `course_page_json` payload value.
 *
 * - Adding a course: the JSON string, or null (omit the field) when nothing is filled in.
 * - Editing, when the form loaded the stored value from course-init (`storedValueLoaded`):
 *   always the full current JSON, or "" (clear) when the admin removed every FAQ and the
 *   mode. "" is never a default.
 * - Editing, when it did NOT load it (e.g. the page was filled from the institute-wide
 *   init list, where the field is always null): null, so the backend keeps what is stored.
 *   Sending anything else would overwrite FAQs the admin never saw.
 */
export const buildCoursePageJson = (
    state: Partial<CoursePageContent> | null | undefined,
    { isEdit, storedValueLoaded = false }: { isEdit: boolean; storedValueLoaded?: boolean }
): string | null => {
    if (isEdit && !storedValueLoaded) return null;

    const mode = isMode(state?.mode) ? state.mode : null;
    const faqs = normalizeFaqs(state?.faqs);

    if (!mode && faqs.length === 0) {
        return isEdit ? '' : null;
    }

    return JSON.stringify({ v: COURSE_PAGE_JSON_VERSION, mode, faqs });
};

/**
 * Pulls `course.course_page_json` for one course out of a course-init response
 * (an array of {course, sessions}). `loaded` is true only when that course is present AND
 * the payload carries the key — a backend that does not know the field yet counts as
 * not loaded, so the edit form leaves the stored value alone.
 */
export const readCoursePageJsonFromCourseInit = (
    data: unknown,
    courseId: string
): { loaded: boolean; raw: string | null } => {
    const list: unknown[] = Array.isArray(data) ? data : data ? [data] : [];
    const courses = list
        .map((item) => (item as { course?: unknown } | null)?.course)
        .filter(
            (course): course is Record<string, unknown> => !!course && typeof course === 'object'
        );
    const course = courses.find((c) => c.id === courseId);
    if (!course || !('course_page_json' in course)) return { loaded: false, raw: null };
    const raw = course.course_page_json;
    return { loaded: true, raw: typeof raw === 'string' ? raw : null };
};

/**
 * Splits AI-written FAQ HTML into rows. Expected shape is `<h3>question</h3>` followed by
 * the answer paragraphs; a paragraph that is only bold text is accepted as a question too
 * (models drift between the two). Text before the first question is ignored.
 */
export const parseFaqsFromHtml = (html: string): CoursePageFaq[] => {
    if (!html || typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const rows: { q: string; parts: string[] }[] = [];
    const isQuestionNode = (el: Element) => {
        if (/^H[1-6]$/.test(el.tagName)) return true;
        if (el.tagName !== 'P') return false;
        const strong = el.querySelector('strong, b');
        const text = (el.textContent ?? '').trim();
        return !!strong && (strong.textContent ?? '').trim() === text && text.length > 0;
    };

    Array.from(doc.body.children).forEach((el) => {
        if (isQuestionNode(el)) {
            const q = (el.textContent ?? '').replace(/^\s*(Q\d*[:.)-]|\d+[.)])\s*/i, '').trim();
            if (q) rows.push({ q, parts: [] });
            return;
        }
        const current = rows[rows.length - 1];
        if (current) current.parts.push(el.outerHTML);
    });

    return normalizeFaqs(rows.map((row) => ({ q: row.q, a: row.parts.join('') })));
};

/** Visible text of an editor value, for feeding course copy into an AI prompt. */
export const htmlToPlainText = (html: string | null | undefined): string =>
    (html ?? '')
        .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;|&#160;/gi, ' ') // design-lint-ignore: HTML entity, not a colour
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();

// The assist endpoint caps the prompt at 4000 characters; leave room for the brief.
const MAX_PROMPT_CONTEXT_CHARS = 2500;

/**
 * Instruction for the course-assist text endpoint that asks for FAQs in the
 * `<h3>question</h3><p>answer</p>` shape {@link parseFaqsFromHtml} reads back.
 */
export const buildFaqSuggestionPrompt = ({
    courseTerm,
    count,
    context,
}: {
    courseTerm: string;
    count: number;
    context: string;
}): string => {
    const term = courseTerm.toLocaleLowerCase('en');
    const details = context.trim().slice(0, MAX_PROMPT_CONTEXT_CHARS);
    return [
        `Write exactly ${count} frequently asked questions, with answers, that a prospective learner would ask before joining this ${term}.`,
        'Format: for each FAQ, one <h3> containing only the question, followed by one or two <p> paragraphs with the answer (30-80 words).',
        'No introduction, title or closing text.',
        `Base the answers only on the ${term} details given; do not invent prices, dates, durations, certificates or guarantees that are not stated — answer in general terms instead.`,
        details ? `\n${courseTerm} details:\n${details}` : '',
    ]
        .filter(Boolean)
        .join('\n');
};
