import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import {
    handleFetchEnquiriesList,
    EnquiryItem as EnquiryListItem,
} from './-services/get-enquiries-list';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { EnquiryTable } from './-components/EnquiryTable';
import { MyButton } from '@/components/design-system/button';
import { Copy, Plus, X, Monitor, Tray } from '@phosphor-icons/react';
import {
    CountChip,
    PillTabs,
    ScreenHeader,
    StatusPill,
} from '@/components/shared/crm-enhance/screen-header';
import createCampaignLink from '@/routes/audience-manager/list/-utils/createCampaignLink';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { FilterChips } from '@/components/design-system/chips';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { CreateEnquiryDialog } from './-components/create-enquiry-dialog/CreateEnquiryDialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { useLeadTiers } from '@/hooks/use-lead-tiers';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
export const Route = createFileRoute('/admissions/enquiries/')({
    component: RouteComponent,
});

// Predefined date ranges
const buildDateRanges = (t: TFunction) => [
    { id: 'today', label: t('dateRanges.today') },
    { id: 'last_7_days', label: t('dateRanges.last7Days') },
    { id: 'last_30_days', label: t('dateRanges.last30Days') },
    { id: 'last_3_months', label: t('dateRanges.last3Months') },
    { id: 'last_6_months', label: t('dateRanges.last6Months') },
    { id: 'last_year', label: t('dateRanges.lastYear') },
];

const buildEnquiryStatuses = (t: TFunction) => [
    { id: 'NEW', label: t('enquiryStatuses.new') },
    { id: 'CONTACTED', label: t('enquiryStatuses.contacted') },
    { id: 'NOT_ELIGIBLE', label: t('enquiryStatuses.notEligible') },
    { id: 'QUALIFIED', label: t('enquiryStatuses.qualified') },
    { id: 'FOLLOW_UP', label: t('enquiryStatuses.followUp') },
    { id: 'CLOSED', label: t('enquiryStatuses.closed') },
    { id: 'CONVERTED', label: t('enquiryStatuses.converted') },
    { id: 'ADMITTED', label: t('enquiryStatuses.admitted') },
];

const buildSourceTypes = (t: TFunction) => [
    { id: 'WEBSITE', label: t('sourceTypes.website') },
    { id: 'GOOGLE_ADS', label: t('sourceTypes.googleAds') },
    { id: 'FACEBOOK', label: t('sourceTypes.facebook') },
    { id: 'INSTAGRAM', label: t('sourceTypes.instagram') },
    { id: 'REFERRAL', label: t('sourceTypes.referral') },
    { id: 'OTHER', label: t('sourceTypes.other') },
];

// Helper function to calculate date range
const getDateRange = (rangeValue: string) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (rangeValue) {
        case 'today':
            return {
                from: today.toISOString(),
                to: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
            };
        case 'last_7_days':
            return {
                from: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
                to: now.toISOString(),
            };
        case 'last_30_days':
            return {
                from: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                to: now.toISOString(),
            };
        case 'last_3_months':
            return {
                from: new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
                to: now.toISOString(),
            };
        case 'last_6_months':
            return {
                from: new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString(),
                to: now.toISOString(),
            };
        case 'last_year':
            return {
                from: new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString(),
                to: now.toISOString(),
            };
        default:
            return undefined;
    }
};

function EnquiryPage() {
    const { t } = useTranslation('admissionsEnquiriesIndex');
    const { data: instituteData } = useSuspenseQuery(useInstituteQuery());
    const DATE_RANGES = useMemo(() => buildDateRanges(t), [t]);
    const ENQUIRY_STATUSES = useMemo(() => buildEnquiryStatuses(t), [t]);
    const SOURCE_TYPES = useMemo(() => buildSourceTypes(t), [t]);
    // Tier pills come from the institute catalog (custom tiers + colours included).
    const tierCatalog = useLeadTiers();
    const LEAD_TIERS = useMemo(
        () =>
            tierCatalog.tiers.map((tier) => ({
                id: tier.tier_key,
                label: tier.label,
                color: tier.color,
            })),
        [tierCatalog.tiers]
    );
    const [selectedEnquiryId, setSelectedEnquiryId] = useState<string>('');
    const [selectedEnquiry, setSelectedEnquiry] = useState<EnquiryListItem | null>(null);
    const { instituteDetails } = useInstituteDetailsStore();
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

    // Filter states - using arrays for multi-select
    const [statusFilters, setStatusFilters] = useState<{ id: string; label: string }[]>([]);
    const [sourceFilters, setSourceFilters] = useState<{ id: string; label: string }[]>([]);
    const [dateRangeFilters, setDateRangeFilters] = useState<{ id: string; label: string }[]>([]);
    const [packageSessionFilters, setPackageSessionFilters] = useState<
        { id: string; label: string }[]
    >([]);
    const [searchInput, setSearchInput] = useState('');
    const [searchFilter, setSearchFilter] = useState('');
    // Phase 1 filters
    const [tierFilter, setTierFilter] = useState('');
    const [showDuplicates, setShowDuplicates] = useState(true);
    const [sortBy, setSortBy] = useState('');
    const [sortDirection, setSortDirection] = useState('DESC');
    const [isWalkInOpen, setIsWalkInOpen] = useState(false);
    const { setNavHeading } = useNavHeadingStore();
    const navigate = useNavigate();
    const leadSettings = useLeadSettings();

    // Fetch all enquiries (campaigns)
    const { data: enquiriesData, refetch: refetchEnquiries } = useSuspenseQuery(
        handleFetchEnquiriesList({
            institute_id: instituteData?.id || '',
            page: 0,
            size: 100, // Fetch all for dropdown
        })
    );

    const enquiries = useMemo(
        () =>
            (enquiriesData?.content || []).filter(
                (enquiry) => enquiry.session_id !== null && enquiry.session_id !== undefined
            ),
        [enquiriesData?.content]
    );
    useEffect(() => {
        setNavHeading(t('pageTitle'));
    }, [setNavHeading, t]);

    // Auto-select first enquiry by default
    useEffect(() => {
        if (enquiries.length > 0 && !selectedEnquiryId) {
            setSelectedEnquiryId(enquiries[0]?.id || '');
            setSelectedEnquiry(enquiries[0] ?? null);
        }
    }, [enquiries, selectedEnquiryId]);

    const handleCopy = () => {
        const shareableLink = createCampaignLink(
            selectedEnquiryId,
            instituteDetails?.learner_portal_base_url,
            true
        );
        navigator.clipboard
            .writeText(shareableLink)
            .then(() => {
                toast.success(t('toast.linkCopied'));
            })
            .catch((error) => {
                console.error('Unable to copy enquiry link', error);
                toast.error(t('toast.copyFailed'));
            });
    };

    const handleCreateSuccess = () => {
        setIsCreateDialogOpen(false);
        refetchEnquiries();
    };

    // Update selected enquiry when selection changes
    useEffect(() => {
        if (selectedEnquiryId) {
            const found = enquiries.find((e) => e.id === selectedEnquiryId);
            setSelectedEnquiry(found || null);
        }
    }, [selectedEnquiryId, enquiries]);

    // Get package sessions from institute store
    const packageSessionOptions = useMemo(() => {
        if (!instituteDetails?.batches_for_sessions) return [];

        return instituteDetails.batches_for_sessions
            .filter((batch) => batch.is_parent === true || !batch.parent_id)
            .map((batch) => ({
                id: batch.id,
                label: `${batch.package_dto.package_name} - ${batch.level.level_name} - ${batch.session.session_name}${batch.name ? ` - ${batch.name}` : ''}`,
            }));
    }, [instituteDetails]);

    // Calculate filter values for API
    const statusFilter = statusFilters.length > 0 ? statusFilters[0]?.id : undefined;
    const sourceFilter = sourceFilters.length > 0 ? sourceFilters[0]?.id : undefined;
    const packageSessionFilter =
        packageSessionFilters.length > 0 ? packageSessionFilters[0]?.id : undefined;

    const dateRange = useMemo(() => {
        if (dateRangeFilters.length === 0) return undefined;
        return getDateRange(dateRangeFilters[0]?.id || '');
    }, [dateRangeFilters]);

    // Built every render (not memoised) so labels follow the loaded catalog.
    const QUICK_STATUS_IDS = ['NEW', 'CONTACTED', 'FOLLOW_UP', 'QUALIFIED', 'CONVERTED'];
    const statusTabs = [
        { key: 'ALL', label: t('quickViews.all') },
        ...ENQUIRY_STATUSES.filter((s) => QUICK_STATUS_IDS.includes(s.id)).map((s) => ({
            key: s.id,
            label: s.label,
        })),
    ];

    // Check if any filter is active
    const hasActiveFilters =
        statusFilters.length > 0 ||
        sourceFilters.length > 0 ||
        dateRangeFilters.length > 0 ||
        packageSessionFilters.length > 0 ||
        searchFilter.length > 0 ||
        tierFilter.length > 0 ||
        sortBy.length > 0;

    const clearAllFilters = () => {
        setStatusFilters([]);
        setSourceFilters([]);
        setDateRangeFilters([]);
        setPackageSessionFilters([]);
        setSearchInput('');
        setSearchFilter('');
        setTierFilter('');
        setSortBy('');
        setSortDirection('DESC');
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <ScreenHeader
                icon={Tray}
                title={t('pageTitle')}
                subtitle={t('pageSubtitle')}
                actions={
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={handleCopy}
                            title={t('copyLinkTitle')}
                            aria-label={t('copyLinkTitle')}
                            className="gap-1.5"
                        >
                            <Copy className="size-4" />
                            {t('copyFormLink')}
                        </MyButton>
                        {leadSettings.enabled && (
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => setIsWalkInOpen(true)}
                                title={t('walkInRegisterTitle')}
                                aria-label={t('walkInRegisterTitle')}
                                disabled={!selectedEnquiryId}
                                className="gap-1.5"
                            >
                                <Monitor className="size-4" />
                                {t('walkInRegister')}
                            </MyButton>
                        )}
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() =>
                                navigate({ to: `/admissions/new-enquiry/${selectedEnquiryId}` })
                            }
                            className="gap-1.5"
                        >
                            <Plus className="size-4" />
                            {t('addNewEnquiryResponse')}
                        </MyButton>
                    </>
                }
            />

            {/* Enquiry form picker — which form's responses the table shows */}
            <Card className="flex flex-col gap-3 rounded-xl border-neutral-200 p-3 shadow-sm md:flex-row md:items-center">
                <Select value={selectedEnquiryId} onValueChange={setSelectedEnquiryId}>
                    <SelectTrigger className="h-auto w-full px-3 py-1.5 md:w-80">
                        <SelectValue placeholder={t('selectEnquiryPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                        {enquiries.map((enquiry) => (
                            <SelectItem key={enquiry.id} value={enquiry.id || ''}>
                                <div className="flex flex-col items-start gap-0.5 text-left">
                                    <span className="text-sm font-medium">
                                        {enquiry.campaign_name}
                                    </span>
                                    <span className="text-xs font-light text-muted-foreground">
                                        {t('enquiryTypeLabel', { type: enquiry.campaign_type })}
                                    </span>
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {selectedEnquiry && (
                    <div className="flex flex-wrap items-center gap-2">
                        {selectedEnquiry.campaign_type && (
                            <CountChip>
                                {t('enquiryTypeLabel', { type: selectedEnquiry.campaign_type })}
                            </CountChip>
                        )}
                        {selectedEnquiry.status && (
                            <StatusPill
                                tone={selectedEnquiry.status === 'ACTIVE' ? 'success' : 'neutral'}
                            >
                                {t('formStatus', {
                                    status: selectedEnquiry.status.toLowerCase().replace(/_/g, ' '),
                                })}
                            </StatusPill>
                        )}
                    </div>
                )}
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => setIsCreateDialogOpen(true)}
                    className="gap-1.5 md:ms-auto"
                >
                    <Plus className="size-4" />
                    {t('createNewEnquiryForm')}
                </MyButton>
            </Card>

            {/* Quick status views — same single-select Status filter as the chip below */}
            <PillTabs
                tabs={statusTabs}
                value={statusFilters[0]?.id ?? 'ALL'}
                onChange={(key) => {
                    if (key === 'ALL') {
                        setStatusFilters([]);
                        return;
                    }
                    const option = ENQUIRY_STATUSES.find((s) => s.id === key);
                    if (option) setStatusFilters([option]);
                }}
            />

            {/* Filters Section */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
                {/* Status Filter */}
                <FilterChips
                    label={t('filters.status')}
                    filterList={ENQUIRY_STATUSES}
                    selectedFilters={statusFilters}
                    handleSelect={(option) => {
                        const exists = statusFilters.some((f) => f.id === option.id);
                        if (exists) {
                            setStatusFilters(statusFilters.filter((f) => f.id !== option.id));
                        } else {
                            // For single selection, replace existing
                            setStatusFilters([option]);
                        }
                    }}
                    handleClearFilters={() => setStatusFilters([])}
                    clearFilters={false}
                />

                {/* Source Filter */}
                <FilterChips
                    label={t('filters.source')}
                    filterList={SOURCE_TYPES}
                    selectedFilters={sourceFilters}
                    handleSelect={(option) => {
                        const exists = sourceFilters.some((f) => f.id === option.id);
                        if (exists) {
                            setSourceFilters(sourceFilters.filter((f) => f.id !== option.id));
                        } else {
                            // For single selection, replace existing
                            setSourceFilters([option]);
                        }
                    }}
                    handleClearFilters={() => setSourceFilters([])}
                    clearFilters={false}
                />

                {/* Date Range Filter */}
                <FilterChips
                    label={t('filters.dateRange')}
                    filterList={DATE_RANGES}
                    selectedFilters={dateRangeFilters}
                    handleSelect={(option) => {
                        const exists = dateRangeFilters.some((f) => f.id === option.id);
                        if (exists) {
                            setDateRangeFilters(dateRangeFilters.filter((f) => f.id !== option.id));
                        } else {
                            // For single selection, replace existing
                            setDateRangeFilters([option]);
                        }
                    }}
                    handleClearFilters={() => setDateRangeFilters([])}
                    clearFilters={false}
                />

                {/* Package Session Filter */}
                {packageSessionOptions.length > 0 && (
                    <FilterChips
                        label={t('filters.class')}
                        filterList={packageSessionOptions}
                        selectedFilters={packageSessionFilters}
                        handleSelect={(option) => {
                            const exists = packageSessionFilters.some((f) => f.id === option.id);
                            if (exists) {
                                setPackageSessionFilters(
                                    packageSessionFilters.filter((f) => f.id !== option.id)
                                );
                            } else {
                                // For single selection, replace existing
                                setPackageSessionFilters([option]);
                            }
                        }}
                        handleClearFilters={() => setPackageSessionFilters([])}
                        clearFilters={false}
                    />
                )}

                {/* Search Bar */}
                <div className="flex items-center gap-2">
                    <Input
                        type="text"
                        placeholder={t('searchPlaceholder')}
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                setSearchFilter(searchInput);
                            }
                        }}
                        className="h-8 bg-white text-xs md:w-64"
                    />
                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 px-3"
                        onClick={() => setSearchFilter(searchInput)}
                    >
                        <MagnifyingGlass className="size-4" />
                    </Button>
                </div>

                {/* Lead Tier Filter — only shown when lead system is enabled */}
                {leadSettings.enabled && (
                    <div className="flex items-center gap-1">
                        {LEAD_TIERS.map((tier) => (
                            <button
                                key={tier.id}
                                onClick={() => setTierFilter(tierFilter === tier.id ? '' : tier.id)}
                                // Inline style: tier colour is admin-picked hex (no design token).
                                style={
                                    tierFilter === tier.id
                                        ? { backgroundColor: tier.color }
                                        : undefined
                                }
                                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                    tierFilter === tier.id
                                        ? 'text-white'
                                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                                }`}
                            >
                                {tierFilter !== tier.id && (
                                    <span
                                        className="size-2 rounded-full"
                                        style={{ backgroundColor: tier.color }}
                                    />
                                )}
                                {tier.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* Sort By */}
                <Select
                    value={sortBy || 'none'}
                    onValueChange={(v) => {
                        if (v === 'none') {
                            setSortBy('');
                        } else if (v === sortBy) {
                            setSortDirection((d) => (d === 'ASC' ? 'DESC' : 'ASC'));
                        } else {
                            setSortBy(v);
                            // Names default ASC (A→Z); scores/dates default DESC (highest/newest first)
                            setSortDirection(v === 'PARENT_NAME' ? 'ASC' : 'DESC');
                        }
                    }}
                >
                    <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue placeholder={t('sortBy.placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">{t('sortBy.defaultOrder')}</SelectItem>
                        <SelectItem value="SUBMITTED_AT">{t('sortBy.dateSubmitted')}</SelectItem>
                        {leadSettings.enabled && (
                            <SelectItem value="LEAD_SCORE">
                                {t('sortBy.leadScore')}{' '}
                                {sortBy === 'LEAD_SCORE'
                                    ? sortDirection === 'DESC'
                                        ? '↓'
                                        : '↑'
                                    : ''}
                            </SelectItem>
                        )}
                        <SelectItem value="PARENT_NAME">
                            {t('sortBy.parentName')}{' '}
                            {sortBy === 'PARENT_NAME' ? (sortDirection === 'DESC' ? '↓' : '↑') : ''}
                        </SelectItem>
                    </SelectContent>
                </Select>

                {/* Show Duplicates Toggle — only shown when lead system is enabled */}
                {leadSettings.enabled && (
                    <div className="flex items-center gap-2">
                        <Switch
                            id="show-duplicates"
                            checked={showDuplicates}
                            onCheckedChange={setShowDuplicates}
                        />
                        <Label htmlFor="show-duplicates" className="text-xs text-neutral-600">
                            {t('showDuplicates')}
                        </Label>
                    </div>
                )}

                {hasActiveFilters && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={clearAllFilters}
                        className="h-8 px-2 text-xs"
                    >
                        <X className="mr-1 size-3" />
                        {t('clearAll')}
                    </MyButton>
                )}
            </div>

            {/* Table Section powered by EnquiryTable component */}
            {selectedEnquiryId && selectedEnquiry && (
                <EnquiryTable
                    enquiryId={selectedEnquiryId}
                    enquiryName={selectedEnquiry.campaign_name}
                    customFieldsJson={JSON.stringify(selectedEnquiry.institute_custom_fields || [])}
                    statusFilter={statusFilter}
                    sourceFilter={sourceFilter}
                    packageSessionFilter={packageSessionFilter}
                    dateRangeFilter={dateRange}
                    searchFilter={searchFilter}
                    leadTierFilter={tierFilter || undefined}
                    excludeDuplicates={showDuplicates ? undefined : true}
                    sortBy={sortBy || undefined}
                    sortDirection={sortBy ? sortDirection : undefined}
                />
            )}

            {/* No enquiry selected state */}
            {!selectedEnquiryId && (
                <Card className="p-12 text-center">
                    <p className="text-muted-foreground">{t('selectEnquiryPrompt')}</p>
                </Card>
            )}

            {/* Create Enquiry Dialog */}
            <CreateEnquiryDialog isOpen={isCreateDialogOpen} onClose={handleCreateSuccess} />

            {/* Walk-in Registration Sheet */}
            <Sheet open={isWalkInOpen} onOpenChange={setIsWalkInOpen}>
                <SheetContent
                    side="right"
                    className="flex w-full max-w-2xl flex-col p-0 sm:max-w-2xl"
                >
                    <SheetHeader className="border-b px-6 py-4">
                        <SheetTitle>{t('walkInRegistration')}</SheetTitle>
                    </SheetHeader>
                    {selectedEnquiryId && (
                        <iframe
                            src={createCampaignLink(
                                selectedEnquiryId,
                                instituteDetails?.learner_portal_base_url,
                                true
                            )}
                            className="w-full flex-1 border-0"
                            title={t('walkInRegistrationFormTitle')}
                        />
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}

function RouteComponent() {
    return (
        <LayoutContainer>
            <EnquiryPage />
        </LayoutContainer>
    );
}
