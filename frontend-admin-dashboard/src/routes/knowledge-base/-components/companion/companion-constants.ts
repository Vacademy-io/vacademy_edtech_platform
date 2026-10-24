import type { TFunction } from 'i18next';
import type { Companion, CompanionLeaf, CompanionTopic } from '../../-types/companion';

export const COMPANION_EMOJIS = [
    '🦉',
    '🤖',
    '🧑‍🏫',
    '📚',
    '🧠',
    '🔬',
    '🧪',
    '🌱',
    '🌍',
    '🧮',
    '📐',
    '🚀',
    '🎨',
    '🎓',
    '💡',
    '🐼',
];

/**
 * Accent colours the learner app themes the companion's cards with. The API
 * only accepts `#rrggbb`, so these are literal hex values rather than tokens.
 */
export const COMPANION_COLORS = [
    '#4f46e5', // design-lint-ignore — user-chosen accent sent to the API
    '#0ea5e9', // design-lint-ignore
    '#10b981', // design-lint-ignore
    '#f59e0b', // design-lint-ignore
    '#ef4444', // design-lint-ignore
    '#ec4899', // design-lint-ignore
    '#8b5cf6', // design-lint-ignore
    '#0f766e', // design-lint-ignore
];

export const DEFAULT_EMOJI = COMPANION_EMOJIS[0] as string;
export const DEFAULT_COLOR = COMPANION_COLORS[0] as string;
export const DEFAULT_DAILY_CAP = 30;

/** "Whole institute" / "3 batches · 2 students" / "Nobody yet". */
export const describeAssignments = (companion: Companion, t: TFunction): string => {
    const list = companion.assignments ?? [];
    if (list.some((a) => a.target_type === 'INSTITUTE')) return t('assign.wholeInstitute');
    const batches = list.filter((a) => a.target_type === 'BATCH').length;
    const learners = list.filter((a) => a.target_type === 'LEARNER').length;
    const parts: string[] = [];
    if (batches) parts.push(t('assign.batchCount', { count: batches }));
    if (learners) parts.push(t('assign.studentCount', { count: learners }));
    return parts.length ? parts.join(' · ') : t('assign.nobody');
};

export type LeafLessonState = 'READY' | 'GENERATING' | 'FAILED' | 'NONE';

export const leafState = (leaf: CompanionLeaf): LeafLessonState => leaf.lesson?.status ?? 'NONE';

export const allLeaves = (topics: CompanionTopic[] | undefined): CompanionLeaf[] =>
    (topics ?? []).flatMap((topic) => topic.leaves);

/** `2026-09-28T00:00:00Z` → `2026-09-28` for a date input. */
export const toDateInput = (iso: string | null | undefined): string =>
    iso ? iso.slice(0, 10) : '';
