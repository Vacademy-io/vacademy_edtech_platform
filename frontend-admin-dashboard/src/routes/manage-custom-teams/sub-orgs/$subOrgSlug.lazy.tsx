import { createLazyFileRoute, useNavigate, useParams, Link } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowsClockwise, Buildings, PencilSimple } from '@phosphor-icons/react';
import {
    ScreenHeader,
    StatusPill,
    type PillTone,
} from '@/components/shared/crm-enhance/screen-header';
import { toast } from 'sonner';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import {
    getSubOrgs,
    resyncSubOrgInvites,
    type SubOrgListPage,
} from '../-services/custom-team-services';
import { humanizeStatus } from '../-utils/status-display';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { SubOrgAnalyticsPanel } from '@/routes/manage-suborg-teams/-components/sub-org-analytics-panel';
import { SubOrgStatCards } from '@/routes/manage-suborg-teams/-components/sub-org-stat-cards';
import {
    buildSubOrgSlug,
    resolveSubOrgBySlug,
} from '@/routes/manage-suborg-teams/-utils/sub-org-slug';
import { InviteLinkSection } from './-components/invite-link-section';
import { EditSubOrgModal } from './-components/edit-sub-org-modal';
import { SubOrgModuleGate } from '../-components/sub-org-module-gate';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { subOrgPermission } from '@/lib/display-settings/sub-org-module';

export const Route = createLazyFileRoute('/manage-custom-teams/sub-orgs/$subOrgSlug')({
    component: InstituteAdminSubOrgPage,
});

interface SubOrgItem {
    id: string;
    name: string;
}

function normaliseSubOrg(org: any, fallbackLabel: string): SubOrgItem | null {
    const id =
        org?.sub_org_id || org?.suborgId || org?.subOrgId || org?.suborg_id || org?.id;
    const name =
        org?.name || org?.institute_name || org?.instituteName || org?.subOrgName;
    if (!id) return null;
    return { id, name: name || fallbackLabel };
}

/**
 * Drilldown page for a single sub-org. Reached by clicking a sub-org row in
 * /manage-custom-teams. Reuses the same SubOrgAnalyticsPanel the sub-org-admin sees;
 * for an institute admin it renders writable (caller has no SUB_ORG-linked FSPSSM, so
 * the panel's drawer treats the ledger as editable — same gate as everywhere else).
 *
 * Two kinds of caller land here:
 *   - Institute admins, who can open any sub-org under the institute and edit it.
 *   - Assignment-scoped users (a teacher / custom role granted the Sub-Organizations
 *     module from Display Settings), who reach only the sub-orgs assigned to them —
 *     getSubOrgs below already comes back scoped, so an unassigned slug simply doesn't
 *     resolve, and the backend rejects the per-sub-org calls regardless. They get the
 *     read-only view: no Edit / Re-sync, and the panel's ledger is not editable.
 *
 * Compare to /manage-suborg-teams: that route is sub-org-admin-only and auto-resolves
 * the caller's single accessible sub-org.
 */
function InstituteAdminSubOrgPage() {
    const { t } = useTranslation('manageCustomTeamsSubOrgSlug');
    const { subOrgSlug } = useParams({
        from: '/manage-custom-teams/sub-orgs/$subOrgSlug',
    });
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId();
    const [editOpen, setEditOpen] = useState(false);
    // A user who reaches this page through the Display Settings grant (rather than
    // the ADMIN role) is here to VIEW an assigned channel partner. The analytics
    // panel already renders read-only for them (canEditLedger is false once the
    // caller has SUB_ORG-linked access), so drop the two mutating header actions
    // rather than showing buttons whose effects they can't complete.
    const canEditConfig = subOrgPermission('canEditConfig');
    // Institutes rename this concept via Settings → Naming (Channel Partner,
    // Branch, Franchise, VLE …). Every label below reads from those settings.
    const term = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const termPlural = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);

    // Institute admin sees the canonical institute-wide sub-org list (not the
    // FSPSSM-scoped "accessible" set used on /manage-suborg-teams).
    const { data: rawSubOrgs, isLoading } = useQuery({
        queryKey: ['sub-orgs-list', instituteId],
        queryFn: () => getSubOrgs(instituteId),
        enabled: !!instituteId,
    });

    const subOrgs: SubOrgItem[] = useMemo(() => {
        const list = Array.isArray(rawSubOrgs)
            ? rawSubOrgs
            : (rawSubOrgs as any)?.content || [];
        return list
            .map((o: unknown) => normaliseSubOrg(o, t('untitled', { term })))
            .filter(Boolean) as SubOrgItem[];
    }, [rawSubOrgs, term]);

    const selectedSubOrg = useMemo(
        () => resolveSubOrgBySlug(subOrgSlug, subOrgs),
        [subOrgSlug, subOrgs]
    );

    // NOTE: deliberately do NOT call setSelectedSubOrgId here. Institute admins
    // don't have FSPSSM access to the sub-org they're *viewing*, and writing the
    // id to localStorage would flip the sidebar branding to that sub-org across
    // the whole app — even after navigating away. The validated getter in
    // facultyAccessUtils will reject this id anyway (it's not in their subOrgs[]),
    // so the only effect of writing it would be visual breakage on /dashboard.

    // Stale slug → bounce back to the sub-orgs list instead of leaving a blank page.
    useEffect(() => {
        if (isLoading) return;
        if (subOrgs.length > 0 && !selectedSubOrg) {
            navigate({ to: '/manage-custom-teams', replace: true });
        }
    }, [isLoading, subOrgs.length, selectedSubOrg, navigate]);

    // Plan status for the header badge: read from the Sub-Orgs list cache when the
    // admin came from that list. Never fetched here — no extra request on this page.
    const cachedList = queryClient.getQueryData<SubOrgListPage>([
        'sub-orgs-with-details',
        instituteId,
    ]);
    const planStatus = selectedSubOrg
        ? cachedList?.content?.find((o) => o.suborg_id === selectedSubOrg.id)?.plan_status
        : null;

    const resyncMutation = useMutation({
        mutationFn: (subOrgId: string) => resyncSubOrgInvites(subOrgId),
        onSuccess: (data) => {
            // Re-sync does two things now: mirror missing invites, and re-apply the
            // institute's naming settings to existing invite names. Report whichever
            // actually happened so a rename-only run doesn't read as "nothing to do".
            const parts: string[] = [];
            if (data.created_count > 0) {
                parts.push(
                    t('resync.createdSummary', {
                        invites: t('resync.inviteCount', { count: data.created_count }),
                        courses: t('resync.courseCount', {
                            count: data.package_session_count,
                        }),
                    })
                );
            }
            if (data.renamed_count > 0) {
                parts.push(t('resync.renamedSummary', { count: data.renamed_count }));
            }
            toast.success(parts.length > 0 ? parts.join(' · ') : t('resync.alreadyInSync'));
            if (selectedSubOrg) {
                queryClient.invalidateQueries({
                    queryKey: ['sub-org-scoped-invites', selectedSubOrg.id],
                });
                queryClient.invalidateQueries({
                    queryKey: ['sub-org-subscription-status', selectedSubOrg.id],
                });
            }
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.message || t('resync.failed'));
        },
    });

    return (
        <LayoutContainer>
            <Helmet>
                <title>
                    {selectedSubOrg
                        ? t('helmet.titleWithName', {
                              name: selectedSubOrg.name,
                              termPlural,
                          })
                        : t('helmet.title', { termPlural })}
                </title>
            </Helmet>
            <div className="p-5">
                <SubOrgModuleGate>
                    {/* Same header shape as the Manage <SubOrgs> list this page drills down
                        from: back link, icon + name (+ plan status when the list is already in
                        the cache) and the mutating actions on the right; the headline figures
                        get their own row below. */}
                    <div className="mb-5 flex flex-col gap-4">
                        <ScreenHeader
                            back={
                                <Link
                                    to="/manage-custom-teams"
                                    className="inline-flex w-fit items-center gap-1 text-xs text-neutral-500 hover:text-primary-500"
                                >
                                    <ArrowLeft className="size-3" />
                                    {t('backToList', { termPlural: termPlural.toLowerCase() })}
                                </Link>
                            }
                            icon={Buildings}
                            title={selectedSubOrg?.name || term}
                            badge={
                                planStatus ? (
                                    <StatusPill tone={planTone(planStatus)}>
                                        {humanizeStatus(planStatus)}
                                    </StatusPill>
                                ) : null
                            }
                            subtitle={
                                canEditConfig
                                    ? t('subtitle.manage', { term: term.toLowerCase() })
                                    : t('subtitle.view', { term: term.toLowerCase() })
                            }
                            actions={
                                selectedSubOrg && canEditConfig ? (
                                    <>
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            scale="small"
                                            disable={resyncMutation.isPending}
                                            onClick={() => resyncMutation.mutate(selectedSubOrg.id)}
                                        >
                                            <ArrowsClockwise
                                                className={`size-4 ${resyncMutation.isPending ? 'animate-spin' : ''}`}
                                            />
                                            {resyncMutation.isPending
                                                ? t('resync.inProgress')
                                                : t('resync.action')}
                                        </MyButton>
                                        <MyButton
                                            type="button"
                                            buttonType="primary"
                                            scale="small"
                                            onClick={() => setEditOpen(true)}
                                        >
                                            <PencilSimple className="size-4" />
                                            {t('editTerm', { term: term.toLowerCase() })}
                                        </MyButton>
                                    </>
                                ) : null
                            }
                        />
                        {selectedSubOrg && <SubOrgStatCards subOrgId={selectedSubOrg.id} full />}
                    </div>

                {isLoading ? (
                    <DashboardLoader />
                ) : !selectedSubOrg ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
                        <p className="font-medium">
                            {t('notFound.message', { term: term.toLowerCase() })}
                        </p>
                        <p className="text-sm">{t('notFound.goingBack')}</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="rounded-lg border border-neutral-200 bg-white p-4">
                            <InviteLinkSection subOrgId={selectedSubOrg.id} />
                        </div>
                        {/* AddUserToSubOrgSection is now mounted INSIDE the panel's
                            Admin Payment tab (panel knows its own tab state). Previously
                            it sat at the deep-page level which made the form visible on
                            every tab — wrong context for Courses/Learners/Invoices/Team. */}
                        <SubOrgAnalyticsPanel
                            subOrgId={selectedSubOrg.id}
                            subOrgName={selectedSubOrg.name}
                            variant="page"
                        />
                    </div>
                )}
                </SubOrgModuleGate>
            </div>
            {selectedSubOrg && canEditConfig && (
                <EditSubOrgModal
                    open={editOpen}
                    onOpenChange={setEditOpen}
                    subOrgId={selectedSubOrg.id}
                    subOrgName={selectedSubOrg.name}
                />
            )}
        </LayoutContainer>
    );
}

/** Pill colour for a plan status — negatives first ("INACTIVE" contains "ACTIVE"). */
function planTone(status: string): PillTone {
    const v = status.toUpperCase();
    if (/FAIL|EXPIR|CANCEL|TERMINAT|DENIED|REJECT|INACTIVE|DISABLED|ERROR/.test(v)) return 'danger';
    if (/COMPLETED|ACTIVE|VERIFIED|SUCCESS|APPROVED|PAID|ENABLED/.test(v)) return 'success';
    if (/PENDING|PROCESS|REVIEW|WAIT|PARTIAL|AWAIT/.test(v)) return 'warning';
    return 'neutral';
}

/** Re-export so callers in this folder (SubOrgList) can build the same slug. */
export { buildSubOrgSlug };
