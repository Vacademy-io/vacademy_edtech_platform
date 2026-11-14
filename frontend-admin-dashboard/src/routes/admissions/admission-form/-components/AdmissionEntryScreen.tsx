import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { FilterChips } from '@/components/design-system/chips';
import { MyButton } from '@/components/design-system/button';
import { GraduationCap, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import {
    PillTabs,
    ScreenHeader,
    StatusPill,
    type PillTone,
} from '@/components/shared/crm-enhance/screen-header';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EnquirySearchModal } from '../../-components/EnquirySearchModal';
import { ParentTypeModal } from '../../-components/ParentTypeModal';
import type { EnquiryDetailsResponse } from '../../-services/applicant-services';
import { AdmissionBulkImportDialog } from './AdmissionBulkImportDialog';

export interface StudentSearchResult {
    id: string;
    studentName: string;
    parentName?: string;
    mobile: string;
    classVal: string;
    source?: string;
    status?: string;
    dob: string;
    address: string;
    gender: string;
    email?: string;
    sourceType?: string;
    sourceId?: string;
    destinationPackageSessionId?: string;
    parentGender?: 'father' | 'mother';
    enquiryId?: string | null;
    applicationId?: string | null;
    enquiryTrackingId?: string | null;
}

interface Props {
    onStartAdmission?: (data: Partial<StudentSearchResult> | null, sessionId?: string) => void;
}

const buildDateRanges = (t: TFunction) => [
    { id: 'today', label: t('dateRanges.today') },
    { id: 'last_7_days', label: t('dateRanges.last7Days') },
    { id: 'last_30_days', label: t('dateRanges.last30Days') },
    { id: 'last_3_months', label: t('dateRanges.last3Months') },
    { id: 'last_6_months', label: t('dateRanges.last6Months') },
    { id: 'last_year', label: t('dateRanges.lastYear') },
];

const buildOverallStatuses = (t: TFunction) => [
    { id: 'APPLICATION', label: t('overallStatuses.application') },
    { id: 'ADMISSION', label: t('overallStatuses.admission') },
];

const buildSourceTypes = (t: TFunction) => [
    { id: 'WEBSITE', label: t('sourceTypes.website') },
    { id: 'GOOGLE_ADS', label: t('sourceTypes.googleAds') },
    { id: 'FACEBOOK', label: t('sourceTypes.facebook') },
    { id: 'GOOGLE', label: t('sourceTypes.google') },
    { id: 'FRIENDS', label: t('sourceTypes.friends') },
    { id: 'ZOHO_FORMS', label: t('sourceTypes.zohoForms') },
    { id: 'AUDIENCE_CAMPAIGN', label: t('sourceTypes.audienceCampaign') },
    { id: 'DIRECT_APPLICATION', label: t('sourceTypes.directApplication') },
    { id: 'MANUAL_ADMISSION', label: t('sourceTypes.manualAdmission') },
    { id: 'OTHER', label: t('sourceTypes.other') },
];

// Internal logic keys — NOT translated. `searchBy` state holds one of these literal
// keys and is used only for SEARCH_BY_MAP lookup and backend `search_by` payload
// resolution; the strings shown to users are looked up separately via
// `getSearchByLabel()` below.
const SEARCH_BY_MAP: Record<string, string> = {
    'Student Name': 'STUDENT_NAME',
    'Parent Mobile': 'PARENT_MOBILE',
    'Enquiry No': 'ENQUIRY_NO',
    'Application No': 'APPLICATION_NO',
};

const getSearchByLabel = (t: TFunction, searchBy: string): string => {
    switch (searchBy) {
        case 'Student Name':
            return t('searchByOptions.studentName');
        case 'Application No':
            return t('searchByOptions.applicationNo');
        case 'Parent Mobile':
            return t('searchByOptions.parentMobile');
        default:
            return searchBy;
    }
};

// `status` values come straight from the backend (enquiry/application/admission
// pipeline). Translate the known set for display; fall back to the raw value for
// anything unrecognized so new backend statuses never render blank.
// `gender` values come from the backend as 'MALE' | 'FEMALE' | 'OTHER'. Translate
// the known set; fall back to the raw value for anything unrecognized.
const getGenderLabel = (t: TFunction, gender: string | undefined): string => {
    switch (gender) {
        case 'MALE':
            return t('genderLabels.male');
        case 'FEMALE':
            return t('genderLabels.female');
        case 'OTHER':
            return t('genderLabels.other');
        default:
            return gender || '-';
    }
};

const getStatusLabel = (t: TFunction, status: string | undefined): string => {
    switch (status) {
        case 'NEW':
            return t('statusLabels.new');
        case 'CONTACTED':
            return t('statusLabels.contacted');
        case 'FOLLOW_UP':
            return t('statusLabels.followUp');
        case 'QUALIFIED':
            return t('statusLabels.qualified');
        case 'NOT_ELIGIBLE':
            return t('statusLabels.notEligible');
        case 'ENQUIRY':
            return t('statusLabels.enquiry');
        case 'APPLICATION':
            return t('statusLabels.application');
        case 'ADMISSION':
            return t('statusLabels.admission');
        default:
            return status || '-';
    }
};

/** Pill colour per pipeline status (unknown statuses stay neutral). */
const getStatusTone = (status: string | undefined): PillTone => {
    switch (status) {
        case 'NEW':
        case 'ADMISSION':
            return 'success';
        case 'CONTACTED':
            return 'info';
        case 'FOLLOW_UP':
        case 'ENQUIRY':
            return 'warning';
        case 'QUALIFIED':
        case 'APPLICATION':
            return 'primary';
        case 'NOT_ELIGIBLE':
            return 'danger';
        default:
            return 'neutral';
    }
};

const getSourceLabel = (t: TFunction, source: string | undefined): string => {
    switch (source) {
        case 'WEBSITE':
            return t('sourceTypes.website');
        case 'GOOGLE_ADS':
            return t('sourceTypes.googleAds');
        case 'FACEBOOK':
            return t('sourceTypes.facebook');
        case 'GOOGLE':
            return t('sourceTypes.google');
        case 'FRIENDS':
            return t('sourceTypes.friends');
        case 'ZOHO_FORMS':
            return t('sourceTypes.zohoForms');
        case 'AUDIENCE_CAMPAIGN':
            return t('sourceTypes.audienceCampaign');
        case 'DIRECT_APPLICATION':
            return t('sourceTypes.directApplication');
        case 'MANUAL_ADMISSION':
            return t('sourceTypes.manualAdmission');
        case 'OTHER':
            return t('sourceTypes.other');
        default:
            return source || '-';
    }
};

const getDateRange = (rangeValue: string) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (rangeValue) {
        case 'today':
            return { from: today.toISOString(), to: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString() };
        case 'last_7_days':
            return { from: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
        case 'last_30_days':
            return { from: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
        case 'last_3_months':
            return { from: new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
        case 'last_6_months':
            return { from: new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
        case 'last_year':
            return { from: new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
        default:
            return undefined;
    }
};

const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '-';
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    } catch {
        return '-';
    }
};

export default function AdmissionEntryScreen({ onStartAdmission }: Props) {
    const { t } = useTranslation('admissionsAdmissionEntryScreen');
    const navigate = useNavigate();
    const { instituteDetails, getDetailsFromPackageSessionId } = useInstituteDetailsStore();

    const navigateToForm = (data: Partial<StudentSearchResult> | null, sessionId?: string) => {
        if (onStartAdmission) {
            navigateToForm(data, sessionId);
            return;
        }
        navigate({
            to: '/admissions/admission-form',
            state: { studentData: data, sessionId } as any,
        });
    };

    const sessions = useMemo(() => instituteDetails?.sessions ?? [], [instituteDetails]);
    const [selectedSessionId, setSelectedSessionId] = useState('');
    const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);

    const [initialLoadDone, setInitialLoadDone] = useState(false);

    useEffect(() => {
        if (sessions.length > 0 && !selectedSessionId) {
            setSelectedSessionId(sessions[0]?.id || '');
        }
    }, [sessions, selectedSessionId]);

    const allBatches = instituteDetails?.batches_for_sessions ?? [];

    const packageSessionOptions = useMemo(() => {
        if (!allBatches.length) return [];
        return allBatches
            .filter((batch) => batch.is_parent === true || !batch.parent_id)
            .filter((batch) => !selectedSessionId || batch.session.id === selectedSessionId)
            .map((batch) => ({
                id: batch.id,
                label: `${batch.package_dto.package_name} - ${batch.level.level_name}${batch.name ? ` - ${batch.name}` : ''}`,
            }));
    }, [allBatches, selectedSessionId]);

    const dateRangeOptions = useMemo(() => buildDateRanges(t), [t]);
    const overallStatusOptions = useMemo(() => buildOverallStatuses(t), [t]);
    const sourceTypeOptions = useMemo(() => buildSourceTypes(t), [t]);

    const [searchBy, setSearchBy] = useState('Student Name');
    const [searchValue, setSearchValue] = useState('');
    const [searchResults, setSearchResults] = useState<any[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [totalResponses, setTotalResponses] = useState(0);

    // Default to Admission on initial load.
    const [statusFilters, setStatusFilters] = useState<{ id: string; label: string }[]>([
        { id: 'ADMISSION', label: t('overallStatuses.admission') },
    ]);
    const [sourceFilters, setSourceFilters] = useState<{ id: string; label: string }[]>([]);
    const [dateRangeFilters, setDateRangeFilters] = useState<{ id: string; label: string }[]>([]);
    const [packageSessionFilters, setPackageSessionFilters] = useState<{ id: string; label: string }[]>([]);
    const [sectionFilters, setSectionFilters] = useState<{ id: string; label: string }[]>([]);

    const sectionFilterOptions = useMemo(() => {
        if (packageSessionFilters.length === 0) return [];
        const parentId = packageSessionFilters[0]?.id;
        if (!parentId) return [];
        return allBatches
            .filter((b) => b.parent_id === parentId)
            .map((b) => ({
                id: b.id,
                label: b.name || b.level.level_name,
            }));
    }, [allBatches, packageSessionFilters]);

    const [showAdmissionTypeModal, setShowAdmissionTypeModal] = useState(false);
    const [showEnquiryModal, setShowEnquiryModal] = useState(false);
    const [showApplicationModal, setShowApplicationModal] = useState(false);
    const [showParentTypeModal, setShowParentTypeModal] = useState(false);
    const [pendingEnquiryMapped, setPendingEnquiryMapped] = useState<Partial<StudentSearchResult> | null>(null);
    const [applicationId, setApplicationId] = useState('');
    const [applicationPhone, setApplicationPhone] = useState('');
    const [isLoadingLookup, setIsLoadingLookup] = useState(false);

    const hasActiveFilters = statusFilters.length > 0 || sourceFilters.length > 0 || dateRangeFilters.length > 0 || packageSessionFilters.length > 0 || sectionFilters.length > 0;

    const clearAllFilters = () => {
        setStatusFilters([]);
        setSourceFilters([]);
        setDateRangeFilters([]);
        setPackageSessionFilters([]);
        setSectionFilters([]);
    };

    const handleNewAdmission = () => {
        setShowAdmissionTypeModal(false);
        navigateToForm({ id: '', studentName: '', mobile: '', classVal: '', dob: '', address: '', gender: '', enquiryId: null, applicationId: null }, selectedSessionId);
    };

    const handleFromEnquiryOption = () => {
        setShowAdmissionTypeModal(false);
        setShowEnquiryModal(true);
    };

    const handleFromApplicationOption = () => {
        setShowAdmissionTypeModal(false);
        setApplicationId('');
        setApplicationPhone('');
        setShowApplicationModal(true);
    };

    const handleSelectEnquiry = (enquiryData: EnquiryDetailsResponse) => {
        const mapped: Partial<StudentSearchResult> = {
            id: enquiryData.enquiry_id || '',
            studentName: enquiryData.child?.name || '',
            gender: enquiryData.child?.gender || '',
            dob: enquiryData.child?.dob ? new Date(enquiryData.child.dob).toISOString().split('T')[0] : '',
            mobile: enquiryData.parent?.phone || '',
            email: enquiryData.parent?.email || '',
            address: enquiryData.parent?.address_line || '',
            parentName: enquiryData.parent?.name || '',
            classVal: '',
            sourceType: 'ENQUIRY',
            sourceId: enquiryData.enquiry_id || '',
            destinationPackageSessionId: '',
            enquiryId: enquiryData.enquiry_id || null,
            applicationId: null,
            enquiryTrackingId: enquiryData.tracking_id || null,
        };

        // Auto-fill parent relation from enquiry data; show popup only if unknown
        const rawRelation = enquiryData.parent_relation_with_child || '';
        const relation = String(rawRelation).toLowerCase().trim();

        if (relation === 'father') {
            mapped.parentGender = 'father';
            navigateToForm(mapped, selectedSessionId);
        } else if (relation === 'mother') {
            mapped.parentGender = 'mother';
            navigateToForm(mapped, selectedSessionId);
        } else {
            // Relation unknown — ask admin to choose
            setPendingEnquiryMapped(mapped);
            setShowParentTypeModal(true);
        }
    };

    const handleParentTypeSelection = (type: 'father' | 'mother') => {
        if (!pendingEnquiryMapped) return;
        const mapped = { ...pendingEnquiryMapped, parentGender: type };
        setShowParentTypeModal(false);
        setPendingEnquiryMapped(null);
        navigateToForm(mapped, selectedSessionId);
    };

    const handleFetchApplication = async () => {
        if (!applicationId.trim() && !applicationPhone.trim()) {
            alert(t('alerts.enterIdOrPhone'));
            return;
        }
        setIsLoadingLookup(true);
        try {
            const body: Record<string, any> = {};
            if (selectedSessionId) body.session_id = selectedSessionId;
            body.from = 'APPLICATION';

            if (applicationId.trim()) {
                body.search_by = 'APPLICATION_NO';
                body.search_text = applicationId.trim();
            } else {
                body.search_by = 'PARENT_MOBILE';
                body.search_text = applicationPhone.trim();
            }

            const response = await authenticatedAxiosInstance.post(
                `${BASE_URL}/admin-core-service/v1/admission/responses/list?pageNo=0&pageSize=1`,
                body
            );

            const results = response.data?.content || [];
            if (results.length === 0) {
                alert(t('alerts.noApplicationFound'));
                setIsLoadingLookup(false);
                return;
            }

            const item = results[0];
            const resolvedApplicantId = item.applicant_id || item.application_id || null;
            const mapped: Partial<StudentSearchResult> = {
                id: resolvedApplicantId || item.admission_id || '',
                studentName: item.student_name || '',
                gender: item.gender || '',
                dob: item.date_of_birth ? new Date(item.date_of_birth).toISOString().split('T')[0] : '',
                mobile: item.parent_mobile || '',
                email: item.parent_email || '',
                parentName: item.parent_name || '',
                address: '',
                classVal: getDisplayClass(item),
                sourceType: 'APPLICATION',
                sourceId: resolvedApplicantId || item.admission_id || '',
                destinationPackageSessionId: item.destination_package_session_id || '',
                enquiryId: null,
                applicationId: resolvedApplicantId,
                enquiryTrackingId: item.tracking_id || null,
            };

            setShowApplicationModal(false);
            navigateToForm(mapped, selectedSessionId);
        } catch (error) {
            console.error('Error fetching application:', error);
            alert(t('alerts.fetchFailed'));
        } finally {
            setIsLoadingLookup(false);
        }
    };

    const handleSearch = async () => {
        setIsSearching(true);
        try {
            const body: Record<string, any> = {};

            // session_id is mandatory
            if (selectedSessionId) body.session_id = selectedSessionId;

            // search_by + search_text (NOT "search")
            if (searchValue.trim()) {
                body.search_by = SEARCH_BY_MAP[searchBy] || 'STUDENT_NAME';
                body.search_text = searchValue.trim();
            }

            if (statusFilters.length > 0) body.statuses = statusFilters.map(f => f.id);
            if (sourceFilters.length > 0) body.sources = sourceFilters.map(f => f.id);
            if (sectionFilters.length > 0) {
                body.destination_package_session_id = sectionFilters[0]?.id;
            } else if (packageSessionFilters.length > 0) {
                body.destination_package_session_id = packageSessionFilters[0]?.id;
            }

            const dateRange = dateRangeFilters.length > 0 ? getDateRange(dateRangeFilters[0]?.id || '') : undefined;
            if (dateRange) {
                body.created_from = dateRange.from;
                body.created_to = dateRange.to;
            }

            const response = await authenticatedAxiosInstance.post(
                `${BASE_URL}/admin-core-service/v1/admission/responses/list?pageNo=0&pageSize=20`,
                body
            );

            const data = response.data;
            const results = data?.content || [];
            setSearchResults(results);
            setTotalResponses(data?.totalElements || results.length);
        } catch (error) {
            console.error('Error searching admission responses:', error);
            setSearchResults([]);
            setTotalResponses(0);
        } finally {
            setIsSearching(false);
        }
    };

    useEffect(() => {
        if (selectedSessionId && !initialLoadDone) {
            setInitialLoadDone(true);
            handleSearch();
        }
    }, [selectedSessionId]);

    // Quick views set the Status filter and run the same search the Apply button runs.
    // The search reads state, so it fires on the next render via this tick.
    const [quickSearchTick, setQuickSearchTick] = useState(0);
    useEffect(() => {
        if (quickSearchTick > 0) handleSearch();
        // Only the tick should re-run the search; handleSearch is recreated every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quickSearchTick]);
    const statusIds = statusFilters
        .map((f) => f.id)
        .sort()
        .join(',');
    const quickView =
        statusIds === 'ADMISSION'
            ? 'ADMISSION'
            : statusIds === 'APPLICATION'
              ? 'APPLICATION'
              : statusIds === ''
                ? 'ALL'
                : '';
    const selectQuickView = (key: string) => {
        const option = overallStatusOptions.find((o) => o.id === key);
        setStatusFilters(option ? [option] : []);
        setQuickSearchTick((n) => n + 1);
    };

    const getDisplayClass = (item: any) => {
        const psId = item.destination_package_session_id;
        if (!psId) return item.applying_for_class || '-';
        const details = getDetailsFromPackageSessionId({ packageSessionId: psId });
        if (details) return details.level.level_name;
        return item.applying_for_class || '-';
    };

    const handleSelectResult = (item: any) => {
        const sourceType = item.status === 'APPLICATION' ? 'APPLICATION' : 'ENQUIRY';
        const sourceId = sourceType === 'APPLICATION'
            ? item.applicant_id || item.application_id || item.admission_id || item.id || ''
            : item.enquiry_id || item.admission_id || item.id || '';

        const isEnquiry = sourceType === 'ENQUIRY';
        const isApplication = sourceType === 'APPLICATION';

        navigateToForm({
            id: sourceId,
            studentName: item.student_name || '',
            parentName: item.parent_name || '',
            mobile: item.parent_mobile || '',
            classVal: getDisplayClass(item),
            source: item.source || sourceType,
            status: item.status || '',
            dob: item.date_of_birth || '',
            address: '',
            gender: item.gender || '',
            email: item.parent_email || '',
            sourceType,
            sourceId,
            destinationPackageSessionId: item.destination_package_session_id || '',
            enquiryId: isEnquiry ? (item.enquiry_id || item.admission_id || null) : null,
            applicationId: isApplication ? (item.applicant_id || item.application_id || null) : null,
        }, selectedSessionId);
    };

    return (
        <div className="flex h-full flex-col p-6 animate-in fade-in duration-300">
            {/* Header with Academic Year + Admission Form button */}
            <ScreenHeader
                className="mb-5"
                icon={GraduationCap}
                title={t('header.title')}
                subtitle={t('header.subtitle')}
                actions={
                    <>
                        {sessions.length > 0 && (
                            <select
                                value={selectedSessionId}
                                onChange={(e) => {
                                    setSelectedSessionId(e.target.value);
                                    setSearchResults(null);
                                }}
                                aria-label={t('header.sessionLabel')}
                                className="h-10 min-w-44 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                            >
                                {sessions.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.session_name}
                                    </option>
                                ))}
                            </select>
                        )}
                        <MyButton
                            buttonType="secondary"
                            disabled={!selectedSessionId}
                            onClick={() => setIsBulkImportOpen(true)}
                        >
                            {t('header.bulkImport')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={() => setShowAdmissionTypeModal(true)}
                        >
                            <Plus className="mr-1 size-4" />
                            {t('header.admissionForm')}
                        </MyButton>
                    </>
                }
            />

            <PillTabs
                className="mb-4"
                tabs={[
                    { key: 'ADMISSION', label: t('quickViews.admitted') },
                    { key: 'APPLICATION', label: t('quickViews.applications') },
                    { key: 'ALL', label: t('quickViews.all') },
                ]}
                value={quickView}
                onChange={selectQuickView}
            />

            {/* Filter Chips */}
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
                <FilterChips
                    label={t('filters.status')}
                    filterList={overallStatusOptions}
                    selectedFilters={statusFilters}
                    handleSelect={(option) => {
                        const exists = statusFilters.some((f) => f.id === option.id);
                        setStatusFilters(exists ? statusFilters.filter((f) => f.id !== option.id) : [...statusFilters, option]);
                    }}
                    handleClearFilters={() => setStatusFilters([])}
                    clearFilters={false}
                />
                <FilterChips
                    label={t('filters.source')}
                    filterList={sourceTypeOptions}
                    selectedFilters={sourceFilters}
                    handleSelect={(option) => {
                        const exists = sourceFilters.some((f) => f.id === option.id);
                        setSourceFilters(exists ? sourceFilters.filter((f) => f.id !== option.id) : [...sourceFilters, option]);
                    }}
                    handleClearFilters={() => setSourceFilters([])}
                    clearFilters={false}
                />
                <FilterChips
                    label={t('filters.dateRange')}
                    filterList={dateRangeOptions}
                    selectedFilters={dateRangeFilters}
                    handleSelect={(option) => {
                        const exists = dateRangeFilters.some((f) => f.id === option.id);
                        setDateRangeFilters(exists ? dateRangeFilters.filter((f) => f.id !== option.id) : [option]);
                    }}
                    handleClearFilters={() => setDateRangeFilters([])}
                    clearFilters={false}
                />
                {packageSessionOptions.length > 0 && (
                    <FilterChips
                        label={t('filters.class')}
                        filterList={packageSessionOptions}
                        selectedFilters={packageSessionFilters}
                        handleSelect={(option) => {
                            const exists = packageSessionFilters.some((f) => f.id === option.id);
                            if (exists) {
                                setPackageSessionFilters([]);
                            } else {
                                setPackageSessionFilters([option]);
                            }
                            setSectionFilters([]);
                        }}
                        handleClearFilters={() => { setPackageSessionFilters([]); setSectionFilters([]); }}
                        clearFilters={false}
                    />
                )}
                {sectionFilterOptions.length > 0 && (
                    <FilterChips
                        label={t('filters.section')}
                        filterList={sectionFilterOptions}
                        selectedFilters={sectionFilters}
                        handleSelect={(option) => {
                            const exists = sectionFilters.some((f) => f.id === option.id);
                            setSectionFilters(exists ? [] : [option]);
                        }}
                        handleClearFilters={() => setSectionFilters([])}
                        clearFilters={false}
                    />
                )}
                {hasActiveFilters && (
                    <>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            onClick={handleSearch}
                            disabled={isSearching}
                            className="h-8 px-3 text-xs"
                        >
                            {isSearching ? t('filters.applying') : t('filters.applyFilter')}
                        </MyButton>
                        <MyButton buttonType="secondary" scale="small" onClick={clearAllFilters} className="h-8 px-2 text-xs">
                            <X className="mr-1 h-3 w-3" />
                            {t('filters.clearAll')}
                        </MyButton>
                    </>
                )}
            </div>

            {/* Search Panel */}
            <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                    <MagnifyingGlass className="size-5 text-neutral-500" />
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-700">
                        {t('search.criteriaHeading')}
                    </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
                    <div className="flex flex-col gap-1.5 flex-1">
                        <label className="text-xs font-medium text-neutral-600">
                            {t('search.searchByLabel')}
                        </label>
                        <select
                            value={searchBy}
                            onChange={(e) => setSearchBy(e.target.value)}
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                        >
                            <option value="Student Name">{t('searchByOptions.studentName')}</option>
                            <option value="Application No">{t('searchByOptions.applicationNo')}</option>
                            <option value="Parent Mobile">{t('searchByOptions.parentMobile')}</option>
                        </select>
                    </div>

                    <div className="flex flex-col gap-1.5 flex-1">
                        <label className="text-xs font-medium text-neutral-600">
                            {t('search.enterDetailsLabel')}
                        </label>
                        <input
                            type="text"
                            value={searchValue}
                            onChange={(e) => setSearchValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            placeholder={t('search.enterDetailsPlaceholder', { field: getSearchByLabel(t, searchBy) })}
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                        />
                    </div>

                    <div className="flex-1">
                        <MyButton
                            buttonType="primary"
                            onClick={handleSearch}
                            disabled={isSearching}
                            className="w-full"
                        >
                            <MagnifyingGlass className="mr-1 size-4" />
                            {isSearching ? t('search.searching') : t('search.searchButton')}
                        </MyButton>
                    </div>
                </div>
            </div>

            {/* Results Section */}
            {searchResults !== null && (
                <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                    {searchResults.length > 0 && (
                        <div className="border-b border-neutral-100 bg-neutral-50 px-6 py-3">
                            <p className="text-sm text-neutral-700">
                                {t('results.totalResponses')}{' '}
                                <span className="font-semibold text-primary-600">
                                    {totalResponses}
                                </span>
                            </p>
                        </div>
                    )}
                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-start border-collapse min-w-[1200px]"> {/* design-lint-ignore: table min-width for horizontal-scroll layout, no scale token close enough */}
                            <thead>
                                <tr className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                                    <th className="px-4 py-3 font-semibold">{t('table.sNo')}</th>
                                    <th className="px-4 py-3 font-semibold">{t('table.class')}</th>
                                    <th className="px-4 py-3 font-semibold">{t('table.studentName')}</th>
                                    <th className="px-4 py-3 font-semibold">{t('table.gender')}</th>
                                    <th className="px-4 py-3 font-semibold">{t('table.dateOfBirth')}</th>
                                    <th className="px-4 py-3 font-semibold">{t('table.parentName')}</th>
                                    <th className="px-4 py-3 font-semibold">{t('table.parentEmail')}</th>
                                    <th className="px-4 py-3 font-semibold">{t('table.parentMobile')}</th>
                                    <th className="px-4 py-3 font-semibold">{t('table.trackingId')}</th>
                                    <th className="px-4 py-3 font-semibold">{t('table.status')}</th>
                                    <th className="px-4 py-3 font-semibold">{t('table.source')}</th>
                                    <th className="px-4 py-3 font-semibold text-end">{t('table.actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100 text-sm">
                                {searchResults.length > 0 ? (
                                    searchResults.map((result, idx) => (
                                        <tr
                                            key={result.admission_id || idx}
                                            className="transition-colors hover:bg-neutral-50"
                                        >
                                            <td className="px-4 py-3.5 text-neutral-500">
                                                {idx + 1}
                                            </td>
                                            <td className="px-4 py-3.5 font-medium text-neutral-800">
                                                {getDisplayClass(result)}
                                            </td>
                                            <td className="px-4 py-3.5 font-medium text-neutral-900">
                                                {result.student_name || '-'}
                                            </td>
                                            <td className="px-4 py-3.5 text-neutral-700">
                                                {getGenderLabel(t, result.gender)}
                                            </td>
                                            <td className="px-4 py-3.5 text-neutral-600">
                                                {formatDate(result.date_of_birth)}
                                            </td>
                                            <td className="px-4 py-3.5 text-neutral-700">
                                                {result.parent_name || '-'}
                                            </td>
                                            <td
                                                className="max-w-44 truncate px-4 py-3.5 text-neutral-600"
                                                title={result.parent_email || ''}
                                            >
                                                {result.parent_email || '-'}
                                            </td>
                                            <td className="px-4 py-3.5 text-neutral-700">
                                                {result.parent_mobile || '-'}
                                            </td>
                                            <td className="px-4 py-3.5 font-mono text-xs text-neutral-600">
                                                {result.tracking_id || '-'}
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <StatusPill tone={getStatusTone(result.status)}>
                                                    {getStatusLabel(t, result.status)}
                                                </StatusPill>
                                            </td>
                                            <td className="px-4 py-3.5 text-neutral-600">
                                                {getSourceLabel(t, result.source)}
                                            </td>
                                            <td className="px-4 py-3.5 text-right">
                                                {result.status !== 'ADMISSION' ? (
                                                    <MyButton
                                                        buttonType="secondary"
                                                        scale="small"
                                                        onClick={() => handleSelectResult(result)}
                                                        className="whitespace-nowrap"
                                                    >
                                                        {t('results.createAdmission')}
                                                    </MyButton>
                                                ) : (
                                                    <span className="text-xs text-neutral-400">
                                                        {t('results.alreadyAdmitted')}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td
                                            colSpan={12}
                                            className="px-6 py-12 text-center text-neutral-500"
                                        >
                                            <div className="flex flex-col items-center justify-center gap-2">
                                                <MagnifyingGlass className="size-8 text-neutral-400" />
                                                <p>{t('results.noRecordsFound')}</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Empty State */}
            {searchResults === null && (
                <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-12 text-center">
                    <div className="mb-4 flex size-16 items-center justify-center rounded-full border border-neutral-200 bg-white text-primary-400 shadow-sm">
                        <GraduationCap className="size-8" />
                    </div>
                    <h3 className="mb-1 text-lg font-medium text-neutral-800">
                        {t('emptyState.title')}
                    </h3>
                    <p className="max-w-md text-sm text-neutral-500">
                        {t('emptyState.description')}
                    </p>
                </div>
            )}

            {/* Choose Admission Type Modal */}
            {showAdmissionTypeModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-neutral-900">{t('admissionTypeModal.title')}</h2>
                            <button onClick={() => setShowAdmissionTypeModal(false)} className="text-neutral-400 hover:text-neutral-600">
                                <X className="size-5" />
                            </button>
                        </div>
                        <p className="mb-6 text-sm text-neutral-600">{t('admissionTypeModal.subtitle')}</p>
                        <div className="space-y-3">
                            <button
                                onClick={handleNewAdmission}
                                className="flex w-full items-center gap-4 rounded-lg border border-neutral-200 p-4 text-left transition-all hover:border-primary-400 hover:bg-primary-50"
                            >
                                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-50">
                                    <svg
                                        className="size-6 text-primary-600"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="font-medium text-neutral-900">{t('admissionTypeModal.newAdmissionTitle')}</h3>
                                    <p className="text-sm text-neutral-600">{t('admissionTypeModal.newAdmissionDesc')}</p>
                                </div>
                            </button>

                            <button
                                onClick={handleFromEnquiryOption}
                                className="flex w-full items-center gap-4 rounded-lg border border-neutral-200 p-4 text-left transition-all hover:border-primary-400 hover:bg-primary-50"
                            >
                                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-info-50">
                                    <svg
                                        className="size-6 text-info-600"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="font-medium text-neutral-900">{t('admissionTypeModal.fromEnquiryTitle')}</h3>
                                    <p className="text-sm text-neutral-600">{t('admissionTypeModal.fromEnquiryDesc')}</p>
                                </div>
                            </button>

                            <button
                                onClick={handleFromApplicationOption}
                                className="flex w-full items-center gap-4 rounded-lg border border-neutral-200 p-4 text-left transition-all hover:border-primary-400 hover:bg-primary-50"
                            >
                                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success-50">
                                    <svg
                                        className="size-6 text-success-600"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="font-medium text-neutral-900">{t('admissionTypeModal.fromApplicationTitle')}</h3>
                                    <p className="text-sm text-neutral-600">{t('admissionTypeModal.fromApplicationDesc')}</p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <EnquirySearchModal
                isOpen={showEnquiryModal}
                onClose={() => setShowEnquiryModal(false)}
                onSelectForAdmission={handleSelectEnquiry}
            />

            {/* Enter Application Details Modal */}
            {showApplicationModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-neutral-900">{t('applicationModal.title')}</h2>
                            <button
                                onClick={() => { setShowApplicationModal(false); setApplicationId(''); setApplicationPhone(''); }}
                                className="text-neutral-400 hover:text-neutral-600"
                            >
                                <X className="size-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="admApplicationId">{t('applicationModal.applicationIdLabel')}</Label>
                                <Input
                                    id="admApplicationId"
                                    type="text"
                                    placeholder={t('applicationModal.applicationIdPlaceholder')}
                                    value={applicationId}
                                    onChange={(e) => setApplicationId(e.target.value)}
                                    className="mt-1"
                                />
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="h-px flex-1 bg-neutral-200"></div>
                                <span className="text-xs text-neutral-500">{t('applicationModal.or')}</span>
                                <div className="h-px flex-1 bg-neutral-200"></div>
                            </div>
                            <div>
                                <Label htmlFor="admApplicationPhone">{t('applicationModal.phoneLabel')}</Label>
                                <Input
                                    id="admApplicationPhone"
                                    type="tel"
                                    placeholder={t('applicationModal.phonePlaceholder')}
                                    value={applicationPhone}
                                    onChange={(e) => setApplicationPhone(e.target.value)}
                                    className="mt-1"
                                />
                            </div>
                            <p className="text-xs text-neutral-500">
                                {t('applicationModal.helperText')}
                            </p>
                            <div className="flex gap-3">
                                <MyButton
                                    buttonType="secondary"
                                    onClick={() => { setShowApplicationModal(false); setApplicationId(''); setApplicationPhone(''); }}
                                    className="flex-1"
                                >
                                    {t('applicationModal.cancel')}
                                </MyButton>
                                <MyButton
                                    buttonType="primary"
                                    onClick={handleFetchApplication}
                                    disabled={isLoadingLookup || (!applicationId.trim() && !applicationPhone.trim())}
                                    className="flex-1"
                                >
                                    {isLoadingLookup ? t('applicationModal.loading') : t('applicationModal.continueButton')}
                                </MyButton>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <ParentTypeModal
                isOpen={showParentTypeModal}
                onClose={() => setShowParentTypeModal(false)}
                onSelect={handleParentTypeSelection}
            />

            <AdmissionBulkImportDialog
                open={isBulkImportOpen}
                onOpenChange={setIsBulkImportOpen}
                sessionId={selectedSessionId}
                onSuccess={() => {
                    // Refresh current search results if user had already searched.
                    handleSearch();
                }}
            />
        </div>
    );
}
