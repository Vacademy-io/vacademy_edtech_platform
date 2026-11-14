/**
 * Discussion slides: a DOCUMENT slide with document_slide.type 'DISCUSSION'.
 * document_slide.data / published_data hold a JSON string ({@link DiscussionSlideData}).
 * Contract: admin_core_service/.../features/discussion/DISCUSSION_FORUM.md
 */

export const DISCUSSION_DOC_TYPE = 'DISCUSSION';

export type DiscussionVisibility = 'OPEN' | 'AFTER_REPLY' | 'PRIVATE';

export type DiscussionReactionKey = 'HEART' | 'HUG' | 'THANKS' | 'INSIGHT' | 'RELATE' | 'STRENGTH';

export const DISCUSSION_REACTIONS: ReadonlyArray<{
    key: DiscussionReactionKey;
    emoji: string;
    label: string;
}> = [
    { key: 'HEART', emoji: '❤️', label: 'Love this' },
    { key: 'HUG', emoji: '🤗', label: 'Sending a hug' },
    { key: 'THANKS', emoji: '🙏', label: 'Thank you' },
    { key: 'INSIGHT', emoji: '💡', label: 'Insightful' },
    { key: 'RELATE', emoji: '🤝', label: 'I relate' },
    { key: 'STRENGTH', emoji: '💪', label: 'You’ve got this' },
];

export const CARE_NOTE_MAX = 1000;
export const POST_CONTENT_MAX = 5000;

export interface DiscussionSettings {
    visibility: DiscussionVisibility;
    allow_comments: boolean;
    allow_reactions: boolean;
    reactions: DiscussionReactionKey[];
    allow_anonymous: boolean;
    require_approval: boolean;
    allow_edit_own: boolean;
    locked: boolean;
    care_note: string;
}

export interface DiscussionSlideData {
    version: 1;
    prompt_html: string;
    settings: DiscussionSettings;
}

export const DEFAULT_DISCUSSION_SETTINGS: DiscussionSettings = {
    visibility: 'OPEN',
    allow_comments: true,
    allow_reactions: true,
    reactions: DISCUSSION_REACTIONS.map((r) => r.key),
    allow_anonymous: false,
    require_approval: false,
    allow_edit_own: true,
    locked: false,
    care_note: '',
};

export function createDefaultDiscussionData(): DiscussionSlideData {
    return {
        version: 1,
        prompt_html: '',
        settings: {
            ...DEFAULT_DISCUSSION_SETTINGS,
            reactions: [...DEFAULT_DISCUSSION_SETTINGS.reactions],
        },
    };
}

const VISIBILITIES: DiscussionVisibility[] = ['OPEN', 'AFTER_REPLY', 'PRIVATE'];
const REACTION_KEYS = new Set<string>(DISCUSSION_REACTIONS.map((r) => r.key));

/** Parse stored slide data, filling any missing field with its default. Never throws. */
export function parseDiscussionData(raw: string | null | undefined): DiscussionSlideData {
    const base = createDefaultDiscussionData();
    if (!raw) return base;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return base;
    }
    if (!parsed || typeof parsed !== 'object') return base;
    const obj = parsed as { prompt_html?: unknown; settings?: Record<string, unknown> };
    const s = (obj.settings && typeof obj.settings === 'object' ? obj.settings : {}) as Record<
        string,
        unknown
    >;
    const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
    const d = DEFAULT_DISCUSSION_SETTINGS;
    return {
        version: 1,
        prompt_html: typeof obj.prompt_html === 'string' ? obj.prompt_html : '',
        settings: {
            visibility: VISIBILITIES.includes(s.visibility as DiscussionVisibility)
                ? (s.visibility as DiscussionVisibility)
                : d.visibility,
            allow_comments: bool(s.allow_comments, d.allow_comments),
            allow_reactions: bool(s.allow_reactions, d.allow_reactions),
            reactions: Array.isArray(s.reactions)
                ? (s.reactions.filter(
                      (r) => typeof r === 'string' && REACTION_KEYS.has(r)
                  ) as DiscussionReactionKey[])
                : [...d.reactions],
            allow_anonymous: bool(s.allow_anonymous, d.allow_anonymous),
            require_approval: bool(s.require_approval, d.require_approval),
            allow_edit_own: bool(s.allow_edit_own, d.allow_edit_own),
            locked: bool(s.locked, d.locked),
            care_note: typeof s.care_note === 'string' ? s.care_note : '',
        },
    };
}

export function serializeDiscussionData(data: DiscussionSlideData): string {
    return JSON.stringify(data);
}

/** The JSON a freshly created discussion slide stores. */
export function createDefaultDiscussionDataJson(): string {
    return serializeDiscussionData(createDefaultDiscussionData());
}

/** Text content of teacher-authored HTML (read-only previews; never injected as HTML). */
export function htmlToPlainText(html: string | null | undefined): string {
    if (!html) return '';
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('p, li, br, h1, h2, h3, h4, blockquote').forEach((el) => {
            el.append('\n');
        });
        return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    } catch {
        return html.replace(/<[^>]*>/g, '').trim();
    }
}

/** Two prompt HTML strings that both hold nothing (TipTap reports '' as '<p></p>'). */
export function isSamePromptHtml(a: string, b: string): boolean {
    if (a === b) return true;
    return (
        htmlToPlainText(a) === '' &&
        htmlToPlainText(b) === '' &&
        !/<img|<iframe|<video/i.test(a + b)
    );
}

// ---- API shapes (snake_case; null fields omitted by the server) ----

export type DiscussionPostStatus = 'PUBLISHED' | 'PENDING' | 'HIDDEN';

export interface DiscussionReactionCount {
    reaction: string;
    count: number;
    reacted_by_me: boolean;
}

export interface DiscussionPostView {
    id: string;
    parent_id?: string;
    content: string;
    created_at: string | number;
    edited_at?: string | number;
    author_name: string;
    author_user_id?: string;
    author_role: 'LEARNER' | 'STAFF';
    anonymous: boolean;
    mine: boolean;
    status: DiscussionPostStatus;
    pinned: boolean;
    reactions?: DiscussionReactionCount[];
    report_count?: number;
    report_reasons?: string[];
    package_session_id?: string;
    comments?: DiscussionPostView[];
}

export interface DiscussionBatch {
    package_session_id: string;
    name: string;
}

export interface DiscussionThreadView {
    slide_id: string;
    package_session_id?: string;
    settings?: DiscussionSettings;
    stats: {
        responses: number;
        participants: number;
        pending?: number;
        flagged?: number;
        hidden?: number;
    };
    posts: DiscussionPostView[];
    batches?: DiscussionBatch[];
}

export type DiscussionModerationAction =
    | 'APPROVE'
    | 'HIDE'
    | 'UNHIDE'
    | 'PIN'
    | 'UNPIN'
    | 'DELETE'
    | 'CLEAR_REPORTS';
