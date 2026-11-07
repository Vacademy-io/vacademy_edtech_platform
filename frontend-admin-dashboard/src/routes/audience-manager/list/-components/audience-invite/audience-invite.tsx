import EmptyInvitePage from '@/assets/svgs/empty-invite-page.svg';
import { ListCardStats } from './ListCardStats';
import { usePaginationState } from '@/hooks/pagination';
import { Button } from '@/components/ui/button';
import { SettingsQuickAccessButton } from '@/components/settings/quick-access/SettingsQuickAccessButton';
import { SettingsTabs } from '@/routes/settings/-constants/terms';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CreateCampaignDialog } from '../create-campaign-dialog/CreateCampaignDialog';
import { format } from 'date-fns';
import {
    MagnifyingGlass,
    Plus,
    UserPlus,
    Code,
    CodeSimple,
    CalendarBlank,
    Info,
    Megaphone,
    Globe,
    QrCode,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useCampaignsList } from '../../-hooks/useCampaignsList';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { CampaignItem } from '../../-services/get-campaigns-list';
import { AudienceCampaignCardMenuOptions } from './audience-campaign-card-menu-options';
import CampaignLink from '../create-campaign-dialog/CampaignLink';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { listAccessibleSubOrgs } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { toast } from 'sonner';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { ApiIntegrationDialog } from '../api-integration-dialog/ApiIntegrationDialog';
import { EmbedCodeDialog } from '../embed-code-dialog/EmbedCodeDialog';
import { ShareQrDialog } from '../share-qr-dialog/ShareQrDialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { LeadPagination } from '@/components/shared/leads';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    buildCampaignTypeFilterOptions,
    buildDefaultCampaignTypeOptions,
} from '../../-utils/campaign-types';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import { orderedTagEntries } from '../../-utils/campaign-tags';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'DRAFT';
const VALID_STATUS: readonly string[] = ['ALL', 'ACTIVE', 'INACTIVE', 'DRAFT'];

const SERVER_FETCH_SIZE = 200;
const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 6;

// Force-filled primary CTA. The platform <Button>'s `bg-primary` CSS-var was
// rendering very light, so primary actions looked like outlines — bypass via tokens.
const PRIMARY_BTN = 'bg-primary-500 text-white shadow-sm hover:bg-primary-600';
const CARD_PRIMARY_BTN =
    'h-8 gap-1.5 rounded-md bg-primary-500 px-3 text-xs font-medium text-white shadow-sm hover:bg-primary-600';
const CARD_OUTLINE_BTN =
    'h-8 gap-1.5 rounded-md border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 shadow-sm hover:border-primary-200 hover:bg-primary-50/40 hover:text-primary-700';

// Human date — never show raw ISO to users.
const formatDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format(d, 'MMM d, yyyy');
};

/** Factory-with-parameter — called from within the component render via
 * useMemo(() => buildStatusDropdownOptions(t), [t]) once the
 * useTranslation('audienceManagerAudienceInvite') consumer is mounted. */
const buildStatusDropdownOptions = (t: TFunction): { label: string; value: StatusFilter }[] => [
    { label: t('statusFilter.allStatus'), value: 'ALL' },
    { label: t('status.active'), value: 'ACTIVE' },
    { label: t('status.inactive'), value: 'INACTIVE' },
    { label: t('status.draft'), value: 'DRAFT' },
];

export const AudienceInvite = () => {
    const { t, i18n } = useTranslation('audienceManagerAudienceInvite');
    const { campaignType: term } = useLeadTerminology();
    const { t: tCampaignType } = useTranslation('audienceManagerCampaignTypeDropdown');
    const statusDropdownOptions = useMemo(() => buildStatusDropdownOptions(t), [t]);
    const [searchQuery, setSearchQuery] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [subOrgFilter, setSubOrgFilter] = useState<string>('ALL');
    const [typeFilter, setTypeFilter] = useState<string>('ALL');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [campaignBeingEdited, setCampaignBeingEdited] = useState<CampaignItem | null>(null);
    const [apiDialogCampaign, setApiDialogCampaign] = useState<CampaignItem | null>(null);
    const [embedDialogCampaign, setEmbedDialogCampaign] = useState<CampaignItem | null>(null);
    const [qrDialogCampaign, setQrDialogCampaign] = useState<CampaignItem | null>(null);
    const { instituteDetails } = useInstituteDetailsStore();
    const navigate = useNavigate();

    const audienceTerm = getTerminology(OtherTerms.AudienceList, SystemTerms.AudienceList);
    const audienceTermPlural = getTerminologyPlural(
        OtherTerms.AudienceList,
        SystemTerms.AudienceList
    );

    const { page, pageSize, handlePageChange } = usePaginationState({
        initialPage: 0,
        initialPageSize: PAGE_SIZE,
    });

    // Sub-orgs for the Sub-Org filter + per-card chip. {id = child-institute id (= audience.sub_org_id), name}.
    const { data: accessibleSubOrgs } = useQuery({
        queryKey: ['ACCESSIBLE_SUB_ORGS', instituteDetails?.id],
        queryFn: () => listAccessibleSubOrgs(instituteDetails?.id || ''),
        enabled: !!instituteDetails?.id,
        staleTime: 5 * 60 * 1000,
    });
    const subOrgNameById = useMemo(() => {
        const m = new Map<string, string>();
        (accessibleSubOrgs ?? []).forEach((so) => m.set(so.id, so.name));
        return m;
    }, [accessibleSubOrgs]);

    // Seed state from the URL on mount — refresh-safe deep linking.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const q = params.get('q');
        const s = params.get('status');
        const p = params.get('page');
        if (q) {
            setSearchQuery(q);
            setAppliedSearch(q);
        }
        if (s && VALID_STATUS.includes(s)) setStatusFilter(s as StatusFilter);
        const so = params.get('subOrg');
        if (so) setSubOrgFilter(so);
        const ty = params.get('type');
        if (ty) setTypeFilter(ty);
        if (p) {
            const n = parseInt(p, 10);
            if (!Number.isNaN(n) && n > 0) handlePageChange(n);
        }
        // intentionally only on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Debounce search input (typing → applied → query key).
    useEffect(() => {
        const trimmed = searchQuery.trim();
        if (trimmed === appliedSearch) return;
        const timer = window.setTimeout(() => {
            setAppliedSearch(trimmed);
            handlePageChange(0);
        }, SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchQuery, appliedSearch, handlePageChange]);

    // Sync state → URL (replaceState so the back button isn't polluted by typing).
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (appliedSearch) params.set('q', appliedSearch);
        else params.delete('q');
        if (statusFilter !== 'ALL') params.set('status', statusFilter);
        else params.delete('status');
        if (subOrgFilter !== 'ALL') params.set('subOrg', subOrgFilter);
        else params.delete('subOrg');
        if (typeFilter !== 'ALL') params.set('type', typeFilter);
        else params.delete('type');
        if (page > 0) params.set('page', String(page));
        else params.delete('page');
        const qs = params.toString();
        const newUrl = `${window.location.pathname}${qs ? '?' + qs : ''}`;
        window.history.replaceState(null, '', newUrl);
    }, [appliedSearch, statusFilter, subOrgFilter, typeFilter, page]);

    const handleStatusChange = (value: StatusFilter) => {
        handlePageChange(0);
        setStatusFilter(value);
    };

    const handleSubOrgChange = (value: string) => {
        handlePageChange(0);
        setSubOrgFilter(value);
    };

    const handleTypeChange = (value: string) => {
        handlePageChange(0);
        setTypeFilter(value);
    };

    const handleClearFilters = () => {
        setSearchQuery('');
        setAppliedSearch('');
        setStatusFilter('ALL');
        setSubOrgFilter('ALL');
        setTypeFilter('ALL');
        handlePageChange(0);
    };

    const campaignsPayload = useMemo(
        () => ({
            institute_id: instituteDetails?.id || '',
            page: 0,
            size: SERVER_FETCH_SIZE,
            campaign_name: appliedSearch || undefined,
            status: statusFilter !== 'ALL' ? statusFilter : undefined,
            sub_org_id: subOrgFilter !== 'ALL' ? subOrgFilter : undefined,
            // Backend matches case-insensitively as a substring, so "Facebook"
            // also finds lists saved as FACEBOOK.
            campaign_type: typeFilter !== 'ALL' ? typeFilter : undefined,
            sort_by: 'created_at',
            sort_direction: 'DESC',
        }),
        [instituteDetails?.id, appliedSearch, statusFilter, subOrgFilter, typeFilter]
    );

    const { data: campaignsList, isLoading, isError } = useCampaignsList(campaignsPayload);

    // Type-filter options come from the unfiltered list so they don't vanish
    // once a filter narrows the page. Same query key as the page's default
    // load, so this is served from cache rather than a second request.
    const { data: allCampaignsList } = useCampaignsList({
        institute_id: instituteDetails?.id || '',
        page: 0,
        size: SERVER_FETCH_SIZE,
        sort_by: 'created_at',
        sort_direction: 'DESC',
    });
    const typeFilterOptions = useMemo(
        () =>
            buildCampaignTypeFilterOptions(buildDefaultCampaignTypeOptions(tCampaignType), [
                ...(allCampaignsList?.content ?? []).map((c) => c.campaign_type),
                typeFilter !== 'ALL' ? typeFilter : undefined,
            ]),
        [tCampaignType, allCampaignsList?.content, typeFilter]
    );

    const filteredCampaigns = useMemo(() => {
        if (!campaignsList?.content) return [];
        return campaignsList.content.filter((c: CampaignItem) => {
            const s = c.status?.trim().toUpperCase();
            return ['ACTIVE', 'INACTIVE', 'DRAFT'].includes(s);
        });
    }, [campaignsList?.content]);

    const totalFilteredPages = useMemo(() => {
        if (!filteredCampaigns.length) return 1;
        return Math.max(1, Math.ceil(filteredCampaigns.length / pageSize));
    }, [filteredCampaigns.length, pageSize]);

    useEffect(() => {
        if (page > 0 && page >= totalFilteredPages) {
            handlePageChange(Math.max(totalFilteredPages - 1, 0));
        }
    }, [handlePageChange, page, totalFilteredPages]);

    const paginatedCampaigns = useMemo(() => {
        const startIndex = page * pageSize;
        return filteredCampaigns.slice(startIndex, startIndex + pageSize);
    }, [filteredCampaigns, page, pageSize]);

    const statusCounts = useMemo(() => {
        const acc = { active: 0, draft: 0, inactive: 0 };
        for (const c of filteredCampaigns) {
            const s = c.status?.trim().toUpperCase();
            if (s === 'ACTIVE') acc.active += 1;
            else if (s === 'DRAFT') acc.draft += 1;
            else acc.inactive += 1;
        }
        return acc;
    }, [filteredCampaigns]);

    const hasResults = paginatedCampaigns.length > 0;
    const hasActiveFilter =
        !!appliedSearch || statusFilter !== 'ALL' || subOrgFilter !== 'ALL' || typeFilter !== 'ALL';

    const kpis: {
        label: string;
        value: number;
        dot: string;
        filter: StatusFilter;
        ring: string;
    }[] = [
        {
            label: t('status.active'),
            value: statusCounts.active,
            dot: 'bg-success-500',
            filter: 'ACTIVE',
            ring: 'ring-success-500',
        },
        {
            label: t('status.draft'),
            value: statusCounts.draft,
            dot: 'bg-warning-500',
            filter: 'DRAFT',
            ring: 'ring-warning-500',
        },
        {
            label: t('status.inactive'),
            value: statusCounts.inactive,
            dot: 'bg-neutral-400',
            filter: 'INACTIVE',
            ring: 'ring-neutral-400',
        },
    ];

    return (
        <div className="flex w-full flex-col gap-6">
            {/* Heading */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold leading-tight text-neutral-900">
                        {isLoading
                            ? t('heading.titleLoading', { term: audienceTermPlural })
                            : t('heading.titleWithCount', {
                                  term: audienceTermPlural,
                                  count: filteredCampaigns.length,
                                  formattedCount:
                                      filteredCampaigns.length.toLocaleString(i18n.language),
                              })}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-500">
                        {t('heading.subtitle', { term: audienceTermPlural.toLowerCase() })}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <SettingsQuickAccessButton
                        settingsKey={SettingsTabs.LeadSettings}
                        label={t('settingsButton')}
                    />
                    <Button
                        onClick={() => {
                            setCampaignBeingEdited(null);
                            setIsDialogOpen(true);
                        }}
                        className={cn('w-full shrink-0 sm:w-auto', PRIMARY_BTN)}
                    >
                        <Plus className="me-2 size-4" /> {t('addButton', { term: audienceTerm })}
                    </Button>
                </div>
            </div>

            {/* Compact clickable KPI strip — click to filter, click again to clear. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {isLoading
                    ? [0, 1, 2].map((i) => (
                          <div
                              key={i}
                              className="rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm"
                          >
                              <Skeleton className="h-3 w-16" />
                              <Skeleton className="mt-2 h-6 w-12" />
                          </div>
                      ))
                    : kpis.map((kpi) => {
                          const isActive = statusFilter === kpi.filter;
                          return (
                              <button
                                  key={kpi.filter}
                                  type="button"
                                  onClick={() => handleStatusChange(isActive ? 'ALL' : kpi.filter)}
                                  aria-pressed={isActive}
                                  className={cn(
                                      'flex items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2',
                                      isActive
                                          ? cn('border-transparent ring-2 ring-inset', kpi.ring)
                                          : 'border-neutral-200'
                                  )}
                              >
                                  <span className="flex items-center gap-2">
                                      <span className={cn('size-1.5 rounded-full', kpi.dot)} />
                                      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                          {kpi.label}
                                      </span>
                                  </span>
                                  <span className="text-xl font-semibold tabular-nums text-neutral-900">
                                      {kpi.value.toLocaleString()}
                                  </span>
                              </button>
                          );
                      })}
            </div>

            {/* Toolbar — search + status filter */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                    <Input
                        type="text"
                        placeholder={t('toolbar.searchPlaceholder', { term: audienceTerm })}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-10 w-full pl-8"
                        aria-label={t('toolbar.searchAriaLabel', { term: audienceTerm })}
                    />
                </div>
                <Select
                    value={statusFilter}
                    onValueChange={(v) => handleStatusChange(v as StatusFilter)}
                >
                    <SelectTrigger className="h-10 w-full sm:w-44">
                        <SelectValue placeholder={t('statusFilter.placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                        {statusDropdownOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={handleTypeChange}>
                    <SelectTrigger className="h-10 w-full sm:w-48">
                        <SelectValue placeholder={t('typeFilter.placeholder', { term })} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL">{t('typeFilter.allTypes', { term })}</SelectItem>
                        {typeFilterOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {((accessibleSubOrgs?.length ?? 0) > 0 || subOrgFilter !== 'ALL') && (
                    <Select value={subOrgFilter} onValueChange={handleSubOrgChange}>
                        <SelectTrigger className="h-10 w-full sm:w-44">
                            <SelectValue placeholder={t('toolbar.subOrgPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">{t('toolbar.allSubOrgs')}</SelectItem>
                            {(accessibleSubOrgs ?? []).map((so) => (
                                <SelectItem key={so.id} value={so.id}>
                                    {so.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            {/* Content */}
            {isError ? (
                <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-neutral-200 bg-white px-6 py-16 text-center">
                    <p className="text-sm font-medium text-neutral-700">
                        {t('errorState.title', { term: audienceTermPlural.toLowerCase() })}
                    </p>
                    <p className="text-xs text-neutral-500">{t('errorState.subtitle')}</p>
                </div>
            ) : isLoading ? (
                <SkeletonCards />
            ) : !hasResults ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                    <EmptyInvitePage />
                    <p className="text-sm text-neutral-600">
                        {hasActiveFilter
                            ? t('emptyState.noMatches', { term: audienceTermPlural.toLowerCase() })
                            : t('emptyState.noneYet', { term: audienceTermPlural.toLowerCase() })}
                    </p>
                    {hasActiveFilter ? (
                        <Button variant="outline" size="sm" onClick={handleClearFilters}>
                            {t('emptyState.clearFilters')}
                        </Button>
                    ) : (
                        <Button
                            className={PRIMARY_BTN}
                            onClick={() => {
                                setCampaignBeingEdited(null);
                                setIsDialogOpen(true);
                            }}
                        >
                            <Plus className="me-2 size-4" />{' '}
                            {t('emptyState.createFirst', { term: audienceTerm.toLowerCase() })}
                        </Button>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        {paginatedCampaigns.map((campaign: CampaignItem, index: number) => {
                            const normalizedStatus = campaign.status?.trim().toUpperCase();
                            const campaignId =
                                campaign.id || campaign.campaign_id || campaign.audience_id || '';

                            const handleCampaignClick = () => {
                                if (!campaignId) {
                                    toast.error(t('toast.missingCampaignId'));
                                    return;
                                }
                                navigate({
                                    to: '/audience-manager/list/campaign-users',
                                    search: {
                                        campaignId,
                                        campaignName: campaign.campaign_name,
                                        customFields: campaign.institute_custom_fields
                                            ? JSON.stringify(campaign.institute_custom_fields)
                                            : undefined,
                                        campaignType: campaign.campaign_type,
                                    },
                                    // Router's typed search doesn't model these dynamic params.
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                } as any);
                            };

                            const statusStyles = (() => {
                                const s = normalizedStatus;
                                if (s === 'ACTIVE') {
                                    return {
                                        dot: 'bg-success-500',
                                        chip: 'bg-success-50 text-success-700',
                                        tile: 'bg-success-50 text-success-700',
                                    };
                                }
                                if (s === 'DRAFT') {
                                    return {
                                        dot: 'bg-warning-500',
                                        chip: 'bg-warning-50 text-warning-700',
                                        tile: 'bg-warning-50 text-warning-700',
                                    };
                                }
                                return {
                                    dot: 'bg-neutral-400',
                                    chip: 'bg-neutral-100 text-neutral-600',
                                    tile: 'bg-neutral-100 text-neutral-500',
                                };
                            })();
                            // Bug fix: this used to naively capitalize the raw backend status
                            // enum (e.g. "ACTIVE" -> "Active"), which only ever rendered an
                            // English-looking label regardless of locale. Map through the
                            // translated status labels instead — filteredCampaigns already
                            // guarantees normalizedStatus is one of these three values.
                            const statusLabel =
                                normalizedStatus === 'ACTIVE'
                                    ? t('status.active')
                                    : normalizedStatus === 'DRAFT'
                                      ? t('status.draft')
                                      : t('status.inactive');
                            const TypeIcon =
                                campaign.campaign_type?.toUpperCase() === 'WEBSITE'
                                    ? Globe
                                    : Megaphone;
                            const tagEntries = orderedTagEntries(campaign.tags);

                            return (
                                <Card
                                    key={campaignId || index}
                                    role="button"
                                    tabIndex={0}
                                    onClick={handleCampaignClick}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handleCampaignClick();
                                        }
                                    }}
                                    aria-label={t('card.openAriaLabel', {
                                        campaignName: campaign.campaign_name,
                                    })}
                                    className="group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
                                >
                                    {/* Header */}
                                    <div className="flex items-start gap-3 p-4 pb-3">
                                        <span
                                            className={cn(
                                                'flex size-10 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105',
                                                statusStyles.tile
                                            )}
                                        >
                                            <TypeIcon weight="fill" className="size-5" />
                                        </span>
                                        <div className="min-w-0 flex-1 space-y-1.5">
                                            <h3
                                                className="truncate text-base font-semibold leading-tight text-neutral-900 transition-colors group-hover:text-primary-700"
                                                title={campaign.campaign_name}
                                            >
                                                {campaign.campaign_name}
                                            </h3>
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span
                                                    className={cn(
                                                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                                                        statusStyles.chip
                                                    )}
                                                >
                                                    <span
                                                        className={cn(
                                                            'size-1.5 rounded-full',
                                                            statusStyles.dot
                                                        )}
                                                    />
                                                    {statusLabel}
                                                </span>
                                                {campaign.campaign_type && (
                                                    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-neutral-600">
                                                        {campaign.campaign_type}
                                                    </span>
                                                )}
                                                {campaign.sub_org_id && (
                                                    <span className="inline-flex items-center rounded-full bg-info-50 px-2.5 py-0.5 text-xs font-medium text-info-600">
                                                        {subOrgNameById.get(campaign.sub_org_id) ||
                                                            t('toolbar.subOrgFallback')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div
                                            className="shrink-0"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <AudienceCampaignCardMenuOptions
                                                campaign={campaign}
                                                onEdit={(selectedCampaign) => {
                                                    setCampaignBeingEdited(selectedCampaign);
                                                    setIsDialogOpen(true);
                                                }}
                                            />
                                        </div>
                                    </div>

                                    {/* Body */}
                                    <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-600">
                                            <CalendarBlank className="size-4 shrink-0 text-neutral-400" />
                                            <span className="font-medium text-neutral-800">
                                                {formatDate(campaign.start_date_local)}
                                            </span>
                                            <span className="text-neutral-400">→</span>
                                            <span className="font-medium text-neutral-800">
                                                {formatDate(campaign.end_date_local)}
                                            </span>
                                        </div>
                                        {campaign.description && (
                                            <p className="line-clamp-2 break-words text-sm leading-relaxed text-neutral-600">
                                                {campaign.description}
                                            </p>
                                        )}
                                        {tagEntries.length > 0 && (
                                            <ul
                                                className="flex flex-wrap gap-1.5"
                                                aria-label={t('card.tagsAriaLabel')}
                                            >
                                                {tagEntries.map(([key, value]) => (
                                                    <li
                                                        key={key}
                                                        className="inline-flex max-w-full items-center truncate rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs text-neutral-700"
                                                        title={`${key}: ${value}`}
                                                    >
                                                        <span className="text-neutral-500">
                                                            {key}:
                                                        </span>
                                                        <span className="ms-1 truncate font-medium">
                                                            {value}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        <ListCardStats audienceId={campaignId} />
                                        <div
                                            className="mt-auto min-w-0 pt-1"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {normalizedStatus === 'ACTIVE' ? (
                                                <CampaignLink
                                                    campaignId={campaignId}
                                                    enableShortLink
                                                />
                                            ) : (
                                                <div className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-3 py-2.5 text-sm text-neutral-500">
                                                    <Info className="size-4 shrink-0 text-neutral-400" />
                                                    <span>
                                                        {t('card.activateHint', {
                                                            term: audienceTerm.toLowerCase(),
                                                        })}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div
                                        className="flex flex-wrap items-center gap-1.5 border-t border-neutral-100 bg-neutral-50/40 px-4 py-3"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        size="sm"
                                                        className={CARD_PRIMARY_BTN}
                                                        onClick={() => {
                                                            navigate({
                                                                to: '/audience-manager/list/campaign-users/add',
                                                                search: {
                                                                    campaignId,
                                                                    campaignName:
                                                                        campaign.campaign_name,
                                                                    customFields:
                                                                        campaign.institute_custom_fields
                                                                            ? JSON.stringify(
                                                                                  campaign.institute_custom_fields
                                                                              )
                                                                            : undefined,
                                                                },
                                                                // Router's typed search doesn't model these dynamic params.
                                                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                            } as any);
                                                        }}
                                                    >
                                                        <UserPlus className="size-3.5" />
                                                        {t('actions.addResponse')}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>{t('actions.addResponseTooltip')}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className={CARD_OUTLINE_BTN}
                                                        onClick={() =>
                                                            setQrDialogCampaign(campaign)
                                                        }
                                                    >
                                                        <QrCode className="size-3.5" />
                                                        {t('actions.qr')}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>{t('actions.qrTooltip')}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className={CARD_OUTLINE_BTN}
                                                        onClick={() =>
                                                            setApiDialogCampaign(campaign)
                                                        }
                                                    >
                                                        <Code className="size-3.5" />
                                                        {t('actions.api')}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>{t('actions.apiTooltip')}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className={CARD_OUTLINE_BTN}
                                                        onClick={() =>
                                                            setEmbedDialogCampaign(campaign)
                                                        }
                                                    >
                                                        <CodeSimple className="size-3.5" />
                                                        {t('actions.embed')}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>{t('actions.embedTooltip')}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                    <LeadPagination
                        currentPage={page}
                        totalPages={totalFilteredPages}
                        onPageChange={handlePageChange}
                    />
                </div>
            )}

            <CreateCampaignDialog
                isOpen={isDialogOpen}
                onClose={() => {
                    setIsDialogOpen(false);
                    setCampaignBeingEdited(null);
                }}
                campaign={campaignBeingEdited}
            />
            {apiDialogCampaign && (
                <ApiIntegrationDialog
                    isOpen={!!apiDialogCampaign}
                    onClose={() => setApiDialogCampaign(null)}
                    campaign={apiDialogCampaign}
                />
            )}
            {embedDialogCampaign && (
                <EmbedCodeDialog
                    isOpen={!!embedDialogCampaign}
                    onClose={() => setEmbedDialogCampaign(null)}
                    campaign={embedDialogCampaign}
                />
            )}
            {qrDialogCampaign && (
                <ShareQrDialog
                    isOpen={!!qrDialogCampaign}
                    onClose={() => setQrDialogCampaign(null)}
                    campaign={qrDialogCampaign}
                />
            )}
        </div>
    );
};

/** Skeleton placeholder for the card grid while data loads. */
function SkeletonCards() {
    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
                <div
                    key={i}
                    className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
                >
                    <div className="flex items-start gap-3">
                        <Skeleton className="size-10 shrink-0 rounded-lg" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-4 w-1/2" />
                        </div>
                    </div>
                    <Skeleton className="mt-4 h-4 w-2/3" />
                    <Skeleton className="mt-3 h-10 w-full" />
                    <div className="mt-3 flex gap-2">
                        <Skeleton className="h-8 w-28" />
                        <Skeleton className="h-8 w-16" />
                        <Skeleton className="h-8 w-20" />
                    </div>
                </div>
            ))}
        </div>
    );
}
