import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { GitMerge, ArrowCounterClockwise, MagnifyingGlass, Warning } from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { LEAD_MERGE_BASE } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { invalidateLeadCaches } from '@/hooks/use-invalidate-lead-caches';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    fetchRecentLeads,
    type RecentLeadDetail,
} from '@/routes/audience-manager/list/-services/get-recent-leads';

// ── API ───────────────────────────────────────────────────────────────────────

interface MergedPerson {
    user_id: string;
    name: string | null;
    merged_at: string | null;
    merged_by_user_id: string | null;
    enquiries: number;
}

interface MergeState {
    user_id: string;
    merged_into_user_id: string | null;
    merged_at: string | null;
    merged_people: MergedPerson[];
}

interface MergeEnquiry {
    response_id: string;
    list_name: string | null;
    name: string | null;
    phone: string | null;
    email: string | null;
    source_type: string | null;
    status_key: string | null;
    audience_status: string | null;
    submitted_at: string | null;
}

interface MergePerson {
    user_id: string;
    profile_id: string;
    name: string | null;
    conversion_status: string | null;
    lead_tier: string | null;
    counsellor_name: string | null;
    created_at: string | null;
    enquiries: MergeEnquiry[];
}

interface MergePreview {
    keep: MergePerson | null;
    duplicate: MergePerson | null;
    can_merge: boolean;
    refusals: { code: string; message: string }[];
    effects: string[];
}

const stateKey = (userId: string, instituteId: string) => ['lead-merge-state', userId, instituteId];

async function fetchMergeState(userId: string, instituteId: string): Promise<MergeState> {
    const { data } = await authenticatedAxiosInstance.get<MergeState>(`${LEAD_MERGE_BASE}/state`, {
        params: { instituteId, userId },
    });
    return data;
}

async function fetchMergePreview(
    keepUserId: string,
    duplicateUserId: string,
    instituteId: string
): Promise<MergePreview> {
    const { data } = await authenticatedAxiosInstance.get<MergePreview>(
        `${LEAD_MERGE_BASE}/preview`,
        { params: { instituteId, keepUserId, duplicateUserId } }
    );
    return data;
}

function errorText(err: unknown, fallback: string): string {
    const data = (err as { response?: { data?: { ex?: string; message?: string } } })?.response
        ?.data;
    return data?.ex || data?.message || fallback;
}

function refreshBoth(queryClient: QueryClient, a: string, b: string) {
    invalidateLeadCaches(queryClient, a);
    invalidateLeadCaches(queryClient, b);
    queryClient.invalidateQueries({ queryKey: ['lead-merge-state'] });
}

function day(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : format(d, 'd MMM yyyy');
}

// ── Merge state on a lead's details ───────────────────────────────────────────

/**
 * Merge state on a lead's details: a note when this person was merged into someone else, the
 * people merged into them, and (for admins) the merge and undo actions.
 */
export function LeadMergeSection({ userId, personName }: { userId: string; personName?: string }) {
    const instituteId = getCurrentInstituteId() ?? '';
    const isAdmin = isAdminForInstitute(instituteId);
    const queryClient = useQueryClient();
    const [mergeOpen, setMergeOpen] = useState(false);

    const { data: state } = useQuery({
        queryKey: stateKey(userId, instituteId),
        queryFn: () => fetchMergeState(userId, instituteId),
        enabled: !!userId && !!instituteId,
        staleTime: 60 * 1000,
        retry: 0,
    });

    const undo = useMutation({
        mutationFn: async (duplicateUserId: string) => {
            await authenticatedAxiosInstance.post(
                `${LEAD_MERGE_BASE}/undo`,
                { duplicate_user_id: duplicateUserId },
                { params: { instituteId } }
            );
            return duplicateUserId;
        },
        onSuccess: (duplicateUserId) => {
            toast.success('Merge undone. Their enquiries moved back.');
            refreshBoth(queryClient, userId, duplicateUserId);
            if (state?.merged_into_user_id) {
                invalidateLeadCaches(queryClient, state.merged_into_user_id);
            }
        },
        onError: (err) => toast.error(errorText(err, 'Could not undo the merge.')),
    });

    const mergedInto = state?.merged_into_user_id ?? null;
    const mergedPeople = state?.merged_people ?? [];

    if (mergedInto) {
        return (
            <div className="rounded-xl border border-warning-200 bg-warning-50 p-4">
                <div className="flex items-start gap-2">
                    <GitMerge weight="bold" className="mt-0.5 size-4 shrink-0 text-warning-700" />
                    <div className="flex-1">
                        <p className="text-sm font-medium text-warning-700">
                            Merged into another person
                        </p>
                        <p className="mt-0.5 text-xs text-warning-700">
                            Their enquiries moved on {day(state?.merged_at)}. This profile no longer
                            counts as a lead or an admission.
                        </p>
                    </div>
                    {isAdmin && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disabled={undo.isPending}
                            onClick={() => undo.mutate(userId)}
                        >
                            <ArrowCounterClockwise className="size-3.5" />
                            {undo.isPending ? 'Undoing…' : 'Undo merge'}
                        </MyButton>
                    )}
                </div>
            </div>
        );
    }

    if (!isAdmin && mergedPeople.length === 0) return null;

    return (
        <div className="rounded-xl border border-neutral-100 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <GitMerge weight="bold" className="size-4 text-neutral-500" />
                    <p className="text-sm font-medium text-neutral-700">Duplicates</p>
                </div>
                {isAdmin && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setMergeOpen(true)}
                    >
                        Merge duplicate
                    </MyButton>
                )}
            </div>
            {mergedPeople.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-2">
                    {mergedPeople.map((p) => (
                        <li
                            key={p.user_id}
                            className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2"
                        >
                            <div className="min-w-0">
                                <p className="truncate text-sm text-neutral-700">
                                    {p.name || 'Unnamed person'}
                                </p>
                                <p className="text-xs text-neutral-500">
                                    Merged in {day(p.merged_at)} · {p.enquiries}{' '}
                                    {p.enquiries === 1 ? 'enquiry' : 'enquiries'}
                                </p>
                            </div>
                            {isAdmin && (
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    disabled={undo.isPending}
                                    onClick={() => undo.mutate(p.user_id)}
                                >
                                    Undo
                                </MyButton>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mt-2 text-xs text-neutral-500">
                    Entered twice? Merge the other record into this person so they count once.
                </p>
            )}
            {isAdmin && (
                <MergeDuplicateDialog
                    open={mergeOpen}
                    onOpenChange={setMergeOpen}
                    keepUserId={userId}
                    keepName={personName}
                />
            )}
        </div>
    );
}

// ── The merge dialog ──────────────────────────────────────────────────────────

function leadName(l: RecentLeadDetail): string {
    return l.user?.full_name || l.parent_name || 'Unnamed lead';
}

function PersonColumn({
    title,
    person,
    tone,
}: {
    title: string;
    person: MergePerson;
    tone: 'keep' | 'dup';
}) {
    return (
        <div
            className={
                tone === 'keep'
                    ? 'flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-success-200 bg-success-50 p-3'
                    : 'flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3'
            }
        >
            <p className="text-xs font-medium uppercase text-neutral-500">{title}</p>
            <p className="truncate text-sm font-semibold text-neutral-800">
                {person.name || 'Unnamed person'}
            </p>
            <p className="text-xs text-neutral-600">
                Status {person.conversion_status || 'LEAD'}
                {person.counsellor_name ? ` · ${person.counsellor_name}` : ''}
            </p>
            <ul className="flex flex-col gap-1.5">
                {person.enquiries.map((e) => (
                    <li key={e.response_id} className="rounded-md bg-white px-2 py-1.5 text-xs">
                        <p className="truncate font-medium text-neutral-700">
                            {e.list_name || 'Lead list'}
                            {e.audience_status && e.audience_status !== 'ACTIVE'
                                ? ' (deleted)'
                                : ''}
                        </p>
                        <p className="truncate text-neutral-500">
                            {[e.phone, e.email].filter(Boolean).join(' · ') || 'No contact'}
                        </p>
                        <p className="text-neutral-400">
                            {day(e.submitted_at)}
                            {e.status_key ? ` · ${e.status_key}` : ''}
                        </p>
                    </li>
                ))}
                {person.enquiries.length === 0 && (
                    <li className="text-xs text-neutral-500">No enquiries here.</li>
                )}
            </ul>
        </div>
    );
}

export function MergeDuplicateDialog({
    open,
    onOpenChange,
    keepUserId,
    keepName,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    keepUserId: string;
    keepName?: string;
}) {
    const instituteId = getCurrentInstituteId() ?? '';
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [applied, setApplied] = useState('');
    const [duplicateUserId, setDuplicateUserId] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setSearch('');
            setApplied('');
            setDuplicateUserId(null);
        }
    }, [open]);

    useEffect(() => {
        const t = setTimeout(() => setApplied(search.trim()), 350);
        return () => clearTimeout(t);
    }, [search]);

    const results = useQuery({
        queryKey: ['lead-merge-search', instituteId, applied],
        queryFn: () =>
            fetchRecentLeads({
                institute_id: instituteId,
                search_query: applied,
                page: 0,
                size: 10,
            }),
        enabled: open && !!instituteId && applied.length >= 3 && !duplicateUserId,
        staleTime: 30 * 1000,
    });
    const candidates = (results.data?.content ?? []).filter(
        (l) => l.user_id && l.user_id !== keepUserId
    );

    const preview = useQuery({
        queryKey: ['lead-merge-preview', keepUserId, duplicateUserId, instituteId],
        queryFn: () => fetchMergePreview(keepUserId, duplicateUserId ?? '', instituteId),
        enabled: open && !!duplicateUserId && !!instituteId,
        staleTime: 0,
    });

    const merge = useMutation({
        mutationFn: async () => {
            const { data } = await authenticatedAxiosInstance.post<{ enquiries_moved: number }>(
                LEAD_MERGE_BASE,
                { keep_user_id: keepUserId, duplicate_user_id: duplicateUserId },
                { params: { instituteId } }
            );
            return data;
        },
        onSuccess: (data) => {
            const n = data?.enquiries_moved ?? 0;
            toast.success(
                `Merged. ${n} ${n === 1 ? 'enquiry' : 'enquiries'} moved to this person.`
            );
            if (duplicateUserId) refreshBoth(queryClient, keepUserId, duplicateUserId);
            onOpenChange(false);
        },
        onError: (err) => toast.error(errorText(err, 'Could not merge these people.')),
    });

    const plan = preview.data;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        Merge a duplicate{keepName ? ` into ${keepName}` : ''}
                    </DialogTitle>
                    <DialogDescription>
                        Use this when the same person was entered twice. The duplicate’s enquiries
                        move to this person, and the duplicate stops counting as a lead.
                    </DialogDescription>
                </DialogHeader>

                {!duplicateUserId ? (
                    <div className="flex flex-col gap-2">
                        <div className="relative">
                            <MagnifyingGlass className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                            <Input
                                autoFocus
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search the duplicate by name, phone or email"
                                className="ps-9"
                                name="lead-merge-search-nofill"
                                autoComplete="off"
                            />
                        </div>
                        {applied.length > 0 && applied.length < 3 && (
                            <p className="text-xs text-neutral-500">Type at least 3 characters.</p>
                        )}
                        {results.isFetching && (
                            <p className="text-xs text-neutral-500">Searching…</p>
                        )}
                        {!results.isFetching && applied.length >= 3 && candidates.length === 0 && (
                            <p className="text-xs text-neutral-500">No other lead matches.</p>
                        )}
                        {candidates.length > 0 && (
                            <ul className="max-h-72 overflow-y-auto rounded-md border border-neutral-200">
                                {candidates.map((l) => (
                                    <li key={l.response_id}>
                                        <button
                                            type="button"
                                            onClick={() => setDuplicateUserId(l.user_id ?? null)}
                                            className="w-full border-b border-neutral-100 px-3 py-2 text-start transition-colors last:border-0 hover:bg-neutral-50"
                                        >
                                            <p className="text-sm font-medium text-neutral-800">
                                                {leadName(l)}
                                            </p>
                                            <p className="text-xs text-neutral-500">
                                                {[
                                                    l.user?.mobile_number || l.parent_mobile,
                                                    l.user?.email || l.parent_email,
                                                    l.campaign_name,
                                                ]
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                            </p>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {preview.isLoading && (
                            <p className="text-sm text-neutral-500">Checking these two people…</p>
                        )}
                        {preview.isError && (
                            <p className="text-sm text-danger-600">
                                {errorText(preview.error, 'Could not check these two people.')}
                            </p>
                        )}
                        {plan && plan.refusals.length > 0 && (
                            <div className="rounded-lg border border-danger-200 bg-danger-50 p-3">
                                <div className="flex items-center gap-2">
                                    <Warning weight="bold" className="size-4 text-danger-600" />
                                    <p className="text-sm font-medium text-danger-700">
                                        These two can’t be merged here
                                    </p>
                                </div>
                                <ul className="mt-1 list-disc ps-6 text-xs text-danger-700">
                                    {plan.refusals.map((r) => (
                                        <li key={r.code}>{r.message}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {plan?.keep && plan?.duplicate && (
                            <div className="flex flex-col gap-3 sm:flex-row">
                                <PersonColumn title="Keep" person={plan.keep} tone="keep" />
                                <PersonColumn
                                    title="Duplicate"
                                    person={plan.duplicate}
                                    tone="dup"
                                />
                            </div>
                        )}
                        {plan?.can_merge && plan.effects.length > 0 && (
                            <ul className="list-disc ps-5 text-xs text-neutral-600">
                                {plan.effects.map((e) => (
                                    <li key={e}>{e}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2">
                    {duplicateUserId && (
                        <MyButton
                            buttonType="text"
                            onClick={() => setDuplicateUserId(null)}
                            disabled={merge.isPending}
                        >
                            Pick someone else
                        </MyButton>
                    )}
                    <MyButton
                        buttonType="secondary"
                        onClick={() => onOpenChange(false)}
                        disabled={merge.isPending}
                    >
                        Cancel
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        disabled={!plan?.can_merge || merge.isPending}
                        onClick={() => merge.mutate()}
                    >
                        {merge.isPending ? 'Merging…' : 'Merge'}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
