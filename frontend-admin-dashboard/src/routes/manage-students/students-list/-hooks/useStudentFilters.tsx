import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StudentFilterRequest } from '@/types/student-table-types';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getBatchOwnName } from '@/utils/helpers/student-management/batch-display-name';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useSelectedSessionStore } from '@/stores/study-library/selected-session-store';
import {
    DropdownItemType,
    DropdownValueType,
} from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useCustomFieldSetup } from '@/routes/audience-manager/list/-hooks/useCustomFieldSetup';
import {
    isRangeFieldType,
    sentinelLabel,
    splitLegacyAndTyped,
} from '@/components/shared/leads/custom-field-filter-encoding';
import { readUtmSelection, toUtmFiltersPayload } from '@/components/shared/leads/utm-filter-encoding';

export const ALL_SESSIONS_ID = '__ALL__';
export const TERMINATED_STATUS = 'TERMINATED';

export const useStudentFilters = (options: { allowAllSessions?: boolean } = {}) => {
    const { allowAllSessions = false } = options;
    const { t } = useTranslation('manageStudentsUseStudentFilters');
    const navigate = useNavigate();
    const searchParams = useSearch({ strict: false }) as Record<string, any>;
    const INSTITUTE_ID = getCurrentInstituteId();
    const { getAllSessions, instituteDetails } = useInstituteDetailsStore();
    const { selectedSession, setSelectedSession } = useSelectedSessionStore();
    // Free-text custom fields (e.g. VetEducation's "Practice Type") have no fixed
    // DROPDOWN option list, so they aren't part of instituteDetails.dropdown_custom_fields
    // — pull the full field catalog and keep only TEXT-type entries. Shares its
    // React Query cache key with any other caller (e.g. the leads filter bar), so
    // this never triggers a second network request.
    const { data: customFieldSetup } = useCustomFieldSetup(INSTITUTE_ID || undefined);
    const textCustomFields = useMemo(
        () => (customFieldSetup ?? []).filter((f) => (f.field_type || '').toUpperCase() === 'TEXT'),
        [customFieldSetup]
    );
    // DATE/NUMBER custom fields get the range popover (typed operators) instead
    // of a value multi-select. Only shown when enabled in the settings gate
    // (students-list-section decides that); the payload builder below still
    // scans all of them so an applied selection always reaches the request.
    const rangeCustomFields = useMemo(
        () => (customFieldSetup ?? []).filter((f) => isRangeFieldType(f.field_type)),
        [customFieldSetup]
    );
    const [columnFilters, setColumnFilters] = useState<
        { id: string; value: { id: string; label: string }[] }[]
    >([]);
    const [searchInput, setSearchInput] = useState<string>('');
    const [searchFilter, setSearchFilter] = useState('');
    const [clearFilters, setClearFilters] = useState<boolean>(false);
    const hasInitializedFilters = useRef(false);
    // Statuses sent when the admin hasn't picked any. A search by name/email also includes
    // TERMINATED, so a member removed from every batch is still findable without first
    // guessing to pick Terminated in the Status filter; the unsearched list is unchanged.
    const defaultStatusesFor = (name?: string): string[] => {
        const base: string[] = instituteDetails?.student_statuses || [];
        return name?.trim() && !base.includes(TERMINATED_STATUS)
            ? [...base, TERMINATED_STATUS]
            : base;
    };
    const hasExplicitStatusFilter = () =>
        columnFilters.some(
            (f) => (f.id === 'statuses' || f.id === 'approval_statuses') && f.value.length > 0
        );
    const buildAllOption = (): DropdownItemType => ({
        id: ALL_SESSIONS_ID,
        name: t('sessionSelector.allOption', {
            term: getTerminologyPlural(ContentTerms.Session, SystemTerms.Session),
        }),
    });
    const buildSessionList = (): DropdownItemType[] => {
        const sessions = getAllSessions().map((session) => ({
            id: session.id,
            name: session.session_name,
        }));
        return allowAllSessions ? [buildAllOption(), ...sessions] : sessions;
    };

    const [sessionList, setSessionList] = useState<DropdownItemType[]>(buildSessionList());
    const [currentSession, setCurrentSession] = useState<DropdownItemType>(() => {
        const urlSessionId = searchParams.session as string | undefined;
        if (urlSessionId) {
            const urlSession = sessionList.find((s) => s.id === urlSessionId);
            if (urlSession) return urlSession;
        }
        if (allowAllSessions) return buildAllOption();
        const defaultSession = sessionList[0] || { id: '', name: '' };
        return selectedSession && sessionList.find((session) => session.id === selectedSession.id)
            ? { id: selectedSession.id, name: selectedSession.session_name }
            : defaultSession;
    });

    useEffect(() => {
        setSessionList(buildSessionList());
        // Preserve the synthetic "All" selection across institute reloads.
        if (currentSession?.id === ALL_SESSIONS_ID) return;
        if (currentSession && sessionList.includes(currentSession)) {
            const session = getAllSessions().find((session) => session.id === currentSession.id);
            if (session) {
                setSelectedSession(session);
            }
        } else {
            const defaultSession = sessionList[0] || { id: '', name: '' };
            const newSession = selectedSession
                ? { id: selectedSession.id, name: selectedSession.session_name }
                : defaultSession;
            setCurrentSession(newSession);
            const session = getAllSessions().find((session) => session.id === newSession.id);
            if (session) {
                setSelectedSession(session);
            }
        }
    }, [instituteDetails]);

    const [allPackageSessionIds, setAllPackageSessionIds] = useState<string[]>([]);

    // Ref to track if we've done the initial package session setup
    const hasInitialSessionSetupRef = useRef(false);

    // Compute initial package session IDs from current session
    const getPackageSessionIdsForSession = useCallback((sessionId: string) => {
        if (sessionId === ALL_SESSIONS_ID) return [];
        return (instituteDetails?.batches_for_sessions || [])
            .filter((batch) => batch.session.id === sessionId)
            .map((batch) => batch.id);
    }, [instituteDetails]);

    const [appliedFilters, setAppliedFilters] = useState<StudentFilterRequest>(() => {
        // URL session param takes highest priority so refresh preserves the selected session.
        // When "All sessions" is the default (no URL param), send empty PS list — backend treats
        // empty as "no filter" and returns customers across every session.
        const urlSessionId = searchParams.session as string | undefined;
        let initialPksIds: string[];
        if (!urlSessionId && allowAllSessions) {
            initialPksIds = [];
        } else {
            const initialSessionId =
                urlSessionId ||
                selectedSession?.id ||
                getAllSessions()[0]?.id ||
                '';
            initialPksIds = (instituteDetails?.batches_for_sessions || [])
                .filter((batch) => batch.session.id === initialSessionId)
                .map((batch) => batch.id);
        }

        return {
            name: '',
            institute_ids: INSTITUTE_ID ? [INSTITUTE_ID] : [],
            package_session_ids: initialPksIds,
            group_ids: [],
            gender: [],
            statuses: instituteDetails?.student_statuses || [],
            session_expiry_days: [],
            sort_columns: {},
            sub_org_user_types: [],
            payment_statuses: [],
            sources: [],
            types: [],
            type_ids: [],
            destination_package_session_ids: [],
            level_ids: [],
        };
    });

    useEffect(() => {
        let pksIds =
            columnFilters
                .find((filter) => filter.id === 'batch')
                ?.value.map((option) => option.id) ||
            getPackageSessionIdsForSession(currentSession.id);

        // Check active status filters (both regular and approval) to see if we need to force empty batches
        const statusFilter = columnFilters.find((filter) => filter.id === 'statuses');
        const approvalFilter = columnFilters.find((filter) => filter.id === 'approval_statuses');

        const activeStatuses = [
            ...(statusFilter?.value.map(opt => opt.label) || []),
            ...(approvalFilter?.value.map(opt => opt.id) || [])
        ];

        if (activeStatuses.some(s => ['INVITED', 'PENDING_FOR_APPROVAL'].includes(s))) {
            pksIds = [];
        }

        setAllPackageSessionIds(pksIds);
    }, [currentSession, getPackageSessionIdsForSession, columnFilters]);

    useEffect(() => {
        if (columnFilters.length === 0) {
            setClearFilters(false);
        }
    }, [columnFilters.length]);

    // Initialize filters from URL params
    useEffect(() => {
        if (!instituteDetails) return;

        // Prevent running this logic multiple times
        if (hasInitializedFilters.current) return;
        hasInitializedFilters.current = true;

        const initialFilters: { id: string; value: { id: string; label: string }[] }[] = [];

        // Session from URL - set current session if provided
        if (searchParams.session) {
            const session = getAllSessions().find((s) => s.id === searchParams.session);
            if (session) {
                const sessionItem = { id: session.id, name: session.session_name };
                setCurrentSession(sessionItem);
                setSelectedSession(session);
                // Sync package_session_ids with the URL session immediately so the
                // first API call uses the correct session, not the default/store session.
                const sessionPksIds = (instituteDetails?.batches_for_sessions || [])
                    .filter((batch) => batch.session.id === session.id)
                    .map((batch) => batch.id);
                setAppliedFilters((prev) => ({
                    ...prev,
                    package_session_ids: sessionPksIds,
                }));
            }
        } else if (currentSession?.id && currentSession.id !== ALL_SESSIONS_ID) {
            // Set session in URL if not present. Skip for the synthetic "All" — we
            // intentionally keep the URL clean so refresh stays on the All view.
            const currentParams = new URLSearchParams(window.location.search);
            currentParams.set('session', currentSession.id);
            const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
            window.history.replaceState({}, '', newUrl);
        }

        // Role filter from URL
        if (searchParams.role) {
            const roles = Array.isArray(searchParams.role) ? searchParams.role : [searchParams.role];
            const roleOptions = roles.map((roleId) => ({
                id: roleId,
                label: roleId.replace(/_/g, ' '),
            }));
            if (roleOptions.length > 0) {
                initialFilters.push({ id: 'sub_org_user_types', value: roleOptions });
            }
        }

        // Gender filter from URL
        if (searchParams.gender) {
            const genders = Array.isArray(searchParams.gender) ? searchParams.gender : [searchParams.gender];
            // Deduplicate genders from URL
            const uniqueGenders = [...new Set(genders)];
            const genderOptions = uniqueGenders.map((gender) => ({
                id: gender,
                label: gender,
            }));
            if (genderOptions.length > 0) {
                initialFilters.push({ id: 'gender', value: genderOptions });
            }
        }

        // Status filter from URL
        if (searchParams.status) {
            const statuses = Array.isArray(searchParams.status) ? searchParams.status : [searchParams.status];
            // Deduplicate statuses from URL
            const uniqueStatuses = [...new Set(statuses)];
            const statusOptions = uniqueStatuses.map((status) => ({
                id: status,
                label: status,
            }));
            if (statusOptions.length > 0) {
                initialFilters.push({ id: 'statuses', value: statusOptions });
            }
        }

        // Batch filter from URL. The label is the batch's own name where it has
        // one — labelling it with the course name gave every batch of a course an
        // identical chip, so the chip never said which batch was being shown.
        // ?batchName= selects every batch carrying that name, across all courses,
        // so a sidebar tab like "Flexi Student" keeps up with batches created
        // later instead of freezing a list of ids. Those batches all share the
        // name, so their chips are labelled by course.
        const toList = (v: unknown): string[] =>
            v ? (Array.isArray(v) ? v : [v]).map((x) => String(x)) : [];
        const batchIds = toList(searchParams.batch);
        const batchNames = toList(searchParams.batchName).map((n) => n.trim().toLowerCase());
        if (batchIds.length > 0 || batchNames.length > 0) {
            const batchOptions =
                instituteDetails.batches_for_sessions
                    ?.filter(
                        (batch) =>
                            batchIds.includes(batch.id) ||
                            batchNames.includes((batch.name ?? '').trim().toLowerCase())
                    )
                    .map((batch) => ({
                        id: batch.id,
                        label: batchIds.includes(batch.id)
                            ? getBatchOwnName(batch) || batch.package_dto?.package_name || batch.id
                            : batch.package_dto?.package_name || getBatchOwnName(batch) || batch.id,
                    })) || [];
            if (batchOptions.length > 0) {
                initialFilters.push({ id: 'batch', value: batchOptions });
            }
        }

        // Session expiry filter from URL (using camelCase)
        if (searchParams.sessionExpiry) {
            const expiries = Array.isArray(searchParams.sessionExpiry)
                ? searchParams.sessionExpiry
                : [searchParams.sessionExpiry];
            const expiryOptions = expiries.map((days) => ({
                id: String(days),
                label: t('filterOptions.sessionExpiryDays', { count: Number(days) }),
            }));
            if (expiryOptions.length > 0) {
                initialFilters.push({ id: 'session_expiry_days', value: expiryOptions });
            }
        }

        // Name filter from URL — push into appliedFilters immediately so the first API
        // call uses the name. Without this, only the search input was hydrated and the
        // "apply" block below (which propagates to appliedFilters) was gated on
        // initialFilters.length > 0 — which excludes name-only URL loads.
        if (searchParams.name) {
            const name = searchParams.name as string;
            setSearchInput(name);
            setSearchFilter(name);
            setAppliedFilters((prev) => ({
                ...prev,
                name,
                ...(!searchParams.status && !searchParams.approvalStatus
                    ? { statuses: defaultStatusesFor(name) }
                    : {}),
            }));
        }

        // Payment Status filter from URL
        if (searchParams.paymentStatus) {
            const statuses = Array.isArray(searchParams.paymentStatus) ? searchParams.paymentStatus : [searchParams.paymentStatus];
            const options = statuses.map((status: string) => ({
                id: status,
                label:
                    status === 'PAID'
                        ? t('filterOptions.paymentStatus.paid')
                        : status === 'failed'
                          ? t('filterOptions.paymentStatus.failed')
                          : t('filterOptions.paymentStatus.paymentFailed'),
            }));
            if (options.length > 0) {
                initialFilters.push({ id: 'payment_statuses', value: options });
            }
        }

        // Approval Status filter from URL
        if (searchParams.approvalStatus) {
            const statuses = Array.isArray(searchParams.approvalStatus) ? searchParams.approvalStatus : [searchParams.approvalStatus];
            const options = statuses.map((status: string) => ({
                id: status,
                label:
                    status === 'PENDING_FOR_APPROVAL'
                        ? t('filterOptions.approvalStatus.pending')
                        : t('filterOptions.approvalStatus.invited'),
            }));
            if (options.length > 0) {
                initialFilters.push({ id: 'approval_statuses', value: options });
            }
        }

        // Learner Type filter from URL (e.g., ABANDONED_CART)
        if (searchParams.learnerType) {
            const learnerType = searchParams.learnerType;
            const options = [{
                id: learnerType,
                label:
                    learnerType === 'ABANDONED_CART'
                        ? t('filterOptions.learnerType.abandonedCart')
                        : learnerType,
            }];
            initialFilters.push({ id: 'learner_type', value: options });
        }

        // Audience filter from URL — label falls back to id; the filter chip resolves
        // the proper campaign name once the campaigns list loads in the parent section.
        if (searchParams.audienceId) {
            const audienceIds = Array.isArray(searchParams.audienceId)
                ? searchParams.audienceId
                : [searchParams.audienceId];
            const audienceOptions = [...new Set(audienceIds as string[])].map((id) => ({
                id,
                label: id,
            }));
            if (audienceOptions.length > 0) {
                initialFilters.push({ id: 'audience_ids', value: audienceOptions });
            }
        }

        // Enroll invite filter from URL — same id-as-label fallback.
        if (searchParams.enrollInviteId) {
            const inviteIds = Array.isArray(searchParams.enrollInviteId)
                ? searchParams.enrollInviteId
                : [searchParams.enrollInviteId];
            const inviteOptions = [...new Set(inviteIds as string[])].map((id) => ({
                id,
                label: id,
            }));
            if (inviteOptions.length > 0) {
                initialFilters.push({ id: 'enroll_invite_ids', value: inviteOptions });
            }
        }

        // Custom field filters from URL
        if (instituteDetails?.dropdown_custom_fields) {
            instituteDetails.dropdown_custom_fields.forEach((customField) => {
                const urlValues = searchParams[customField.fieldKey];
                if (urlValues) {
                    const values = Array.isArray(urlValues) ? urlValues : [urlValues];
                    try {
                        const config = JSON.parse(customField.config);
                        const matchedOptions = values
                            .map((value) => {
                                const option = config.find((opt: any) => opt.value === value);
                                return option ? { id: option.value, label: option.label } : null;
                            })
                            .filter(Boolean) as { id: string; label: string }[];

                        if (matchedOptions.length > 0) {
                            initialFilters.push({ id: customField.fieldKey, value: matchedOptions });
                        }
                    } catch (error) {
                        console.error(`Error parsing custom field ${customField.fieldName}:`, error);
                    }
                }
            });
        }

        // Free-text custom field filters from URL — no fixed option list to match
        // against, so each stored value is its own id/label.
        textCustomFields.forEach((customField) => {
            const urlValues = searchParams[customField.field_key];
            if (urlValues) {
                const values = Array.isArray(urlValues) ? urlValues : [urlValues];
                const options = [...new Set(values as string[])].map((value) => ({
                    id: value,
                    label: sentinelLabel(value) ?? value,
                }));
                if (options.length > 0) {
                    initialFilters.push({ id: customField.field_key, value: options });
                }
            }
        });

        if (initialFilters.length > 0) {
            setColumnFilters(initialFilters);
            // Mark that filters have been loaded from URL so they appear as "applied"
            // This ensures the UI shows them as active filters
            setClearFilters(false);

            // Apply the URL filters immediately on initial load
            // Calculate filters from initialFilters to apply them
            const statusFilter = initialFilters.find((filter) => filter.id === 'statuses');
            const statusesToApply = statusFilter?.value.map((option) => option.label) || [];

            const approvalStatusFilter = initialFilters.find((filter) => filter.id === 'approval_statuses');
            const approvalStatusesToApply = approvalStatusFilter?.value.map((option) => option.id) || [];

            // Combine regular statuses and approval statuses
            // Logic: If ANY status filter (regular or approval) is set, use ONLY those.
            // If NO status filter is set, we use default regular statuses.
            let finalStatusesToApply: string[] = [];

            if (statusesToApply.length > 0 || approvalStatusesToApply.length > 0) {
                finalStatusesToApply = [...statusesToApply, ...approvalStatusesToApply];
            } else {
                finalStatusesToApply = defaultStatusesFor(
                    (searchParams.name as string) || searchFilter
                );
            }

            const genderFilter = initialFilters.find((filter) => filter.id === 'gender');
            const gendersToApply = genderFilter?.value.map((option) => option.label) || [];

            const roleFilter = initialFilters.find((filter) => filter.id === 'sub_org_user_types');
            const rolesToApply = roleFilter?.value.map((option) => option.id) || [];

            const batchFilter = initialFilters.find((filter) => filter.id === 'batch');
            // Use the URL session ID if present — currentSession state is stale here because
            // setCurrentSession called above hasn't re-rendered yet.
            const resolvedSessionId = (searchParams.session as string) || currentSession.id;
            let pksids = batchFilter?.value.map((option) => option.id) ||
                (instituteDetails?.batches_for_sessions || [])
                    .filter((batch) => batch.session.id === resolvedSessionId)
                    .map((batch) => batch.id);

            // Special handling for Invited/Pending statuses:
            // These students might not be assigned to a batch yet, so we must clear the batch filter
            // to allow global search across the institute for these statuses.
            // Handle learner type filter (e.g., ABANDONED_CART) - need this early for package_session_ids logic
            const learnerTypeFilter = initialFilters.find((filter) => filter.id === 'learner_type');
            const learnerTypeToApply = learnerTypeFilter?.value[0]?.id || undefined;

            // If ABANDONED_CART is selected, package_session_ids should be empty
            const isAbandonedCart = learnerTypeToApply === 'ABANDONED_CART';

            // Store original pksids for destination_package_session_ids before clearing
            const originalPksids = [...pksids];

            // For ABANDONED_CART, calculate destination_package_session_ids
            let destinationPksids: string[] = [];
            if (isAbandonedCart) {
                // If user selected specific batches, use those; otherwise use all batches for current session
                const batchFilter = initialFilters.find((filter) => filter.id === 'batch');
                const selectedBatchIds = batchFilter?.value.map((option) => option.id);
                destinationPksids = selectedBatchIds && selectedBatchIds.length > 0 
                    ? selectedBatchIds 
                    : originalPksids;
            }

            if (finalStatusesToApply.some(s => ['INVITED', 'PENDING_FOR_APPROVAL'].includes(s)) || isAbandonedCart) {
                pksids = [];
            }

            const sessionExpiryFilter = initialFilters.find((filter) => filter.id === 'session_expiry_days');
            const sessionExpiryDays = sessionExpiryFilter?.value.map((value) => {
                const numberMatch = value.label.match(/\d+/);
                return numberMatch ? parseInt(numberMatch[0]) : 0;
            }) || [];

            const paymentStatusFilter = initialFilters.find((filter) => filter.id === 'payment_statuses');
            const paymentStatusesToApply = paymentStatusFilter?.value.map((option) => option.id) || [];

            // approvalStatusFilter already declared above
            // approvalStatusesToApply already declared above

            // Handle custom field filters — keyed by custom_field.id, matching the
            // backend's StudentListFilter.customFieldFilters (Map<String, List<String>>).
            const customFieldFilters: Record<string, string[]> = {};
            if (instituteDetails?.dropdown_custom_fields) {
                instituteDetails.dropdown_custom_fields.forEach((customField) => {
                    const filter = initialFilters.find((f) => f.id === customField.fieldKey);
                    if (filter && filter.value.length > 0) {
                        customFieldFilters[customField.id] = filter.value.map((option) => option.id);
                    }
                });
            }
            textCustomFields.forEach((customField) => {
                const filter = initialFilters.find((f) => f.id === customField.field_key);
                if (filter && filter.value.length > 0) {
                    customFieldFilters[customField.custom_field_id] = filter.value.map(
                        (option) => option.id
                    );
                }
            });
            rangeCustomFields.forEach((customField) => {
                const filter = initialFilters.find((f) => f.id === customField.field_key);
                if (filter && filter.value.length > 0) {
                    customFieldFilters[customField.custom_field_id] = filter.value.map(
                        (option) => option.id
                    );
                }
            });

            // Sentinel selections (contains / empty / ranges) go to the typed
            // list; plain values keep the legacy values-IN map shape.
            const { legacy: legacyCfFilters, typed: typedCfFilters } =
                splitLegacyAndTyped(customFieldFilters);

            setAppliedFilters((prev) => ({
                ...prev,
                // Use URL value directly — searchFilter state hasn't flushed yet within this effect.
                name: (searchParams.name as string) || searchFilter || '',
                package_session_ids: pksids,
                destination_package_session_ids: isAbandonedCart ? destinationPksids : [],
                gender: gendersToApply,
                statuses: finalStatusesToApply,
                session_expiry_days: sessionExpiryDays,
                sub_org_user_types: rolesToApply,
                payment_statuses: paymentStatusesToApply,
                type: learnerTypeToApply,
                // approval_statuses is removed, merged into statuses
                ...(Object.keys(legacyCfFilters).length > 0
                    ? { custom_field_filters: legacyCfFilters }
                    : { custom_field_filters: undefined }),
                ...(typedCfFilters.length > 0
                    ? { custom_field_typed_filters: typedCfFilters }
                    : { custom_field_typed_filters: undefined }),
            }));
        }
    }, [instituteDetails, searchParams]);

    const handleSessionChange = (value: DropdownValueType) => {
        if (value && typeof value === 'object' && 'id' in value && 'name' in value) {
            const newSessionId = (value as DropdownItemType).id;
            setCurrentSession(value as DropdownItemType);

            // "All sessions" branch: clear PS scoping, drop session/batch from URL.
            // Leave useSelectedSessionStore untouched — it's shared with other pages
            // (Study Library, reports, etc.) that require a real session selection.
            if (newSessionId === ALL_SESSIONS_ID) {
                setColumnFilters((prev) => prev.filter((f) => f.id !== 'batch'));
                setAppliedFilters((prev) => ({
                    ...prev,
                    package_session_ids: [],
                }));
                const currentParams = new URLSearchParams(window.location.search);
                currentParams.delete('session');
                currentParams.delete('batch');
                currentParams.delete('batchName');
                const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
                window.history.replaceState({}, '', newUrl);
                return;
            }

            const session = getAllSessions().find(
                (session) => session.id === newSessionId
            );
            if (session) {
                setSelectedSession(session);

                // Clear any existing batch filter when session changes
                // This ensures we show ALL students from the new session
                setColumnFilters((prev) => prev.filter((f) => f.id !== 'batch'));

                // Get all batch IDs (package_session_ids) for the new session
                const newSessionBatchIds = (instituteDetails?.batches_for_sessions || [])
                    .filter((batch) => batch.session.id === newSessionId)
                    .map((batch) => batch.id);

                // Update applied filters with new session's batch IDs
                // This triggers the API call to fetch students for the new session
                setAppliedFilters((prev) => ({
                    ...prev,
                    package_session_ids: newSessionBatchIds,
                    // Clear name search when switching sessions for cleaner UX
                }));

                // Update session in URL and clear batch param
                const currentParams = new URLSearchParams(window.location.search);
                currentParams.set('session', session.id);
                currentParams.delete('batch'); // Clear batch from URL
                currentParams.delete('batchName');
                const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
                window.history.replaceState({}, '', newUrl);
            }
        }
    };

    const handleFilterChange = (filterId: string, options: { id: string; label: string }[]) => {
        setColumnFilters((prev) => {
            const existing = prev.filter((f) => f.id !== filterId);
            if (options.length === 0 && filterId === 'statuses') {
                // If clearing status filter, use all API-provided statuses
                return existing;
            }
            if (options.length === 0) return existing;
            return [...existing, { id: filterId, value: options }];
        });
    };

    const handleFilterClick = async () => {
        const sessionExpiryFilter = columnFilters.find(
            (filter) => filter.id === 'session_expiry_days'
        );
        const sessionExpiryDays = sessionExpiryFilter?.value.map((value) => {
            const numberMatch = value.label.match(/\d+/);
            return numberMatch ? parseInt(numberMatch[0]) : 0;
        });

        // Determine statuses to apply
        let finalStatusesToApply: string[] = [];

        // Check if we have any "regular" statuses selected
        const statusFilter = columnFilters.find((filter) => filter.id === 'statuses');
        const statusesToApply = statusFilter?.value.map((opt) => opt.label) || [];
        if (statusesToApply.length > 0) {
            finalStatusesToApply = [...finalStatusesToApply, ...statusesToApply];
        }

        // Check if we have any "approval" statuses selected
        const approvalFilter = columnFilters.find((filter) => filter.id === 'approval_statuses');
        const approvalStatusesToApply = approvalFilter?.value.map((opt) => opt.id) || [];
        if (approvalStatusesToApply.length > 0) {
            finalStatusesToApply = [...finalStatusesToApply, ...approvalStatusesToApply];
        }

        // If NO status filters are selected (regular or approval), default to ACTIVE/INACTIVE
        if (finalStatusesToApply.length === 0) {
            finalStatusesToApply = defaultStatusesFor(searchFilter);
        }

        // Handle Package Session IDs
        // Requirement: If INVITED or PENDING_FOR_APPROVAL status is selected (explicitly), 
        // we MUST send empty package_session_ids to search globally.
        let finalPackageSessionIds: string[] = [];
        let destinationPackageSessionIds: string[] = [];

        // Combine all explicitly selected statuses to check for special ones
        const allExplicitStatuses = [...statusesToApply, ...approvalStatusesToApply];
        const hasSpecialStatus = allExplicitStatuses.some(s =>
            ['INVITED', 'PENDING_FOR_APPROVAL', 'Invited', 'Pending for Approval'].includes(s)
        );

        // Get Learner Type filter (e.g., ABANDONED_CART) - need this early for package_session_ids logic
        const learnerTypeFilter = columnFilters.find((filter) => filter.id === 'learner_type');
        const learnerType = learnerTypeFilter?.value[0]?.id || undefined;

        // If ABANDONED_CART is selected, package_session_ids should be empty
        const isAbandonedCart = learnerType === 'ABANDONED_CART';

        // Get selected batch IDs from filter
        const selectedBatchIds = columnFilters.find((filter) => filter.id === 'batch')?.value.map((option) => option.id);

        if (hasSpecialStatus || isAbandonedCart) {
            finalPackageSessionIds = [];
            // For ABANDONED_CART, set destination_package_session_ids
            if (isAbandonedCart) {
                // If user selected specific batches, use those; otherwise use all batches
                destinationPackageSessionIds = selectedBatchIds && selectedBatchIds.length > 0 
                    ? selectedBatchIds 
                    : allPackageSessionIds;
            }
        } else {
            finalPackageSessionIds = selectedBatchIds || allPackageSessionIds;
        }

        // Get Payment Statuses
        const paymentFilter = columnFilters.find((filter) => filter.id === 'payment_statuses');
        const paymentStatuses = paymentFilter ? paymentFilter.value.map((opt) => opt.id) : [];

        // Membership (Trial / Paid) — learner-only, so the backend drops audience-only rows
        // whenever it is set: someone with no plan is neither.
        const membershipFilter = columnFilters.find((filter) => filter.id === 'membership_types');
        const membershipTypes = membershipFilter ? membershipFilter.value.map((opt) => opt.id) : [];

        // Joined -> the existing start_date/end_date range over ssigm.enrolled_date. The
        // control encodes its selection as "from:DD/MM/YYYY" / "to:DD/MM/YYYY"; the API wants
        // YYYY-MM-DD, so convert here rather than teaching the shared control a second format.
        const joinedFilter = columnFilters.find((filter) => filter.id === 'joined_range');
        const joinedValues = joinedFilter ? joinedFilter.value.map((opt) => opt.id) : [];
        const joinedFrom = toIsoDate(joinedValues.find((v) => v.startsWith('from:'))?.slice(5));
        const joinedTo = toIsoDate(joinedValues.find((v) => v.startsWith('to:'))?.slice(3));
        const joinedRange =
            joinedFrom && joinedTo ? { start_date: joinedFrom, end_date: joinedTo } : {};

        // Handle custom field filters — keyed by custom_field.id, matching the
        // backend's StudentListFilter.customFieldFilters (Map<String, List<String>>).
        const customFieldFilters: Record<string, string[]> = {};
        if (instituteDetails?.dropdown_custom_fields) {
            instituteDetails.dropdown_custom_fields.forEach((customField) => {
                const filter = columnFilters.find((f) => f.id === customField.fieldKey);
                if (filter && filter.value.length > 0) {
                    customFieldFilters[customField.id] = filter.value.map((option) => option.id);
                }
            });
        }
        textCustomFields.forEach((customField) => {
            const filter = columnFilters.find((f) => f.id === customField.field_key);
            if (filter && filter.value.length > 0) {
                customFieldFilters[customField.custom_field_id] = filter.value.map(
                    (option) => option.id
                );
            }
        });
        rangeCustomFields.forEach((customField) => {
            const filter = columnFilters.find((f) => f.id === customField.field_key);
            if (filter && filter.value.length > 0) {
                customFieldFilters[customField.custom_field_id] = filter.value.map(
                    (option) => option.id
                );
            }
        });

        // Sentinel selections (contains / empty / ranges) go to the typed list;
        // plain values keep the legacy values-IN map shape.
        const { legacy: legacyCfFilters, typed: typedCfFilters } =
            splitLegacyAndTyped(customFieldFilters);

        const gendersToApply = columnFilters.find((filter) => filter.id === 'gender')?.value.map((option) => option.label) || [];
        const rolesToApply = columnFilters.find((filter) => filter.id === 'sub_org_user_types')?.value.map((option) => option.id) || [];
        const enrollInviteFilter = columnFilters.find((filter) => filter.id === 'enroll_invite_ids');
        const enrollInviteIds = enrollInviteFilter?.value.map((opt) => opt.id) || [];
        const audienceFilter = columnFilters.find((filter) => filter.id === 'audience_ids');
        const audienceIds = audienceFilter?.value.map((opt) => opt.id) || [];
        const subOrgFilter = columnFilters.find((filter) => filter.id === 'sub_org_ids');
        const subOrgIds = subOrgFilter?.value.map((opt) => opt.id) || [];

        const newFilters: StudentFilterRequest = {
            name: searchFilter,
            package_session_ids: finalPackageSessionIds,
            destination_package_session_ids: isAbandonedCart ? destinationPackageSessionIds : [],
            gender: gendersToApply,
            statuses: finalStatusesToApply,
            session_expiry_days: sessionExpiryDays || [],
            sub_org_user_types: rolesToApply,
            institute_ids: INSTITUTE_ID ? [INSTITUTE_ID] : [],
            group_ids: [],
            sort_columns: {},
            payment_statuses: paymentStatuses,
            type: learnerType,
            ...(membershipTypes.length > 0 ? { membership_types: membershipTypes } : {}),
            ...joinedRange,
            ...(enrollInviteIds.length > 0 ? { enroll_invite_ids: enrollInviteIds } : {}),
            ...(audienceIds.length > 0 ? { audience_ids: audienceIds } : {}),
            ...(subOrgIds.length > 0 ? { sub_org_ids: subOrgIds } : {}),
            ...(Object.keys(legacyCfFilters).length > 0
                ? { custom_field_filters: legacyCfFilters }
                : {}),
            ...(typedCfFilters.length > 0
                ? { custom_field_typed_filters: typedCfFilters }
                : {}),
        };
        // Campaign (UTM) filters ride columnFilters under `utm:<dimension>`
        // (set by the UtmFilterControls pills) and apply with the same button.
        const utmFilters = toUtmFiltersPayload(readUtmSelection(columnFilters));
        if (utmFilters) newFilters.utm_filters = utmFilters;

        setAppliedFilters(newFilters);

        // Build URL search params
        const currentParams = new URLSearchParams(window.location.search);

        // Remove old filter params
        currentParams.delete('name');
        currentParams.delete('role');
        currentParams.delete('gender');
        currentParams.delete('status');
        currentParams.delete('batch');
        currentParams.delete('batchName');
        currentParams.delete('sessionExpiry');
        currentParams.delete('learnerType');
        currentParams.delete('paymentStatus');
        currentParams.delete('approvalStatus');
        currentParams.delete('audienceId');
        currentParams.delete('enrollInviteId');

        // Remove old custom field params
        if (instituteDetails?.dropdown_custom_fields) {
            instituteDetails.dropdown_custom_fields.forEach((customField) => {
                currentParams.delete(customField.fieldKey);
            });
        }
        textCustomFields.forEach((customField) => {
            currentParams.delete(customField.field_key);
        });
        rangeCustomFields.forEach((customField) => {
            currentParams.delete(customField.field_key);
        });

        // Keep session — but never write the synthetic "All" sentinel to the URL.
        if (currentSession?.id && currentSession.id !== ALL_SESSIONS_ID) {
            currentParams.set('session', currentSession.id);
        } else {
            currentParams.delete('session');
        }

        // Add new filter values
        if (searchFilter) {
            currentParams.set('name', searchFilter);
        }

        if (rolesToApply.length > 0) {
            [...new Set(rolesToApply)].forEach(role => currentParams.append('role', role));
        }

        if (gendersToApply.length > 0) {
            [...new Set(gendersToApply)].forEach(gender => currentParams.append('gender', gender));
        }

        if (statusesToApply.length > 0) {
            [...new Set(statusesToApply)].forEach(status => currentParams.append('status', status));
        }

        // Persist the user's explicit batch chip selection — not finalPackageSessionIds,
        // which falls back to session-wide batches when the chip is empty. That fallback
        // would either bloat the URL with implied IDs or get suppressed by the now-removed
        // count comparison, neither of which gave a faithful round-trip on reload.
        if (selectedBatchIds && selectedBatchIds.length > 0) {
            [...new Set(selectedBatchIds)].forEach((batch) =>
                currentParams.append('batch', batch)
            );
        }

        if (sessionExpiryDays && sessionExpiryDays.length > 0) {
            [...new Set(sessionExpiryDays)].forEach(days => currentParams.append('sessionExpiry', String(days)));
        }

        if (paymentStatuses.length > 0) {
            [...new Set(paymentStatuses)].forEach(status => currentParams.append('paymentStatus', status));
        }

        if (approvalStatusesToApply.length > 0) {
            [...new Set(approvalStatusesToApply)].forEach(status => currentParams.append('approvalStatus', status));
        }

        if (learnerType) {
            currentParams.set('learnerType', learnerType);
        }

        if (audienceIds.length > 0) {
            [...new Set(audienceIds)].forEach((id) => currentParams.append('audienceId', id));
        }

        if (enrollInviteIds.length > 0) {
            [...new Set(enrollInviteIds)].forEach((id) => currentParams.append('enrollInviteId', id));
        }

        // Handle custom field filters
        if (instituteDetails?.dropdown_custom_fields) {
            instituteDetails.dropdown_custom_fields.forEach((customField) => {
                const filter = columnFilters.find((f) => f.id === customField.fieldKey);
                if (filter && filter.value.length > 0) {
                    const uniqueValues = [...new Set(filter.value.map(opt => opt.id))];
                    uniqueValues.forEach(value => {
                        currentParams.append(customField.fieldKey, value);
                    });
                }
            });
        }
        textCustomFields.forEach((customField) => {
            const filter = columnFilters.find((f) => f.id === customField.field_key);
            if (filter && filter.value.length > 0) {
                const uniqueValues = [...new Set(filter.value.map((opt) => opt.id))];
                uniqueValues.forEach((value) => {
                    currentParams.append(customField.field_key, value);
                });
            }
        });
        // Range (DATE/NUMBER) selections are sentinel-encoded strings — write
        // them like text values so an applied range survives a reload (the
        // URL-init effect decodes them back into typed filter entries).
        rangeCustomFields.forEach((customField) => {
            const filter = columnFilters.find((f) => f.id === customField.field_key);
            if (filter && filter.value.length > 0) {
                const uniqueValues = [...new Set(filter.value.map((opt) => opt.id))];
                uniqueValues.forEach((value) => {
                    currentParams.append(customField.field_key, value);
                });
            }
        });

        const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
        window.history.replaceState({}, '', newUrl);
    };

    const handleClearFilters = async () => {
        setClearFilters(true);
        setColumnFilters([]);
        setSearchFilter('');
        setSearchInput('');

        const pksids = currentSession.id === ALL_SESSIONS_ID
            ? []
            : (instituteDetails?.batches_for_sessions || [])
                .filter((batch) => batch.session.id === currentSession.id)
                .map((batch) => batch.id);

        // Clear filter params but preserve other URL params (like courseId)
        const currentParams = new URLSearchParams(window.location.search);

        // Remove only filter-related params
        currentParams.delete('name');
        currentParams.delete('role');
        currentParams.delete('gender');
        currentParams.delete('status');
        currentParams.delete('batch');
        currentParams.delete('batchName');
        currentParams.delete('sessionExpiry');
        currentParams.delete('paymentStatus');
        currentParams.delete('approvalStatus');
        currentParams.delete('learnerType');
        currentParams.delete('audienceId');
        currentParams.delete('enrollInviteId');

        // Remove custom field params
        if (instituteDetails?.dropdown_custom_fields) {
            instituteDetails.dropdown_custom_fields.forEach((customField) => {
                currentParams.delete(customField.fieldKey);
            });
        }
        textCustomFields.forEach((customField) => {
            currentParams.delete(customField.field_key);
        });
        rangeCustomFields.forEach((customField) => {
            currentParams.delete(customField.field_key);
        });

        // Keep session — but never write the synthetic "All" sentinel to the URL.
        if (currentSession?.id && currentSession.id !== ALL_SESSIONS_ID) {
            currentParams.set('session', currentSession.id);
        } else {
            currentParams.delete('session');
        }

        const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
        window.history.replaceState({}, '', newUrl);

        // Remove all custom field params
        const newFilters: StudentFilterRequest = {
            name: '',
            package_session_ids: pksids,
            gender: [],
            statuses: instituteDetails?.student_statuses || [],
            session_expiry_days: [],
            sub_org_user_types: [],
            institute_ids: INSTITUTE_ID ? [INSTITUTE_ID] : [],
            group_ids: [],
            sort_columns: {},
            payment_statuses: [],
            type: undefined,
        };

        setAppliedFilters(newFilters);
    };

    const handleSearchInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchInput(event.target.value);
    };

    const handleSearchEnter = async () => {
        setSearchFilter(searchInput);

        // Update URL with search name
        const currentParams = new URLSearchParams(window.location.search);
        if (searchInput) {
            currentParams.set('name', searchInput);
        } else {
            currentParams.delete('name');
        }
        const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
        window.history.replaceState({}, '', newUrl);

        setAppliedFilters((prev) => ({
            ...prev,
            name: searchInput,
            ...(hasExplicitStatusFilter() ? {} : { statuses: defaultStatusesFor(searchInput) }),
        }));
    };

    const handleClearSearch = async () => {
        setSearchInput('');
        setSearchFilter('');

        // Remove name from URL but keep session
        const currentParams = new URLSearchParams(window.location.search);
        currentParams.delete('name');
        const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
        window.history.replaceState({}, '', newUrl);

        setAppliedFilters((prev) => ({
            ...prev,
            name: '',
            ...(hasExplicitStatusFilter() ? {} : { statuses: defaultStatusesFor('') }),
        }));
    };

    const getActiveFiltersState = useCallback(() => {
        const batchFilter = columnFilters.find((filter) => filter.id === 'batch');
        const statusFilter = columnFilters.find((filter) => filter.id === 'statuses');
        const sessionExpiryFilter = columnFilters.find(
            (filter) => filter.id === 'session_expiry_days'
        );
        const paymentStatusFilter = columnFilters.find((filter) => filter.id === 'payment_statuses');
        const approvalStatusFilter = columnFilters.find((filter) => filter.id === 'approval_statuses');
        const learnerTypeFilter = columnFilters.find((filter) => filter.id === 'learner_type');

        const hasBatch = Boolean(batchFilter?.value && batchFilter.value.length > 0);
        const hasName = Boolean(appliedFilters.name?.trim());
        const hasGender = Array.isArray(appliedFilters.gender) && appliedFilters.gender.length > 0;
        const hasStatus = Boolean(statusFilter?.value && statusFilter.value.length > 0);
        const hasSessionExpiry = Boolean(
            sessionExpiryFilter?.value && sessionExpiryFilter.value.length > 0
        );
        const hasPaymentStatus = Boolean(paymentStatusFilter?.value && paymentStatusFilter.value.length > 0);
        const hasApprovalStatus = Boolean(approvalStatusFilter?.value && approvalStatusFilter.value.length > 0);
        const hasLearnerType = Boolean(learnerTypeFilter?.value && learnerTypeFilter.value.length > 0);

        return Boolean(hasName || hasGender || hasStatus || hasBatch || hasSessionExpiry || hasPaymentStatus || hasApprovalStatus || hasLearnerType);
    }, [columnFilters, appliedFilters]);

    return {
        columnFilters,
        appliedFilters,
        clearFilters,
        searchInput,
        searchFilter,
        currentSession,
        sessionList,
        getActiveFiltersState,
        handleFilterChange,
        handleFilterClick,
        handleClearFilters,
        handleSearchInputChange,
        handleSearchEnter,
        handleClearSearch,
        setAppliedFilters,
        handleSessionChange,
        setColumnFilters,
        textCustomFields,
        rangeCustomFields,
    };
};

/** "DD/MM/YYYY" (what the shared date-range control emits) -> "YYYY-MM-DD". */
function toIsoDate(value?: string): string | undefined {
    if (!value) return undefined;
    const [day, month, year] = value.split('/');
    if (!day || !month || !year) return undefined;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
