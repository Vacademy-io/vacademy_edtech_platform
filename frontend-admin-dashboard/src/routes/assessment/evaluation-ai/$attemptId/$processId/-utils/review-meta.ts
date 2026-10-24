/**
 * `ai_question_evaluation.review_meta` (jsonb, spec §7.9): who reviewed a
 * question outside the dashboard, e.g. a partner's teacher overriding marks
 * through the AI Evaluation API.
 *
 *   {"reviewer": {"ref": "T-0042", "name": "Mrs. Iyer"}, "reason": "...", "via": "api"}
 *   {"approved_by": {"ref": "T-0042", "name": "Mrs. Iyer"}}
 *
 * Partner-supplied plain text: rendered as text (React escapes it), never as HTML.
 *
 * Only the API writes review_meta (§7.9), so a missing `via` reads as the API;
 * an explicit non-"api" `via` does not. The backend should still send
 * via:"api" so this does not rest on that assumption.
 */

export interface ReviewAttribution {
    kind: 'reviewed' | 'approved';
    /** "T-0042 (Mrs. Iyer)", "Mrs. Iyer" or "T-0042"; empty when the partner sent neither. */
    reviewer: string;
    viaApi: boolean;
    reason: string | null;
}

const MAX_PART_LENGTH = 80;

const clean = (value: unknown): string => {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const text = String(value).replace(/\s+/g, ' ').trim();
    return text.length > MAX_PART_LENGTH ? `${text.slice(0, MAX_PART_LENGTH - 1)}…` : text;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

/** {ref, name} | "name" → display text. */
export function formatReviewer(value: unknown): string {
    const obj = asRecord(value);
    if (!obj) return clean(value);
    const ref = clean(obj.ref ?? obj.id ?? obj.external_id);
    const name = clean(obj.name ?? obj.full_name);
    if (ref && name) return `${ref} (${name})`;
    return ref || name;
}

/** True when `edited_by` names a dashboard user, i.e. not an API key (`apikey:<key_id>`). */
const isDashboardEditor = (editedBy: unknown): boolean =>
    typeof editedBy === 'string' && editedBy.trim() !== '' && !editedBy.startsWith('apikey:');

/**
 * @param editedBy the question's `edited_by` when the payload carries it. A
 *   dashboard editor there means a teacher overrode the marks on the dashboard
 *   after the API review, so the API "Reviewed by …" line would be stale and is
 *   dropped (an API approval stays: it is still true history).
 */
export function parseReviewMeta(raw: unknown, editedBy?: unknown): ReviewAttribution | null {
    let meta: unknown = raw;
    if (typeof raw === 'string') {
        if (!raw.trim()) return null;
        try {
            meta = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    const obj = asRecord(meta);
    if (!obj) return null;

    const channel = clean(obj.via ?? obj.channel ?? obj.source);
    const viaApi = channel === '' || channel.toLowerCase() === 'api';
    const reason = clean(obj.reason) || null;

    if (obj.reviewer !== undefined && obj.reviewer !== null) {
        if (isDashboardEditor(editedBy)) return null;
        return { kind: 'reviewed', reviewer: formatReviewer(obj.reviewer), viaApi, reason };
    }
    if (obj.approved_by !== undefined && obj.approved_by !== null) {
        return { kind: 'approved', reviewer: formatReviewer(obj.approved_by), viaApi, reason };
    }
    return null;
}
