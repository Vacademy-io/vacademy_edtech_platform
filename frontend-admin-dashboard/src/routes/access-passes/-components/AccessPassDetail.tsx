import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowsClockwise, Copy, PencilSimple, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MultiSelect } from '@/components/design-system/multi-select';
import {
    ACCESS_PASS_QUERY_KEYS,
    addAccessPassItems,
    formatPassPrice,
    getAccessPass,
    getAccessPassHolders,
    removeAccessPassItem,
    syncAccessPass,
    updateAccessPassStatus,
    type AccessPass,
    type AccessPassStatus,
} from '@/services/access-pass';
import { useBatchOptions } from '../-hooks/use-batch-options';
import { AccessPassEditorDialog } from './AccessPassEditorDialog';
import { AccessPassStatusBadge } from './AccessPassStatusBadge';
import { AccessPassSubOrgsPanel } from './AccessPassSubOrgsPanel';

const HOLDERS_PAGE_SIZE = 20;

const apiError = (e: unknown, fallback: string) =>
    (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex ?? fallback;

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '—');

export function AccessPassDetail({ passId, onDeleted }: { passId: string; onDeleted: () => void }) {
    const { t } = useTranslation('manageAccessPasses');
    const queryClient = useQueryClient();
    const { options: batchOptions, labelById } = useBatchOptions();
    const [editOpen, setEditOpen] = useState(false);
    const [toAdd, setToAdd] = useState<string[]>([]);
    const [holdersPage, setHoldersPage] = useState(0);

    const { data: pass, isLoading } = useQuery({
        queryKey: ACCESS_PASS_QUERY_KEYS.detail(passId),
        queryFn: () => getAccessPass(passId),
    });
    const { data: holders, isLoading: holdersLoading } = useQuery({
        queryKey: ACCESS_PASS_QUERY_KEYS.holders(passId, holdersPage),
        queryFn: () => getAccessPassHolders(passId, holdersPage, HOLDERS_PAGE_SIZE),
    });

    const refresh = (updated?: AccessPass) => {
        if (updated) queryClient.setQueryData(ACCESS_PASS_QUERY_KEYS.detail(passId), updated);
        queryClient.invalidateQueries({ queryKey: ACCESS_PASS_QUERY_KEYS.list });
        queryClient.invalidateQueries({ queryKey: ['access-pass-holders', passId] });
    };

    const statusMutation = useMutation({
        mutationFn: (status: AccessPassStatus) => updateAccessPassStatus(passId, status),
        onSuccess: (updated, status) => {
            if (status === 'DELETED') {
                queryClient.invalidateQueries({ queryKey: ACCESS_PASS_QUERY_KEYS.list });
                onDeleted();
                return;
            }
            refresh(updated);
            toast.success(t('detail.statusChanged', 'Status updated'));
        },
        onError: (e) => toast.error(apiError(e, t('detail.statusFailed', 'Could not change the status'))),
    });

    const addMutation = useMutation({
        mutationFn: (ids: string[]) => addAccessPassItems(passId, ids),
        onSuccess: (updated) => {
            setToAdd([]);
            refresh(updated);
            toast.success(
                t('detail.coursesAdded', 'Courses added. Current holders get them within a few minutes.')
            );
        },
        onError: (e) => toast.error(apiError(e, t('detail.addFailed', 'Could not add the courses'))),
    });

    const removeMutation = useMutation({
        mutationFn: (packageSessionId: string) => removeAccessPassItem(passId, packageSessionId),
        onSuccess: (updated) => {
            refresh(updated);
            toast.success(t('detail.courseRemoved', 'Course removed from the pass'));
        },
        onError: (e) => toast.error(apiError(e, t('detail.removeFailed', 'Could not remove the course'))),
    });

    const syncMutation = useMutation({
        mutationFn: () => syncAccessPass(passId),
        onSuccess: (r) => {
            refresh();
            queryClient.invalidateQueries({ queryKey: ACCESS_PASS_QUERY_KEYS.detail(passId) });
            if (r.skipped_locked) {
                toast.info(t('detail.syncRunning', 'A sync is already running for this pass'));
            } else {
                toast.success(
                    pass?.audience_type === 'B2B'
                        ? t('detail.syncDoneB2B', {
                              defaultValue:
                                  'Synced {{subOrgs}} sub-orgs: {{linked}} courses newly linked, {{failed}} failed',
                              subOrgs: r.sub_orgs_synced,
                              linked: r.sub_org_courses_linked,
                              failed: r.sub_orgs_failed,
                          })
                        : t('detail.syncDone', {
                              defaultValue:
                                  'Synced {{plans}} holders: {{granted}} courses granted, {{revoked}} revoked, {{failed}} failed',
                              plans: r.plans_processed,
                              granted: r.courses_granted,
                              revoked: r.courses_revoked,
                              failed: r.plans_failed,
                          })
                );
            }
        },
        onError: (e) => toast.error(apiError(e, t('detail.syncFailed', 'Sync failed'))),
    });

    const existingIds = useMemo(() => new Set((pass?.items ?? []).map((i) => i.package_session_id)), [pass]);
    const addableOptions = useMemo(
        () => batchOptions.filter((o) => !existingIds.has(o.value)),
        [batchOptions, existingIds]
    );

    if (isLoading || !pass) {
        return <div className="p-6 text-sm text-neutral-500">{t('common.loading', 'Loading…')}</div>;
    }

    const shareLink = pass.short_url;
    const copy = (text: string) => {
        navigator.clipboard.writeText(text).then(
            () => toast.success(t('detail.copied', 'Copied')),
            () => toast.error(t('detail.copyFailed', 'Could not copy'))
        );
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-start md:justify-between">
                <div className="flex gap-4">
                    {pass.cover_image_url && (
                        <img src={pass.cover_image_url} alt="" className="h-20 w-32 rounded-md object-cover" />
                    )}
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold">{pass.name}</h2>
                            <AccessPassStatusBadge status={pass.status} />
                            <Badge variant="outline">{pass.audience_type === 'B2B' ? 'B2B' : 'B2C'}</Badge>
                            {pass.course_scope === 'ALL_COURSES' && (
                                <Badge variant="secondary">{t('detail.allCourses', 'All courses')}</Badge>
                            )}
                        </div>
                        {pass.short_description && (
                            <p className="text-sm text-neutral-600">{pass.short_description}</p>
                        )}
                        <p className="text-sm">
                            {formatPassPrice(pass.price)} · {pass.course_count ?? 0}{' '}
                            {t('common.courses', 'courses')} ·{' '}
                            {pass.audience_type === 'B2B'
                                ? `${pass.sub_org_count ?? 0} ${t('common.subOrgs', 'sub-orgs')}`
                                : `${pass.current_holder_count ?? 0} ${t('common.currentHolders', 'current holders')}`}
                        </p>
                        {(pass.tags ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1">
                                {pass.tags!.map((tag) => (
                                    <Badge key={tag} variant="secondary">
                                        {tag}
                                    </Badge>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                        <PencilSimple className="mr-1 size-4" />
                        {t('detail.edit', 'Edit')}
                    </Button>
                    {pass.status !== 'ACTIVE' && (
                        <Button
                            size="sm"
                            disabled={statusMutation.isPending}
                            onClick={() => statusMutation.mutate('ACTIVE')}
                        >
                            {t('detail.publish', 'Publish')}
                        </Button>
                    )}
                    {pass.status === 'ACTIVE' && (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={statusMutation.isPending}
                            onClick={() => statusMutation.mutate('ARCHIVED')}
                        >
                            {t('detail.archive', 'Stop selling')}
                        </Button>
                    )}
                    {pass.status !== 'ACTIVE' && (
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={statusMutation.isPending}
                            onClick={() => {
                                if (
                                    window.confirm(
                                        t(
                                            'detail.deleteConfirm',
                                            'Delete this pass? Current holders keep their access until their plan ends.'
                                        )
                                    )
                                ) {
                                    statusMutation.mutate('DELETED');
                                }
                            }}
                        >
                            {t('detail.delete', 'Delete')}
                        </Button>
                    )}
                </div>
            </div>

            {pass.audience_type === 'B2B' && <AccessPassSubOrgsPanel passId={passId} />}

            {/* Sell link (B2C only: a B2B pass reaches learners through its sub-orgs). The
                invite only accepts enrolments while the pass is published, so a draft's link
                is shown as closed instead of being handed out to learners. */}
            {pass.audience_type !== 'B2B' &&
                (pass.status === 'ACTIVE' ? (
                    <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                        <div className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-emerald-500" />
                            <h3 className="font-medium text-emerald-900">
                                {t('detail.sellingTitle', 'Selling — share this link')}
                            </h3>
                        </div>
                        {shareLink && (
                            <div className="flex min-w-0 items-center gap-2">
                                <code className="min-w-0 flex-1 truncate rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm">
                                    {shareLink}
                                </code>
                                <Button size="sm" onClick={() => copy(shareLink)}>
                                    <Copy className="mr-1 size-4" />
                                    {t('detail.copy', 'Copy')}
                                </Button>
                            </div>
                        )}
                        <p className="text-xs text-emerald-800">
                            {t('detail.inviteCode', 'Invite code')}: <code>{pass.invite_code}</code> ·{' '}
                            {t('detail.slug', 'Catalogue key')}: <code>{pass.slug}</code> ·{' '}
                            {t(
                                'detail.catalogueHint',
                                'To show passes on your website, add the "Access Passes" section in Manage Pages.'
                            )}
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <h3 className="font-medium text-amber-900">
                                {pass.status === 'ARCHIVED'
                                    ? t('detail.closedArchived', 'Not selling — the link is closed')
                                    : t('detail.closedDraft', 'Draft — the link opens when you publish')}
                            </h3>
                            <p className="mt-0.5 text-xs text-amber-800">
                                {t(
                                    'detail.closedHint',
                                    'Until then, learners opening the link see "Enrollment is currently closed".'
                                )}
                            </p>
                        </div>
                        <Button
                            size="sm"
                            className="shrink-0"
                            disabled={statusMutation.isPending}
                            onClick={() => statusMutation.mutate('ACTIVE')}
                        >
                            {t('detail.publishNow', 'Publish now')}
                        </Button>
                    </div>
                ))}

            {/* Courses */}
            <div className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-medium">{t('detail.coursesTitle', 'Included courses')}</h3>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={syncMutation.isPending}
                        onClick={() => syncMutation.mutate()}
                    >
                        <ArrowsClockwise className="mr-1 size-4" />
                        {syncMutation.isPending ? t('detail.syncing', 'Syncing…') : t('detail.syncNow', 'Sync holders now')}
                    </Button>
                </div>
                {pass.needs_sync && (
                    <p className="text-xs text-amber-600">
                        {t('detail.syncPending', 'Course changes are still being applied to current holders.')}
                    </p>
                )}
                <ul className="divide-y rounded-md border">
                    {(pass.items ?? []).map((item) => (
                        <li key={item.package_session_id} className="flex items-center justify-between px-3 py-2">
                            <span className="text-sm">
                                {labelById.get(item.package_session_id) ??
                                    [item.package_name, item.level_name, item.session_name].filter(Boolean).join(' · ')}
                            </span>
                            {pass.course_scope !== 'ALL_COURSES' && (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={removeMutation.isPending}
                                onClick={() => {
                                    const msg =
                                        pass.on_item_removed === 'REVOKE'
                                            ? t(
                                                  'detail.removeConfirmRevoke',
                                                  'Remove this course? Current holders will LOSE access to it.'
                                              )
                                            : t(
                                                  'detail.removeConfirmKeep',
                                                  'Remove this course? New buyers will not get it; current holders keep it until their plan ends.'
                                              );
                                    if (window.confirm(msg)) removeMutation.mutate(item.package_session_id);
                                }}
                            >
                                <Trash className="size-4" />
                            </Button>
                            )}
                        </li>
                    ))}
                    {(pass.items ?? []).length === 0 && (
                        <li className="px-3 py-2 text-sm text-neutral-500">
                            {t('detail.noCourses', 'No courses yet')}
                        </li>
                    )}
                </ul>
                {pass.course_scope === 'ALL_COURSES' ? (
                    <p className="text-xs text-neutral-500">
                        {t(
                            'detail.allCoursesHint',
                            'This pass follows your catalogue: courses you publish are added automatically (on the next sync). To pick courses by hand, edit the pass and switch to selected courses.'
                        )}
                    </p>
                ) : (
                <>
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <div className="flex-1">
                        <MultiSelect
                            options={addableOptions}
                            selected={toAdd}
                            onChange={setToAdd}
                            placeholder={t('detail.addPlaceholder', 'Add course batches')}
                            checkboxes
                        />
                    </div>
                    <Button
                        size="sm"
                        disabled={toAdd.length === 0 || addMutation.isPending}
                        onClick={() => addMutation.mutate(toAdd)}
                    >
                        {t('detail.add', 'Add to pass')}
                    </Button>
                </div>
                <p className="text-xs text-neutral-500">
                    {t(
                        'detail.addHint',
                        'Added courses are delivered to everyone who currently holds the pass, expiring with their plan.'
                    )}
                </p>
                </>
                )}
            </div>

            {/* Holders (B2C only) */}
            {pass.audience_type !== 'B2B' && (
            <div className="flex flex-col gap-3 rounded-lg border p-4">
                <h3 className="font-medium">{t('detail.holdersTitle', 'Holders')}</h3>
                {holdersLoading ? (
                    <p className="text-sm text-neutral-500">{t('common.loading', 'Loading…')}</p>
                ) : (holders?.content ?? []).length === 0 ? (
                    <p className="text-sm text-neutral-500">{t('detail.noHolders', 'Nobody has bought this pass yet')}</p>
                ) : (
                    <>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('holders.name', 'Learner')}</TableHead>
                                    <TableHead>{t('holders.status', 'Plan')}</TableHead>
                                    <TableHead>{t('holders.start', 'Start')}</TableHead>
                                    <TableHead>{t('holders.end', 'Ends')}</TableHead>
                                    <TableHead>{t('holders.autopay', 'Autopay')}</TableHead>
                                    <TableHead>{t('holders.courses', 'Courses (pass / own)')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {holders!.content.map((h) => (
                                    <TableRow key={h.user_plan_id}>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span>{h.full_name ?? h.user_id}</span>
                                                <span className="text-xs text-neutral-500">
                                                    {h.email ?? h.mobile_number}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{h.plan_status}</Badge>
                                        </TableCell>
                                        <TableCell>{fmtDate(h.start_date)}</TableCell>
                                        <TableCell>{h.end_date ? fmtDate(h.end_date) : t('holders.noEnd', 'No end')}</TableCell>
                                        <TableCell>{h.auto_renewal_enabled ? '✓' : '—'}</TableCell>
                                        <TableCell>
                                            {h.granted_courses ?? 0} / {h.covered_courses ?? 0}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        <div className="flex items-center justify-end gap-2 text-sm">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={holdersPage === 0}
                                onClick={() => setHoldersPage((p) => Math.max(0, p - 1))}
                            >
                                {t('common.prev', 'Previous')}
                            </Button>
                            <span>
                                {holdersPage + 1} / {Math.max(1, holders?.totalPages ?? 1)}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={holdersPage + 1 >= (holders?.totalPages ?? 1)}
                                onClick={() => setHoldersPage((p) => p + 1)}
                            >
                                {t('common.next', 'Next')}
                            </Button>
                        </div>
                    </>
                )}
            </div>
            )}

            <AccessPassEditorDialog open={editOpen} onOpenChange={setEditOpen} pass={pass} onSaved={(p) => refresh(p)} />
        </div>
    );
}
