/**
 * W10 history line per event type (contract §9.10). Returns i18n keys under `history.*`
 * of the assessmentSubmissionReview namespace plus their params. Pure, tested.
 */
import type { MarkEventView } from '@/services/submission-review/types';
import { formatMark } from '@/services/submission-review/marks';

export interface HistoryLine {
    /** Who did it: a name, or one of the `history.actor.*` keys when `whoKey` is set. */
    who: string | null;
    whoKey: 'history.actor.ai' | 'history.actor.system' | 'history.actor.someone' | null;
    key: string;
    params: Record<string, string | number>;
    reason: string | null;
    afterRelease: boolean;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const historyLine = (e: MarkEventView): HistoryLine => {
    const who = e.actor?.name?.trim() ? e.actor.name : null;
    const whoKey =
        e.actor_type === 'AI'
            ? ('history.actor.ai' as const)
            : e.actor_type === 'SYSTEM'
              ? ('history.actor.system' as const)
              : who
                ? null
                : ('history.actor.someone' as const);
    const old = formatMark(e.old_marks);
    const next = formatMark(e.new_marks);
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    const base = {
        who: e.actor_type === 'TEACHER' ? who : null,
        whoKey,
        reason: e.reason && e.reason.trim() ? e.reason : null,
        afterRelease: !!e.after_release,
    };
    switch (e.event_type) {
        case 'TEACHER_EDITED': {
            if (e.new_state === 'NOT_ANSWERED') {
                return { ...base, key: 'history.markedNotAnswered', params: { old } };
            }
            if (
                e.old_marks === e.new_marks &&
                (e.old_source === 'AI' || e.old_state === 'AI_DRAFT') &&
                e.new_source === 'AI_REVIEWED'
            ) {
                return { ...base, key: 'history.acceptedAi', params: { marks: next } };
            }
            if (e.old_marks === e.new_marks && e.old_feedback !== e.new_feedback) {
                return { ...base, key: 'history.feedbackChanged', params: { marks: next } };
            }
            return { ...base, key: 'history.edited', params: { old, new: next } };
        }
        case 'KEY_REAPPLIED':
            return { ...base, key: 'history.keyReapplied', params: { old, new: next } };
        case 'OVERRIDE_TEACHER':
            return { ...base, key: 'history.overrideTeacher', params: { old, new: next } };
        case 'SKIPPED_PROTECTED': {
            const keys = Array.isArray(payload.keys) ? payload.keys.length : 0;
            return keys > 1
                ? { ...base, key: 'history.skippedProtectedMany', params: { count: keys } }
                : { ...base, key: 'history.skippedProtected', params: {} };
        }
        case 'RELEASED':
            return payload.resend === true
                ? { ...base, key: 'history.releasedResent', params: {} }
                : { ...base, key: 'history.released', params: {} };
        case 'RELEASED_WITH_UNMARKED':
            return {
                ...base,
                key: 'history.releasedWithUnmarked',
                params: { count: num(payload.count) ?? (Array.isArray(payload.unmarked_keys) ? payload.unmarked_keys.length : 0) },
            };
        case 'AI_ACCEPTED_ON_RELEASE':
            return { ...base, key: 'history.aiAcceptedOnRelease', params: { count: num(payload.count) ?? 0 } };
        case 'WITHDRAWN':
            return { ...base, key: 'history.withdrawn', params: {} };
        case 'UPDATE_SENT':
            return { ...base, key: 'history.updateSent', params: {} };
        case 'TOTAL_RECOMPUTED':
            return {
                ...base,
                key: 'history.totalRecomputed',
                params: {
                    stored: formatMark(num(payload.stored_total)),
                    r6: formatMark(num(payload.r6_before)),
                },
            };
        case 'AI_MARKED':
            return { ...base, key: 'history.aiMarked', params: { marks: next } };
        case 'AI_FAILED':
            return { ...base, key: 'history.aiFailed', params: {} };
        default:
            return { ...base, key: 'history.other', params: { type: e.event_type, old, new: next } };
    }
};
