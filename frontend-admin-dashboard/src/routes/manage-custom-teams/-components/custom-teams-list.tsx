import { MyButton } from '@/components/design-system/button';
import { Plus, User, Building2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { AddMemberForm } from './add-member-form';
import { SubOrgRemoveMemberDialog } from './sub-org-remove-member-dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getAllRoles,
    listSubOrgTeamMembers,
    removeSubOrgTeamMember,
    getSubOrgTeamPendingInstallments,
    type SubOrgTeamPendingInstallments,
} from '../-services/custom-team-services';
import { fetchInstituteDashboardUsers } from '@/routes/dashboard/-services/dashboard-services';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { subOrgPermission } from '@/lib/display-settings/sub-org-module';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getInstituteId } from '@/constants/helper';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserAccessModal } from './user-access-modal';
import { MemberHistoryDrawer } from '@/routes/manage-custom-teams/sub-orgs/-components/member-history-drawer';
import { isCallerSubOrgAdmin } from '@/lib/auth/facultyAccessUtils';
import { mapRoleToCustomName } from '@/utils/roleUtils';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import { MyPagination } from '@/components/design-system/pagination';
import { cn } from '@/lib/utils';
import { FilterChip } from './filter-chip';

/**
 * Table density, matched to the Manage <SubOrgs> list so the two tables in this module
 * read as one component rather than two. Same reasoning there: a directory people read a
 * row at a time gets roomier cells than the dense-grid defaults, and the header earns a
 * tint plus small caps so it stops competing with the body text.
 */
const HEAD_CLASS =
    'h-10 whitespace-nowrap bg-neutral-50 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-500';
const CELL_CLASS = 'px-3 py-2.5 align-middle text-sm';

/** Default rows-per-page; the footer's selector can change it. */
const MEMBER_PAGE_SIZE = 10;

type SubOrgTab = 'active' | 'invited';

/** The few member fields the toolbar reads. The rows themselves stay loosely typed. */
interface MemberRoleRef {
    institute_id?: string;
    role_name?: string;
}
interface MemberRow {
    full_name?: string;
    name?: string;
    email?: string;
    mobile_number?: string;
    mobileNumber?: string;
    roles?: MemberRoleRef[];
}

export interface CustomTeamsListProps {
    /** 'institute' (default) — original institute-wide custom teams flow.
     *  'subOrg' — scope listing/add/remove to a specific sub-org (server-enforced). */
    mode?: 'institute' | 'subOrg';
    /** Required when mode='subOrg'. */
    subOrgId?: string;
}

export function CustomTeamsList({ mode = 'institute', subOrgId }: CustomTeamsListProps = {}) {
    const { t } = useTranslation('manageCustomTeamsCustomTeamsList');
    // Institutes rename this concept via Settings → Naming (Channel Partner,
    // Branch, Franchise, VLE …); user-facing labels must follow that.
    const subOrgTerm = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);
    // Only constrains role-granted users; admins and sub-org admins always pass.
    // Institute-mode listing is unrelated to channel-partner permissions.
    const canManageTeam = mode !== 'subOrg' || subOrgPermission('canManageTeam');
    const queryClient = useQueryClient();
    const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
    const [accessModalUserId, setAccessModalUserId] = useState<string | null>(null);
    const [accessModalUserName, setAccessModalUserName] = useState<string>('');
    // In subOrg mode a row click opens the payment-history drawer (CPO installments +
    // invoices) instead of the per-permissions UserAccessModal.
    const [historyDrawer, setHistoryDrawer] = useState<{
        userId: string;
        name?: string;
    } | null>(null);
    const [selectedTab, setSelectedTab] = useState<SubOrgTab>('active');

    const { data: rolesResponse, isLoading: isLoadingRoles } = useQuery({
        queryKey: ['custom-roles'],
        queryFn: getAllRoles,
    });

    const activeRoles = rolesResponse || [];
    const instituteId = getInstituteId();

    const { data, isLoading: isLoadingUsers } = useQuery({
        queryKey: ['custom-teams', mode, subOrgId, activeRoles],
        queryFn: async () => {
            if (!activeRoles.length) return { content: [] };

            if (mode === 'subOrg') {
                if (!subOrgId) return { content: [] };
                // Sub-org members should only have custom (non-system) roles.
                // Strip system role names defensively even if the backend lists them.
                const SYSTEM_ROLES = new Set([
                    'ADMIN', 'TEACHER', 'STUDENT', 'EVALUATOR',
                    'CONTENT CREATOR', 'ASSESSMENT CREATOR',
                ]);
                const customRoleNames = activeRoles
                    .map((r: any) => r.name)
                    .filter((n: string) => !SYSTEM_ROLES.has((n || '').toUpperCase()));
                const resp = await listSubOrgTeamMembers({
                    sub_org_id: subOrgId,
                    institute_id: instituteId!,
                    roles: customRoleNames,
                    // INVITED covers freshly added members who haven't accepted yet.
                    status: ['ACTIVE', 'DISABLED', 'INVITED'],
                    page_number: 0,
                    page_size: 50,
                });
                // Normalize to the same shape the institute flow expects
                return { content: resp.content || [] };
            }

            const mappedRoles = activeRoles.map((role: any) => ({
                id: role.id,
                name: role.name,
            }));

            return fetchInstituteDashboardUsers(
                instituteId,
                {
                    roles: mappedRoles,
                    status: [
                        { id: '1', name: 'ACTIVE' },
                        { id: '2', name: 'DISABLED' }
                    ]
                },
                0, // pageNumber
                50 // pageSize
            );
        },
        enabled: activeRoles.length > 0 && (mode !== 'subOrg' || !!subOrgId),
    });

    const allMembers = data?.content || [];

    // Pending-installments lookup, only in subOrg mode. Only members with non-PAID
    // StudentFeePayment rows are returned by the backend; absent members render '—'.
    const { data: pendingDues } = useQuery<SubOrgTeamPendingInstallments>({
        queryKey: ['sub-org-team-pending-installments', subOrgId],
        queryFn: () => getSubOrgTeamPendingInstallments(subOrgId!, instituteId!),
        enabled: mode === 'subOrg' && !!subOrgId && !!instituteId,
        staleTime: 30000,
    });
    const duesByUserId = (pendingDues?.members || []).reduce<
        Record<string, SubOrgTeamPendingInstallments['members'][number]>
    >((acc, row) => {
        acc[row.user_id] = row;
        return acc;
    }, {});

    // Status derivation has to mirror the cell-level logic — auth-service doesn't set the
    // top-level `status` field, so fall back to the first institute-scoped role's status.
    const instituteIdForFilter = getInstituteId();
    const memberStatus = (m: any): string =>
        m.status
        || (m.roles || []).find((r: any) => r.institute_id === instituteIdForFilter)?.status
        || 'UNKNOWN';

    const activeMembers = allMembers.filter((m: any) => {
        const s = memberStatus(m);
        return s === 'ACTIVE' || s === 'DISABLED';
    });
    const invitedMembers = allMembers.filter((m: any) => memberStatus(m) === 'INVITED');

    // In subOrg mode the table content depends on the tab; institute mode keeps original behaviour.
    const members = mode === 'subOrg'
        ? (selectedTab === 'active' ? activeMembers : invitedMembers)
        : allMembers;

    // ---- Toolbar state. The list had no search, no filter and no pagination: every
    // member of every sub-org rendered in one unbounded table, which is fine at five
    // rows and unusable at eighty.
    const [searchInput, setSearchInput] = useState('');
    const [roleFilter, setRoleFilter] = useState<string[]>([]);
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(MEMBER_PAGE_SIZE);

    /** Institute-scoped role names present on the loaded members → the filter's options. */
    const roleOptions = useMemo(() => {
        const names = new Set<string>();
        (members as MemberRow[]).forEach((m) => {
            (m.roles || [])
                .filter((r) => r.institute_id === instituteIdForFilter)
                .forEach((r) => {
                    const label = r.role_name ? mapRoleToCustomName(r.role_name) : '';
                    if (label) names.add(label);
                });
        });
        return [...names].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
    }, [members, instituteIdForFilter]);

    const q = searchInput.trim().toLowerCase();
    const filteredMembers = useMemo(
        () =>
            (members as MemberRow[]).filter((m) => {
                if (roleFilter.length) {
                    const names = (m.roles || [])
                        .filter((r) => r.institute_id === instituteIdForFilter)
                        .map((r) => (r.role_name ? mapRoleToCustomName(r.role_name) : ''));
                    if (!names.some((n) => roleFilter.includes(n))) return false;
                }
                if (!q) return true;
                return [m.full_name, m.name, m.email, m.mobile_number, m.mobileNumber]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase()
                    .includes(q);
            }),
        [members, q, roleFilter, instituteIdForFilter]
    );
    const hasActiveFilters = !!q || roleFilter.length > 0;

    // Any filter change — or a tab switch — jumps back to the first page.
    useEffect(() => {
        setPage(0);
    }, [q, roleFilter, selectedTab]);

    const totalPages = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
    const pagedMembers = filteredMembers.slice(page * pageSize, page * pageSize + pageSize);

    // Which member the remove dialog is targeting (null = closed).
    const [removeTarget, setRemoveTarget] = useState<{ userId: string; name: string } | null>(null);

    const removeMutation = useMutation({
        mutationFn: async (vars: {
            userId: string;
            removeMode: 'SOFT' | 'HARD';
            accessTillDate: string | null;
        }) => {
            if (mode !== 'subOrg' || !subOrgId) {
                throw new Error('Remove is only supported in sub-org mode');
            }
            return removeSubOrgTeamMember({
                sub_org_id: subOrgId,
                institute_id: instituteId!,
                user_id: vars.userId,
                mode: vars.removeMode,
                access_till_date: vars.accessTillDate,
            });
        },
        onSuccess: (_data, vars) => {
            toast.success(
                vars.removeMode === 'SOFT'
                    ? t('toast.removeScheduled')
                    : t('toast.removed', { org: subOrgTerm.toLowerCase() })
            );
            setRemoveTarget(null);
            queryClient.invalidateQueries({ queryKey: ['custom-teams'] });
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || err?.message || t('toast.removeFailed'));
        },
    });

    if (isLoadingRoles || isLoadingUsers) return <DashboardLoader />;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                {mode === 'subOrg' ? (
                    <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as SubOrgTab)}>
                        <TabsList className="inline-flex h-auto justify-start gap-4 rounded-none border-b !bg-transparent p-0">
                            <TabsTrigger
                                value="active"
                                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                    selectedTab === 'active'
                                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                        : 'border-none bg-transparent'
                                }`}
                            >
                                <span
                                    className={selectedTab === 'active' ? 'text-primary-500' : ''}
                                >
                                    {t('tabs.active')}
                                </span>
                                <Badge
                                    className="rounded-[10px] bg-primary-500 p-0 px-2 text-[9px] text-white"
                                    variant="outline"
                                >
                                    {activeMembers.length}
                                </Badge>
                            </TabsTrigger>
                            <TabsTrigger
                                value="invited"
                                className={`flex gap-1.5 rounded-none px-12 py-2 !shadow-none ${
                                    selectedTab === 'invited'
                                        ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                        : 'border-none bg-transparent'
                                }`}
                            >
                                <span
                                    className={selectedTab === 'invited' ? 'text-primary-500' : ''}
                                >
                                    {t('tabs.invited')}
                                </span>
                                <Badge
                                    className="rounded-[10px] bg-primary-500 p-0 px-2 text-[9px] text-white"
                                    variant="outline"
                                >
                                    {invitedMembers.length}
                                </Badge>
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                ) : (
                    <div />
                )}
            </div>

            {/* Same card + two-tier toolbar as the Manage <SubOrgs> list: search and the
                primary action on one line, filters on the next, the table below. */}
            <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
                <div className="space-y-2 p-3">
                    <div className="flex items-center gap-2">
                        <div className="relative w-full min-w-40 sm:w-auto sm:max-w-56 sm:flex-1">
                            <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                            <Input
                                aria-label={t('search.ariaLabel')}
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                placeholder={t('search.placeholder')}
                                className="h-10 px-8"
                            />
                            {searchInput && (
                                <button
                                    type="button"
                                    onClick={() => setSearchInput('')}
                                    aria-label={t('search.clearAriaLabel')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                                >
                                    <X className="size-3.5" weight="bold" />
                                </button>
                            )}
                        </div>
                        {canManageTeam && (
                            <div className="ml-auto flex shrink-0 items-center gap-2">
                                <MyButton onClick={() => setIsAddMemberOpen(true)}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    {t('addMember')}
                                </MyButton>
                            </div>
                        )}
                    </div>
                    {roleOptions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <MultiSelectFilter
                                label={t('filters.roleLabel')}
                                options={roleOptions}
                                selected={roleFilter}
                                onChange={setRoleFilter}
                                placeholder={t('filters.rolePlaceholder')}
                                widthClass="w-auto min-w-24"
                            />
                        </div>
                    )}
                </div>

                {hasActiveFilters && (
                    <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
                        <span className="text-xs text-muted-foreground">
                            {t('filters.summary', {
                                filtered: filteredMembers.length,
                                count: members.length,
                            })}
                        </span>
                        {!!q && (
                            <FilterChip
                                label={t('filters.chipSearchLabel')}
                                value={searchInput.trim()}
                                onRemove={() => setSearchInput('')}
                            />
                        )}
                        {roleFilter.map((value) => (
                            <FilterChip
                                key={`role-${value}`}
                                label={t('filters.chipRoleLabel')}
                                value={value}
                                onRemove={() =>
                                    setRoleFilter(roleFilter.filter((v) => v !== value))
                                }
                            />
                        ))}
                        <button
                            type="button"
                            onClick={() => {
                                setSearchInput('');
                                setRoleFilter([]);
                            }}
                            className="rounded-sm text-xs font-medium text-neutral-500 underline-offset-2 transition-colors hover:text-neutral-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                        >
                            {t('filters.clearAll')}
                        </button>
                    </div>
                )}

                {/* Seven columns in sub-org mode need more width than a laptop gives, so the
                    table scrolls inside its own box rather than being clipped at the edge. */}
                <div className="overflow-x-auto border-t">
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className={HEAD_CLASS}>{t('table.member')}</TableHead>
                                <TableHead className={HEAD_CLASS}>{t('table.email')}</TableHead>
                                <TableHead className={HEAD_CLASS}>{t('table.phone')}</TableHead>
                                <TableHead className={HEAD_CLASS}>{t('table.roles')}</TableHead>
                                <TableHead className={HEAD_CLASS}>{t('table.status')}</TableHead>
                                {mode === 'subOrg' && (
                                    <TableHead className={HEAD_CLASS}>{t('table.pendingDues')}</TableHead>
                                )}
                                {mode === 'subOrg' && canManageTeam && (
                                    <TableHead className={cn(HEAD_CLASS, 'text-right')}>
                                        {t('table.actions')}
                                    </TableHead>
                                )}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {pagedMembers.length === 0 ? (
                                <TableRow>
                                    <TableCell
                                        colSpan={mode === 'subOrg' ? 7 : 5}
                                        className="h-24 text-center"
                                    >
                                        <div className="flex flex-col items-center justify-center gap-2 text-gray-500">
                                            <User className="h-8 w-8 opacity-50" />
                                            <p>
                                                {hasActiveFilters
                                                    ? t('empty.noMatch')
                                                    : t('empty.none')}
                                            </p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                pagedMembers.map((member: any) => (
                                    <TableRow
                                        key={member.id || member.userId}
                                        className="cursor-pointer transition-colors hover:bg-primary-50"
                                        onClick={() => {
                                            const uid = member.id || member.userId;
                                            const uname = member.full_name || member.name;
                                            if (mode === 'subOrg') {
                                                setHistoryDrawer({ userId: uid, name: uname });
                                            } else {
                                                setAccessModalUserId(uid);
                                                setAccessModalUserName(uname);
                                            }
                                        }}
                                    >
                                        <TableCell className={cn(CELL_CLASS, 'font-medium')}>
                                            <div className="flex items-center gap-2">
                                                <Avatar className="h-8 w-8">
                                                    <AvatarImage
                                                        src={
                                                            member.profile_pic_file_id ||
                                                            member.profilePic
                                                        }
                                                    />
                                                    <AvatarFallback>
                                                        {(member.full_name || member.name)?.charAt(
                                                            0
                                                        ) || 'U'}
                                                    </AvatarFallback>
                                                </Avatar>
                                                {member.full_name || member.name}
                                            </div>
                                        </TableCell>
                                        <TableCell className={CELL_CLASS}>{member.email}</TableCell>
                                        <TableCell className={CELL_CLASS}>
                                            {member.mobile_number || member.mobileNumber}
                                        </TableCell>
                                        <TableCell className={CELL_CLASS}>
                                            <div className="flex flex-wrap gap-1">
                                                {(member.roles || [])
                                                    .filter(
                                                        (r: any) =>
                                                            r.institute_id === getInstituteId()
                                                    )
                                                    .map((role: any) => (
                                                        <span
                                                            key={role.id}
                                                            className="rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-700"
                                                        >
                                                            {mapRoleToCustomName(role.role_name)}
                                                        </span>
                                                    ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className={CELL_CLASS}>
                                            {(() => {
                                                // auth-service doesn't fill the top-level `status` on UserWithRolesDTO
                                                // (it lives on each per-institute UserRole). Fall back to the first
                                                // institute-scoped role's status so the column isn't blank.
                                                const instituteRoles = (member.roles || []).filter(
                                                    (r: any) => r.institute_id === getInstituteId()
                                                );
                                                const status =
                                                    member.status ||
                                                    instituteRoles[0]?.status ||
                                                    'UNKNOWN';
                                                const badgeClass =
                                                    status === 'ACTIVE'
                                                        ? 'bg-green-100 text-green-800'
                                                        : status === 'INVITED'
                                                          ? 'bg-amber-100 text-amber-800'
                                                          : status === 'DISABLED'
                                                            ? 'bg-red-100 text-red-800'
                                                            : 'bg-neutral-100 text-neutral-700';
                                                return (
                                                    <span
                                                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}
                                                    >
                                                        {status}
                                                    </span>
                                                );
                                            })()}
                                        </TableCell>
                                        {mode === 'subOrg' &&
                                            (() => {
                                                // Most team members have no UserPlan → no SFP rows → empty cell.
                                                // A row appears here only if the member happens to have a CPO plan.
                                                const memberId = member.id || member.userId;
                                                const dues = memberId
                                                    ? duesByUserId[memberId]
                                                    : undefined;
                                                if (
                                                    !dues ||
                                                    (dues.pending_installments_count ?? 0) === 0
                                                ) {
                                                    return (
                                                        <TableCell
                                                            className={cn(
                                                                CELL_CLASS,
                                                                'text-xs text-muted-foreground'
                                                            )}
                                                        >
                                                            —
                                                        </TableCell>
                                                    );
                                                }
                                                const amount = dues.outstanding_amount ?? 0;
                                                const fmt = `₹${Number(amount).toLocaleString(
                                                    'en-IN',
                                                    {
                                                        maximumFractionDigits: 2,
                                                    }
                                                )}`;
                                                return (
                                                    <TableCell className={CELL_CLASS}>
                                                        <div className="flex flex-col">
                                                            <span className="text-xs font-medium text-amber-700">
                                                                {fmt}
                                                            </span>
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {t('dues.pendingCount', {
                                                                    count:
                                                                        dues.pending_installments_count,
                                                                })}
                                                                {dues.next_due_date
                                                                    ? ` · next ${new Date(
                                                                          dues.next_due_date
                                                                      ).toLocaleDateString(
                                                                          'en-IN',
                                                                          {
                                                                              day: '2-digit',
                                                                              month: 'short',
                                                                          }
                                                                      )}`
                                                                    : ''}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                );
                                            })()}
                                        {mode === 'subOrg' && (
                                            <TableCell
                                                className={cn(CELL_CLASS, 'text-right')}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    disabled={removeMutation.isPending}
                                                    className="h-8 w-8 text-neutral-500 hover:bg-danger-50 hover:text-danger-600"
                                                    aria-label={t('actions.removeFrom', {
                                                        org: subOrgTerm.toLowerCase(),
                                                    })}
                                                    title={t('actions.removeFrom', {
                                                        org: subOrgTerm.toLowerCase(),
                                                    })}
                                                    onClick={() => {
                                                        const userId = member.id || member.userId;
                                                        if (!userId) return;
                                                        setRemoveTarget({
                                                            userId,
                                                            name:
                                                                member.full_name ||
                                                                member.fullName ||
                                                                'this user',
                                                        });
                                                    }}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {filteredMembers.length > 0 && (
                    // MyPagination renders "Showing 1 to 10 of 24 entries" plus the per-page
                    // selector itself, the same footer the Manage <SubOrgs> table uses.
                    <MyPagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        totalElements={filteredMembers.length}
                        pageSize={pageSize}
                        onPageSizeChange={(size) => {
                            setPageSize(size);
                            setPage(0);
                        }}
                    />
                )}
            </div>

            <AddMemberForm
                open={isAddMemberOpen}
                onOpenChange={setIsAddMemberOpen}
                mode={mode}
                subOrgId={subOrgId}
            />

            <UserAccessModal
                open={!!accessModalUserId}
                onOpenChange={(open) => !open && setAccessModalUserId(null)}
                userId={accessModalUserId}
                userName={accessModalUserName}
            />

            <MemberHistoryDrawer
                open={!!historyDrawer}
                onOpenChange={(o) => !o && setHistoryDrawer(null)}
                userId={historyDrawer?.userId || null}
                userName={historyDrawer?.name}
                subtitle="Team member"
                readOnly={isCallerSubOrgAdmin()}
            />

            <SubOrgRemoveMemberDialog
                open={!!removeTarget}
                onOpenChange={(o) => !o && setRemoveTarget(null)}
                memberName={removeTarget?.name || 'this user'}
                isPending={removeMutation.isPending}
                onConfirm={(removeMode, accessTillDate) => {
                    if (!removeTarget) return;
                    removeMutation.mutate({
                        userId: removeTarget.userId,
                        removeMode,
                        accessTillDate,
                    });
                }}
            />
        </div>
    );
}
