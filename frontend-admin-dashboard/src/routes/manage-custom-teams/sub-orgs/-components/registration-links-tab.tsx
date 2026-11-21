import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    CircleNotch,
    Copy,
    DownloadSimple,
    LinkSimple,
    MagnifyingGlass,
    MapPin,
    PencilSimple,
    Plus,
    UsersThree,
    X,
} from '@phosphor-icons/react';

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyPagination } from '@/components/design-system/pagination';
import { Input } from '@/components/ui/input';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import createSubOrgRegistrationLink from '@/routes/manage-students/invite/-utils/createSubOrgRegistrationLink';
import {
    fetchAllTemplateRegistrations,
    getRegistrationTemplateDetail,
    getRegistrationFacets,
    listRegistrationTemplates,
    listTemplateRegistrations,
    updateRegistrationTemplateStatus,
    type RegistrationTemplateListItem,
    type SubOrgRegistrationRow,
    type TemplateDetail,
} from '../../-services/sub-org-registration-services';
import { RegistrationLinkCreateModal } from './registration-link-create-modal';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import { humanizeStatus, statusToneClass } from '../../-utils/status-display';
import { buildCsv, downloadCsv, formatDate } from '../../-utils/list-export';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/** Distinct facet values → MultiSelectFilter options (value === label; searchable by label). */
const toFilterOptions = (values: string[] | undefined) =>
    (values ?? []).map((v) => ({ value: v, label: v }));

// The list response only carries `steps`; paid templates include a "PAYMENT" step and
// templates with DigiLocker identity verification include a "KYC" step.
const isPaidTemplate = (template: RegistrationTemplateListItem) =>
    Array.isArray(template.steps) && template.steps.includes('PAYMENT');

const hasKycStep = (template: RegistrationTemplateListItem) =>
    Array.isArray(template.steps) && template.steps.includes('KYC');

// The registration statuses the dialog can filter by — mirrors the backend
// SubOrgRegistrationStatus enum. Labels + colours are DERIVED (humanizeStatus /
// statusToneClass), so nothing is duplicated per value.
const REGISTRATION_STATUS_VALUES = ['DRAFT', 'OTP_VERIFIED', 'PENDING_PAYMENT', 'COMPLETED', 'FAILED'];
const LINK_STATUS_VALUES = ['ACTIVE', 'INACTIVE'];
const LINK_TYPE_VALUES = ['PAID', 'FREE'];

// MyDropdown works on display strings — first option clears the filter.
const buildLinkStatusLabels = (t: TFunction) => [
    t('filters.allStatuses'),
    ...LINK_STATUS_VALUES.map(humanizeStatus),
];
const buildLinkTypeLabels = (t: TFunction) => [
    t('filters.allTypes'),
    ...LINK_TYPE_VALUES.map(humanizeStatus),
];
const buildDialogStatusLabels = (t: TFunction) => [
    t('filters.allStatuses'),
    ...REGISTRATION_STATUS_VALUES.map(humanizeStatus),
];

const buildRegistrationsCsvHeaders = (t: TFunction) => [
    t('csv.organization'),
    t('csv.admin'),
    t('csv.email'),
    t('csv.phone'),
    t('csv.city'),
    t('csv.state'),
    t('csv.pincode'),
    t('csv.seatsUsed'),
    t('csv.seatsTotal'),
    t('csv.status'),
    t('csv.kyc'),
    t('csv.registeredOn'),
];

const buildRegistrationsCsv = (t: TFunction, rows: SubOrgRegistrationRow[]): string =>
    buildCsv(
        buildRegistrationsCsvHeaders(t),
        rows.map((r) => [
            r.org_name,
            r.admin_name,
            r.admin_email,
            r.admin_phone,
            r.city,
            r.state,
            r.pincode,
            r.used_seats ?? '',
            r.total_seats ?? '',
            humanizeStatus(r.status),
            humanizeStatus(r.kyc_status),
            formatDate(r.created_at),
        ])
    );

export function RegistrationLinksTab() {
    const { t } = useTranslation('manageCustomTeamsRegistrationLinksTab');
    // Institutes rename this concept via Settings → Naming (Channel Partner,
    // Branch, Franchise, VLE …); user-facing labels must follow that.
    const subOrgTermPlural = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    // Full detail of the template being edited — presence switches the modal to edit mode.
    const [editTemplate, setEditTemplate] = useState<TemplateDetail | null>(null);
    const [registrationsTemplate, setRegistrationsTemplate] =
        useState<RegistrationTemplateListItem | null>(null);

    // Client-side filters for the links list (the list is fetched whole).
    const [linkSearch, setLinkSearch] = useState('');
    const [linkStatusFilter, setLinkStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
    const [linkTypeFilter, setLinkTypeFilter] = useState<'ALL' | 'PAID' | 'FREE'>('ALL');

    const instituteId = getCurrentInstituteId();
    const queryClient = useQueryClient();
    const { instituteDetails } = useInstituteDetailsStore();

    const { data: templates = [], isLoading } = useQuery({
        queryKey: ['sub-org-registration-templates', instituteId],
        queryFn: () => listRegistrationTemplates(instituteId || ''),
        enabled: !!instituteId,
    });

    const statusMutation = useMutation({
        mutationFn: ({
            templateId,
            status,
        }: {
            templateId: string;
            status: 'ACTIVE' | 'INACTIVE';
        }) => updateRegistrationTemplateStatus(templateId, status, instituteId || ''),
        onSuccess: (data) => {
            toast.success(
                data.status === 'ACTIVE'
                    ? t('toast.linkActivated')
                    : t('toast.linkDeactivated')
            );
            queryClient.invalidateQueries({
                queryKey: ['sub-org-registration-templates', instituteId],
            });
        },
        onError: (error: unknown) => {
            const message =
                (error as { response?: { data?: { message?: string } } })?.response?.data
                    ?.message || t('toast.updateStatusFailed');
            toast.error(message);
        },
    });

    // Edit needs the full template config (the list rows only carry summary fields),
    // so fetch the detail on click, then open the modal in edit mode.
    const editDetailMutation = useMutation({
        mutationFn: (templateId: string) =>
            getRegistrationTemplateDetail(templateId, instituteId || ''),
        onSuccess: (detail) => {
            setEditTemplate(detail);
            setIsCreateModalOpen(true);
        },
        onError: (error: unknown) => {
            const message =
                (error as { response?: { data?: { message?: string } } })?.response?.data
                    ?.message || t('toast.loadDetailFailed');
            toast.error(message);
        },
    });

    const copyLink = (inviteCode: string) => {
        const url = createSubOrgRegistrationLink(
            inviteCode,
            instituteDetails?.learner_portal_base_url
        );
        navigator.clipboard.writeText(url);
        toast.success(t('toast.linkCopied'));
    };

    const q = linkSearch.trim().toLowerCase();
    const filteredTemplates = templates.filter((tpl) => {
        if (linkStatusFilter !== 'ALL' && tpl.status !== linkStatusFilter) return false;
        if (linkTypeFilter !== 'ALL') {
            const paid = isPaidTemplate(tpl);
            if (linkTypeFilter === 'PAID' && !paid) return false;
            if (linkTypeFilter === 'FREE' && paid) return false;
        }
        if (q && !(tpl.name || '').toLowerCase().includes(q)) return false;
        return true;
    });
    const hasLinkFilters =
        !!q || linkStatusFilter !== 'ALL' || linkTypeFilter !== 'ALL';
    const linkStatusLabels = buildLinkStatusLabels(t);
    const linkTypeLabels = buildLinkTypeLabels(t);

    if (isLoading) {
        return (
            <div className="space-y-4">
                <div className="flex justify-end">
                    <Skeleton className="h-9 w-52" />
                </div>
                <div className="space-y-2 rounded-md border p-4">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-1 flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1 sm:max-w-xs">
                        <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                        <Input
                            value={linkSearch}
                            onChange={(e) => setLinkSearch(e.target.value)}
                            placeholder={t('filters.searchPlaceholder')}
                            className="h-9 pl-8"
                        />
                    </div>
                    <MyDropdown
                        currentValue={
                            linkStatusFilter === 'ACTIVE'
                                ? t('filters.active')
                                : linkStatusFilter === 'INACTIVE'
                                  ? t('filters.inactive')
                                  : t('filters.allStatuses')
                        }
                        dropdownList={linkStatusLabels}
                        handleChange={(l) =>
                            setLinkStatusFilter(
                                (LINK_STATUS_VALUES.find((v) => humanizeStatus(v) === l) as
                                    | 'ACTIVE'
                                    | 'INACTIVE'
                                    | undefined) ?? 'ALL'
                            )
                        }
                        className="w-36"
                    />
                    <MyDropdown
                        currentValue={
                            linkTypeFilter === 'PAID'
                                ? t('filters.paid')
                                : linkTypeFilter === 'FREE'
                                  ? t('filters.free')
                                  : t('filters.allTypes')
                        }
                        dropdownList={linkTypeLabels}
                        handleChange={(l) =>
                            setLinkTypeFilter(
                                (LINK_TYPE_VALUES.find((v) => humanizeStatus(v) === l) as
                                    | 'PAID'
                                    | 'FREE'
                                    | undefined) ?? 'ALL'
                            )
                        }
                        className="w-32"
                    />
                </div>
                <MyButton
                    onClick={() => {
                        setEditTemplate(null);
                        setIsCreateModalOpen(true);
                    }}
                >
                    <Plus className="mr-2 size-4" />
                    {t('actions.createLink')}
                </MyButton>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('table.name')}</TableHead>
                            <TableHead>{t('table.link')}</TableHead>
                            <TableHead>{t('table.status')}</TableHead>
                            <TableHead>{t('table.registrations')}</TableHead>
                            <TableHead>{t('table.created')}</TableHead>
                            <TableHead className="text-right">{t('table.actions')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredTemplates.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center">
                                    <div className="flex flex-col items-center justify-center gap-2 text-neutral-500">
                                        <LinkSimple className="size-8 opacity-50" />
                                        {hasLinkFilters ? (
                                            <p>{t('empty.noMatchFilters')}</p>
                                        ) : (
                                            <>
                                                <p>{t('empty.noLinksYet')}</p>
                                                <p className="text-xs text-neutral-400">
                                                    {t('empty.createOneHint', {
                                                        term: subOrgTermPlural.toLowerCase(),
                                                    })}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredTemplates.map((template) => {
                                const isRowUpdating =
                                    statusMutation.isPending &&
                                    statusMutation.variables?.templateId === template.id;
                                const isRowLoadingDetail =
                                    editDetailMutation.isPending &&
                                    editDetailMutation.variables === template.id;
                                return (
                                    <TableRow key={template.id}>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <span>{template.name || '-'}</span>
                                                <Badge
                                                    variant="outline"
                                                    className={
                                                        isPaidTemplate(template)
                                                            ? 'border-primary-200 text-primary-500'
                                                            : 'text-muted-foreground'
                                                    }
                                                >
                                                    {isPaidTemplate(template)
                                                        ? t('filters.paid')
                                                        : t('filters.free')}
                                                </Badge>
                                                {hasKycStep(template) && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-muted-foreground"
                                                    >
                                                        {t('badge.kyc')}
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {template.invite_code ? (
                                                <button
                                                    type="button"
                                                    onClick={() => copyLink(template.invite_code)}
                                                    className="flex items-center gap-1 text-sm text-primary-500 hover:underline"
                                                    title={t('link.copyTitle')}
                                                >
                                                    <LinkSimple className="size-3.5" />
                                                    <span className="max-w-24 truncate">
                                                        {template.invite_code}
                                                    </span>
                                                    <Copy className="size-3" />
                                                </button>
                                            ) : (
                                                <span className="text-sm text-muted-foreground">
                                                    -
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Switch
                                                    checked={template.status === 'ACTIVE'}
                                                    disabled={isRowUpdating}
                                                    onCheckedChange={(checked) =>
                                                        statusMutation.mutate({
                                                            templateId: template.id,
                                                            status: checked ? 'ACTIVE' : 'INACTIVE',
                                                        })
                                                    }
                                                    aria-label={t('link.toggleStatusAria', {
                                                        name: template.name,
                                                    })}
                                                />
                                                <Badge
                                                    variant={
                                                        template.status === 'ACTIVE'
                                                            ? 'default'
                                                            : 'secondary'
                                                    }
                                                >
                                                    {template.status}
                                                </Badge>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm">
                                                {template.completed_count ?? 0}
                                                {template.max_registrations
                                                    ? ` / ${template.max_registrations}`
                                                    : ` (${t('table.attemptsSuffix', {
                                                          count: template.total_attempts ?? 0,
                                                      })})`}
                                            </span>
                                        </TableCell>
                                        <TableCell>{formatDate(template.created_at)}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={() =>
                                                        editDetailMutation.mutate(template.id)
                                                    }
                                                    disable={editDetailMutation.isPending}
                                                >
                                                    {isRowLoadingDetail ? (
                                                        <CircleNotch className="mr-1 size-3.5 animate-spin" />
                                                    ) : (
                                                        <PencilSimple className="mr-1 size-3.5" />
                                                    )}
                                                    {t('actions.edit')}
                                                </MyButton>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={() =>
                                                        setRegistrationsTemplate(template)
                                                    }
                                                >
                                                    <UsersThree className="mr-1 size-3.5" />
                                                    {t('actions.view')}
                                                </MyButton>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <RegistrationLinkCreateModal
                open={isCreateModalOpen}
                onOpenChange={(open) => {
                    setIsCreateModalOpen(open);
                    // Clear edit state on close so the next open starts a fresh create.
                    if (!open) setEditTemplate(null);
                }}
                editTemplate={editTemplate}
            />

            <RegistrationsDialog
                template={registrationsTemplate}
                onClose={() => setRegistrationsTemplate(null)}
            />
        </div>
    );
}

/** Rows-per-page for the registrations listing. */
const REGISTRATIONS_PAGE_SIZE = 10;

/** Read-only, paginated + City/State/Pincode-filterable list of the registrations made through one template link. */
function RegistrationsDialog({
    template,
    onClose,
}: {
    template: RegistrationTemplateListItem | null;
    onClose: () => void;
}) {
    const { t } = useTranslation('manageCustomTeamsRegistrationLinksTab');
    const instituteId = getCurrentInstituteId();

    // Free-text search is debounced; the discrete selectors (status + City/State/Pincode
    // multi-selects) apply immediately.
    const [searchInput, setSearchInput] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [cityFilter, setCityFilter] = useState<string[]>([]);
    const [stateFilter, setStateFilter] = useState<string[]>([]);
    const [pincodeFilter, setPincodeFilter] = useState<string[]>([]);
    // Per-custom-field selections, keyed by custom_field id.
    const [customFieldFilters, setCustomFieldFilters] = useState<Record<string, string[]>>({});
    const [page, setPage] = useState(0);
    const [isExporting, setIsExporting] = useState(false);

    // Reset all filter + page state when a different template's dialog opens.
    useEffect(() => {
        setSearchInput('');
        setDebouncedSearch('');
        setStatusFilter('');
        setCityFilter([]);
        setStateFilter([]);
        setPincodeFilter([]);
        setCustomFieldFilters({});
        setPage(0);
    }, [template?.id]);

    // Debounce the free-text search (300ms).
    useEffect(() => {
        const timeout = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
        return () => clearTimeout(timeout);
    }, [searchInput]);

    const filters = useMemo(
        () => ({
            search: debouncedSearch,
            status: statusFilter,
            cities: cityFilter,
            states: stateFilter,
            pincodes: pincodeFilter,
            customFieldFilters,
        }),
        [debouncedSearch, statusFilter, cityFilter, stateFilter, pincodeFilter, customFieldFilters]
    );

    // Any filter change jumps back to the first page.
    useEffect(() => {
        setPage(0);
    }, [filters]);

    // Distinct City/State/Pincode values actually present in this link's registrations —
    // populate the multi-select filters by default (nothing hardcoded).
    const { data: facets } = useQuery({
        queryKey: ['sub-org-registration-facets', template?.id, instituteId],
        queryFn: () => getRegistrationFacets(template?.id || '', instituteId || ''),
        enabled: !!template?.id && !!instituteId,
    });
    const cityOptions = useMemo(() => toFilterOptions(facets?.cities), [facets?.cities]);
    const stateOptions = useMemo(() => toFilterOptions(facets?.states), [facets?.states]);
    const pincodeOptions = useMemo(() => toFilterOptions(facets?.pincodes), [facets?.pincodes]);
    const customFieldFacets = facets?.customFields ?? [];

    const setCustomFieldSelection = (fieldId: string, values: string[]) =>
        setCustomFieldFilters((prev) => {
            const next = { ...prev };
            if (values.length) next[fieldId] = values;
            else delete next[fieldId];
            return next;
        });

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['sub-org-registrations', template?.id, instituteId, page, filters],
        queryFn: () =>
            listTemplateRegistrations({
                templateInviteId: template?.id || '',
                instituteId: instituteId || '',
                page,
                size: REGISTRATIONS_PAGE_SIZE,
                search: filters.search,
                status: filters.status,
                cities: filters.cities,
                states: filters.states,
                pincodes: filters.pincodes,
                customFieldFilters: filters.customFieldFilters,
            }),
        enabled: !!template?.id && !!instituteId,
        placeholderData: keepPreviousData,
    });

    const registrations = data?.content ?? [];
    const totalPages = data?.total_pages ?? 1;
    const totalElements = data?.total_elements ?? 0;
    const activeCustomFieldCount = Object.values(filters.customFieldFilters).filter(
        (v) => v.length
    ).length;
    const hasActiveFilters = !!(
        filters.search ||
        filters.status ||
        filters.cities.length ||
        filters.states.length ||
        filters.pincodes.length ||
        activeCustomFieldCount
    );

    const clearFilters = () => {
        setSearchInput('');
        setStatusFilter('');
        setCityFilter([]);
        setStateFilter([]);
        setPincodeFilter([]);
        setCustomFieldFilters({});
    };

    // Export ALL rows matching the current filters (not just the visible page).
    const handleExport = async () => {
        if (!template?.id || !instituteId) return;
        setIsExporting(true);
        try {
            const rows = await fetchAllTemplateRegistrations({
                templateInviteId: template.id,
                instituteId,
                search: filters.search,
                status: filters.status,
                cities: filters.cities,
                states: filters.states,
                pincodes: filters.pincodes,
                customFieldFilters: filters.customFieldFilters,
            });
            if (rows.length === 0) {
                toast.info(t('toast.noRegistrationsToExport'));
                return;
            }
            const safeName = (template.name || 'registrations').replace(/[^\w.-]+/g, '_');
            downloadCsv(buildRegistrationsCsv(t, rows), `${safeName}_registrations.csv`);
            toast.success(t('toast.exportedCount', { count: rows.length }));
        } catch {
            toast.error(t('toast.exportFailed'));
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <MyDialog
            heading={
                template
                    ? t('dialog.heading', { name: template.name })
                    : t('dialog.headingDefault')
            }
            open={!!template}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            dialogWidth="max-w-5xl"
        >
            <div className="space-y-3">
                {/* Filters: search + status + the fixed City/State/Pincode address columns +
                    one searchable multi-select per form-collected custom field. Every option
                    list is pulled live from submitted data (facets) — nothing hardcoded. A
                    filter only appears when there is data to filter on. */}
                <div className="rounded-lg border bg-neutral-50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative min-w-0 flex-1 sm:max-w-xs">
                            <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                            <Input
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                placeholder={t('dialog.searchPlaceholder')}
                                className="h-9 pl-8"
                            />
                        </div>
                        <MyDropdown
                            currentValue={
                                statusFilter ? humanizeStatus(statusFilter) : t('filters.allStatuses')
                            }
                            dropdownList={buildDialogStatusLabels(t)}
                            handleChange={(l) => {
                                const val = REGISTRATION_STATUS_VALUES.find(
                                    (v) => humanizeStatus(v) === l
                                );
                                setStatusFilter(val ?? '');
                            }}
                            className="w-44"
                        />
                        {cityOptions.length > 0 && (
                            <MultiSelectFilter
                                label={t('dialog.cityLabel')}
                                icon={<MapPin className="size-4 text-neutral-400" />}
                                options={cityOptions}
                                selected={cityFilter}
                                onChange={setCityFilter}
                                placeholder={t('dialog.searchCityPlaceholder')}
                                widthClass="w-36"
                            />
                        )}
                        {stateOptions.length > 0 && (
                            <MultiSelectFilter
                                label={t('dialog.stateLabel')}
                                options={stateOptions}
                                selected={stateFilter}
                                onChange={setStateFilter}
                                placeholder={t('dialog.searchStatePlaceholder')}
                                widthClass="w-36"
                            />
                        )}
                        {pincodeOptions.length > 0 && (
                            <MultiSelectFilter
                                label={t('dialog.pincodeLabel')}
                                options={pincodeOptions}
                                selected={pincodeFilter}
                                onChange={setPincodeFilter}
                                placeholder={t('dialog.searchPincodePlaceholder')}
                                widthClass="w-36"
                            />
                        )}
                        {customFieldFacets.map((field) => (
                            <MultiSelectFilter
                                key={field.id}
                                label={field.label}
                                options={toFilterOptions(field.values)}
                                selected={customFieldFilters[field.id] ?? []}
                                onChange={(values) => setCustomFieldSelection(field.id, values)}
                                placeholder={t('dialog.searchFieldPlaceholder', {
                                    field: field.label.toLowerCase(),
                                })}
                                widthClass="w-40"
                            />
                        ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                            {t('dialog.registrationCount', { count: totalElements })}
                            {hasActiveFilters ? t('dialog.filteredSuffix') : ''}
                        </p>
                        <div className="flex items-center gap-2">
                            {hasActiveFilters && (
                                <MyButton buttonType="secondary" scale="small" onClick={clearFilters}>
                                    <X className="mr-1 size-3.5" />
                                    {t('dialog.clear')}
                                </MyButton>
                            )}
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={handleExport}
                                disable={isExporting || totalElements === 0}
                            >
                                {isExporting ? (
                                    <CircleNotch className="mr-1 size-3.5 animate-spin" />
                                ) : (
                                    <DownloadSimple className="mr-1 size-3.5" />
                                )}
                                {t('dialog.exportCsv')}
                            </MyButton>
                        </div>
                    </div>
                </div>

                {isLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                    </div>
                ) : registrations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-neutral-500">
                        <UsersThree className="size-8 opacity-50" />
                        <p className="text-sm">
                            {hasActiveFilters
                                ? t('dialog.noMatchFilters')
                                : t('dialog.noRegistrationsYet')}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t('dialog.table.organization')}</TableHead>
                                        <TableHead>{t('dialog.table.admin')}</TableHead>
                                        <TableHead>{t('dialog.table.email')}</TableHead>
                                        <TableHead>{t('dialog.table.phone')}</TableHead>
                                        <TableHead>{t('dialog.table.city')}</TableHead>
                                        <TableHead>{t('dialog.table.state')}</TableHead>
                                        <TableHead>{t('dialog.table.pincode')}</TableHead>
                                        <TableHead>{t('dialog.table.seats')}</TableHead>
                                        <TableHead>{t('dialog.table.status')}</TableHead>
                                        <TableHead>{t('dialog.table.kyc')}</TableHead>
                                        <TableHead>{t('dialog.table.date')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {registrations.map((row) => (
                                        <TableRow key={row.id} className="hover:bg-muted/50">
                                            <TableCell className="font-medium">
                                                {row.org_name || '-'}
                                            </TableCell>
                                            <TableCell>{row.admin_name || '-'}</TableCell>
                                            <TableCell>{row.admin_email || '-'}</TableCell>
                                            <TableCell>{row.admin_phone || '-'}</TableCell>
                                            <TableCell>{row.city || '-'}</TableCell>
                                            <TableCell>{row.state || '-'}</TableCell>
                                            <TableCell>{row.pincode || '-'}</TableCell>
                                            <TableCell>
                                                {row.used_seats == null
                                                    ? '-'
                                                    : row.total_seats != null
                                                      ? `${row.used_seats}/${row.total_seats}`
                                                      : String(row.used_seats)}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant="outline"
                                                    className={statusToneClass(row.status)}
                                                >
                                                    {humanizeStatus(row.status)}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {row.kyc_status ? (
                                                    <Badge
                                                        variant="outline"
                                                        className={statusToneClass(row.kyc_status)}
                                                    >
                                                        {humanizeStatus(row.kyc_status)}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-sm text-muted-foreground">
                                                        —
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>{formatDate(row.created_at)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        {totalPages > 1 && (
                            <div className={isFetching ? 'opacity-60' : ''}>
                                <MyPagination
                                    currentPage={page}
                                    totalPages={totalPages}
                                    onPageChange={setPage}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        </MyDialog>
    );
}
