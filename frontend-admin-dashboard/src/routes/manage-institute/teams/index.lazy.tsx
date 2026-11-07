import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ArrowCounterClockwise,
    Buildings,
    CheckCircle,
    Clock,
    Copy,
    CursorClick,
    MagnifyingGlass,
    PaperPlaneTilt,
    Prohibit,
    UserPlus,
    UploadSimple,
    DownloadSimple,
    CircleNotch,
    Users,
    WarningCircle,
    X,
    type Icon,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useRefetchUsersStore } from '@/routes/dashboard/-global-states/refetch-store-users';
import {
    handleDeleteDisableDashboardUsers,
    handleResendUserInvitation,
} from '@/routes/dashboard/-services/dashboard-services';
import { getInstituteId } from '@/constants/helper';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MyPagination } from '@/components/design-system/pagination';
import { FilterChips } from '@/components/design-system/chips';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { cn } from '@/lib/utils';
import {
    getAllRoles,
    LEGACY_ROLE_NAMES,
    listUserSubOrgLinks,
    listAccessibleSubOrgs,
    type AccessibleSubOrg,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import {
    getAllRoleDisplaySettings,
    getDisplaySettingsFromCache,
} from '@/services/display-settings';
import { subOrgPermission } from '@/lib/display-settings/sub-org-module';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { ADMIN_DISPLAY_SETTINGS_KEY } from '@/types/display-settings';
import {
    getActiveRoleDisplaySettingsKey,
    getRolesForCurrentInstitute,
} from '@/lib/auth/instituteUtils';
import { getPreferredPhoneCountries } from '@/services/domain-routing';
import { OrgChartTab } from './-components/OrgChartTab';
import { InviteMemberDialog } from './-components/InviteMemberDialog';
import { MemberDetailsSheet, type MemberSection } from './-components/MemberDetailsSheet';
import { TeamConfirmDialog, type TeamConfirmKind } from './-components/TeamConfirmDialog';
import { InviteRowActions, MemberRowActions } from './-components/TeamRowActions';
import { TeamTable, type TeamColumn } from './-components/TeamTable';
import {
    MemberAvatar,
    MemberStatusPill,
    NotSignedInTag,
    RoleChip,
    TONE_TILE,
} from './-components/team-ui';
import {
    buildRoleOptions,
    formatPhoneForDisplay,
    hasNeverSignedIn,
    instituteRolesOf,
    memberStatusOf,
    type RoleTone,
    type TeamMember,
    type TeamRoleOption,
} from './-utils/team-helpers';
import {
    fetchAllTeamMembers,
    fetchTeamCounts,
    fetchTeamPage,
} from './-services/team-member-services';
import { buildTeamExportCsv, teamExportFileName, triggerCsvDownload } from './-utils/team-csv';
import { TeamImportDialog } from './-components/TeamImportDialog';

type TabKey = 'members' | 'invites' | 'orgChart';

const MEMBER_STATUSES = ['ACTIVE', 'DISABLED'] as const;

export const Route = createLazyFileRoute('/manage-institute/teams/')({
    component: RouteComponent,
});

function useDebounced<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const id = window.setTimeout(() => setDebounced(value), delay);
        return () => window.clearTimeout(id);
    }, [value, delay]);
    return debounced;
}

function RouteComponent() {
    const { t } = useTranslation('manageInstituteTeamsIndexLazy');
    const { setNavHeading } = useNavHeadingStore();
    const setHandleRefetchUsersData = useRefetchUsersStore(
        (state) => state.setHandleRefetchUsersData
    );
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const defaultCountry = useMemo(() => getPreferredPhoneCountries().defaultCountry, []);

    const [tab, setTab] = useState<TabKey>('members');
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(10);
    const [searchInput, setSearchInput] = useState('');
    const search = useDebounced(searchInput.trim(), 300);
    const [roleFilter, setRoleFilter] = useState<string[]>([]);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [subOrgFilter, setSubOrgFilter] = useState<string[]>([]);

    const [drawer, setDrawer] = useState<{ member: TeamMember; section?: MemberSection } | null>(
        null
    );
    const [inviteDialog, setInviteDialog] = useState<{
        mode: 'new' | 'edit';
        invite?: TeamMember;
    } | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [confirm, setConfirm] = useState<{ kind: TeamConfirmKind; member: TeamMember } | null>(
        null
    );

    useEffect(() => {
        setNavHeading(t('navHeading'));
    }, [setNavHeading, t]);

    // ---- Viewer settings (unchanged rules) -------------------------------------------
    // The viewer's own role settings, matching the sidebar: admin, teacher, or the
    // custom role (e.g. "Operations") they are signed in as.
    const viewerDisplaySettings = useMemo(() => {
        // Roles in THIS institute — ADMIN elsewhere doesn't make the viewer an admin here.
        const viewerRoles = getRolesForCurrentInstitute();
        const isAdmin = viewerRoles.includes('ADMIN');
        const roleKey = isAdmin ? ADMIN_DISPLAY_SETTINGS_KEY : getActiveRoleDisplaySettingsKey();
        return { isAdmin, settings: getDisplaySettingsFromCache(roleKey) };
    }, []);
    const viewerTeamManagement = viewerDisplaySettings.settings?.teamManagement;
    // Admins can always maintain team profiles; other roles need the profile-edit permission.
    const canEditTeamProfiles =
        viewerDisplaySettings.isAdmin ||
        viewerDisplaySettings.settings?.permissions?.canEditProfileDetails === true;
    // Memoized: a fresh `{}` per render would cascade into every role-derived value.
    const viewerVisibleRoles = useMemo(
        () => viewerTeamManagement?.visibleRoles ?? {},
        [viewerTeamManagement]
    );
    // Org Chart tab is opt-in per institute (Settings → Admin Display Settings).
    const orgChartTabVisible = viewerTeamManagement?.orgChartTabVisible === true;
    // Login details show by default; an admin can hide passwords per institute.
    const allowViewPassword = viewerTeamManagement?.allowViewPassword !== false;
    // Self-role is never hidden, so a viewer can't lock themselves out.
    const isRoleVisibleToViewer = useMemo(() => {
        const viewerRoles = getRolesForCurrentInstitute().map((r) => r.toUpperCase());
        return (roleName: string) => {
            const key = roleName.toUpperCase();
            if (viewerRoles.includes(key)) return true;
            return viewerVisibleRoles[key] !== false;
        };
    }, [viewerVisibleRoles]);

    // ---- Roles ------------------------------------------------------------------------
    const rolesQuery = useQuery({
        queryKey: ['TEAM_ROLES', instituteId],
        queryFn: getAllRoles,
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });
    // Platform roles + only THIS institute's custom roles (see buildRoleOptions).
    const roleOptions = useMemo<TeamRoleOption[]>(
        () =>
            buildRoleOptions(
                Array.isArray(rolesQuery.data) ? rolesQuery.data : [],
                instituteId,
                isRoleVisibleToViewer
            ),
        [rolesQuery.data, instituteId, isRoleVisibleToViewer]
    );
    const roleOptionByName = useMemo(
        () => new Map(roleOptions.map((option) => [option.name, option])),
        [roleOptions]
    );
    // Default role filter. getAllRoles() hides the legacy roles from every picker, but
    // real users still hold them until migrated — keep matching them here or those
    // users silently drop out. Empty until roles load, so no premature fetch.
    const allRoleNames = useMemo(() => {
        if (roleOptions.length === 0) return [];
        return [
            ...roleOptions.map((option) => option.name),
            ...LEGACY_ROLE_NAMES.filter(isRoleVisibleToViewer),
        ];
    }, [roleOptions, isRoleVisibleToViewer]);

    // ---- Sub-orgs ---------------------------------------------------------------------
    const { data: userSubOrgLinks } = useQuery({
        queryKey: ['SUB_ORG_USER_LINKS', instituteId],
        queryFn: () => listUserSubOrgLinks(instituteId!),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });
    const { data: accessibleSubOrgs } = useQuery({
        queryKey: ['ACCESSIBLE_SUB_ORGS', instituteId],
        queryFn: () => listAccessibleSubOrgs(instituteId!),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });
    // Sub-orgs granted by a ROLE (Settings → Display Settings → role → partners), so the
    // column doesn't read "-" for someone who has access through their role.
    const { data: roleDisplaySettings } = useQuery({
        queryKey: ['ROLE_DISPLAY_SETTINGS_ALL', instituteId],
        queryFn: () => getAllRoleDisplaySettings(),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });
    const linksMap = useMemo(() => {
        const m = new Map<string, AccessibleSubOrg[]>();
        (userSubOrgLinks ?? []).forEach((link) => m.set(link.user_id, link.sub_orgs));
        return m;
    }, [userSubOrgLinks]);
    const roleGrantMap = useMemo(() => {
        const m = new Map<string, string[]>();
        Object.entries(roleDisplaySettings ?? {}).forEach(([roleId, cfg]) => {
            const ids = cfg?.subOrganizations?.assignedSubOrgIds;
            if (Array.isArray(ids) && ids.length > 0) m.set(roleId, ids);
        });
        return m;
    }, [roleDisplaySettings]);
    const subOrgNameById = useMemo(() => {
        const m = new Map<string, string>();
        (accessibleSubOrgs ?? []).forEach((so) => m.set(so.id, so.name));
        return m;
    }, [accessibleSubOrgs]);
    const subOrgTermPlural = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const hasSubOrgs = (accessibleSubOrgs ?? []).length > 0;
    const canAssignSubOrgs = hasSubOrgs && subOrgPermission('canManageTeam');

    // ---- List + counts ----------------------------------------------------------------
    const listQueryInput = useMemo(() => {
        const roles = roleFilter.length > 0 ? roleFilter : allRoleNames;
        const statuses =
            tab === 'invites'
                ? ['INVITED']
                : statusFilter.length > 0
                  ? statusFilter
                  : [...MEMBER_STATUSES];
        // Sub-org filter: resolve matching users from the institute-wide links (covers
        // every page, so server pagination stays right). Individual links only — access
        // through a role grant needs backend support to OR into this filter.
        let userIds: string[] | undefined;
        if (tab === 'members' && subOrgFilter.length > 0) {
            const selected = new Set(subOrgFilter);
            userIds = (userSubOrgLinks ?? [])
                .filter((link) => link.sub_orgs.some((so) => selected.has(so.id)))
                .map((link) => link.user_id);
        }
        return { roles, statuses, name: search, userIds };
    }, [roleFilter, allRoleNames, tab, statusFilter, subOrgFilter, userSubOrgLinks, search]);

    const listQuery = useQuery({
        queryKey: ['TEAM_MEMBERS', instituteId, tab, listQueryInput, page, pageSize],
        queryFn: () => fetchTeamPage(instituteId, listQueryInput, page, pageSize),
        enabled: !!instituteId && tab !== 'orgChart' && allRoleNames.length > 0,
        placeholderData: keepPreviousData,
    });
    const countsQuery = useQuery({
        queryKey: ['TEAM_COUNTS', instituteId, allRoleNames],
        queryFn: () => fetchTeamCounts(instituteId, allRoleNames),
        enabled: !!instituteId && allRoleNames.length > 0,
        staleTime: 60 * 1000,
    });
    const counts = countsQuery.data;

    // Removing the last row of the last page (delete / cancel invite) leaves an empty
    // page past the end — step back instead of showing a false "no one here".
    useEffect(() => {
        const current = listQuery.data;
        if (!current || listQuery.isPlaceholderData) return;
        if (page > 0 && current.content.length === 0 && current.total_elements > 0) {
            setPage(Math.max(0, current.total_pages - 1));
        }
    }, [listQuery.data, listQuery.isPlaceholderData, page]);

    const refreshTeam = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['TEAM_MEMBERS'] });
        queryClient.invalidateQueries({ queryKey: ['TEAM_COUNTS'] });
    }, [queryClient]);

    // Other surfaces (profile edits elsewhere) trigger a Teams refetch through this store.
    useEffect(() => {
        setHandleRefetchUsersData(refreshTeam);
    }, [setHandleRefetchUsersData, refreshTeam]);

    // ---- Actions ----------------------------------------------------------------------
    const copyLogin = async (member: TeamMember) => {
        try {
            await navigator.clipboard.writeText(
                t('login.copyTemplate', {
                    username: member.username,
                    password: member.password ?? '',
                })
            );
            toast.success(t('login.copied'));
        } catch {
            toast.error(t('login.copyFailed'));
        }
    };

    const confirmMutation = useMutation({
        mutationFn: async ({ kind, member }: { kind: TeamConfirmKind; member: TeamMember }) => {
            if (kind === 'resend') return handleResendUserInvitation(member.id, instituteId);
            const status =
                kind === 'disable'
                    ? 'DISABLED'
                    : kind === 'enable'
                      ? 'ACTIVE'
                      : kind === 'delete'
                        ? 'DELETE'
                        : 'CANCEL';
            return handleDeleteDisableDashboardUsers(instituteId, status, member.id);
        },
        onSuccess: (data, { kind, member }) => {
            const name = member.full_name;
            // The server mails the password only to an unused account it created here;
            // everyone else gets a sign-in reminder, and the toast says which went out.
            const reminderOnly = kind === 'resend' && data === 'Sign-in reminder sent';
            const messages: Partial<Record<TeamConfirmKind, string>> = {
                disable: t('confirm.disable.toast', { name }),
                enable: t('confirm.enable.toast', { name }),
                delete: t('confirm.delete.toast', { name }),
                resend: t(reminderOnly ? 'confirm.resend.reminderToast' : 'confirm.resend.toast', {
                    email: member.email,
                }),
                cancel: t('confirm.cancel.toast', { name }),
            };
            toast.success(messages[kind]);
            setConfirm(null);
            if (kind === 'delete') setDrawer((d) => (d?.member.id === member.id ? null : d));
            if (kind === 'disable' || kind === 'enable') {
                const status = kind === 'disable' ? 'DISABLED' : 'ACTIVE';
                setDrawer((d) =>
                    d?.member.id === member.id ? { ...d, member: { ...d.member, status } } : d
                );
            }
            refreshTeam();
        },
        onError: (error) => {
            const message = (error as { response?: { data?: { ex?: string } } })?.response?.data
                ?.ex;
            toast.error(message || t('confirm.failed'));
        },
    });

    const changeTab = (next: string) => {
        if (next === 'orgChart' && !orgChartTabVisible) return;
        setTab(next as TabKey);
        setPage(0);
        // Status and sub-org filters are Members-only; clearing keeps chips and data in step.
        setStatusFilter([]);
        setSubOrgFilter([]);
    };

    const openStat = (key: 'all' | 'ACTIVE' | 'DISABLED' | 'invites') => {
        setPage(0);
        if (key === 'invites') {
            changeTab('invites');
            return;
        }
        setTab('members');
        setSubOrgFilter([]);
        setStatusFilter(key === 'all' ? [] : [key]);
    };

    const toggleIn = (list: string[], value: string) =>
        list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

    const filtersActive =
        roleFilter.length > 0 || statusFilter.length > 0 || subOrgFilter.length > 0 || !!search;
    const clearAll = () => {
        setRoleFilter([]);
        setStatusFilter([]);
        setSubOrgFilter([]);
        setSearchInput('');
        setPage(0);
    };

    // ---- Columns ----------------------------------------------------------------------
    const memberCell = (member: TeamMember, invite: boolean) => (
        <div className="flex min-w-0 items-center gap-3">
            <MemberAvatar
                name={member.full_name}
                dashed={invite}
                muted={member.status === 'DISABLED'}
            />
            <div className="min-w-0 max-w-64">
                <div
                    className={`text-body ${cn(
                        'truncate font-semibold',
                        member.status === 'DISABLED' ? 'text-neutral-500' : 'text-neutral-900'
                    )}`}
                >
                    {member.full_name || '—'}
                </div>
                <div className="truncate text-caption text-neutral-500" title={member.email}>
                    {member.email || '—'}
                </div>
            </div>
        </div>
    );

    const loginCell = (member: TeamMember) => (
        <div className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-caption text-neutral-700">
                {member.username || '—'}
            </span>
            {allowViewPassword && (
                <span className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-caption text-neutral-500">
                        {member.password || '—'}
                    </span>
                    {member.password && (
                        <button
                            type="button"
                            className="shrink-0 text-neutral-400 hover:text-primary-500"
                            aria-label={t('login.copyDetails')}
                            title={t('login.copyDetails')}
                            onClick={(event) => {
                                event.stopPropagation();
                                void copyLogin(member);
                            }}
                        >
                            <Copy size={14} />
                        </button>
                    )}
                </span>
            )}
        </div>
    );

    const phoneCell = (member: TeamMember) => {
        const phone = formatPhoneForDisplay(member.mobile_number, defaultCountry);
        return phone ? (
            <span className="whitespace-nowrap text-body tabular-nums text-neutral-700">
                {phone}
            </span>
        ) : (
            <span className="text-neutral-400">—</span>
        );
    };

    const rolesCell = (member: TeamMember) => (
        <div className="flex flex-wrap gap-1.5">
            {instituteRolesOf(member, instituteId).map((role) => (
                <RoleChip
                    key={role.id}
                    name={role.role_name}
                    option={roleOptionByName.get(role.role_name)}
                />
            ))}
        </div>
    );

    // Sub-org names a member reaches: individual links first, then role grants.
    const subOrgNamesOf = (member: TeamMember): string[] => {
        const direct = (linksMap.get(member.id) ?? []).map((so) => so.name);
        const directIds = new Set((linksMap.get(member.id) ?? []).map((so) => so.id));
        const viaRole = new Set<string>();
        instituteRolesOf(member, instituteId).forEach((role) =>
            (roleGrantMap.get(role.role_id ?? '') ?? []).forEach((id) => {
                if (!directIds.has(id)) viaRole.add(subOrgNameById.get(id) ?? id);
            })
        );
        return [...direct, ...[...viaRole].map((name) => `${name} (via role)`)];
    };

    /** Everything matching the current tab, search and filters — not just the visible page. */
    const exportCurrentList = async () => {
        const exportTab = tab === 'invites' ? 'invites' : 'members';
        const query =
            tab === 'orgChart'
                ? { roles: allRoleNames, statuses: [...MEMBER_STATUSES], name: '' }
                : listQueryInput;
        setExporting(true);
        try {
            const { members, truncated } = await fetchAllTeamMembers(instituteId, query);
            if (members.length === 0) {
                toast.info(t('export.empty'));
                return;
            }
            const csv = buildTeamExportCsv(members, {
                instituteId,
                tab: exportTab,
                roleOptions,
                includePasswords: allowViewPassword,
                defaultCountry,
                subOrgsOf: hasSubOrgs ? subOrgNamesOf : undefined,
            });
            triggerCsvDownload(csv, teamExportFileName(exportTab));
            toast.success(
                truncated
                    ? t('export.truncated', { count: members.length })
                    : t('export.done', { count: members.length })
            );
        } catch {
            toast.error(t('export.failed'));
        } finally {
            setExporting(false);
        }
    };

    const subOrgCell = (member: TeamMember) => {
        // Individual links (FSPSSM) and role grants — the same union the backend applies.
        const direct = linksMap.get(member.id) ?? [];
        const seen = new Set(direct.map((s) => s.id));
        const viaRole: { id: string; name: string }[] = [];
        instituteRolesOf(member, instituteId).forEach((role) => {
            (roleGrantMap.get(role.role_id ?? '') ?? []).forEach((id) => {
                if (seen.has(id)) return;
                seen.add(id);
                viaRole.push({ id, name: subOrgNameById.get(id) ?? id });
            });
        });
        const chips = [
            ...direct.map((so) => ({ ...so, via: false })),
            ...viaRole.map((so) => ({ ...so, via: true })),
        ];
        if (chips.length === 0) return <span className="text-neutral-400">—</span>;
        return (
            <div className="flex flex-wrap gap-1.5">
                {chips.slice(0, 2).map((so) =>
                    so.via ? (
                        <span
                            key={so.id}
                            title={t('subOrgColumn.grantedByRoleTooltip')}
                            className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-neutral-300 bg-white px-2 text-caption text-neutral-600"
                        >
                            {so.name}
                            <span className="text-neutral-400">{t('subOrgColumn.viaRole')}</span>
                        </span>
                    ) : (
                        <span
                            key={so.id}
                            title={t('subOrgColumn.assignedTooltip')}
                            className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md bg-info-50 px-2 text-caption font-semibold text-info-700"
                        >
                            <Buildings size={13} />
                            {so.name}
                        </span>
                    )
                )}
                {chips.length > 2 && (
                    <span
                        className="inline-flex h-6 items-center rounded-md bg-neutral-100 px-2 text-caption font-semibold text-neutral-600"
                        title={chips
                            .slice(2)
                            .map((so) => so.name)
                            .join(', ')}
                    >
                        +{chips.length - 2}
                    </span>
                )}
            </div>
        );
    };

    const memberColumns: TeamColumn<TeamMember>[] = [
        { id: 'member', header: t('columns.member'), cell: (row) => memberCell(row, false) },
        { id: 'login', header: t('columns.login'), interactive: true, cell: loginCell },
        { id: 'phone', header: t('columns.phone'), cell: phoneCell },
        { id: 'roles', header: t('columns.roles'), cell: rolesCell },
        ...(hasSubOrgs ? [{ id: 'subOrgs', header: t('columns.subOrgs'), cell: subOrgCell }] : []),
        {
            id: 'status',
            header: t('columns.status'),
            className: 'w-36',
            cell: (row) => (
                <div className="flex flex-col items-start gap-1">
                    <MemberStatusPill status={row.status} />
                    {row.status !== 'DISABLED' && hasNeverSignedIn(row) && <NotSignedInTag />}
                </div>
            ),
        },
        {
            id: 'actions',
            header: '',
            className: 'w-24',
            interactive: true,
            cell: (row) => (
                <MemberRowActions
                    member={row}
                    canAssignSubOrgs={canAssignSubOrgs}
                    subOrgLabel={t('assignSubOrgs', { term: subOrgTermPlural.toLowerCase() })}
                    canCopyLogin={allowViewPassword}
                    onEdit={(member, section) => setDrawer({ member, section })}
                    onCopyLogin={copyLogin}
                    onStatus={(kind, member) => setConfirm({ kind, member })}
                />
            ),
        },
    ];

    const inviteColumns: TeamColumn<TeamMember>[] = [
        { id: 'member', header: t('columns.invitee'), cell: (row) => memberCell(row, true) },
        { id: 'roles', header: t('columns.invitedAs'), cell: rolesCell },
        { id: 'phone', header: t('columns.phone'), cell: phoneCell },
        { id: 'login', header: t('columns.login'), interactive: true, cell: loginCell },
        {
            id: 'status',
            header: t('columns.status'),
            className: 'w-36',
            cell: () => <MemberStatusPill status="INVITED" />,
        },
        {
            id: 'actions',
            header: '',
            className: 'w-40',
            interactive: true,
            cell: (row) => (
                <InviteRowActions
                    invite={row}
                    canCopyLogin={allowViewPassword}
                    onEdit={(invite) => setInviteDialog({ mode: 'edit', invite })}
                    onResend={(invite) => setConfirm({ kind: 'resend', member: invite })}
                    onCancel={(invite) => setConfirm({ kind: 'cancel', member: invite })}
                    onCopyLogin={copyLogin}
                />
            ),
        },
    ];

    const openRow = (row: TeamMember) => {
        if (tab === 'invites') setInviteDialog({ mode: 'edit', invite: row });
        else setDrawer({ member: row });
    };

    // ---- Filters ----------------------------------------------------------------------
    const roleFilterOptions = roleOptions.map((option) => ({
        id: option.name,
        label: option.custom ? t('filters.customRoleOption', { role: option.label }) : option.label,
    }));
    const statusFilterOptions = MEMBER_STATUSES.map((status) => ({
        id: status,
        label: status === 'ACTIVE' ? t('status.active') : t('status.disabled'),
    }));
    const subOrgFilterOptions = (accessibleSubOrgs ?? []).map((so) => ({
        id: so.id,
        label: so.name,
    }));
    const labelFor = (options: { id: string; label: string }[], ids: string[]) =>
        ids.map((id) => ({ id, label: options.find((o) => o.id === id)?.label ?? id }));

    // ---- Render -----------------------------------------------------------------------
    const data = listQuery.data;
    // Members carry no status from the API; derive it from their roles here (see memberStatusOf)
    // so the pill, the row menu and the drawer all agree.
    const rows = useMemo(
        () =>
            (data?.content ?? []).map((member) =>
                tab === 'members'
                    ? { ...member, status: memberStatusOf(member, instituteId) }
                    : member
            ),
        [data, tab, instituteId]
    );
    const memberTotal = counts ? counts.active + counts.disabled : undefined;
    const statCards: {
        key: 'all' | 'ACTIVE' | 'DISABLED' | 'invites';
        tone: RoleTone;
        icon: Icon;
        label: string;
        value: number | undefined;
        caption: string;
        active: boolean;
    }[] = [
        {
            key: 'all',
            tone: 'primary',
            icon: Users,
            label: t('stats.members'),
            value: memberTotal,
            caption: t('stats.membersCaption'),
            active: tab === 'members' && statusFilter.length === 0,
        },
        {
            key: 'ACTIVE',
            tone: 'success',
            icon: CheckCircle,
            label: t('stats.active'),
            value: counts?.active,
            caption: t('stats.activeCaption'),
            active: tab === 'members' && statusFilter.length === 1 && statusFilter[0] === 'ACTIVE',
        },
        {
            key: 'DISABLED',
            tone: 'neutral',
            icon: Prohibit,
            label: t('stats.disabled'),
            value: counts?.disabled,
            caption: t('stats.disabledCaption'),
            active:
                tab === 'members' && statusFilter.length === 1 && statusFilter[0] === 'DISABLED',
        },
        {
            key: 'invites',
            tone: 'warning',
            icon: Clock,
            label: t('stats.invites'),
            value: counts?.invited,
            caption: t('stats.invitesCaption'),
            active: tab === 'invites',
        },
    ];

    const tabTrigger = (key: TabKey, label: string, count?: number) => (
        <TabsTrigger
            value={key}
            className="-mb-px h-auto gap-2 rounded-none border-b-2 border-transparent px-3 pb-3 pt-3.5 text-body font-semibold text-neutral-500 hover:text-neutral-800 data-[state=active]:border-primary-500 data-[state=active]:bg-transparent data-[state=active]:text-primary-500 data-[state=active]:shadow-none"
        >
            {label}
            {count !== undefined && (
                <span
                    className={`text-caption ${cn(
                        'rounded-full px-2 font-semibold',
                        tab === key
                            ? 'bg-primary-100 text-primary-600'
                            : 'bg-neutral-100 text-neutral-600'
                    )}`}
                >
                    {count}
                </span>
            )}
        </TabsTrigger>
    );

    const emptyState = (() => {
        if (filtersActive) {
            return {
                icon: MagnifyingGlass,
                title: t('emptyState.filteredTitle'),
                body: t('emptyState.filteredBody'),
                action: (
                    <MyButton buttonType="secondary" onClick={clearAll}>
                        <X size={16} />
                        {t('filters.clearAllFilters')}
                    </MyButton>
                ),
            };
        }
        return {
            icon: tab === 'invites' ? PaperPlaneTilt : Users,
            title:
                tab === 'invites' ? t('emptyState.invitesTitle') : t('emptyState.noMembersTitle'),
            body: tab === 'invites' ? t('emptyState.invitesBody') : t('emptyState.noMembersBody'),
            action: (
                <MyButton buttonType="primary" onClick={() => setInviteDialog({ mode: 'new' })}>
                    <UserPlus size={16} />
                    {t('header.invite')}
                </MyButton>
            ),
        };
    })();
    const EmptyIcon = emptyState.icon;

    const listLoading =
        (listQuery.isLoading && !data) || (rolesQuery.isLoading && tab !== 'orgChart');
    const listError = listQuery.isError || rolesQuery.isError;

    return (
        <LayoutContainer>
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                    <h2 className="text-h2 font-semibold text-neutral-900">{t('header.title')}</h2>
                    <p className="mt-1 max-w-3xl text-body text-neutral-500">
                        {t('header.subtitle')}
                    </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        disable={allRoleNames.length === 0}
                        onClick={() => setImportOpen(true)}
                    >
                        <UploadSimple size={16} />
                        {t('header.import')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        disable={exporting || allRoleNames.length === 0}
                        onClick={() => void exportCurrentList()}
                    >
                        {exporting ? (
                            <CircleNotch size={16} className="animate-spin" />
                        ) : (
                            <DownloadSimple size={16} />
                        )}
                        {t('header.export')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={() => setInviteDialog({ mode: 'new' })}
                    >
                        <UserPlus size={16} />
                        {t('header.invite')}
                    </MyButton>
                </div>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                {statCards.map((card) => {
                    const CardIcon = card.icon;
                    return (
                        <button
                            key={card.key}
                            type="button"
                            onClick={() => openStat(card.key)}
                            className={cn(
                                'flex items-center gap-3.5 rounded-lg border bg-white p-4 text-left shadow-sm transition-all hover:border-neutral-300 hover:shadow-md',
                                card.active
                                    ? 'border-primary-300 ring-2 ring-primary-50'
                                    : 'border-neutral-200'
                            )}
                        >
                            <span
                                className={cn(
                                    'flex size-11 shrink-0 items-center justify-center rounded-lg',
                                    TONE_TILE[card.tone]
                                )}
                            >
                                <CardIcon size={22} />
                            </span>
                            <span className="min-w-0">
                                <span className="block text-caption font-semibold text-neutral-500">
                                    {card.label}
                                </span>
                                <span className="block text-h2 font-bold text-neutral-900">
                                    {card.value ?? '—'}
                                </span>
                                <span className="block truncate text-caption text-neutral-400">
                                    {card.caption}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
                <Tabs value={tab} onValueChange={changeTab}>
                    <TabsList className="flex h-auto w-full justify-start gap-1 rounded-none border-b border-neutral-200 bg-transparent px-4 py-0">
                        {tabTrigger('members', t('tabs.members'), memberTotal)}
                        {tabTrigger('invites', t('tabs.invites'), counts?.invited)}
                        {orgChartTabVisible && tabTrigger('orgChart', t('tabs.orgChart'))}
                    </TabsList>
                </Tabs>

                {tab === 'orgChart' && orgChartTabVisible && instituteId ? (
                    <div className="p-4">
                        <OrgChartTab instituteId={instituteId} />
                    </div>
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-2 p-4">
                            <div className="relative w-full sm:w-80">
                                <MagnifyingGlass
                                    size={16}
                                    className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                                />
                                <MyInput
                                    inputType="text"
                                    input={searchInput}
                                    onChangeFunction={(event) => {
                                        setSearchInput(event.target.value);
                                        setPage(0);
                                    }}
                                    inputPlaceholder={t('search.placeholder')}
                                    className="px-9 sm:w-80"
                                />
                                {searchInput && (
                                    <button
                                        type="button"
                                        aria-label={t('search.clear')}
                                        onClick={() => setSearchInput('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            <FilterChips
                                label={t('filters.roleType')}
                                filterList={roleFilterOptions}
                                selectedFilters={labelFor(roleFilterOptions, roleFilter)}
                                handleSelect={(option) => {
                                    setRoleFilter((prev) => toggleIn(prev, option.id));
                                    setPage(0);
                                }}
                                handleClearFilters={() => setRoleFilter([])}
                            />
                            {tab === 'members' && (
                                <FilterChips
                                    label={t('filters.status')}
                                    filterList={statusFilterOptions}
                                    selectedFilters={labelFor(statusFilterOptions, statusFilter)}
                                    handleSelect={(option) => {
                                        setStatusFilter((prev) => toggleIn(prev, option.id));
                                        setPage(0);
                                    }}
                                    handleClearFilters={() => setStatusFilter([])}
                                />
                            )}
                            {tab === 'members' && hasSubOrgs && userSubOrgLinks !== undefined && (
                                <FilterChips
                                    label={t('filters.subOrg')}
                                    filterList={subOrgFilterOptions}
                                    selectedFilters={labelFor(subOrgFilterOptions, subOrgFilter)}
                                    handleSelect={(option) => {
                                        setSubOrgFilter((prev) => toggleIn(prev, option.id));
                                        setPage(0);
                                    }}
                                    handleClearFilters={() => setSubOrgFilter([])}
                                />
                            )}
                            {filtersActive && (
                                <MyButton buttonType="text" scale="small" onClick={clearAll}>
                                    {t('filters.clearAll')}
                                </MyButton>
                            )}
                            <span className="ms-auto hidden items-center gap-1.5 text-caption text-neutral-400 lg:flex">
                                <CursorClick size={14} />
                                {tab === 'invites' ? t('hint.invites') : t('hint.members')}
                            </span>
                        </div>

                        {listError ? (
                            <div className="flex flex-col items-center gap-3 border-t border-neutral-200 px-6 py-14 text-center">
                                <WarningCircle size={32} className="text-danger-600" />
                                <p className="text-body text-neutral-600">{t('error.body')}</p>
                                <MyButton
                                    buttonType="secondary"
                                    onClick={() => {
                                        void rolesQuery.refetch();
                                        void listQuery.refetch();
                                    }}
                                >
                                    <ArrowCounterClockwise size={16} />
                                    {t('error.retry')}
                                </MyButton>
                            </div>
                        ) : !listLoading && data && data.content.length === 0 ? (
                            <div className="flex flex-col items-center border-t border-neutral-200 px-6 py-14 text-center">
                                <div className="mb-5 flex size-16 items-center justify-center rounded-full bg-primary-50 text-primary-500 ring-8 ring-primary-50">
                                    <EmptyIcon size={28} />
                                </div>
                                <h3 className="mb-1.5 text-subtitle font-semibold text-neutral-900">
                                    {emptyState.title}
                                </h3>
                                <p className="mb-5 max-w-md text-body text-neutral-500">
                                    {emptyState.body}
                                </p>
                                {emptyState.action}
                            </div>
                        ) : (
                            <>
                                <div className="border-t border-neutral-200">
                                    <TeamTable<TeamMember>
                                        rows={rows}
                                        columns={tab === 'invites' ? inviteColumns : memberColumns}
                                        loading={listLoading || !data}
                                        onRowClick={openRow}
                                        rowLabel={(row) =>
                                            t('table.openRow', { name: row.full_name || row.email })
                                        }
                                    />
                                </div>
                                {data && data.total_elements > 0 && (
                                    <div className="border-t border-neutral-200 px-4 py-3">
                                        <MyPagination
                                            currentPage={page}
                                            totalPages={data.total_pages}
                                            onPageChange={setPage}
                                            totalElements={data.total_elements}
                                            pageSize={pageSize}
                                            onPageSizeChange={(size) => {
                                                setPageSize(size);
                                                setPage(0);
                                            }}
                                            pageSizeOptions={[10, 25, 50]}
                                        />
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>

            {instituteId && importOpen && (
                <TeamImportDialog
                    open
                    onOpenChange={(open) => !open && setImportOpen(false)}
                    instituteId={instituteId}
                    roleOptions={roleOptions}
                    allRoleNames={allRoleNames}
                />
            )}

            {instituteId && inviteDialog && (
                <InviteMemberDialog
                    open
                    onOpenChange={(open) => !open && setInviteDialog(null)}
                    mode={inviteDialog.mode}
                    invite={inviteDialog.invite}
                    roleOptions={roleOptions}
                    instituteId={instituteId}
                    onViewTeam={() => changeTab('members')}
                />
            )}

            {instituteId && drawer && (
                <MemberDetailsSheet
                    // Prefer the refetched row: after Enable/Disable it carries the fresh roles
                    // and status that the snapshot taken on open does not.
                    member={rows.find((row) => row.id === drawer.member.id) ?? drawer.member}
                    initialSection={drawer.section}
                    onClose={() => setDrawer(null)}
                    instituteId={instituteId}
                    roleOptions={roleOptions}
                    canEditProfile={canEditTeamProfiles}
                    allowViewPassword={allowViewPassword}
                    subOrgs={accessibleSubOrgs ?? []}
                    canAssignSubOrgs={canAssignSubOrgs}
                    directSubOrgIds={(linksMap.get(drawer.member.id) ?? []).map((so) => so.id)}
                    roleGrantMap={roleGrantMap}
                    subOrgTerm={subOrgTermPlural}
                    onRequestStatus={(kind, member) => setConfirm({ kind, member })}
                    onCopyLogin={copyLogin}
                />
            )}

            <TeamConfirmDialog
                kind={confirm?.kind ?? null}
                name={confirm?.member.full_name ?? ''}
                email={confirm?.member.email}
                busy={confirmMutation.isPending}
                onClose={() => setConfirm(null)}
                onConfirm={() => confirm && confirmMutation.mutate(confirm)}
                onDisableInstead={
                    confirm?.kind === 'delete' && confirm.member.status !== 'DISABLED'
                        ? () => setConfirm({ kind: 'disable', member: confirm.member })
                        : undefined
                }
            />
        </LayoutContainer>
    );
}
