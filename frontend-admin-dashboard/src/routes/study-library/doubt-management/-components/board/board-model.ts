import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { DoubtType } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/add-doubt-type';
import {
    effectiveStatusKey,
    PENDING_STATUS_KEY,
    RESOLVED_STATUS_KEY,
    WorkflowStatusConfig,
} from '../../-services/use-doubt-statuses';

/**
 * Pure model behind the doubt Kanban board: which column a doubt lands in, and what a drag from
 * one column to another means in terms of the update payload. Kept free of React/network so it
 * can be unit-tested and so the board component only has to wire DnD + optimistic state.
 *
 * Columns are keyed by assignee: a synthetic "Unassigned" column, one column per staff member,
 * and a synthetic "Resolved" column at the end. Only EXPLICIT assignee rows (doubt_assignee,
 * source=USER) place a doubt in a staff column — the FSPSSM "Default" teachers the inbox shows
 * as grey pills are not persisted assignments, so a doubt that only has defaults reads as
 * Unassigned here. Dropping it on a teacher creates the explicit row.
 */

export const UNASSIGNED_KEY = '__unassigned__';
export const RESOLVED_KEY = '__resolved__';

export type BoardColumnKind = 'unassigned' | 'staff' | 'resolved' | 'status';

/** How the board is laid out: one column per assignee, or one per workflow status. */
export type BoardGroupBy = 'assignee' | 'status';

export interface BoardColumnDef {
    /** Droppable id. For staff columns this is the assignee's USER id; for status columns the status key. */
    key: string;
    kind: BoardColumnKind;
    name: string;
    /** Role label for staff columns ("Teacher", "Evaluator"). */
    subtitle?: string;
    /** Admin-picked colour for status columns. */
    color?: string | null;
}

export const isSyntheticKey = (key: string) => key === UNASSIGNED_KEY || key === RESOLVED_KEY;

/** Distinct USER ids explicitly assigned to the doubt (the persisted doubt_assignee rows). */
export function explicitAssigneeUserIds(doubt: Pick<Doubt, 'all_doubt_assignee'>): string[] {
    const seen = new Set<string>();
    (doubt.all_doubt_assignee ?? []).forEach((a) => {
        if (a.source === 'USER' && a.source_id) seen.add(a.source_id);
    });
    return [...seen];
}

/**
 * Column key(s) a doubt belongs to. Resolved doubts live only in the Resolved column whatever
 * their assignees; an open doubt with N assignees appears in N staff columns (one card each) so
 * every teacher's column is a complete picture of their queue; no assignee ⇒ Unassigned.
 */
export function columnKeysForDoubt(doubt: Pick<Doubt, 'status' | 'all_doubt_assignee'>): string[] {
    if (doubt.status === 'RESOLVED') return [RESOLVED_KEY];
    const ids = explicitAssigneeUserIds(doubt);
    return ids.length > 0 ? ids : [UNASSIGNED_KEY];
}

/** Group doubts into column buckets. Input order (newest first from the API) is preserved. */
export function groupDoubtsByColumn(doubts: Doubt[]): Map<string, Doubt[]> {
    const groups = new Map<string, Doubt[]>();
    doubts.forEach((doubt) => {
        columnKeysForDoubt(doubt).forEach((key) => {
            const bucket = groups.get(key);
            if (bucket) bucket.push(doubt);
            else groups.set(key, [doubt]);
        });
    });
    return groups;
}

/** Group doubts by their effective workflow status key, in catalog order (unknown keys appended). */
export function groupDoubtsByStatus(
    doubts: Doubt[],
    statuses: WorkflowStatusConfig[]
): Map<string, Doubt[]> {
    const groups = new Map<string, Doubt[]>();
    statuses.forEach((s) => groups.set(s.key, []));
    doubts.forEach((doubt) => {
        const key = effectiveStatusKey(doubt);
        const bucket = groups.get(key);
        if (bucket) bucket.push(doubt);
        else groups.set(key, [doubt]);
    });
    return groups;
}

/** What a drop changes on the doubt. Applied by {@link buildDoubtUpdatePayload}. */
export interface DoubtAssignmentPatch {
    status?: 'ACTIVE' | 'RESOLVED';
    /** Move to this configurable workflow status (the backend derives `status` from its kind). */
    workflowStatus?: string;
    /** Note for the activity trail. */
    remark?: string;
    /** USER ids to add as explicit assignees (already-assigned ids are skipped). */
    addUserIds?: string[];
    /** USER ids whose explicit assignee rows should be deleted. */
    removeUserIds?: string[];
}

export type MoveOutcome =
    | 'assigned'
    | 'reassigned'
    | 'unassigned'
    | 'resolved'
    | 'reopened'
    | 'reopenedAssigned'
    | 'statusChanged';

/** A drop between two STATUS columns: move the doubt to the target workflow status. */
export function planStatusMove(fromKey: string, toKey: string): MovePlan | null {
    if (fromKey === toKey) return null;
    return { patch: { workflowStatus: toKey }, outcome: 'statusChanged' };
}

export interface MovePlan {
    patch: DoubtAssignmentPatch;
    outcome: MoveOutcome;
}

/**
 * Translate "card dragged from column A to column B" into an update. Returns null when the drop
 * is a no-op (same column, or Unassigned → Unassigned).
 *
 * - staff → staff: swap the one assignee (others on the doubt are untouched).
 * - Unassigned → staff: add the assignee.
 * - staff → Unassigned: remove that one assignee. If the doubt has other assignees it simply
 *   stays in their columns — it is not "unassigned" from everyone.
 * - anything → Resolved: mark resolved (assignees kept).
 * - Resolved → Unassigned: reopen, keeping whatever assignees it had.
 * - Resolved → staff: reopen and make sure that staff member is assigned.
 */
export function planMove(fromKey: string, toKey: string): MovePlan | null {
    if (fromKey === toKey) return null;
    if (toKey === RESOLVED_KEY) return { patch: { status: 'RESOLVED' }, outcome: 'resolved' };
    if (fromKey === RESOLVED_KEY) {
        if (toKey === UNASSIGNED_KEY) return { patch: { status: 'ACTIVE' }, outcome: 'reopened' };
        return { patch: { status: 'ACTIVE', addUserIds: [toKey] }, outcome: 'reopenedAssigned' };
    }
    if (fromKey === UNASSIGNED_KEY) {
        return { patch: { addUserIds: [toKey] }, outcome: 'assigned' };
    }
    if (toKey === UNASSIGNED_KEY) {
        return { patch: { removeUserIds: [fromKey] }, outcome: 'unassigned' };
    }
    return { patch: { addUserIds: [toKey], removeUserIds: [fromKey] }, outcome: 'reassigned' };
}

/**
 * The doubt as it will look once the patch is saved — used to place an in-flight card in its new
 * column immediately (optimistic move) by running it through the same grouping as everything
 * else. Added assignees get placeholder row ids; they're never sent back to the server (a doubt
 * with a pending move can't be dragged again until the refetch lands).
 */
export function applyPatchLocally(doubt: Doubt, patch: DoubtAssignmentPatch): Doubt {
    const removeSet = new Set(patch.removeUserIds ?? []);
    const existing = new Set(explicitAssigneeUserIds(doubt));
    const kept = (doubt.all_doubt_assignee ?? []).filter(
        (a) => !(a.source === 'USER' && removeSet.has(a.source_id))
    );
    const added = (patch.addUserIds ?? [])
        .filter((id) => !existing.has(id))
        .map((id) => ({ id: `pending-${id}`, source: 'USER', source_id: id, status: 'ACTIVE' }));
    // A workflow move implies the coarse status through the target's kind; the caller passes the
    // kind via `status` when it knows it (the board does), else keep the current coarse status.
    const workflow_status = patch.workflowStatus
        ? patch.workflowStatus.toUpperCase()
        : patch.status === 'RESOLVED'
          ? RESOLVED_STATUS_KEY
          : patch.status === 'ACTIVE'
            ? PENDING_STATUS_KEY
            : doubt.workflow_status;
    return {
        ...doubt,
        status: patch.status ?? doubt.status,
        workflow_status,
        all_doubt_assignee: [...kept, ...added],
    };
}

/**
 * Full update body for POST /doubts/create?doubtId=… — the backend applies every non-null field,
 * so the unchanged ones are echoed back exactly as TeacherSelection / MarkAsResolved do.
 * `delete_assignee_request` speaks in assignee ROW ids, `doubt_assignee_request_user_ids` in
 * USER ids; the patch is expressed in user ids and mapped here.
 */
export function buildDoubtUpdatePayload(doubt: Doubt, patch: DoubtAssignmentPatch): DoubtType {
    const existingUserIds = new Set(explicitAssigneeUserIds(doubt));
    const addUserIds = (patch.addUserIds ?? []).filter((id) => !existingUserIds.has(id));
    const removeSet = new Set(patch.removeUserIds ?? []);
    const deleteRowIds = (doubt.all_doubt_assignee ?? [])
        .filter((a) => a.source === 'USER' && removeSet.has(a.source_id))
        .map((a) => a.id);
    const status = patch.status ?? doubt.status;

    return {
        id: doubt.id,
        user_id: doubt.user_id,
        name: doubt.name,
        source: doubt.source,
        source_id: doubt.source_id,
        raised_time: doubt.raised_time,
        // Mirror MarkAsResolved: stamp the flip to RESOLVED, clear on reopen, else keep as-is.
        resolved_time:
            patch.status === 'RESOLVED'
                ? new Date().toISOString()
                : patch.status === 'ACTIVE'
                  ? null
                  : doubt.resolved_time,
        content_position: doubt.content_position,
        content_type: doubt.content_type,
        html_text: doubt.html_text,
        status,
        parent_id: doubt.parent_id,
        parent_level: doubt.parent_level,
        doubt_assignee_request_user_ids: addUserIds,
        all_doubt_assignee: doubt.all_doubt_assignee,
        delete_assignee_request: deleteRowIds,
        // Only sent when the move asks for it — echoing the current key back is a no-op anyway,
        // but leaving it out keeps assignment-only updates from touching status at all.
        workflow_status: patch.workflowStatus,
        remark: patch.remark?.trim() || undefined,
    };
}
