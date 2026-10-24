/**
 * SubOrgModuleCard — per-role access to the Sub-Organizations (Channel Partners)
 * module. Rendered identically in the Admin, Teacher and Custom Role panels.
 *
 * The toggle owns two things so an admin never has to flip two switches:
 *   1. `subOrganizations.moduleEnabled` — the gate read by the sidebar filter and
 *      the /manage-custom-teams route.
 *   2. The sidebar entry itself — "Manage Institute → Manage Institute Sub-Orgs"
 *      ships hidden by default, so enabling the module also un-hides that
 *      sub-item (and its parent tab) in this role's sidebar config.
 *
 * Below the toggle it also owns the ROLE-LEVEL assignment: the channel partners
 * every holder of this role can see. Assignment used to be per-person only (a
 * SUB_ORG-linked FSPSSM row created from a partner's Team tab), which meant wiring
 * up each member of a regional team by hand and redoing it for every new joiner.
 * The two mechanisms UNION server-side, so per-user assignments keep working and
 * simply add on top.
 *
 * What this card never does is widen visibility beyond what it lists. The backend
 * (SubOrgAccessScopeService) re-reads this same persisted blob and scopes every
 * sub-org response to it — search, filters, pagination and totals included.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getSubOrgsWithDetails } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import type { DisplaySettingsData, SubOrgModulePermissions } from '@/types/display-settings';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { X } from '@phosphor-icons/react';
import {
    SUB_ORG_MODULE_SUB_ITEM_ID,
    SUB_ORG_MODULE_TAB_ID,
} from '@/lib/display-settings/sub-org-module';

interface SubOrgModuleCardProps {
    settings: DisplaySettingsData;
    onChange: (next: DisplaySettingsData) => void;
    /** 'Admin' | 'Teacher' | the custom role's name — used in the copy. */
    roleLabel: string;
    /** Admins always see every channel partner; the assignment note is hidden for them. */
    isAdminRole?: boolean;
}

/** Flip the module's sidebar tab + sub-item visibility to match the toggle. */
const applySidebarVisibility = (
    sidebar: DisplaySettingsData['sidebar'],
    enabled: boolean
): DisplaySettingsData['sidebar'] =>
    sidebar.map((tab) => {
        if (tab.id !== SUB_ORG_MODULE_TAB_ID) return tab;
        return {
            ...tab,
            // Only force the parent open. Turning the module off must not hide
            // "Manage Institute" wholesale — an admin may still want its other
            // sub-items (teams, sessions, …).
            visible: enabled ? true : tab.visible,
            subTabs: (tab.subTabs || []).map((sub) =>
                sub.id === SUB_ORG_MODULE_SUB_ITEM_ID ? { ...sub, visible: enabled } : sub
            ),
        };
    });

export const SubOrgModuleCard = ({
    settings,
    onChange,
    roleLabel,
    isAdminRole = false,
}: SubOrgModuleCardProps) => {
    const { t } = useTranslation('settingsSubOrgModuleCard');
    // Institutes rename this concept (Channel Partner / Branch / Franchise / VLE …)
    // via Settings → Naming. Both forms are needed: the module is named in the
    // plural, but the per-record phrases below are singular.
    const term = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const one = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg).toLowerCase();
    const many = term.toLowerCase();
    const enabled = settings.subOrganizations?.moduleEnabled === true;
    // Memoized so the `?? []` fallback doesn't mint a new array identity on every
    // render and re-run the chip lookup below.
    const assignedIds = useMemo(
        () => settings.subOrganizations?.assignedSubOrgIds ?? [],
        [settings.subOrganizations?.assignedSubOrgIds]
    );

    // The admin configuring this is unrestricted, so this returns the institute's
    // full partner list to pick from. Only fetched once the module is on.
    const instituteId = getCurrentInstituteId();
    const { data, isLoading } = useQuery({
        queryKey: ['sub-orgs-with-details', instituteId],
        queryFn: () => getSubOrgsWithDetails(instituteId),
        enabled: !!instituteId && enabled && !isAdminRole,
    });

    const options = useMemo(
        () =>
            (data?.content ?? [])
                .filter((o) => !!o.suborg_id)
                .map((o) => ({
                    value: o.suborg_id as string,
                    label: o.name || (o.suborg_id as string),
                }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        [data?.content]
    );

    // Names for the currently-selected ids, so the admin can eyeball exactly which
    // partners this role grants instead of trusting a bare count. An id that no longer
    // resolves (partner deleted, or list still loading) is shown as-is rather than
    // dropped — silently hiding a granted partner would misrepresent real access.
    const selectedChips = useMemo(() => {
        const nameById = new Map(options.map((o) => [o.value, o.label]));
        return assignedIds.map((id) => ({
            id,
            label: nameById.get(id),
            unresolved: !nameById.has(id),
        }));
    }, [assignedIds, options]);

    // Always emit the whole section so neither field is dropped on save.
    const patch = (partial: Partial<NonNullable<DisplaySettingsData['subOrganizations']>>) =>
        onChange({
            ...settings,
            subOrganizations: {
                moduleEnabled: enabled,
                assignedSubOrgIds: assignedIds,
                ...partial,
            },
            sidebar: applySidebarVisibility(settings.sidebar, partial.moduleEnabled ?? enabled),
        });

    const toggle = (next: boolean) => patch({ moduleEnabled: next });

    // Reads default ON, writes default OFF — see SubOrgModulePermissions.
    const perms = settings.subOrganizations?.permissions ?? {};
    const permValue = (k: keyof SubOrgModulePermissions) =>
        perms[k] ?? (k === 'canViewFinance' || k === 'canExport');
    const setPerm = (k: keyof SubOrgModulePermissions, v: boolean) =>
        patch({ permissions: { ...perms, [k]: v } });

    // `uiOnly` marks capabilities the server does NOT re-check. The money actions run
    // through endpoints shared with manage-students (record-offline-payment is literally
    // the same one the learner side view calls), so adding a channel-partner permission
    // check there would reject unrelated, legitimate traffic. Those toggles hide the
    // affordance only — surfaced honestly rather than implying enforcement that isn't there.
    const PERMISSIONS: {
        key: keyof SubOrgModulePermissions;
        label: string;
        hint: string;
        uiOnly?: boolean;
    }[] = [
        {
            key: 'canCreate',
            label: t('permissions.items.canCreate.label', { many }),
            hint: t('permissions.items.canCreate.hint', { one }),
        },
        {
            key: 'canEditConfig',
            label: t('permissions.items.canEditConfig.label', { one }),
            hint: t('permissions.items.canEditConfig.hint'),
        },
        {
            key: 'canManageTeam',
            label: t('permissions.items.canManageTeam.label'),
            hint: t('permissions.items.canManageTeam.hint', { one }),
        },
        {
            key: 'canViewFinance',
            label: t('permissions.items.canViewFinance.label'),
            hint: t('permissions.items.canViewFinance.hint'),
            uiOnly: true,
        },
        {
            key: 'canManageFinance',
            label: t('permissions.items.canManageFinance.label'),
            hint: t('permissions.items.canManageFinance.hint'),
            uiOnly: true,
        },
        {
            key: 'canExport',
            label: t('permissions.items.canExport.label'),
            hint: t('permissions.items.canExport.hint', { one }),
            uiOnly: true,
        },
    ];

    return (
        <Card>
            <CardHeader>
                <CardTitle>{term}</CardTitle>
                <CardDescription>
                    {t('card.description', { roleLabel, term, many, one })}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-4 border-b border-border py-3.5">
                    <div>
                        <div className="text-sm font-medium text-neutral-800">
                            {t('toggle.title', { term })}
                        </div>
                        <p className="text-caption text-neutral-500">
                            {t('toggle.description', { term })}
                        </p>
                    </div>
                    <Switch checked={enabled} onCheckedChange={toggle} />
                </div>

                {enabled && !isAdminRole && (
                    <div className="space-y-3 pt-3">
                        <div>
                            <div className="text-sm font-medium text-neutral-800">
                                {t('assignment.title', { term })}
                            </div>
                            <p className="text-caption text-neutral-500">
                                {t('assignment.description')}
                            </p>
                        </div>

                        {isLoading ? (
                            <DashboardLoader />
                        ) : options.length === 0 ? (
                            <div className="rounded-md border border-dashed border-neutral-200 px-3 py-4 text-center text-caption text-neutral-500">
                                {t('assignment.emptyState', { many })}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <MultiSelectFilter
                                    label={t('assignment.selectLabel', { many })}
                                    options={options}
                                    selected={assignedIds}
                                    onChange={(values) => patch({ assignedSubOrgIds: values })}
                                    placeholder={t('assignment.searchPlaceholder', { many })}
                                    widthClass="w-64"
                                />
                                {selectedChips.length === 0 ? (
                                    <p className="text-caption text-neutral-500">
                                        {t('assignment.noneSelected', { many })}
                                    </p>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {selectedChips.map((chip) => (
                                            <span
                                                key={chip.id}
                                                className={
                                                    chip.unresolved
                                                        ? 'inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-caption text-warning-700'
                                                        : 'inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-caption text-primary-700'
                                                }
                                                title={
                                                    chip.unresolved
                                                        ? t('assignment.chipUnresolvedTitle', {
                                                              one,
                                                              id: chip.id,
                                                          })
                                                        : chip.label
                                                }
                                            >
                                                {chip.label ??
                                                    t('assignment.unknownOne', { one })}
                                                <button
                                                    type="button"
                                                    aria-label={t('assignment.removeAriaLabel', {
                                                        name: chip.label ?? chip.id,
                                                    })}
                                                    onClick={() =>
                                                        patch({
                                                            assignedSubOrgIds: assignedIds.filter(
                                                                (v) => v !== chip.id
                                                            ),
                                                        })
                                                    }
                                                    className="rounded-full hover:bg-black/10"
                                                >
                                                    <X className="size-3" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <p className="rounded-md bg-primary-50 px-3 py-2 text-caption text-neutral-600">
                            {t('assignment.scopeNote', { many, one })}
                        </p>

                        <div className="space-y-1 pt-2">
                            <div className="text-sm font-medium text-neutral-800">
                                {t('permissions.title')}
                            </div>
                            <p className="text-caption text-neutral-500">
                                {t('permissions.description')}
                            </p>
                            {PERMISSIONS.map((perm) => (
                                <div
                                    key={perm.key}
                                    className="flex items-center justify-between gap-4 border-b border-border py-3"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-neutral-800">
                                                {perm.label}
                                            </span>
                                            {perm.uiOnly && (
                                                <span
                                                    className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-caption text-neutral-500"
                                                    title={t(
                                                        'permissions.screenOnlyTooltip'
                                                    )}
                                                >
                                                    {t('permissions.screenOnlyBadge')}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-caption text-neutral-500">{perm.hint}</p>
                                    </div>
                                    <Switch
                                        checked={permValue(perm.key)}
                                        onCheckedChange={(v) => setPerm(perm.key, v)}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {enabled && isAdminRole && (
                    <p className="rounded-md bg-primary-50 px-3 py-2 text-caption text-neutral-600">
                        {t('adminNote', { one })}
                    </p>
                )}
            </CardContent>
        </Card>
    );
};

export default SubOrgModuleCard;
