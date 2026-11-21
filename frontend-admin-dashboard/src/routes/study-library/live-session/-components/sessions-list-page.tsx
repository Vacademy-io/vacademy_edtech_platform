/* eslint-disable @typescript-eslint/no-unused-vars */
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getPublicUrls } from '@/services/upload_file';
import { CalendarCheck, ClockCounterClockwise, NotePencil } from '@phosphor-icons/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MyButton } from '@/components/design-system/button';
import { SessionStatus, sessionStatusTabLabelKeys } from '../-constants/enums';
import { SettingsQuickAccessButton } from '@/components/settings/quick-access/SettingsQuickAccessButton';
import { SettingsTabs } from '@/routes/settings/-constants/terms';
import { cn } from '@/lib/utils';
import LiveSessionCard from './live-session-card';
import { useNavigate } from '@tanstack/react-router';
import { useSessionSearch } from '../-hooks/useLiveSessions';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { SessionSearchRequest, SessionSearchResponse, searchSessions } from '../-services/utils';
import PreviousSessionCard from './previous-session-card';
import DraftSessionCard from './draft-session-card';
import { useSessionDetailsStore } from '../-store/useSessionDetailsStore';
import {
    useLiveSessionListStateStore,
    ALL_BATCHES_OPTION,
} from '../-store/useLiveSessionListStateStore';
import { useLiveSessionStore } from '../schedule/-store/sessionIdstore';
import { Calendar as CalendarIcon } from 'lucide-react';
import { CaretDown, VideoCameraSlash, Clock, FunnelSimple, X } from '@phosphor-icons/react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { format } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { useQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useFilterDataForAssesment } from '@/routes/assessment/assessment-list/-utils.ts/useFiltersData';
import { MyPagination } from '@/components/design-system/pagination';
import { RecurringType, AccessType, StreamingPlatform } from '../-constants/enums';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { type SelectOption } from '@/components/design-system/SelectChips';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useTranslation } from 'react-i18next';
import { useLiveClassActionVisibility } from '@/lib/display-settings/live-class-actions';

const AllBatchesOption: SelectOption = ALL_BATCHES_OPTION;

export default function SessionListPage() {
    const { t } = useTranslation('studyLibrarySessionsListPage');
    const { setNavHeading } = useNavHeadingStore();
    const { clearSessionDetails } = useSessionDetailsStore();
    const { clearSessionId } = useLiveSessionStore();
    const navigate = useNavigate();

    // Auth institute id
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = (tokenData && Object.keys(tokenData.authorities)[0]) || '';

    // Tab + filter + pagination state all live in the in-memory list-state
    // store rather than component state: opening a class detail unmounts this
    // page, so `useState` used to drop every applied filter on the way back and
    // leave the admin on a page index belonging to a result set that no longer
    // existed. A hard refresh resets the store and lands on Live, page 0, unfiltered.
    const selectedTab = useLiveSessionListStateStore((s) => s.selectedTab);
    const setSelectedTab = useLiveSessionListStateStore((s) => s.setSelectedTab);

    // Committed filter state (see the store for the reset rules).
    const searchQuery = useLiveSessionListStateStore((s) => s.searchQuery);
    const setSearchQuery = useLiveSessionListStateStore((s) => s.setSearchQuery);
    const startDate = useLiveSessionListStateStore((s) => s.startDate);
    const setStartDate = useLiveSessionListStateStore((s) => s.setStartDate);
    const endDate = useLiveSessionListStateStore((s) => s.endDate);
    const setEndDate = useLiveSessionListStateStore((s) => s.setEndDate);
    const meetingTypeFilter = useLiveSessionListStateStore((s) => s.meetingTypeFilter);
    const setMeetingTypeFilter = useLiveSessionListStateStore((s) => s.setMeetingTypeFilter);
    const subjectFilter = useLiveSessionListStateStore((s) => s.subjectFilter);
    const setSubjectFilter = useLiveSessionListStateStore((s) => s.setSubjectFilter);
    const accessFilter = useLiveSessionListStateStore((s) => s.accessFilter);
    const setAccessFilter = useLiveSessionListStateStore((s) => s.setAccessFilter);
    const streamingServiceFilter = useLiveSessionListStateStore((s) => s.streamingServiceFilter);
    const setStreamingServiceFilter = useLiveSessionListStateStore(
        (s) => s.setStreamingServiceFilter
    );
    const startTimeOfDay = useLiveSessionListStateStore((s) => s.startTimeOfDay);
    const setStartTimeOfDay = useLiveSessionListStateStore((s) => s.setStartTimeOfDay);
    const endTimeOfDay = useLiveSessionListStateStore((s) => s.endTimeOfDay);
    const setEndTimeOfDay = useLiveSessionListStateStore((s) => s.setEndTimeOfDay);
    const selectedBatches = useLiveSessionListStateStore((s) => s.selectedBatches);
    const setSelectedBatches = useLiveSessionListStateStore((s) => s.setSelectedBatches);
    const clearAllFilters = useLiveSessionListStateStore((s) => s.clearFilters);

    // Purely transient UI state — never worth restoring on back navigation.
    const [datePopoverOpen, setDatePopoverOpen] = useState(false);

    const { data: instituteDetails } = useQuery(useInstituteQuery());
    // Read once here rather than per card — one settings fetch for the whole list.
    const { canDeletePastSessions } = useLiveClassActionVisibility();
    const { SubjectFilterData } = useFilterDataForAssesment(instituteDetails!);
    const { instituteDetails: storeInstituteDetails } = useInstituteDetailsStore();

    // Build batch options from institute details
    const batchOptions = useMemo(() => {
        const batches =
            storeInstituteDetails?.batches_for_sessions?.map((batch) => ({
                label: batch.level.id === 'DEFAULT'
                    ? `${batch.package_dto.package_name.replace(/^default\s+/i, '')}, ${batch.session.session_name}`.trim()
                    : `${batch.level.level_name.replace(/^default\s+/i, '')} ${batch.package_dto.package_name.replace(/^default\s+/i, '')}, ${batch.session.session_name}`.trim(),
                value: batch.id, // This is the package_session_id
            })) || [];
        return [AllBatchesOption, ...batches];
    }, [storeInstituteDetails?.batches_for_sessions]);

    // Search box inside the Batches picker — transient, resets with the popover.
    const [batchSearch, setBatchSearch] = useState<string>('');

    // Controlled state for the Filters popover. Selections inside the popover
    // are buffered into `filterDraft` so they don't immediately re-fetch the
    // list — the user reviews their selections and clicks Apply to commit.
    const [filtersOpen, setFiltersOpen] = useState(false);
    interface FilterDraft {
        startTimeOfDay: string;
        endTimeOfDay: string;
        meetingTypeFilter: string;
        subjectFilter: string[];
        accessFilter: string;
        streamingServiceFilter: string;
        selectedBatches: SelectOption[];
    }
    const buildDraftFromCommitted = (): FilterDraft => ({
        startTimeOfDay,
        endTimeOfDay,
        meetingTypeFilter,
        subjectFilter: Array.isArray(subjectFilter) ? subjectFilter : [],
        accessFilter,
        streamingServiceFilter,
        selectedBatches,
    });
    const [filterDraft, setFilterDraft] = useState<FilterDraft>(buildDraftFromCommitted);

    // Seed the draft + flip the popover open in a single event handler so
    // React batches the two state updates into one render. Doing the seed in a
    // useEffect after `filtersOpen` flipped caused a visible flicker: the
    // popover would render once with the stale draft from the previous session
    // and then re-render with the fresh values.
    const handleFiltersOpenChange = (next: boolean) => {
        if (next) {
            setFilterDraft({
                startTimeOfDay,
                endTimeOfDay,
                meetingTypeFilter,
                subjectFilter: Array.isArray(subjectFilter) ? subjectFilter : [],
                accessFilter,
                streamingServiceFilter,
                selectedBatches,
            });
        }
        setFiltersOpen(next);
    };

    const applyFilters = () => {
        setStartTimeOfDay(filterDraft.startTimeOfDay);
        setEndTimeOfDay(filterDraft.endTimeOfDay);
        setMeetingTypeFilter(filterDraft.meetingTypeFilter);
        setSubjectFilter(filterDraft.subjectFilter);
        setAccessFilter(filterDraft.accessFilter);
        setStreamingServiceFilter(filterDraft.streamingServiceFilter);
        setSelectedBatches(
            filterDraft.selectedBatches.length > 0
                ? filterDraft.selectedBatches
                : [AllBatchesOption]
        );
        setCurrentPage(0);
        setFiltersOpen(false);
    };

    const resetDraft = () => {
        setFilterDraft({
            startTimeOfDay: '',
            endTimeOfDay: '',
            meetingTypeFilter: '',
            subjectFilter: [],
            accessFilter: '',
            streamingServiceFilter: '',
            selectedBatches: [AllBatchesOption],
        });
    };

    const draftFilterCount =
        (filterDraft.startTimeOfDay || filterDraft.endTimeOfDay ? 1 : 0) +
        (filterDraft.meetingTypeFilter ? 1 : 0) +
        (filterDraft.subjectFilter.length > 0 ? 1 : 0) +
        (filterDraft.accessFilter ? 1 : 0) +
        (filterDraft.streamingServiceFilter ? 1 : 0) +
        (filterDraft.selectedBatches.filter((b) => b.value !== 'all').length > 0 ? 1 : 0);

    // Pagination state - server-side, also held in the store so it survives a
    // round-trip into a class detail.
    const ITEMS_PER_PAGE = 10;
    const currentPage = useLiveSessionListStateStore((s) => s.currentPage);
    const setCurrentPage = useLiveSessionListStateStore((s) => s.setCurrentPage);

    // Build search request based on current filters and a given tab.
    const buildSearchRequest = useCallback((
        tab: SessionStatus,
        page: number,
        size: number
    ): SessionSearchRequest => {
        const baseRequest: SessionSearchRequest = {
            institute_id: INSTITUTE_ID,
            page,
            size,
            sort_by: 'meetingDate',
            sort_direction: 'ASC',
        };

        // Get current date in user's local timezone
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: userTimezone }));
        const todayFormatted = format(nowLocal, 'yyyy-MM-dd');

        // Dynamic date limits
        const farFuture = new Date(nowLocal);
        farFuture.setFullYear(farFuture.getFullYear() + 50);
        const farFutureFormatted = format(farFuture, 'yyyy-MM-dd');

        const farPast = new Date(nowLocal);
        farPast.setFullYear(farPast.getFullYear() - 50);
        const farPastFormatted = format(farPast, 'yyyy-MM-dd');

        // Configure payload based on Tab (Strict Rules)
        switch (tab) {
            case SessionStatus.UPCOMING:
                baseRequest.statuses = ['LIVE'];
                baseRequest.time_status = 'UPCOMING';
                baseRequest.sort_by = 'meetingDate';
                baseRequest.sort_direction = 'ASC';
                // CRITICAL: Override default 30-day limit
                baseRequest.start_date = startDate ? format(startDate, 'yyyy-MM-dd') : todayFormatted;
                baseRequest.end_date = endDate ? format(endDate, 'yyyy-MM-dd') : farFutureFormatted;
                break;

            case SessionStatus.PAST:
                baseRequest.statuses = ['LIVE'];
                baseRequest.time_status = 'PAST';
                baseRequest.sort_by = 'meetingDate';
                baseRequest.sort_direction = 'DESC';
                // CRITICAL: Override default "From Today" limit
                baseRequest.start_date = startDate ? format(startDate, 'yyyy-MM-dd') : farPastFormatted;
                baseRequest.end_date = endDate ? format(endDate, 'yyyy-MM-dd') : todayFormatted;
                break;

            case SessionStatus.DRAFTS:
                baseRequest.statuses = ['DRAFT'];
                baseRequest.time_status = null;
                baseRequest.sort_by = 'updatedAt';
                baseRequest.sort_direction = 'DESC';
                // CRITICAL: Show all drafts history
                baseRequest.start_date = startDate ? format(startDate, 'yyyy-MM-dd') : farPastFormatted;
                baseRequest.end_date = endDate ? format(endDate, 'yyyy-MM-dd') : farFutureFormatted;
                break;

            case SessionStatus.LIVE:
                baseRequest.statuses = ['LIVE'];
                // Intentionally do NOT default start_date / end_date here. When both are
                // omitted and statuses=['LIVE'], the backend applies a timezone-aware
                // "currently in progress" filter (meeting_date = today AND
                // start_time <= now <= last_entry_time). Sending an explicit date range
                // pushes the backend out of that smart-default branch and into a plain
                // date filter, which returns every scheduled session for the day
                // regardless of whether it's in progress — breaking pagination for the
                // Live tab. See LiveSessionRepositoryCustomImpl.searchSessions.
                if (startDate) {
                    baseRequest.start_date = format(startDate, 'yyyy-MM-dd');
                }
                if (endDate) {
                    baseRequest.end_date = format(endDate, 'yyyy-MM-dd');
                }
                break;
        }

        // Apply Common Filters.
        // Backend has no dedicated `subject_names` field on SessionSearchRequest,
        // so selected subjects are appended into `search_query` (same approach
        // the legacy single-subject filter used). With multiple subjects the
        // backend's substring match may narrow results, but the UI now matches
        // the multi-select pattern used for batches.
        // Normalize defensively: Vite HMR can preserve React state across a
        // type change, so an older string value may still be in memory until a
        // hard refresh. Treat any non-array value as empty.
        const subjectList = Array.isArray(subjectFilter) ? subjectFilter : [];
        const subjectTerms = subjectList.filter((s) => s && s !== 'DEFAULT');
        const subjectQuery = subjectTerms.join(' ');
        if (searchQuery) {
            baseRequest.search_query = subjectQuery
                ? `${searchQuery} ${subjectQuery}`
                : searchQuery;
        } else if (subjectQuery) {
            baseRequest.search_query = subjectQuery;
        }

        if (startTimeOfDay) {
            baseRequest.start_time_of_day = startTimeOfDay;
        }
        if (endTimeOfDay) {
            baseRequest.end_time_of_day = endTimeOfDay;
        }

        // Apply recurrence type filter
        if (meetingTypeFilter) {
            if (meetingTypeFilter === 'custom') {
                baseRequest.recurrence_types = ['weekly'];
            } else {
                baseRequest.recurrence_types = [meetingTypeFilter];
            }
        }

        // Apply access level filter
        if (accessFilter) {
            baseRequest.access_levels = [accessFilter];
        }

        // Apply streaming service filter.
        // Values must match `StreamingPlatform` enum strings (see
        // live-session/-constants/enums.ts) exactly — the backend query at
        // LiveSessionRepositoryCustomImpl `s.session_streaming_service_type IN
        // :streamingServiceTypes` is case-sensitive and the stored values are
        // lowercase, so we send the raw enum string without altering case.
        if (streamingServiceFilter) {
            baseRequest.streaming_service_types = [streamingServiceFilter];
        }

        // Apply batch filter
        if (selectedBatches.length > 0 && !selectedBatches.some((b) => b.value === 'all')) {
            baseRequest.batch_ids = selectedBatches.map((b) => b.value);
        }

        return baseRequest;
    }, [
        INSTITUTE_ID,
        searchQuery,
        startDate,
        endDate,
        startTimeOfDay,
        endTimeOfDay,
        meetingTypeFilter,
        subjectFilter,
        accessFilter,
        streamingServiceFilter,
        selectedBatches,
    ]);

    const searchRequest = useMemo(
        () => buildSearchRequest(selectedTab, currentPage, ITEMS_PER_PAGE),
        [buildSearchRequest, selectedTab, currentPage]
    );

    // Fetch sessions using the new search API
    const { data: searchResponse, isLoading, error } = useSessionSearch(searchRequest);

    /**
     * Per-tab counts for the tab strip.
     *
     * One `size: 1` search per INACTIVE tab, built by the same
     * `buildSearchRequest` the tab itself uses — so a count can never describe
     * a different query from the rows it sits above. The ACTIVE tab is not
     * refetched at all: its count is read off the list response already on
     * screen.
     *
     * The key is prefixed `sessionSearch` on purpose. Deleting a session
     * invalidates `['sessionSearch']`, and react-query matches that by prefix —
     * so counts refresh with the list instead of sitting stale next to it.
     *
     * Caveat worth knowing: LIVE/UPCOMING/PAST are re-filtered client-side for
     * midnight crossover, so a count can read one higher than the rows on a
     * session sitting exactly on that boundary.
     */
    const countQueries = useQueries({
        queries: Object.values(SessionStatus).map((status) => {
            const request = buildSearchRequest(status, 0, 1);
            return {
                queryKey: ['sessionSearch', 'count', request],
                queryFn: () => searchSessions(request),
                enabled: status !== selectedTab,
                staleTime: 30_000,
                select: (data: SessionSearchResponse) => data.pagination.total_elements,
            };
        }),
    });

    const tabCounts = useMemo(() => {
        const statuses = Object.values(SessionStatus);
        const counts: Partial<Record<SessionStatus, number>> = {};
        statuses.forEach((status, idx) => {
            const value =
                status === selectedTab
                    ? searchResponse?.pagination?.total_elements
                    : countQueries[idx]?.data;
            if (typeof value === 'number') counts[status] = value;
        });
        return counts;
    }, [countQueries, selectedTab, searchResponse]);

    // The restored page index can outlive the result set it belonged to — a
    // session that was Live when the admin opened it has since ended, or a
    // draft was deleted. Only snap back when the page is genuinely out of
    // range, otherwise the tab renders its empty state on a non-empty list.
    useEffect(() => {
        const totalPages = searchResponse?.pagination?.total_pages ?? 0;
        if (totalPages > 0 && currentPage >= totalPages) {
            setCurrentPage(totalPages - 1);
        }
    }, [searchResponse, currentPage, setCurrentPage]);

    const handleTabChange = (value: string) => {
        if (value === selectedTab) return;
        // Deliberately switching tabs is the one navigation that starts a fresh
        // browse — the store drops the filters and the page index with the tab.
        // Coming back from a class detail keeps them.
        setSelectedTab(value as SessionStatus);
    };

    const handlePageChange = (pageIndex: number) => {
        setCurrentPage(pageIndex);
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
        setCurrentPage(0); // Reset to first page on search
    };

    // "Clear all" — the only control that wipes committed filters. It also
    // returns to page 0 since the result set is fully replaced. The tab is kept.
    const clearFilters = () => {
        clearAllFilters();
        setBatchSearch('');
        setDatePopoverOpen(false);
    };

    // Human-readable label for the active platform value (used in the chip strip).
    const platformLabelFor = (value: string): string => {
        const map: Record<string, string> = {
            zoom: t('platformLabels.zoom'),
            'google meet': t('platformLabels.googleMeet'),
            youtube: t('platformLabels.youtube'),
            bbb: t('platformLabels.bbb'),
            zoho: t('platformLabels.zoho'),
            other: t('platformLabels.other'),
        };
        return map[value] ?? value;
    };

    // Filter bar — rendered inline (called as a function, not used as a
    // JSX component) so it shares SessionListPage's render tree directly.
    // Using <FilterBar /> made React treat each render's arrow-function as a
    // new component identity and unmount/remount the popover on every keystroke
    // or pill click, which made the Filters popover flicker shut and reopen.
    const renderFilterBar = () => {
        // Active chips for filters that live in the inline row (search, date).
        const inlineChips: Array<{ key: string; label: string; value: string; onClear: () => void }> = [];
        if (searchQuery) {
            inlineChips.push({
                key: 'search',
                label: t('chips.search'),
                value: `"${searchQuery}"`,
                onClear: () => setSearchQuery(''),
            });
        }
        if (startDate || endDate) {
            const left = startDate ? format(startDate, 'dd MMM') : '…';
            const right = endDate ? format(endDate, 'dd MMM') : '…';
            inlineChips.push({
                key: 'date',
                label: t('chips.date'),
                value: `${left} – ${right}`,
                onClear: () => {
                    setStartDate(undefined);
                    setEndDate(undefined);
                },
            });
        }

        // Active chips for filters living inside the Filters popover.
        const attributeChips: Array<{ key: string; label: string; value: string; onClear: () => void }> = [];
        if (startTimeOfDay || endTimeOfDay) {
            attributeChips.push({
                key: 'time',
                label: t('chips.time'),
                value: `${startTimeOfDay || '00:00'} – ${endTimeOfDay || '23:59'}`,
                onClear: () => {
                    setStartTimeOfDay('');
                    setEndTimeOfDay('');
                },
            });
        }
        if (meetingTypeFilter) {
            const v = meetingTypeFilter === RecurringType.ONCE
                ? t('filters.once')
                : meetingTypeFilter === RecurringType.WEEKLY
                    ? t('filters.weekly')
                    : meetingTypeFilter === 'custom' ? t('filters.custom') : meetingTypeFilter;
            attributeChips.push({
                key: 'meeting',
                label: t('chips.meetingType'),
                value: v,
                onClear: () => setMeetingTypeFilter(''),
            });
        }
        const subjectChipList = Array.isArray(subjectFilter) ? subjectFilter : [];
        if (subjectChipList.length > 0) {
            attributeChips.push({
                key: 'subject',
                label: t('chips.subject'),
                value:
                    subjectChipList.length === 1
                        ? subjectChipList[0]!
                        : t('filters.selectedCount', { count: subjectChipList.length }),
                onClear: () => setSubjectFilter([]),
            });
        }
        if (accessFilter) {
            attributeChips.push({
                key: 'access',
                label: t('chips.access'),
                value: accessFilter.charAt(0).toUpperCase() + accessFilter.slice(1),
                onClear: () => setAccessFilter(''),
            });
        }
        if (streamingServiceFilter) {
            attributeChips.push({
                key: 'platform',
                label: t('chips.platform'),
                value: platformLabelFor(streamingServiceFilter),
                onClear: () => setStreamingServiceFilter(''),
            });
        }
        const nonAllBatches = selectedBatches.filter((b) => b.value !== 'all');
        if (nonAllBatches.length > 0) {
            attributeChips.push({
                key: 'batches',
                label: getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch),
                value: nonAllBatches.length === 1 ? nonAllBatches[0]!.label : t('filters.selectedCount', { count: nonAllBatches.length }),
                onClear: () => setSelectedBatches([AllBatchesOption]),
            });
        }

        const allChips = [...inlineChips, ...attributeChips];
        const hasAnyFilter = allChips.length > 0;
        const attributeFilterCount = attributeChips.length;

        // Reusable styles for popover-internal option pills.
        const pillBase =
            'rounded-full border px-3 py-1 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary-300';
        const pillOn = 'border-primary-500 bg-primary-50 text-primary-600';
        const pillOff = 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50';

        return (
        <div className="mb-4 rounded-lg border bg-white p-3 sm:mb-6 sm:p-4">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                {/* Search */}
                <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[260px]">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-neutral-400"
                        >
                            <circle cx="11" cy="11" r="8"></circle>
                            <path d="m21 21-4.3-4.3"></path>
                        </svg>
                    </div>
                    <input
                        autoFocus
                        type="text"
                        value={searchQuery}
                        onChange={handleSearchChange}
                        placeholder={t('filterBarSearchPlaceholder')}
                        className="h-9 w-full rounded-md border border-neutral-300 bg-white py-2 pl-10 pr-3 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                </div>

                {/* Date range */}
                <div className="w-[calc(50%-4px)] sm:w-[220px]">
                    <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                        <PopoverTrigger asChild>
                            <button
                                className={`flex h-9 w-full items-center justify-between rounded-md border px-3 ${startDate || endDate ? 'border-primary-500' : 'border-neutral-300'} focus:border-primary-500 focus:ring-1 focus:ring-primary-500`}
                            >
                                {startDate && endDate
                                    ? `${format(startDate, 'dd/MM/yy')} - ${format(endDate, 'dd/MM/yy')}`
                                    : startDate
                                        ? t('dateRange.from', { date: format(startDate, 'dd/MM/yy') })
                                        : endDate
                                            ? t('dateRange.to', { date: format(endDate, 'dd/MM/yy') })
                                            : t('dateRange.selectRange')}
                                <CalendarIcon className="text-neutral-500" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[280px] p-0">
                            {(() => {
                                // Forward-looking presets make sense for Upcoming /
                                // Live tabs; everything else (Past, Drafts) is
                                // historical. Same numbers, opposite direction.
                                const isForward =
                                    selectedTab === SessionStatus.UPCOMING ||
                                    selectedTab === SessionStatus.LIVE;
                                const directionLabel = isForward ? t('dateRange.next') : t('dateRange.past');
                                const applyDays = (days: number) => {
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0);
                                    if (days === 1) {
                                        setStartDate(today);
                                        setEndDate(today);
                                    } else if (isForward) {
                                        const end = new Date(today);
                                        end.setDate(end.getDate() + (days - 1));
                                        setStartDate(today);
                                        setEndDate(end);
                                    } else {
                                        const start = new Date(today);
                                        start.setDate(start.getDate() - (days - 1));
                                        setStartDate(start);
                                        setEndDate(today);
                                    }
                                    setDatePopoverOpen(false);
                                };
                                const presets: Array<{ label: string; days: number }> = [
                                    { label: t('dateRange.today'), days: 1 },
                                    { label: t('dateRange.daysPreset', { direction: directionLabel, count: 3 }), days: 3 },
                                    { label: t('dateRange.daysPreset', { direction: directionLabel, count: 7 }), days: 7 },
                                    { label: t('dateRange.daysPreset', { direction: directionLabel, count: 10 }), days: 10 },
                                    { label: t('dateRange.daysPreset', { direction: directionLabel, count: 15 }), days: 15 },
                                ];
                                // Highlight a preset only if the current range
                                // exactly matches its computed window.
                                const presetMatchesDays = (days: number): boolean => {
                                    if (!startDate || !endDate) return false;
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0);
                                    let expectedStart: Date;
                                    let expectedEnd: Date;
                                    if (days === 1) {
                                        expectedStart = today;
                                        expectedEnd = today;
                                    } else if (isForward) {
                                        expectedStart = today;
                                        expectedEnd = new Date(today);
                                        expectedEnd.setDate(today.getDate() + (days - 1));
                                    } else {
                                        expectedEnd = today;
                                        expectedStart = new Date(today);
                                        expectedStart.setDate(today.getDate() - (days - 1));
                                    }
                                    const sameDay = (a: Date, b: Date) =>
                                        format(a, 'yyyy-MM-dd') === format(b, 'yyyy-MM-dd');
                                    return (
                                        sameDay(startDate, expectedStart) &&
                                        sameDay(endDate, expectedEnd)
                                    );
                                };
                                return (
                                    <>
                                        <div className="border-b border-neutral-100 px-4 py-3">
                                            <h4 className="text-xs font-medium text-neutral-700">
                                                {t('dateRange.quickSelect')}
                                            </h4>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {presets.map((p) => {
                                                    const active = presetMatchesDays(p.days);
                                                    return (
                                                        <button
                                                            key={p.label}
                                                            type="button"
                                                            onClick={() => applyDays(p.days)}
                                                            className={`rounded-full border px-3 py-1 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary-300 ${
                                                                active
                                                                    ? 'border-primary-500 bg-primary-50 text-primary-600'
                                                                    : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                                                            }`}
                                                        >
                                                            {p.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="px-4 py-3">
                                            <h4 className="text-xs font-medium text-neutral-700">
                                                {t('dateRange.customRange')}
                                            </h4>
                                            <div className="mt-2 flex flex-col gap-2">
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-[11px] text-neutral-500">
                                                        {t('dateRange.startDate')}
                                                    </span>
                                                    <input
                                                        type="date"
                                                        value={
                                                            startDate
                                                                ? format(startDate, 'yyyy-MM-dd')
                                                                : ''
                                                        }
                                                        onChange={(e) =>
                                                            setStartDate(
                                                                e.target.value
                                                                    ? new Date(e.target.value)
                                                                    : undefined
                                                            )
                                                        }
                                                        className="h-8 rounded-md border border-neutral-300 px-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                                    />
                                                </label>
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-[11px] text-neutral-500">
                                                        {t('dateRange.endDate')}
                                                    </span>
                                                    <input
                                                        type="date"
                                                        value={
                                                            endDate
                                                                ? format(endDate, 'yyyy-MM-dd')
                                                                : ''
                                                        }
                                                        onChange={(e) =>
                                                            setEndDate(
                                                                e.target.value
                                                                    ? new Date(e.target.value)
                                                                    : undefined
                                                            )
                                                        }
                                                        className="h-8 rounded-md border border-neutral-300 px-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-2.5">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setStartDate(undefined);
                                                    setEndDate(undefined);
                                                }}
                                                disabled={!startDate && !endDate}
                                                className="text-xs text-neutral-500 hover:text-neutral-800 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                                            >
                                                {t('dateRange.clear')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDatePopoverOpen(false)}
                                                className="rounded-md bg-primary-500 px-3 py-1 text-xs text-white hover:bg-primary-600"
                                            >
                                                {t('dateRange.done')}
                                            </button>
                                        </div>
                                    </>
                                );
                            })()}
                        </PopoverContent>
                    </Popover>
                </div>

                {/* Filters popover — Time of Day, Meeting Type, Subject,
                    Access Type, Platform, Batches collapsed into one place.
                    Selections are buffered into a local draft and committed
                    only when the user clicks Apply. */}
                <Popover open={filtersOpen} onOpenChange={handleFiltersOpenChange}>
                    <PopoverTrigger asChild>
                        <button
                            className={`flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors focus:outline-none focus:ring-1 focus:ring-primary-500 ${
                                attributeFilterCount > 0
                                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                            }`}
                        >
                            <FunnelSimple size={16} weight="bold" />
                            <span>{t('filters.button')}</span>
                            {attributeFilterCount > 0 && (
                                <span className="rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                                    {attributeFilterCount}
                                </span>
                            )}
                            <CaretDown size={14} className="text-neutral-500" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="end"
                        className="w-[360px] max-w-[calc(100vw-2rem)] p-0"
                    >
                        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
                            <h3 className="text-sm font-semibold text-neutral-800">
                                {t('filters.heading')}
                            </h3>
                            <button
                                type="button"
                                onClick={resetDraft}
                                disabled={draftFilterCount === 0}
                                className="text-xs font-medium text-red-600 transition-opacity hover:text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
                            >
                                {t('filters.reset')}
                            </button>
                        </div>
                        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto p-4">
                            {/* Time of Day */}
                            <section>
                                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-neutral-700">
                                    <Clock size={14} className="text-neutral-500" />
                                    {t('filters.timeOfDay')}
                                </h4>
                                <div className="flex gap-2">
                                    <input
                                        type="time"
                                        value={filterDraft.startTimeOfDay}
                                        onChange={(e) =>
                                            setFilterDraft((d) => ({
                                                ...d,
                                                startTimeOfDay: e.target.value,
                                            }))
                                        }
                                        className="h-8 flex-1 rounded-md border border-neutral-300 px-2 text-sm"
                                        aria-label={t('filters.startTimeAria')}
                                    />
                                    <input
                                        type="time"
                                        value={filterDraft.endTimeOfDay}
                                        onChange={(e) =>
                                            setFilterDraft((d) => ({
                                                ...d,
                                                endTimeOfDay: e.target.value,
                                            }))
                                        }
                                        className="h-8 flex-1 rounded-md border border-neutral-300 px-2 text-sm"
                                        aria-label={t('filters.endTimeAria')}
                                    />
                                </div>
                            </section>

                            {/* Meeting Type */}
                            <section>
                                <h4 className="mb-2 text-xs font-medium text-neutral-700">
                                    {t('filters.meetingType')}
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                    {[
                                        { label: t('filters.all'), value: '' },
                                        { label: t('filters.once'), value: RecurringType.ONCE },
                                        { label: t('filters.weekly'), value: RecurringType.WEEKLY },
                                        { label: t('filters.custom'), value: 'custom' },
                                    ].map((opt) => (
                                        <button
                                            key={opt.label}
                                            type="button"
                                            onClick={() =>
                                                setFilterDraft((d) => ({
                                                    ...d,
                                                    meetingTypeFilter: opt.value,
                                                }))
                                            }
                                            className={`${pillBase} ${
                                                filterDraft.meetingTypeFilter === opt.value
                                                    ? pillOn
                                                    : pillOff
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {/* Subject — multi-select, mirrors the batches pattern */}
                            <section>
                                <h4 className="mb-2 flex items-center justify-between text-xs font-medium text-neutral-700">
                                    <span>{t('chips.subject')}</span>
                                    {filterDraft.subjectFilter.length > 0 && (
                                        <span className="text-[10px] font-normal text-neutral-500">
                                            {t('filters.selectedCount', { count: filterDraft.subjectFilter.length })}
                                        </span>
                                    )}
                                </h4>
                                <div className="flex max-h-[140px] flex-wrap gap-1.5 overflow-y-auto rounded-md border border-neutral-100 bg-neutral-50/40 p-2">
                                    {[
                                        { id: 'all', name: t('filters.all') },
                                        ...SubjectFilterData.sort((a, b) =>
                                            a.name.localeCompare(b.name)
                                        ),
                                    ].map((opt) => {
                                        const isAll = opt.name === t('filters.all');
                                        const isActive = isAll
                                            ? filterDraft.subjectFilter.length === 0
                                            : filterDraft.subjectFilter.includes(opt.name);
                                        return (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => {
                                                    if (isAll) {
                                                        setFilterDraft((d) => ({
                                                            ...d,
                                                            subjectFilter: [],
                                                        }));
                                                        return;
                                                    }
                                                    setFilterDraft((d) => ({
                                                        ...d,
                                                        subjectFilter: d.subjectFilter.includes(
                                                            opt.name
                                                        )
                                                            ? d.subjectFilter.filter(
                                                                  (s) => s !== opt.name
                                                              )
                                                            : [...d.subjectFilter, opt.name],
                                                    }));
                                                }}
                                                className={`${pillBase} ${isActive ? pillOn : pillOff}`}
                                            >
                                                {opt.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>

                            {/* Access Type */}
                            <section>
                                <h4 className="mb-2 text-xs font-medium text-neutral-700">
                                    {t('filters.accessType')}
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                    {[
                                        { label: t('filters.all'), value: '' },
                                        ...Object.values(AccessType).map((a) => ({
                                            label: a.charAt(0).toUpperCase() + a.slice(1),
                                            value: a,
                                        })),
                                    ].map((opt) => (
                                        <button
                                            key={opt.label}
                                            type="button"
                                            onClick={() =>
                                                setFilterDraft((d) => ({
                                                    ...d,
                                                    accessFilter: opt.value,
                                                }))
                                            }
                                            className={`${pillBase} ${
                                                filterDraft.accessFilter === opt.value
                                                    ? pillOn
                                                    : pillOff
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {/* Platform */}
                            <section>
                                <h4 className="mb-2 text-xs font-medium text-neutral-700">
                                    {t('filters.platform')}
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                    {[
                                        { label: t('filters.all'), value: '' },
                                        { label: t('platformLabels.zoom'), value: 'zoom' },
                                        { label: t('platformLabels.googleMeet'), value: 'google meet' },
                                        { label: t('platformLabels.youtube'), value: 'youtube' },
                                        { label: t('platformLabels.bbb'), value: 'bbb' },
                                        { label: t('platformLabels.other'), value: 'other' },
                                    ].map((opt) => (
                                        <button
                                            key={opt.label}
                                            type="button"
                                            onClick={() =>
                                                setFilterDraft((d) => ({
                                                    ...d,
                                                    streamingServiceFilter: opt.value,
                                                }))
                                            }
                                            className={`${pillBase} ${
                                                filterDraft.streamingServiceFilter === opt.value
                                                    ? pillOn
                                                    : pillOff
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {/* Batches — inline searchable list. SelectChips
                                opens its own nested popover which collides with
                                this one, so we render checkboxes directly. */}
                            <section>
                                <h4 className="mb-2 flex items-center justify-between text-xs font-medium text-neutral-700">
                                    <span>
                                        {getTerminologyPlural(
                                            ContentTerms.Batch,
                                            SystemTerms.Batch
                                        )}
                                    </span>
                                    {filterDraft.selectedBatches.filter((b) => b.value !== 'all')
                                        .length > 0 && (
                                        <span className="font-normal text-primary-600">
                                            {t('filters.selectedCount', {
                                                count: filterDraft.selectedBatches.filter(
                                                    (b) => b.value !== 'all'
                                                ).length,
                                            })}
                                        </span>
                                    )}
                                </h4>
                                <div className="rounded-md border border-neutral-200">
                                    <div className="border-b border-neutral-100 p-1.5">
                                        <input
                                            type="text"
                                            value={batchSearch}
                                            onChange={(e) => setBatchSearch(e.target.value)}
                                            placeholder={t('filters.searchBatchesPlaceholder', { batches: getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch).toLowerCase() })}
                                            className="h-7 w-full rounded border-none bg-transparent px-1.5 text-xs text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:ring-0"
                                        />
                                    </div>
                                    <div className="max-h-[160px] overflow-y-auto py-1">
                                        {(() => {
                                            const q = batchSearch.trim().toLowerCase();
                                            const matched = batchOptions.filter((opt) =>
                                                q ? opt.label.toLowerCase().includes(q) : true
                                            );
                                            if (matched.length === 0) {
                                                return (
                                                    <div className="px-3 py-4 text-center text-xs text-neutral-400">
                                                        {t('filters.noMatches')}
                                                    </div>
                                                );
                                            }
                                            const isAll = filterDraft.selectedBatches.some(
                                                (b) => b.value === 'all'
                                            );
                                            return matched.map((opt) => {
                                                const isCheckedAll = opt.value === 'all' && isAll;
                                                const isCheckedItem =
                                                    opt.value !== 'all' &&
                                                    filterDraft.selectedBatches.some(
                                                        (b) => b.value === opt.value
                                                    );
                                                const isChecked = isCheckedAll || isCheckedItem;
                                                return (
                                                    <label
                                                        key={opt.value}
                                                        className="flex cursor-pointer items-start gap-2 px-3 py-1.5 hover:bg-neutral-50"
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={() => {
                                                                if (opt.value === 'all') {
                                                                    setFilterDraft((d) => ({
                                                                        ...d,
                                                                        selectedBatches: [
                                                                            AllBatchesOption,
                                                                        ],
                                                                    }));
                                                                    return;
                                                                }
                                                                setFilterDraft((d) => {
                                                                    const withoutAll =
                                                                        d.selectedBatches.filter(
                                                                            (b) =>
                                                                                b.value !== 'all'
                                                                        );
                                                                    const currentlyChecked =
                                                                        withoutAll.some(
                                                                            (b) =>
                                                                                b.value ===
                                                                                opt.value
                                                                        );
                                                                    const next = currentlyChecked
                                                                        ? withoutAll.filter(
                                                                              (b) =>
                                                                                  b.value !==
                                                                                  opt.value
                                                                          )
                                                                        : [...withoutAll, opt];
                                                                    return {
                                                                        ...d,
                                                                        selectedBatches:
                                                                            next.length === 0
                                                                                ? [
                                                                                      AllBatchesOption,
                                                                                  ]
                                                                                : next,
                                                                    };
                                                                });
                                                            }}
                                                            className="mt-0.5 size-3.5 shrink-0 rounded border-neutral-300 text-primary-500 focus:ring-primary-500"
                                                        />
                                                        <span
                                                            className={`text-xs leading-snug ${
                                                                isChecked
                                                                    ? 'font-medium text-primary-700'
                                                                    : 'text-neutral-700'
                                                            }`}
                                                        >
                                                            {opt.label}
                                                        </span>
                                                    </label>
                                                );
                                            });
                                        })()}
                                    </div>
                                </div>
                            </section>
                        </div>
                        {/* Footer — Cancel discards the draft, Apply commits it. */}
                        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50/60 px-4 py-2.5">
                            <button
                                type="button"
                                onClick={() => setFiltersOpen(false)}
                                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                            >
                                {t('filters.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={applyFilters}
                                className="rounded-md bg-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600"
                            >
                                {t('filters.apply')}
                            </button>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            {/* Active filter chips */}
            {hasAnyFilter && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
                    {allChips.map((chip) => (
                        <span
                            key={chip.key}
                            className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 py-1 pl-2.5 pr-1.5 text-xs text-primary-700"
                        >
                            <span className="font-medium">{chip.label}:</span>
                            <span className="max-w-[180px] truncate">{chip.value}</span>
                            <button
                                type="button"
                                onClick={chip.onClear}
                                className="flex size-4 items-center justify-center rounded-full text-primary-500 hover:bg-primary-100 hover:text-primary-700"
                                aria-label={t('chips.clearAria', { label: chip.label })}
                            >
                                <X size={10} weight="bold" />
                            </button>
                        </span>
                    ))}
                    <button
                        onClick={clearFilters}
                        className="ml-auto text-xs text-neutral-500 hover:text-neutral-800 hover:underline"
                    >
                        {t('chips.clearAll')}
                    </button>
                </div>
            )}
        </div>
        );
    };

    const instructorFileIds = useMemo(() => {
        const ids = new Set<string>();
        searchResponse?.sessions?.forEach((session) => {
            session.instructors?.forEach((instructor) => {
                const fileId = instructor?.profile_pic_file_id?.trim();
                if (fileId) ids.add(fileId);
            });
        });
        return Array.from(ids).sort();
    }, [searchResponse]);

    const [instructorAvatars, setInstructorAvatars] = useState<Record<string, string>>({});

    useEffect(() => {
        if (instructorFileIds.length === 0) {
            setInstructorAvatars({});
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const details = await getPublicUrls(instructorFileIds.join(','));
                if (cancelled) return;
                const next: Record<string, string> = {};
                (Array.isArray(details) ? details : []).forEach(
                    (entry: { id?: string; url?: string }) => {
                        if (entry?.id && entry?.url) next[entry.id] = entry.url;
                    }
                );
                setInstructorAvatars(next);
            } catch {
                // Cosmetic: the card falls back to initials.
                if (!cancelled) setInstructorAvatars({});
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [instructorFileIds]);

    useEffect(() => {
        setNavHeading(getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession));
        clearSessionDetails();
        clearSessionId();
    }, [setNavHeading, clearSessionDetails, clearSessionId]);

    // Render sessions based on current tab
    const renderSessions = () => {
        if (isLoading) {
            return (
                <div className="flex h-[300px] items-center justify-center">
                    <div className="text-neutral-500">{t('sessions.loading')}</div>
                </div>
            );
        }

        if (error) {
            return (
                <div className="flex h-[300px] items-center justify-center">
                    <div className="text-red-500">{t('sessions.error', { message: error.message })}</div>
                </div>
            );
        }

        const tabLabel =
            selectedTab === SessionStatus.LIVE
                ? t('sessions.tabLabels.live')
                : selectedTab === SessionStatus.UPCOMING
                    ? t('sessions.tabLabels.upcoming')
                    : selectedTab === SessionStatus.PAST
                        ? t('sessions.tabLabels.past')
                        : t('sessions.tabLabels.draft');

        const renderBigEmpty = () => (
            <div className="flex h-[300px] flex-col items-center justify-center gap-4 text-center">
                <VideoCameraSlash size={64} className="text-neutral-300" />
                <h2 className="text-2xl font-bold text-neutral-600">
                    {t('sessions.emptyTitle', { tab: tabLabel })}
                </h2>
                <p className="max-w-xs text-sm text-neutral-500">
                    {selectedTab === SessionStatus.DRAFTS
                        ? t('sessions.emptyDraftBody')
                        : t('sessions.emptyDefaultBody')}
                </p>
            </div>
        );

        if (!searchResponse?.sessions || searchResponse.sessions.length === 0) {
            return renderBigEmpty();
        }



        // Use sessions directly from API response (filtering is server-side mostly, but client-side for LIVE tab specific logic)
        let filteredSessions = searchResponse.sessions;

        // FRONTEND FILTERING for LIVE, UPCOMING, PAST tabs to handle midnight crossover correctly
        if (
            selectedTab === SessionStatus.LIVE ||
            selectedTab === SessionStatus.UPCOMING ||
            selectedTab === SessionStatus.PAST
        ) {
            const now = new Date();
            const normalizeTime = (t: string) => {
                if (t.includes('T')) {
                    const afterT = t.split('T')[1] || t;
                    return afterT.replace(/[+-]\d{2}:\d{2}$|Z$/, '');
                }
                return t.replace(/[+-]\d{2}:\d{2}$|Z$/, '');
            };

            filteredSessions = searchResponse.sessions.filter((session) => {
                const sessionTimezone = session.timezone || 'Asia/Kolkata';

                const sessionStartString = `${session.meeting_date}T${normalizeTime(session.start_time)}`;
                const sessionEndString = `${session.meeting_date}T${normalizeTime(session.last_entry_time)}`;

                const startTime = fromZonedTime(sessionStartString, sessionTimezone);
                let endTime = fromZonedTime(sessionEndString, sessionTimezone);

                // Handle midnight crossover (e.g., 23:00 to 00:30)
                if (endTime < startTime) {
                    endTime = new Date(endTime.getTime() + 24 * 60 * 60 * 1000);
                }

                if (selectedTab === SessionStatus.LIVE) {
                    return startTime <= now && now <= endTime;
                } else if (selectedTab === SessionStatus.UPCOMING) {
                    return now < startTime;
                } else if (selectedTab === SessionStatus.PAST) {
                    return now > endTime;
                }
                return true;
            });
        }

        // If the timezone filter removed every session on this page, show the big
        // empty state for the current tab instead of a confusing inline fallback.
        if (filteredSessions.length === 0) {
            return renderBigEmpty();
        }

        return (
            <div>
                <div className="space-y-4">
                    {filteredSessions.length > 0 ? (
                        filteredSessions.map((session) => {
                            // Convert API response to component props format
                            const sessionData = {
                                session_id: session.session_id,
                                schedule_id: session.schedule_id,
                                meeting_date: session.meeting_date,
                                start_time: session.start_time,
                                last_entry_time: session.last_entry_time,
                                recurrence_type: session.recurrence_type,
                                access_level: session.access_level,
                                title: session.title,
                                subject: session.subject || '',
                                meeting_link: session.meeting_link,
                                registration_form_link_for_public_sessions:
                                    session.registration_form_link_for_public_sessions || '',
                                timezone: session.timezone,
                                link_type: session.link_type,
                                waiting_room_time: session.waiting_room_time,
                                default_class_link: session.default_class_link,
                                defaultClassName: session.default_class_name,
                                learner_button_config: session.learner_button_config,
                                package_session_details: session.package_session_details,
                                instructors: session.instructors,
                            };

                            if (selectedTab === SessionStatus.PAST) {
                                return (
                                    <PreviousSessionCard
                                        key={`${session.session_id}-${session.schedule_id}`}
                                        session={sessionData}
                                        avatarUrlByFileId={instructorAvatars}
                                        canDelete={canDeletePastSessions}
                                    />
                                );
                            } else if (selectedTab === SessionStatus.DRAFTS) {
                                const draftSession = {
                                    ...sessionData,
                                    waiting_room_time: session.waiting_room_time,
                                    thumbnail_file_id: session.thumbnail_file_id,
                                    background_score_file_id: session.background_score_file_id,
                                    session_streaming_service_type:
                                        session.session_streaming_service_type,
                                };
                                return (
                                    <DraftSessionCard
                                        key={session.session_id}
                                        session={draftSession}
                                        avatarUrlByFileId={instructorAvatars}
                                    />
                                );
                            } else {
                                return (
                                    <LiveSessionCard
                                        key={`${session.session_id}-${session.schedule_id}`}
                                        session={sessionData}
                                        avatarUrlByFileId={instructorAvatars}
                                    />
                                );
                            }
                        })
                    ) : (
                        <div className="flex h-[200px] items-center justify-center text-neutral-500">
                            {t('sessions.emptyPage', { tab: tabLabel.toLowerCase() })}
                        </div>
                    )}
                </div>
                {/* Result counter + pager share one strip so the list always ends
                    with "where am I in the set", not with a bare card edge. The
                    range is counted off what is actually rendered: the LIVE /
                    UPCOMING / PAST tabs re-filter the page client-side for
                    midnight crossover, so the server's page_size can overstate it. */}
                <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-neutral-100 pt-4 sm:flex-row">
                    <p className="text-sm text-neutral-500">
                        {t('sessions.showingRange', {
                            from:
                                searchResponse.pagination.current_page *
                                    searchResponse.pagination.page_size +
                                1,
                            to:
                                searchResponse.pagination.current_page *
                                    searchResponse.pagination.page_size +
                                filteredSessions.length,
                            total: searchResponse.pagination.total_elements,
                            term: getTerminologyPlural(
                                ContentTerms.LiveSession,
                                SystemTerms.LiveSession
                            ).toLowerCase(),
                        })}
                    </p>
                    {searchResponse.pagination.total_pages > 1 && (
                        <MyPagination
                            currentPage={searchResponse.pagination.current_page}
                            totalPages={searchResponse.pagination.total_pages}
                            onPageChange={handlePageChange}
                        />
                    )}
                </div>
            </div>
        );
    };

    return (
        <>
            {renderFilterBar()}
            <Tabs value={selectedTab} onValueChange={handleTabChange}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <TabsList className="inline-flex h-auto justify-start gap-1 overflow-x-auto rounded-none border-b !bg-transparent p-0 sm:gap-4">
                        {Object.values(SessionStatus).map((status) => {
                            const liveDotActive =
                                (tabCounts[SessionStatus.LIVE] ?? 0) > 0 ||
                                selectedTab === SessionStatus.LIVE;
                            const tabIcon =
                                status === SessionStatus.LIVE ? (
                                    // Red and pulsing whenever a class is
                                    // actually live, and also while you are
                                    // standing on the Live tab — a flat grey dot
                                    // on the tab you just opened read as dead UI.
                                    <span className="relative flex size-2">
                                        {liveDotActive ? (
                                            <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger-400 opacity-75" />
                                        ) : null}
                                        <span
                                            className={cn(
                                                'relative inline-flex size-2 rounded-full',
                                                liveDotActive ? 'bg-danger-500' : 'bg-neutral-300'
                                            )}
                                        />
                                    </span>
                                ) : status === SessionStatus.UPCOMING ? (
                                    <CalendarCheck size={16} weight="duotone" />
                                ) : status === SessionStatus.PAST ? (
                                    <ClockCounterClockwise size={16} weight="duotone" />
                                ) : (
                                    <NotePencil size={16} weight="duotone" />
                                );
                            return (
                            <TabsTrigger
                                key={status}
                                value={status}
                                className={`flex shrink-0 gap-1.5 rounded-none px-4 py-2 text-sm !shadow-none sm:px-12 ${selectedTab === status
                                    ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                    : 'border-none bg-transparent'
                                    }`}
                            >
                                {tabIcon}
                                {t(`sessions.tabLabels.${sessionStatusTabLabelKeys[status]}`)}
                                {typeof tabCounts[status] === 'number' ? (
                                    <span
                                        className={
                                            selectedTab === status
                                                ? 'text-primary-500'
                                                : 'text-neutral-400'
                                        }
                                    >
                                        ({tabCounts[status]})
                                    </span>
                                ) : null}
                            </TabsTrigger>
                            );
                        })}
                    </TabsList>
                    <div className="flex items-center gap-2">
                        <SettingsQuickAccessButton
                            settingsKey={SettingsTabs.LiveSession}
                            label={t('settingsButtonLabel')}
                        />
                        <MyButton
                            onClick={() => navigate({ to: '/study-library/live-session/schedule' })}
                            buttonType="primary"
                            className="w-full sm:w-auto"
                        >
                            {t('scheduleButton')}
                        </MyButton>
                    </div>
                </div>

                <TabsContent value={SessionStatus.LIVE} className="space-y-4">
                    {renderSessions()}
                </TabsContent>
                <TabsContent value={SessionStatus.UPCOMING} className="space-y-4">
                    {renderSessions()}
                </TabsContent>
                <TabsContent value={SessionStatus.PAST} className="space-y-4">
                    {renderSessions()}
                </TabsContent>
                <TabsContent value={SessionStatus.DRAFTS} className="space-y-4">
                    {renderSessions()}
                </TabsContent>
            </Tabs>
        </>
    );
}
