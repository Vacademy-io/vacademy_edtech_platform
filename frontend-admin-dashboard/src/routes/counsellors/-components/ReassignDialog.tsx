import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { CounsellorRatingBadge } from '@/components/counsellor/CounsellorRatingBadge';
import { toast } from 'sonner';
import {
    commitReassign,
    previewReassign,
    type ReassignMode,
    type ReassignResult,
    type WorkbenchCounsellor,
    type WorkbenchLead,
} from '../-services/counsellor-workbench-services';

interface Props {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    instituteId: string;
    fromUserId: string | null;
    fromUserName: string | null;
    /** Open-leads pre-populated by the inactive-toggle response (or empty when invoked from a single lead row).
     *  NOTE: capped at the fetch page size (500) — display/preview only when {@link reassignAll} is set. */
    openLeads: WorkbenchLead[];
    /** All counsellors in the team subtree — for the SINGLE picker and the MANUAL overrides. */
    candidates: WorkbenchCounsellor[];
    /**
     * When true the commit moves EVERY open lead of the source counsellor —
     * the backend resolves the full set itself (no lead_ids whitelist, no 500
     * cap). Used by the counsellor-level flows (mark inactive, Reassign
     * leads). Per-row reassign keeps it false so a single-row action can't
     * sweep the whole pipeline.
     */
    reassignAll?: boolean;
    /** True total of open leads (from the paginated fetch) — may exceed openLeads.length. */
    totalOpenLeads?: number;
    /**
     * When true the dialog confirms a reassign-AND-mark-inactive in one step:
     * the backend flips the source counsellor's pool memberships INACTIVE
     * inside the same transaction as the assignment commit. Cancelling the
     * dialog leaves the counsellor untouched (no inactive flip happens).
     */
    markInactive?: boolean;
    onComplete?: () => void;
    /**
     * Take the counsellor offline WITHOUT reassigning — leaves their leads
     * assigned to them as-is. Only surfaced in the markInactive flow when
     * there are leads (with none, the primary button already just flips
     * inactive). The parent owns the status call + dialog close.
     */
    onMarkInactiveWithoutReassign?: () => Promise<void> | void;
}

/**
 * Reassign dialog with three modes:
 *   SINGLE       — pick one target; backend moves all openLeads there.
 *   ROUND_ROBIN  — backend spreads openLeads across active counsellors.
 *   MANUAL       — preview row-by-row, override each target inline.
 *
 * The MANUAL flow fires /reassign/preview first to render the proposed
 * mapping, then sends MANUAL with the (possibly-edited) assignments back.
 */
export function ReassignDialog({
    open,
    onOpenChange,
    instituteId,
    fromUserId,
    fromUserName,
    openLeads,
    candidates,
    reassignAll = false,
    totalOpenLeads,
    markInactive = false,
    onComplete,
    onMarkInactiveWithoutReassign,
}: Props) {
    const { t } = useTranslation('counsellorsReassignDialog');
    const [mode, setMode] = useState<ReassignMode>('SINGLE');
    const [target, setTarget] = useState<string>('');
    const [preview, setPreview] = useState<ReassignResult | null>(null);
    const [perRowOverrides, setPerRowOverrides] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [skipping, setSkipping] = useState(false);

    // Pool-activeness is a PREFERENCE, not a gate: institutes that don't use
    // counselor pools have zero "active" members, and the old hard filter
    // left this dropdown empty — making reassignment impossible. Actives sort
    // first; offline counsellors stay pickable, labelled "(offline)".
    const targets = useMemo(
        () =>
            candidates
                .filter((c) => c.user_id !== fromUserId)
                .sort((a, b) => Number(b.is_active) - Number(a.is_active)),
        [candidates, fromUserId]
    );
    const activeTargetCount = useMemo(() => targets.filter((t) => t.is_active).length, [targets]);

    useEffect(() => {
        if (open) {
            setMode('SINGLE');
            setTarget('');
            setPreview(null);
            setPerRowOverrides({});
            setSubmitting(false);
            setSkipping(false);
        }
    }, [open]);

    async function skipReassignAndMarkInactive() {
        if (!onMarkInactiveWithoutReassign) return;
        setSkipping(true);
        try {
            await onMarkInactiveWithoutReassign();
        } finally {
            setSkipping(false);
        }
    }

    async function loadPreview(nextMode: ReassignMode) {
        if (!fromUserId) return;
        try {
            const r = await previewReassign({
                institute_id: instituteId,
                from_user_id: fromUserId,
                mode: nextMode,
            });
            setPreview(r);
            const seed: Record<string, string> = {};
            r.assignments.forEach((a) => (seed[a.lead_id] = a.to_user_id));
            setPerRowOverrides(seed);
        } catch (e) {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.previewFailed'));
        }
    }

    // True count of open leads — openLeads is capped at the fetch page size
    // (500), so counsellor-level flows show/move the real total instead.
    const totalCount = totalOpenLeads ?? openLeads.length;

    async function submit() {
        if (!fromUserId) return;
        setSubmitting(true);
        try {
            let result;
            // reassignAll (counsellor-level flows): send NO lead_ids — the
            // backend resolves and moves EVERY open lead of the source
            // counsellor in one transaction, so nothing is left behind by the
            // 500-row fetch cap. Per-row reassign keeps the whitelist so a
            // single-row action can't sweep the whole pipeline.
            const scopeIds = reassignAll ? undefined : openLeads.map((l) => l.lead_id);
            // Reassign-first edge case: marking inactive with no open leads —
            // backend short-circuits before evaluating mode-specific args, so
            // we send a no-op SINGLE request without a target. The flip still
            // happens server-side.
            if (markInactive && openLeads.length === 0) {
                result = await commitReassign({
                    institute_id: instituteId,
                    from_user_id: fromUserId,
                    mode: 'SINGLE',
                    mark_inactive: true,
                });
            } else if (mode === 'SINGLE') {
                if (!target) {
                    toast.error(t('toast.pickTarget'));
                    setSubmitting(false);
                    return;
                }
                result = await commitReassign({
                    institute_id: instituteId,
                    from_user_id: fromUserId,
                    mode: 'SINGLE',
                    target_user_id: target,
                    lead_ids: scopeIds,
                    mark_inactive: markInactive,
                });
            } else if (mode === 'ROUND_ROBIN') {
                result = await commitReassign({
                    institute_id: instituteId,
                    from_user_id: fromUserId,
                    mode: 'ROUND_ROBIN',
                    lead_ids: scopeIds,
                    mark_inactive: markInactive,
                });
            } else {
                if (!preview) {
                    toast.error(t('toast.generatePreviewFirst'));
                    setSubmitting(false);
                    return;
                }
                result = await commitReassign({
                    institute_id: instituteId,
                    from_user_id: fromUserId,
                    mode: 'MANUAL',
                    assignments: Object.entries(perRowOverrides).map(([lead_id, to_user_id]) => ({
                        lead_id,
                        to_user_id,
                    })),
                    // MANUAL always scopes to exactly the previewed set — a
                    // lead that drifted in after the preview has no target and
                    // would fail the whole batch if the backend swept it up.
                    lead_ids: Object.keys(perRowOverrides),
                    mark_inactive: markInactive,
                });
            }
            // Toast varies by whether the counsellor was also taken offline,
            // so the manager gets a single clear confirmation of what
            // actually happened in the same transaction. Count comes from the
            // backend result — the authoritative number of leads moved (the
            // dialog's openLeads list is capped at 500 for display).
            const n = result.total_leads;
            if (markInactive && result.marked_inactive) {
                toast.success(
                    n > 0
                        ? t('toast.reassignedAndMarkedInactive', { count: n })
                        : t('toast.markedInactive')
                );
            } else {
                toast.success(t('toast.reassignedCount', { count: n }));
            }
            onComplete?.();
            onOpenChange(false);
        } catch (e) {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.reassignFailed'));
        } finally {
            setSubmitting(false);
        }
    }

    const openLeadsById = useMemo(() => {
        const m = new Map<string, WorkbenchLead>();
        openLeads.forEach((l) => m.set(l.lead_id, l));
        return m;
    }, [openLeads]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* The dialog now fills most of the screen for the manual flow
                (which can list dozens of leads), but we cap it at 85vh so the
                header / mode picker / footer stay anchored while the body
                scrolls inside. `flex flex-col` + `min-h-0` on the body is the
                Tailwind dance that lets an inner scroll-container actually
                shrink — without min-h-0 the body grows to its content height
                and overflows the viewport instead of scrolling. */}
            <DialogContent className="flex max-h-[85vh] w-[95vw] max-w-5xl flex-col gap-0 p-0">
                <DialogHeader className="border-b border-neutral-200 px-6 py-4">
                    <DialogTitle>
                        {markInactive
                            ? t('title.markInactive', {
                                  name: fromUserName ?? t('fallback.counsellor'),
                              })
                            : fromUserName
                              ? t('title.reassignFrom', { count: totalCount, name: fromUserName })
                              : t('title.reassign', { count: totalCount })}
                    </DialogTitle>
                    {markInactive && (
                        <p className="mt-1 text-caption text-neutral-500">
                            {openLeads.length === 0
                                ? t('markInactive.noLeads', {
                                      name: fromUserName ?? t('fallback.they'),
                                  })
                                : t('markInactive.withLeads', { count: totalCount })}
                        </p>
                    )}
                    {reassignAll && totalCount > openLeads.length && (
                        <p className="mt-1 text-caption text-neutral-500">
                            {t('showingFirstOf', { shown: openLeads.length, total: totalCount })}
                        </p>
                    )}
                </DialogHeader>

                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
                    {/* Skip the mode picker entirely when there's nothing to
                        move — the dialog is then just a confirmation for the
                        atomic inactive flip. */}
                    {!(markInactive && openLeads.length === 0) && (
                        <ModeChoice
                            mode={mode}
                            onChange={(m) => {
                                setMode(m);
                                if (m === 'MANUAL') loadPreview('ROUND_ROBIN');
                            }}
                            t={t}
                        />
                    )}

                    {!(markInactive && openLeads.length === 0) && mode === 'SINGLE' && (
                        <div>
                            <label className="mb-1 block text-caption font-medium text-neutral-700">
                                {openLeads.length === 1 ? t('moveTo') : t('moveAllTo')}
                            </label>
                            <select
                                className="w-full rounded border border-neutral-300 px-3 py-2"
                                value={target}
                                onChange={(e) => setTarget(e.target.value)}
                            >
                                <option value="">{t('selectCounsellorPlaceholder')}</option>
                                {targets.map((c) => (
                                    <option key={c.user_id} value={c.user_id}>
                                        {c.full_name ?? c.user_id}
                                        {c.is_active ? '' : ` ${t('offlineLabel')}`}
                                        {c.rating != null
                                            ? ` ${t('ratingSuffix', { rating: Math.round(c.rating) })}`
                                            : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {mode === 'ROUND_ROBIN' && (
                        <p className="rounded border border-info-200 bg-primary-50 px-3 py-2 text-subtitle text-neutral-700">
                            {/* Mirrors the backend rule: prefer active counsellors,
                                fall back to everyone when none are pool-active. */}
                            {activeTargetCount > 0
                                ? t('roundRobinActive', { count: activeTargetCount })
                                : t('roundRobinAll', { count: targets.length })}
                        </p>
                    )}

                    {mode === 'MANUAL' && (
                        <ManualPreviewTable
                            instituteId={instituteId}
                            preview={preview}
                            overrides={perRowOverrides}
                            setOverrides={setPerRowOverrides}
                            candidates={targets}
                            openLeadsById={openLeadsById}
                            onReshufflePreview={() => loadPreview('ROUND_ROBIN')}
                            t={t}
                        />
                    )}
                </div>

                <DialogFooter className="border-t border-neutral-200 px-6 py-4">
                    <MyButton
                        buttonType="secondary"
                        onClick={() => onOpenChange(false)}
                        disable={submitting || skipping}
                    >
                        {t('cancel')}
                    </MyButton>
                    {/* Take the counsellor offline but leave their leads where
                        they are — only meaningful when there ARE leads (with
                        none, the primary button already just flips inactive). */}
                    {markInactive && openLeads.length > 0 && onMarkInactiveWithoutReassign && (
                        <MyButton
                            buttonType="secondary"
                            onClick={skipReassignAndMarkInactive}
                            disable={submitting || skipping}
                        >
                            {skipping ? t('markingInactive') : t('markInactiveWithoutReassign')}
                        </MyButton>
                    )}
                    <MyButton buttonType="primary" onClick={submit} disable={submitting || skipping}>
                        {submitting
                            ? markInactive
                                ? t('working')
                                : t('reassigning')
                            : markInactive
                              ? openLeads.length === 0
                                  ? t('confirmMarkInactive')
                                  : t('reassignAndMarkInactive')
                              : t('confirmReassign')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ModeChoice({
    mode,
    onChange,
    t,
}: {
    mode: ReassignMode;
    onChange: (m: ReassignMode) => void;
    t: TFunction;
}) {
    return (
        <div className="grid grid-cols-3 gap-2">
            {(['SINGLE', 'ROUND_ROBIN', 'MANUAL'] as ReassignMode[]).map((m) => (
                <button
                    key={m}
                    type="button"
                    onClick={() => onChange(m)}
                    className={`rounded border p-2 text-start text-subtitle ${
                        mode === m
                            ? 'border-primary-400 bg-primary-50 text-primary-700'
                            : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                    }`}
                >
                    <div className="font-medium">{labelFor(m, t)}</div>
                    <div className="text-caption text-neutral-500">{descriptionFor(m, t)}</div>
                </button>
            ))}
        </div>
    );
}

function labelFor(m: ReassignMode, t: TFunction) {
    return m === 'SINGLE'
        ? t('modeLabel.single')
        : m === 'ROUND_ROBIN'
          ? t('modeLabel.roundRobin')
          : t('modeLabel.manual');
}
function descriptionFor(m: ReassignMode, t: TFunction) {
    return m === 'SINGLE'
        ? t('modeDescription.single')
        : m === 'ROUND_ROBIN'
          ? t('modeDescription.roundRobin')
          : t('modeDescription.manual');
}

function ManualPreviewTable({
    instituteId,
    preview,
    overrides,
    setOverrides,
    candidates,
    openLeadsById,
    onReshufflePreview,
    t,
}: {
    instituteId: string;
    preview: ReassignResult | null;
    overrides: Record<string, string>;
    setOverrides: (next: Record<string, string>) => void;
    candidates: WorkbenchCounsellor[];
    openLeadsById: Map<string, WorkbenchLead>;
    onReshufflePreview: () => void;
    t: TFunction;
}) {
    if (!preview) {
        return <div className="p-4 text-subtitle text-neutral-500">{t('generatingPreview')}</div>;
    }
    if (preview.assignments.length === 0) {
        return (
            <div className="rounded border border-dashed border-neutral-300 p-6 text-center text-subtitle text-neutral-500">
                {t('noOpenLeads')}
            </div>
        );
    }
    return (
        // Only the table body needs to scroll independently — the parent
        // dialog body provides the vertical scroll. The sticky header keeps
        // the "Lead | Target counsellor" labels visible while the manager
        // scrolls through dozens of rows. `overflow-x-auto` survives narrow
        // viewports without forcing the parent into double-scroll.
        <div className="overflow-x-auto rounded border border-neutral-200">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-3 py-2">
                <span className="text-caption text-neutral-500">
                    {t('leadsAdjustTargets', { count: preview.assignments.length })}
                </span>
                <MyButton buttonType="secondary" scale="small" onClick={onReshufflePreview}>
                    {t('reshuffle')}
                </MyButton>
            </div>
            <table className="w-full text-body">
                <thead className="bg-neutral-50 text-caption uppercase tracking-wide text-neutral-500">
                    <tr>
                        <th className="px-3 py-2 text-start">{t('tableLead')}</th>
                        <th className="px-3 py-2 text-start">{t('tableTargetCounsellor')}</th>
                    </tr>
                </thead>
                <tbody>
                    {preview.assignments.map((a) => {
                        const full = openLeadsById.get(a.lead_id);
                        const name = full?.lead_name ?? a.lead_name ?? '—';
                        const email = full?.lead_email;
                        const phone = full?.lead_phone;
                        return (
                        <tr key={a.lead_id} className="border-t border-neutral-100">
                            <td className="px-3 py-2.5 text-neutral-900">
                                <div className="font-medium">{name}</div>
                                {(email || phone) && (
                                    <div className="text-caption text-neutral-500">
                                        {email}
                                        {email && phone ? ' · ' : ''}
                                        {phone}
                                    </div>
                                )}
                            </td>
                            <td className="px-3 py-2.5">
                                <div className="flex items-center gap-2">
                                    <select
                                        className="flex-1 rounded border border-neutral-300 px-2 py-1"
                                        value={overrides[a.lead_id] ?? a.to_user_id}
                                        onChange={(e) =>
                                            setOverrides({
                                                ...overrides,
                                                [a.lead_id]: e.target.value,
                                            })
                                        }
                                    >
                                        {candidates.map((c) => (
                                            <option key={c.user_id} value={c.user_id}>
                                                {c.full_name ?? c.user_id}
                                                {c.is_active ? '' : ` ${t('offlineLabel')}`}
                                            </option>
                                        ))}
                                    </select>
                                    <CounsellorRatingBadge
                                        instituteId={instituteId}
                                        userId={overrides[a.lead_id] ?? a.to_user_id}
                                        size="sm"
                                    />
                                </div>
                            </td>
                        </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
