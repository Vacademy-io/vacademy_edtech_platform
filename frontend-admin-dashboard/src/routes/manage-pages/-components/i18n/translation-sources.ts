/**
 * Live data a site shows but does not store — course names, folder titles,
 * product page names, level and session names, course tags, the course page's
 * texts. The learner site translates these at DISPLAY time through the same
 * dictionary (useSiteT), keyed by the exact text it displays, so the strings
 * collected here must be byte-identical to what the renderers show.
 *
 * Not collected: the field labels of a campaign-backed lead form. They come
 * from each campaign's own CRM fields (one more request per campaign), so
 * they are added to the dictionary by hand in the JSON tab.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { OPEN_CATALOGUE_COURSE_SEARCH_V2 } from '@/constants/urls';
import {
    getFolderTree,
    listFolderLibraries,
    type FolderNode,
} from '../../-services/folder-library-service';
import { getAllProductPages } from '../../product-pages/-services/product-pages-service';

export type LiveTextGroup =
    | 'Course name'
    | 'Course description'
    | 'Level'
    | 'Session'
    | 'Course tag'
    | 'Card category'
    | 'About the course'
    | 'What learners will gain'
    | 'Who should join'
    | 'Author'
    | 'Folder'
    | 'Product page';

export interface LiveText {
    source: string;
    group: LiveTextGroup;
}

/** Libraries read per site at most (each is one request). */
const MAX_LIBRARIES = 20;

/** Live values are free text (a course called "physics" is still copy); only blanks, links and pure numbers are skipped. */
export const isLiveText = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    const t = value.trim();
    if (!t) return false;
    if (/^(https?:|mailto:|tel:|\/\/|www\.)/i.test(t)) return false;
    return !/^[\d\s.,:;%+\-–—/×x*₹$€£¥()]+$/.test(t);
};

/** The course card's description: the HTML description as plain text (same transform as the learner card). */
export const courseCardDescription = (html: unknown): string =>
    typeof html === 'string'
        ? html
              .replace(/<[^>]*>/g, '')
              .replace(/&nbsp;/g, ' ')
              .trim()
        : '';

/** Distinct texts, first occurrence wins (its group is the one shown). */
export const dedupeLiveTexts = (items: LiveText[]): LiveText[] => {
    const seen = new Set<string>();
    const out: LiveText[] = [];
    for (const item of items) {
        if (!isLiveText(item.source) || seen.has(item.source)) continue;
        seen.add(item.source);
        out.push(item);
    }
    return out;
};

/** A course's faculty member as the search lists them (UserDTO). */
interface CourseSearchInstructor {
    full_name?: string | null;
    author_subtitle?: string | null;
    author_description?: string | null;
}

interface CourseSearchRow {
    package_name?: string | null;
    package_type?: string | null;
    level_name?: string | null;
    session_name?: string | null;
    comma_separeted_tags?: string | null;
    course_html_description_html?: string | null;
    about_the_course_html?: string | null;
    why_learn_html?: string | null;
    who_should_learn_html?: string | null;
    instructors?: CourseSearchInstructor[] | null;
}

/** Backend placeholder level names the learner never shows. */
const SENTINEL_LEVEL_NAMES = new Set(['default', 'none', 'null', 'undefined', '']);

/**
 * A level name as the Courses page shows it: the learner's displayLevelName
 * (CourseCatalogComponent) — placeholders hidden, the rest title-cased by
 * lib/utils toTitleCase ('class_10' → 'Class 10', 'Pre-Foundation' →
 * 'Pre Foundation', acronyms kept). Copied on purpose: the dictionary is
 * keyed by the exact text shown, so keep the two in step.
 */
export const displayedLevelName = (raw: string | null | undefined): string => {
    const trimmed = (raw || '').trim();
    if (SENTINEL_LEVEL_NAMES.has(trimmed.toLowerCase())) return '';
    return trimmed
        .split(/[\s_-]+/)
        .map((word) =>
            word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()
                ? word
                : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        )
        .join(' ');
};

/**
 * A level or session name as a product page offer card's chips show it: the
 * learner's ProductPageOfferComponent displayChips/toChipCase — placeholders
 * hidden, every all-caps word longer than three letters lowered after its
 * first letter ('NEET 2025' → 'Neet 2025', 'CBSE' → 'Cbse', 'JEE' kept), the
 * rest as stored. Copied on purpose, like displayedLevelName.
 */
export const offerChipName = (raw: string | null | undefined): string => {
    const trimmed = (raw || '').trim();
    if (SENTINEL_LEVEL_NAMES.has(trimmed.toLowerCase())) return '';
    return trimmed
        .split(/\s+/)
        .map((word) =>
            word === word.toUpperCase() && word.length > 3
                ? word.charAt(0) + word.slice(1).toLowerCase()
                : word
        )
        .join(' ');
};

/**
 * Field-name echoes the backend returns for an unset course field; the course
 * page shows nothing for them (CourseDetailsPage PLACEHOLDER_FIELD_NAMES).
 */
const PLACEHOLDER_FIELD_NAMES = new Set([
    'about_the_course',
    'about_the_course_html',
    'course_html_description',
    'course_html_description_html',
    'who_should_learn',
    'why_learn',
    'course_preview_image_media_id',
    'course_banner_media_id',
    'thumbnail_file_id',
]);

/**
 * A rich-text course field as the course page puts it through the dictionary
 * (CourseDetailsPage rawHtmlContent): the HTML as stored, or '' for an unset
 * field (a field-name echo, markup with no visible text). Trimmed: the learner
 * looks a text up exactly and then trimmed, so the trimmed key serves both.
 */
export const courseRichText = (html: unknown): string => {
    if (typeof html !== 'string') return '';
    const trimmed = html.trim();
    if (!trimmed || PLACEHOLDER_FIELD_NAMES.has(trimmed)) return '';
    const shown = trimmed
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
    return shown && !PLACEHOLDER_FIELD_NAMES.has(shown) ? trimmed : '';
};

/** An author's bio counts once it has visible text: an untouched editor saves '<p></p>' (course-authors). */
const hasVisibleText = (html: string): boolean =>
    html
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .trim().length > 0;

/**
 * Course rows → texts: names, card descriptions, level and session names,
 * course tags, the card's category, and the course page's About / What
 * learners will gain / Who should join and authors. Every one of them comes
 * with the single search below, so the panel makes no request per course.
 */
export const courseTextsFromRows = (rows: CourseSearchRow[]): LiveText[] => {
    const names: LiveText[] = [];
    const descriptions: LiveText[] = [];
    const levels: LiveText[] = [];
    const sessions: LiveText[] = [];
    const tags: LiveText[] = [];
    const categories: LiveText[] = [];
    const coursePage: LiveText[] = [];
    const authors: LiveText[] = [];
    for (const row of rows || []) {
        if (!row) continue;
        if (row.package_name) names.push({ source: row.package_name, group: 'Course name' });
        const description = courseCardDescription(row.course_html_description_html);
        if (description) descriptions.push({ source: description, group: 'Course description' });
        if (row.level_name) {
            // As stored (the course page and learning paths show it so), as
            // the Courses page cards and level filter show it, and as a
            // product page offer card's chip shows it.
            levels.push({ source: row.level_name, group: 'Level' });
            const shown = displayedLevelName(row.level_name);
            if (shown) levels.push({ source: shown, group: 'Level' });
            const chip = offerChipName(row.level_name);
            if (chip) levels.push({ source: chip, group: 'Level' });
        }
        // The same three forms: a learning path shows the name as stored, the
        // Courses page's session filter and chips title-cased, an offer card's
        // chip in its own casing. Placeholder sessions are left out: the site
        // hides them everywhere but a product page offer's Course Finder step.
        const session = displayedLevelName(row.session_name);
        if (session && row.session_name) {
            sessions.push({ source: row.session_name, group: 'Session' });
            sessions.push({ source: session, group: 'Session' });
            sessions.push({ source: offerChipName(row.session_name), group: 'Session' });
        }
        // The Tags filter (and the course page hero): each entry, trimmed.
        if (typeof row.comma_separeted_tags === 'string') {
            for (const tag of row.comma_separeted_tags.split(',')) {
                if (tag.trim()) tags.push({ source: tag.trim(), group: 'Course tag' });
            }
        }
        // The card's category label: the course type, unless it is 'General'.
        if (row.package_type && row.package_type !== 'General') {
            categories.push({ source: row.package_type, group: 'Card category' });
        }
        // The course page's sections; About falls back to the description.
        const about =
            courseRichText(row.about_the_course_html) ||
            courseRichText(row.course_html_description_html);
        if (about) coursePage.push({ source: about, group: 'About the course' });
        const whyLearn = courseRichText(row.why_learn_html);
        if (whyLearn) coursePage.push({ source: whyLearn, group: 'What learners will gain' });
        const whoShouldLearn = courseRichText(row.who_should_learn_html);
        if (whoShouldLearn) coursePage.push({ source: whoShouldLearn, group: 'Who should join' });
        // Its authors as mapCourseAuthors gives them: name and subtitle
        // trimmed, the bio when it has text.
        for (const author of Array.isArray(row.instructors) ? row.instructors : []) {
            if (!author || typeof author !== 'object') continue;
            for (const value of [author.full_name, author.author_subtitle]) {
                if (typeof value === 'string' && value.trim()) {
                    authors.push({ source: value.trim(), group: 'Author' });
                }
            }
            const bio = author.author_description;
            if (typeof bio === 'string' && hasVisibleText(bio)) {
                authors.push({ source: bio.trim(), group: 'Author' });
            }
        }
    }
    return dedupeLiveTexts([
        ...names,
        ...levels,
        ...sessions,
        ...tags,
        ...categories,
        ...descriptions,
        ...coursePage,
        ...authors,
    ]);
};

/** The same request the live catalogue makes (all catalogue courses, one page). */
export const fetchCourseTexts = async (instituteId: string): Promise<LiveText[]> => {
    const response = await authenticatedAxiosInstance.post<
        { content?: CourseSearchRow[] } | CourseSearchRow[]
    >(
        OPEN_CATALOGUE_COURSE_SEARCH_V2,
        {
            status: [],
            level_ids: [],
            faculty_ids: [],
            search_by_name: '',
            tag: [],
            min_percentage_completed: 0,
            max_percentage_completed: 0,
        },
        { params: { instituteId, page: 0, size: 1000, sort: 'createdAt,desc' } }
    );
    const data = response.data;
    const rows = Array.isArray(data) ? data : data?.content ?? [];
    return courseTextsFromRows(rows);
};

/** Folder fields a visitor reads: title, subtitle, tagline, description, call-to-action. */
export const folderTextsFromNodes = (roots: FolderNode[]): LiveText[] => {
    const out: LiveText[] = [];
    const walk = (nodes: FolderNode[]) => {
        for (const n of nodes || []) {
            if (n.status === 'HIDDEN') continue;
            for (const value of [n.title, n.subtitle, n.tagline, n.description, n.cta_label]) {
                if (value) out.push({ source: value, group: 'Folder' });
            }
            walk(n.children || []);
        }
    };
    walk(roots);
    return dedupeLiveTexts(out);
};

export const fetchFolderTexts = async (instituteId: string): Promise<LiveText[]> => {
    const libraries = (await listFolderLibraries(instituteId)).slice(0, MAX_LIBRARIES);
    const trees = await Promise.all(libraries.map((l) => getFolderTree(instituteId, l.id)));
    return dedupeLiveTexts(trees.flatMap((tree) => folderTextsFromNodes(tree.roots || [])));
};

export const fetchProductPageTexts = async (instituteId: string): Promise<LiveText[]> => {
    const pages = await getAllProductPages(instituteId);
    return dedupeLiveTexts(
        pages
            .filter((p) => (p.status || '').toUpperCase() !== 'DELETED')
            .map((p) => ({ source: p.name, group: 'Product page' as const }))
    );
};
