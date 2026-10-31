import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { COURSE_CATALOG_URL, GET_INVITE_LINKS, GET_SINGLE_INVITE_DETAILS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
    MagnifyingGlass,
    Plus,
    X,
    CaretDown,
    CircleNotch,
    CheckCircle,
    ArrowsClockwise,
    Network,
    ArrowUp,
    ArrowDown,
    SortAscending,
    SortDescending,
} from '@phosphor-icons/react';
import type { MappingRow } from '../-types/product-page-types';
import { SuggestionsPanel } from './SuggestionsPanel';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;
// Well above the largest page today (296 invites). For staff limited to certain
// invites the server filters after paging and reports that page as the last,
// so for them nothing past the first page is fetched.
const INVITE_BATCH_PAGE_SIZE = 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CourseSearchItem {
    id: string;
    package_name: string;
    package_session_id: string;
    package_session_name?: string | null;
    level_id: string;
    level_name: string;
    session_id?: string;
    session_name?: string;
}

interface CourseSearchResponse {
    content: CourseSearchItem[];
    totalElements: number;
    last: boolean;
    number: number;
}

interface EnrollInvite {
    id: string;
    name: string;
    invite_code: string;
    /** Only the sessions that were asked for, not every session on the invite. */
    package_session_ids?: string[];
}

const NO_INVITES: EnrollInvite[] = [];

interface PackageSessionPaymentOption {
    id: string; // ps_invite_payment_option_id
    package_session_id: string;
    payment_option: {
        id: string;
        payment_plans: {
            id: string;
            name: string;
            actual_price: number;
            elevated_price: number;
            currency: string;
            validity_in_days: number;
        }[];
    };
}

interface InviteDetails extends EnrollInvite {
    package_session_to_payment_options: PackageSessionPaymentOption[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSessionLabel(t: TFunction) {
    return (s: CourseSearchItem) => {
        const level = s.level_name;
        const session = s.session_name || s.package_session_name;
        if (level && session) return `${level} · ${session}`;
        if (level) return level;
        if (session) return session;
        return t('sessionLabelDefault');
    };
}

function useDebounce<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timeoutId = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timeoutId);
    }, [value, delay]);
    return debounced;
}

// ─── Sub-component: one selected course row ───────────────────────────────────

interface SelectedRowProps {
    row: MappingRow;
    session: CourseSearchItem | undefined;
    /** This session's invites, from the parent's single batched list call. */
    invites: EnrollInvite[];
    invitesLoading: boolean;
    onChange: (updated: MappingRow) => void;
    onRemove: () => void;
    index: number;
    /** Step up (-1) / down (+1). Absent = no reorder arrows. */
    onMove?: (direction: -1 | 1) => void;
    isFirst?: boolean;
    isLast?: boolean;
}

const SelectedRow = ({
    row,
    session,
    invites,
    invitesLoading,
    onChange,
    onRemove,
    index,
    onMove,
    isFirst = false,
    isLast = false,
}: SelectedRowProps) => {
    const { t } = useTranslation('managePagesCourseSessionSelector');
    const sessionLabel = useMemo(() => buildSessionLabel(t), [t]);
    const instituteId = getCurrentInstituteId() || getInstituteId() || '';
    const [showInviteDropdown, setShowInviteDropdown] = useState(false);

    // Saved rows arrive without a name; the batched list already has it.
    const inviteName = row.inviteName || invites.find((i) => i.id === row.inviteId)?.name;

    // Full invite details are only needed to resolve a row that has no payment
    // option yet (a new row, or one whose invite was just changed). Saved rows
    // already carry option, plan and price from the product page response.
    const { data: inviteDetails, isLoading: detailsLoading } = useQuery({
        queryKey: ['PP_INVITE_DETAILS', row.inviteId, instituteId],
        queryFn: async () => {
            const url = GET_SINGLE_INVITE_DETAILS.replace('{instituteId}', instituteId).replace(
                '{enrollInviteId}',
                row.inviteId
            );
            const res = await authenticatedAxiosInstance.get(url);
            return res.data as InviteDetails;
        },
        enabled: !!row.inviteId && !row.psInvitePaymentOptionId && !!instituteId,
        staleTime: 5 * 60 * 1000,
    });

    // Auto-set first invite + plan when row is incomplete
    useEffect(() => {
        if (row.inviteId || !invites.length) return;
        // Auto-select first invite
        const firstInvite = invites[0]!;
        onChange({ ...row, inviteId: firstInvite.id, inviteName: firstInvite.name });
    }, [invites, row.inviteId]);

    useEffect(() => {
        if (!inviteDetails || row.psInvitePaymentOptionId) return;
        // Find the ps option for this session
        const psOption = inviteDetails.package_session_to_payment_options.find(
            (o) => o.package_session_id === row.packageSessionId
        );
        if (!psOption) return;
        const firstPlan = psOption.payment_option.payment_plans[0];
        if (!firstPlan) return;
        onChange({
            ...row,
            psInvitePaymentOptionId: psOption.id,
            paymentPlanId: firstPlan.id,
            paymentPlanName: firstPlan.name,
            paymentPlanPrice: firstPlan.actual_price,
            currency: firstPlan.currency,
            inviteName: inviteDetails.name,
        });
    }, [inviteDetails, row.psInvitePaymentOptionId]);

    const handleChangeInvite = useCallback(
        (invite: EnrollInvite) => {
            setShowInviteDropdown(false);
            // Reset ps option so the details-effect will re-resolve it
            onChange({
                ...row,
                inviteId: invite.id,
                inviteName: invite.name,
                psInvitePaymentOptionId: '',
                paymentPlanId: '',
                paymentPlanName: '',
                paymentPlanPrice: 0,
                currency: '',
            });
        },
        [row, onChange]
    );

    const isReady = !!row.psInvitePaymentOptionId && !!row.paymentPlanId;
    const isLoading = invitesLoading || detailsLoading;

    return (
        <div
            className={`relative rounded-xl border bg-white p-4 shadow-sm transition-all ${
                isReady ? 'border-neutral-200' : 'border-warning-200'
            }`}
        >
            {/* Row header */}
            <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-600">
                        {index + 1}
                    </span>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-neutral-800">
                            {session
                                ? `${session.package_name} · ${sessionLabel(session)}`
                                : row.packageSessionId.slice(0, 16) + '…'}
                        </p>
                        {isLoading && (
                            <span className="flex items-center gap-1 text-2xs text-neutral-400">
                                <CircleNotch className="size-3 animate-spin" />
                                {t('selectedRow.loadingInvite')}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {isReady && !isLoading && <CheckCircle className="size-4 text-success-500" />}
                    {onMove && (
                        <div className="flex items-center">
                            <button
                                type="button"
                                onClick={() => onMove(-1)}
                                disabled={isFirst}
                                aria-label={t('selectedRow.moveUp', 'Move up')}
                                title={t('selectedRow.moveUp', 'Move up')}
                                className="flex size-6 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                                <ArrowUp className="size-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => onMove(1)}
                                disabled={isLast}
                                aria-label={t('selectedRow.moveDown', 'Move down')}
                                title={t('selectedRow.moveDown', 'Move down')}
                                className="flex size-6 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                                <ArrowDown className="size-3.5" />
                            </button>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={onRemove}
                        className="flex size-6 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-danger-50 hover:text-danger-500"
                    >
                        <X className="size-3.5" />
                    </button>
                </div>
            </div>

            {/* Invite selector + price */}
            <div className="flex flex-wrap items-center gap-3">
                {/* Invite badge / dropdown trigger */}
                <div className="relative">
                    <button
                        type="button"
                        disabled={invites.length <= 1 || isLoading}
                        onClick={() => setShowInviteDropdown((v) => !v)}
                        className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-default disabled:opacity-70"
                    >
                        <span className="max-w-44 truncate font-medium">
                            {inviteName || t('selectedRow.selectingInvite')}
                        </span>
                        {invites.length > 1 && (
                            <>
                                <span className="text-neutral-300">·</span>
                                <span className="text-2xs text-primary-500">
                                    {t('selectedRow.invitesCount', { count: invites.length })}
                                </span>
                                <CaretDown className="size-3 text-neutral-400" />
                            </>
                        )}
                    </button>

                    {showInviteDropdown && (
                        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-xl border border-neutral-200 bg-white shadow-lg">
                            <div className="max-h-48 overflow-y-auto p-1">
                                {invites.map((inv) => (
                                    <button
                                        key={inv.id}
                                        type="button"
                                        onClick={() => handleChangeInvite(inv)}
                                        className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-primary-50 ${
                                            inv.id === row.inviteId
                                                ? 'bg-primary-50 font-semibold text-primary-700'
                                                : 'text-neutral-700'
                                        }`}
                                    >
                                        {inv.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Price badge */}
                {row.paymentPlanPrice > 0 ? (
                    <span className="rounded-lg bg-success-50 px-2.5 py-1 text-xs font-semibold text-success-700">
                        {row.currency} {row.paymentPlanPrice.toLocaleString()}
                    </span>
                ) : row.paymentPlanId ? (
                    <span className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-500">
                        {t('selectedRow.free')}
                    </span>
                ) : null}

                {/* Preselected toggle */}
                <label className="ml-auto flex cursor-pointer items-center gap-1.5">
                    <input
                        type="checkbox"
                        checked={row.preselected}
                        onChange={(e) => onChange({ ...row, preselected: e.target.checked })}
                        className="size-3.5 accent-primary-500"
                    />
                    <span className="text-xs text-neutral-500">{t('selectedRow.preselected')}</span>
                </label>
            </div>

            {/* Not-ready warning */}
            {!isReady && !isLoading && row.inviteId && (
                <p className="mt-2 text-2xs text-warning-600">
                    {t('selectedRow.noMatchingPaymentOption')}
                </p>
            )}
            {!isReady && !isLoading && !row.inviteId && invites.length === 0 && (
                <p className="mt-2 text-2xs text-danger-600">
                    {t('selectedRow.noActiveInvite')}
                </p>
            )}
        </div>
    );
};

// ─── Main component ───────────────────────────────────────────────────────────

interface CourseSessionSelectorProps {
    mappingRows: MappingRow[];
    onAdd: (row: MappingRow) => void;
    onUpdate: (rowId: string, updated: MappingRow) => void;
    onRemove: (rowId: string) => void;
    suggestions: Record<string, string[]>;
    onUpdateSuggestions: (s: Record<string, string[]>) => void;
    /** Moves a row one step; the row order is the order saved (and a learning path's step order). */
    onMove?: (rowId: string, direction: -1 | 1) => void;
    /** Puts the rows in this order (row ids); the newest/oldest-first buttons use it. */
    onReorder?: (orderedRowIds: string[]) => void;
}

export const CourseSessionSelector = ({
    mappingRows,
    onAdd,
    onUpdate,
    onRemove,
    suggestions,
    onUpdateSuggestions,
    onMove,
    onReorder,
}: CourseSessionSelectorProps) => {
    const { t } = useTranslation('managePagesCourseSessionSelector');
    const { toast } = useToast();
    const [sorting, setSorting] = useState<'newest' | 'oldest' | null>(null);
    const sessionLabel = useMemo(() => buildSessionLabel(t), [t]);
    const instituteId = getCurrentInstituteId() || getInstituteId() || '';
    const [view, setView] = useState<'list' | 'suggestions'>('list');
    const [search, setSearch] = useState('');
    const [showBrowser, setShowBrowser] = useState(mappingRows.length === 0);

    const debouncedSearch = useDebounce(search, SEARCH_DEBOUNCE_MS);
    const selectedSessionIds = new Set(mappingRows.map((r) => r.packageSessionId));

    // One invite-list call for every selected session, split per session here.
    // Each row used to fetch its own list plus its invite's full details, so
    // opening this tab on a 163-course page fired ~326 requests at once.
    const rowSessionIds = useMemo(
        () =>
            Array.from(new Set(mappingRows.map((r) => r.packageSessionId).filter(Boolean))).sort(),
        [mappingRows]
    );
    const { data: invitesBySession, isError: invitesError } = useQuery({
        queryKey: ['PP_SESSION_INVITES', instituteId, rowSessionIds.join(',')],
        queryFn: async () => {
            const bySession = new Map<string, EnrollInvite[]>(rowSessionIds.map((id) => [id, []]));
            for (let pageNo = 0; ; pageNo++) {
                const res = await authenticatedAxiosInstance.post(
                    `${GET_INVITE_LINKS}?instituteId=${instituteId}&pageNo=${pageNo}&pageSize=${INVITE_BATCH_PAGE_SIZE}`,
                    {
                        search_name: '',
                        package_session_ids: rowSessionIds,
                        payment_option_ids: [],
                        sort_columns: {},
                        tags: [],
                    }
                );
                const content = (res.data?.content || []) as EnrollInvite[];
                for (const invite of content) {
                    for (const psId of invite.package_session_ids ?? []) {
                        bySession.get(psId)?.push(invite);
                    }
                }
                if (res.data?.last !== false || content.length === 0) break;
            }
            return bySession;
        },
        enabled: !!instituteId && rowSessionIds.length > 0,
        staleTime: 5 * 60 * 1000,
        // Adding or removing a course changes the key; keep the other rows'
        // invites on screen while the new batch loads.
        placeholderData: keepPreviousData,
    });

    // Paginated sessions fetch — server-side search via search_by_name
    const {
        data: sessionsPages,
        isLoading: sessionsLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        refetch: refetchSessions,
    } = useInfiniteQuery({
        queryKey: ['PP_COURSE_SESSIONS', instituteId, debouncedSearch],
        queryFn: async ({ pageParam = 0 }) => {
            const res = await authenticatedAxiosInstance.post(
                COURSE_CATALOG_URL,
                {
                    status: ['ACTIVE'],
                    level_ids: [],
                    faculty_ids: [],
                    package_types: [],
                    search_by_name: debouncedSearch.trim() || null,
                    tag: [],
                    created_by_user_id: null,
                    min_percentage_completed: 0,
                    max_percentage_completed: 100,
                    sort_columns: { created_at: 'DESC' },
                    type: null,
                    package_ids: [],
                    package_session_ids: [],
                    session_ids: [],
                    package_view: true,
                },
                { params: { instituteId, page: pageParam, size: PAGE_SIZE } }
            );
            return res.data as CourseSearchResponse;
        },
        getNextPageParam: (lastPage, allPages) => (lastPage.last ? undefined : allPages.length),
        initialPageParam: 0,
        enabled: !!instituteId,
        staleTime: 2 * 60 * 1000,
    });

    const allSessions: CourseSearchItem[] = useMemo(
        () => sessionsPages?.pages.flatMap((p) => p.content) ?? [],
        [sessionsPages]
    );
    const totalElements = sessionsPages?.pages[0]?.totalElements ?? 0;

    // Fetch name data for already-selected sessions that aren't in the browse results
    const loadedIds = useMemo(
        () => new Set(allSessions.map((s) => s.package_session_id)),
        [allSessions]
    );
    const missingIds = useMemo(
        () => mappingRows.map((r) => r.packageSessionId).filter((id) => !loadedIds.has(id)),
        [mappingRows, loadedIds]
    );
    const { data: missingSessionsData } = useQuery({
        queryKey: ['PP_SELECTED_SESSION_NAMES', missingIds.join(','), instituteId],
        queryFn: async () => {
            const res = await authenticatedAxiosInstance.post(
                COURSE_CATALOG_URL,
                {
                    status: ['ACTIVE'],
                    level_ids: [],
                    faculty_ids: [],
                    package_types: [],
                    search_by_name: null,
                    tag: [],
                    created_by_user_id: null,
                    min_percentage_completed: 0,
                    max_percentage_completed: 100,
                    sort_columns: { created_at: 'DESC' },
                    type: null,
                    package_ids: [],
                    package_session_ids: missingIds,
                    session_ids: [],
                    package_view: true,
                },
                { params: { instituteId, page: 0, size: missingIds.length } }
            );
            return (res.data?.content ?? []) as CourseSearchItem[];
        },
        enabled: !!instituteId && missingIds.length > 0,
        staleTime: 10 * 60 * 1000,
    });

    const sessionLookup = useMemo(() => {
        const map = new Map<string, CourseSearchItem>();
        for (const s of allSessions) map.set(s.package_session_id, s);
        for (const s of missingSessionsData ?? []) map.set(s.package_session_id, s);
        return map;
    }, [allSessions, missingSessionsData]);

    const getSession = (packageSessionId: string) => sessionLookup.get(packageSessionId);

    const getRowLabel = useCallback((row: MappingRow) => {
        const s = sessionLookup.get(row.packageSessionId);
        return s ? `${s.package_name} · ${sessionLabel(s)}` : row.inviteName || '…';
    }, [sessionLookup, sessionLabel]);

    // Sentinel ref for "load more" at bottom of list
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!loadMoreRef.current || !hasNextPage || isFetchingNextPage) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) fetchNextPage();
            },
            { threshold: 0.1 }
        );
        observer.observe(loadMoreRef.current);
        return () => observer.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    // Search is server-side — just group whatever is loaded
    const grouped: Record<string, CourseSearchItem[]> = {};
    for (const s of allSessions) {
        const key = s.package_name || t('browser.otherGroup');
        if (!grouped[key]) grouped[key] = [];
        grouped[key]!.push(s);
    }

    const handleAddSession = (session: CourseSearchItem) => {
        if (selectedSessionIds.has(session.package_session_id)) return;
        onAdd({
            rowId: `new-${Date.now()}-${session.package_session_id}`,
            packageSessionId: session.package_session_id,
            inviteId: '',
            inviteName: '',
            psInvitePaymentOptionId: '',
            paymentPlanId: '',
            paymentPlanName: '',
            paymentPlanPrice: 0,
            currency: '',
            preselected: false,
            displayOrder: 0,
        });
    };

    const handleSelectAll = () => {
        const unselected = allSessions.filter((s) => !selectedSessionIds.has(s.package_session_id));
        // onAdd puts each row first, so add in reverse to keep the list's order at the top.
        [...unselected].reverse().forEach((session, i) => {
            onAdd({
                rowId: `new-${Date.now()}-${i}-${session.package_session_id}`,
                packageSessionId: session.package_session_id,
                inviteId: '',
                inviteName: '',
                psInvitePaymentOptionId: '',
                paymentPlanId: '',
                paymentPlanName: '',
                paymentPlanPrice: 0,
                currency: '',
                preselected: false,
                displayOrder: 0,
            });
        });
    };

    const unselectedCount = allSessions.filter(
        (s) => !selectedSessionIds.has(s.package_session_id)
    ).length;



    const readyCount = mappingRows.filter(
        (r) => r.psInvitePaymentOptionId && r.paymentPlanId
    ).length;
    const totalPrice = mappingRows.reduce((sum, r) => sum + (r.paymentPlanPrice || 0), 0);
    const currency = mappingRows.find((r) => r.currency)?.currency || '';

    // The search API has no created_at in its response, but sorts by it: ask it for
    // this page's courses newest first and take that order (reversed for oldest).
    const handleSortByCreated = async (direction: 'newest' | 'oldest') => {
        if (!onReorder || sorting) return;
        const sessionIds = Array.from(new Set(mappingRows.map((r) => r.packageSessionId).filter(Boolean)));
        if (sessionIds.length === 0) return;
        setSorting(direction);
        try {
            const res = await authenticatedAxiosInstance.post(
                COURSE_CATALOG_URL,
                {
                    status: ['ACTIVE'],
                    level_ids: [],
                    faculty_ids: [],
                    package_types: [],
                    search_by_name: null,
                    tag: [],
                    created_by_user_id: null,
                    min_percentage_completed: 0,
                    max_percentage_completed: 100,
                    sort_columns: { created_at: 'DESC' },
                    type: null,
                    package_ids: [],
                    package_session_ids: sessionIds,
                    session_ids: [],
                    package_view: true,
                },
                { params: { instituteId, page: 0, size: sessionIds.length } }
            );
            const newestFirst = ((res.data?.content ?? []) as CourseSearchItem[]).map(
                (s) => s.package_session_id
            );
            const ordered = direction === 'newest' ? newestFirst : [...newestFirst].reverse();
            const rank = new Map(ordered.map((id, i) => [id, i]));
            // Stable: rows of the same course (or one the search didn't return) keep their order.
            const rowIds = mappingRows
                .map((r, i) => ({ id: r.rowId, i, rank: rank.get(r.packageSessionId) ?? Infinity }))
                .sort((a, b) => a.rank - b.rank || a.i - b.i)
                .map((r) => r.id);
            onReorder(rowIds);
        } catch {
            toast({ title: t('selectedCourses.sortFailed'), variant: 'destructive' });
        } finally {
            setSorting(null);
        }
    };

    const handleRemoveRow = (rowId: string) => {
        const row = mappingRows.find((r) => r.rowId === rowId);
        if (row?.psInvitePaymentOptionId) {
            const cleaned = { ...suggestions };
            delete cleaned[row.psInvitePaymentOptionId];
            for (const key of Object.keys(cleaned)) {
                cleaned[key] = cleaned[key]!.filter((id) => id !== row.psInvitePaymentOptionId);
            }
            onUpdateSuggestions(cleaned);
        }
        onRemove(rowId);
    };

    return (
        <div className="space-y-5">

            {/* View toggle */}
            {mappingRows.length > 0 && (
                <div className="flex items-center gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 w-fit">
                    <button
                        type="button"
                        onClick={() => setView('list')}
                        className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                            view === 'list'
                                ? 'bg-white text-neutral-800 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                    >
                        {t('tabs.courses')}
                        <span className={`rounded-full px-1.5 text-2xs font-semibold ${view === 'list' ? 'bg-primary-100 text-primary-700' : 'bg-neutral-200 text-neutral-500'}`}>
                            {readyCount}/{mappingRows.length}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setView('suggestions')}
                        className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                            view === 'suggestions'
                                ? 'bg-white text-neutral-800 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                    >
                        <Network className="size-3.5" />
                        {t('tabs.suggestions')}
                    </button>
                </div>
            )}

            {/* Suggestions view */}
            {view === 'suggestions' && (
                <SuggestionsPanel
                    mappingRows={mappingRows}
                    suggestions={suggestions}
                    onUpdateSuggestions={onUpdateSuggestions}
                    getRowLabel={getRowLabel}
                />
            )}

            {/* List view — selected courses */}
            {view === 'list' && mappingRows.length > 0 && (
                <div>
                    <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-neutral-800">
                                {t('selectedCourses.heading')}
                            </h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {onReorder && mappingRows.length > 1 && (
                                <>
                                    <MyButton
                                        scale="small"
                                        buttonType="secondary"
                                        disable={!!sorting}
                                        onClick={() => handleSortByCreated('newest')}
                                        title={t('selectedCourses.newestFirstHint')}
                                    >
                                        {sorting === 'newest' ? (
                                            <CircleNotch className="size-3.5 animate-spin" />
                                        ) : (
                                            <SortDescending className="size-3.5" />
                                        )}
                                        {t('selectedCourses.newestFirst')}
                                    </MyButton>
                                    <MyButton
                                        scale="small"
                                        buttonType="secondary"
                                        disable={!!sorting}
                                        onClick={() => handleSortByCreated('oldest')}
                                        title={t('selectedCourses.oldestFirstHint')}
                                    >
                                        {sorting === 'oldest' ? (
                                            <CircleNotch className="size-3.5 animate-spin" />
                                        ) : (
                                            <SortAscending className="size-3.5" />
                                        )}
                                        {t('selectedCourses.oldestFirst')}
                                    </MyButton>
                                </>
                            )}
                            <MyButton
                                scale="small"
                                buttonType="secondary"
                                onClick={() => setShowBrowser((v) => !v)}
                            >
                                <Plus className="size-3.5" />
                                {t('selectedCourses.addMore')}
                            </MyButton>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {mappingRows.map((row, idx) => {
                            const rowInvites = invitesBySession?.get(row.packageSessionId);
                            return (
                                <SelectedRow
                                    key={row.rowId}
                                    row={row}
                                    session={getSession(row.packageSessionId)}
                                    invites={rowInvites ?? NO_INVITES}
                                    invitesLoading={
                                        !!row.packageSessionId && !invitesError && !rowInvites
                                    }
                                    index={idx}
                                    onChange={(updated) => onUpdate(row.rowId, updated)}
                                    onRemove={() => handleRemoveRow(row.rowId)}
                                    onMove={onMove ? (direction) => onMove(row.rowId, direction) : undefined}
                                    isFirst={idx === 0}
                                    isLast={idx === mappingRows.length - 1}
                                />
                            );
                        })}
                    </div>

                    {/* Total price summary */}
                    {totalPrice > 0 && (
                        <div className="mt-3 flex items-center justify-end rounded-xl border border-neutral-100 bg-white px-4 py-3">
                            <span className="text-sm text-neutral-500">{t('selectedCourses.combinedTotal')}</span>
                            <span className="ml-2 text-base font-bold text-neutral-900">
                                {currency} {totalPrice.toLocaleString()}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Session browser */}
            {view === 'list' && (showBrowser || mappingRows.length === 0) && (
                <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
                    {/* Browser header */}
                    <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
                        <MagnifyingGlass className="size-4 shrink-0 text-neutral-400" />
                        <Input
                            placeholder={t('browser.searchPlaceholder')}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-8 flex-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                        />
                        {sessionsLoading && (
                            <CircleNotch className="size-4 shrink-0 animate-spin text-neutral-300" />
                        )}
                        {!sessionsLoading && unselectedCount > 0 && (
                            <button
                                type="button"
                                onClick={handleSelectAll}
                                className="shrink-0 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600"
                            >
                                {t('browser.selectAll', { count: unselectedCount })}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => refetchSessions()}
                            title={t('browser.refresh')}
                            className="text-neutral-300 transition-colors hover:text-neutral-500"
                        >
                            <ArrowsClockwise className="size-3.5" />
                        </button>
                        {mappingRows.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setShowBrowser(false)}
                                className="text-neutral-300 transition-colors hover:text-neutral-500"
                            >
                                <X className="size-4" />
                            </button>
                        )}
                    </div>

                    {/* Session list */}
                    <div className="max-h-96 overflow-y-auto">
                        {sessionsLoading ? (
                            <div className="flex items-center justify-center py-10 text-sm text-neutral-400">
                                <CircleNotch className="me-2 size-4 animate-spin" />
                                {t('browser.loadingSessions')}
                            </div>
                        ) : allSessions.length === 0 ? (
                            <div className="py-10 text-center text-sm text-neutral-400">
                                {debouncedSearch
                                    ? t('browser.noSessionsMatch', { query: debouncedSearch })
                                    : t('browser.noActiveSessions')}
                            </div>
                        ) : (
                            <>
                                {Object.entries(grouped).map(([courseName, sessions]) => (
                                    <div key={courseName}>
                                        {/* Course group header */}
                                        <div className="sticky top-0 border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-neutral-400">
                                            {courseName}
                                        </div>

                                        {sessions.map((session) => {
                                            const isAdded = selectedSessionIds.has(
                                                session.package_session_id
                                            );

                                            return (
                                                <div
                                                    key={session.package_session_id}
                                                    className={`flex items-center justify-between px-4 py-3 transition-colors ${
                                                        isAdded
                                                            ? 'bg-primary-50/60'
                                                            : 'cursor-pointer hover:bg-neutral-50'
                                                    }`}
                                                    onClick={() =>
                                                        !isAdded && handleAddSession(session)
                                                    }
                                                >
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-medium text-neutral-800">
                                                            {sessionLabel(session)}
                                                        </p>
                                                    </div>
                                                    {isAdded ? (
                                                        <span className="ms-3 flex shrink-0 items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-2xs font-semibold text-primary-600">
                                                            <CheckCircle className="size-3" />
                                                            {t('browser.added')}
                                                        </span>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleAddSession(session);
                                                            }}
                                                            className="ms-3 flex shrink-0 items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-2xs font-medium text-neutral-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600"
                                                        >
                                                            <Plus className="size-3" />
                                                            {t('browser.add')}
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}

                                {/* Infinite scroll sentinel / load more */}
                                <div ref={loadMoreRef} className="px-4 py-3">
                                    {isFetchingNextPage && (
                                        <div className="flex items-center justify-center gap-2 text-xs text-neutral-400">
                                            <CircleNotch className="size-3.5 animate-spin" />
                                            {t('browser.loadingMore')}
                                        </div>
                                    )}
                                    {!isFetchingNextPage && hasNextPage && (
                                        <button
                                            type="button"
                                            onClick={() => fetchNextPage()}
                                            className="w-full rounded-lg border border-neutral-200 py-1.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-50"
                                        >
                                            {t('browser.loadMore', {
                                                count: totalElements - allSessions.length,
                                            })}
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Footer hint */}
                    {allSessions.length > 0 && (
                        <div className="border-t border-neutral-100 px-4 py-2 text-2xs text-neutral-400">
                            {t('browser.footerHint', {
                                loaded: allSessions.length,
                                total: totalElements,
                                selected: selectedSessionIds.size,
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
