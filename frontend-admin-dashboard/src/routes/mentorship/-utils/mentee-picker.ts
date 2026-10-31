import type { TFunction } from 'i18next';
import type { StudentRow } from '../-types/mentorship-types';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/**
 * Selection helpers for the mentee picker.
 *
 * Kept as pure functions so the "select every student matching this filter"
 * arithmetic — the part that decides how many rows an admin is about to assign —
 * is testable without a DOM, a query client or an institute store.
 */

/**
 * Ceiling on one "select all matching" pull.
 *
 * The sweep itself is several requests and the assignment then writes a row per
 * student, so an unfiltered institute's whole roster is not a sensible single
 * action — and no single mentor's capacity is anywhere near this. Beyond the cap
 * the admin is told to narrow by batch rather than handed a silent subset, since
 * "the first 1,000 of 3,000" is a selection nobody can reason about.
 */
export const MAX_BULK_SELECT = 1000;

/** Page size used when sweeping every match for "select all". */
export const SELECT_ALL_PAGE_SIZE = 200;

/** Rows shown per page while browsing. */
export const PICKER_PAGE_SIZE = 20;

export interface BatchOption {
    value: string;
    label: string;
}

/**
 * The shape the batch filter needs out of `instituteDetails.batches_for_sessions`.
 * Structural on purpose — the store's zod type carries a dozen fields this doesn't
 * care about, and depending on it would drag the schema into the tests.
 */
export interface PickerBatch {
    /** The package_session_id — what the learner list filters on. */
    id: string;
    name?: string | null;
    status?: string | null;
    level?: { id?: string; level_name?: string } | null;
    package_dto?: { package_name?: string } | null;
    session?: { id?: string; session_name?: string } | null;
}

const stripDefaultPrefix = (value: string) => value.replace(/^default\s+/i, '').trim();

/**
 * A level is a placeholder when the course was created without one — those rows
 * exist but are literally named "DEFAULT", and showing them turns every option
 * into "Default <course>".
 */
const isPlaceholderLevel = (level: PickerBatch['level']) => {
    if (!level) return true;
    const name = (level.level_name ?? '').trim();
    if (!name) return true;
    return level.id === 'DEFAULT' || name.toLowerCase() === 'default';
};

/**
 * Build the batch filter's options from the institute's package sessions.
 *
 * The session name is appended only when the institute actually runs more than
 * one — on a single-session institute it is the same suffix on every row, which
 * is noise that pushes the part that distinguishes them out of the truncation.
 *
 * `t` is optional (namespace `mentorshipMenteePickerUtils`) because this is a
 * plain function, not a hook — a caller that hasn't been wired for i18n yet can
 * still call it and gets the English "Course" fallback; a caller that has a `t`
 * in scope should pass it through so the fallback is translated.
 */
export function buildBatchOptions(
    batches: PickerBatch[] | undefined | null,
    t?: TFunction
): BatchOption[] {
    const live = (batches ?? []).filter(
        (b) => !!b?.id && (b.status ?? '').toUpperCase() !== 'DELETED'
    );
    const sessionIds = new Set(live.map((b) => b.session?.id).filter(Boolean));
    const showSession = sessionIds.size > 1;

    const options = live.map((batch) => {
        const course =
            stripDefaultPrefix(batch.package_dto?.package_name ?? '') ||
            (t ? t('courseFallback') : getTerminology(ContentTerms.Course, SystemTerms.Course));
        const parts = [course];
        if (!isPlaceholderLevel(batch.level)) {
            parts.push(stripDefaultPrefix(batch.level?.level_name ?? ''));
        }
        // A child batch carries its own display name (e.g. "Morning batch").
        const childName = (batch.name ?? '').trim();
        if (childName) parts.push(childName);
        const sessionName = (batch.session?.session_name ?? '').trim();
        const label =
            showSession && sessionName
                ? `${parts.join(' · ')} (${sessionName})`
                : parts.join(' · ');
        return { value: batch.id, label };
    });

    return options.sort((a, b) => a.label.localeCompare(b.label));
}

/** Map of package_session_id → display label, for captioning a student row. */
export function batchLabelMap(options: BatchOption[]): Record<string, string> {
    return options.reduce<Record<string, string>>((acc, opt) => {
        acc[opt.value] = opt.label;
        return acc;
    }, {});
}

/** Add rows that aren't selected yet, keeping the existing order stable. */
export function mergeSelection(selected: StudentRow[], rows: StudentRow[]): StudentRow[] {
    const seen = new Set(selected.map((s) => s.user_id));
    const additions = rows.filter((r) => r?.user_id && !seen.has(r.user_id));
    return additions.length ? [...selected, ...additions] : selected;
}

/** Drop every row in `rows` from the selection. */
export function removeSelection(selected: StudentRow[], rows: StudentRow[]): StudentRow[] {
    const drop = new Set(rows.map((r) => r.user_id));
    return selected.filter((s) => !drop.has(s.user_id));
}

export type PageSelectionState = 'none' | 'some' | 'all';

/** Whether none / some / all of the rows on screen are selected. */
export function pageSelectionState(
    selected: StudentRow[],
    pageRows: StudentRow[]
): PageSelectionState {
    if (pageRows.length === 0) return 'none';
    const ids = new Set(selected.map((s) => s.user_id));
    const hits = pageRows.filter((r) => ids.has(r.user_id)).length;
    if (hits === 0) return 'none';
    return hits === pageRows.length ? 'all' : 'some';
}

/**
 * What the "select all N matching" control should do for a match set of this size.
 *
 * `blocked` means the match set is larger than one assignment should be — the
 * caller shows the reason instead of silently truncating, because an admin who
 * asked for 3,000 students and got 1,000 has no way to tell which 1,000.
 */
export function selectAllAffordance(totalMatching: number): {
    available: boolean;
    blocked: boolean;
} {
    if (totalMatching <= 0) return { available: false, blocked: false };
    if (totalMatching > MAX_BULK_SELECT) return { available: false, blocked: true };
    return { available: true, blocked: false };
}

export interface MentorCapacity {
    max_mentees?: number | null;
    available_slots?: number | null;
}

/**
 * Seats left for one mentor, or `null` when they have no cap.
 *
 * A cap only exists **above zero**: `MentorService.normalizeCapacity` stores 0 and
 * negatives as null, and `atCapacity`/`availableSlots` both read `<= 0` as
 * uncapped. Testing `max_mentees != null` alone would read a legacy `max_mentees:
 * 0` row as a mentor with zero seats and warn that nothing can be assigned to
 * them — when the server would in fact take everyone.
 */
export function seatsLeft(mentor: MentorCapacity): number | null {
    if (mentor.max_mentees == null || mentor.max_mentees <= 0) return null;
    return Math.max(0, mentor.available_slots ?? 0);
}

/**
 * Seats left across a group of mentors, or `null` when at least one of them is
 * uncapped (so the group can absorb anything).
 *
 * A mentor with no cap must not be read as "no room" — doing that would warn
 * about overflow on the common institute that never sets caps at all.
 */
export function openSeats(mentors: MentorCapacity[]): number | null {
    if (mentors.length === 0) return 0;
    if (mentors.some((m) => seatsLeft(m) === null)) return null;
    return mentors.reduce((sum, m) => sum + (seatsLeft(m) ?? 0), 0);
}

/** Best display name for a student row, never blank. */
export function studentLabel(row: StudentRow): string {
    return row.full_name?.trim() || row.username?.trim() || row.email?.trim() || row.user_id;
}

/**
 * The single batch to stamp on the assignment, or undefined.
 *
 * Derived from the selected students themselves, NOT from the batch filter. The
 * picker deliberately keeps a selection while the filter moves, so at submit time
 * the filter says nothing about where those students came from — an admin who
 * ticked Class 9 and then switched to Class 10 would stamp every Class 9 row with
 * Class 10. `package_session_id` is context for one assignment row, so it is only
 * honest when every student in the batch actually shares it.
 */
export function assignmentBatchContext(selected: StudentRow[]): string | undefined {
    const first = selected[0]?.package_session_id;
    if (!first) return undefined;
    return selected.every((s) => s.package_session_id === first) ? first : undefined;
}
