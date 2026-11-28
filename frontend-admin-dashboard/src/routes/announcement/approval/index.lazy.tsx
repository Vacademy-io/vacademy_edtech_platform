import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Eye, Stamp, X } from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { QuickViews } from '@/components/shared/crm-enhance';
import { cn } from '@/lib/utils';
import { isUserAdmin } from '@/utils/userDetails';
import { parseUtcDate } from '@/utils/dateUtils';
import { AnnouncementService } from '@/services/announcement';
import { EmptyChart } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { toHistoryPage, type Announcement } from '../history/-types';
import { joinParts, utcParts } from '../history/-utils/format';
import {
    AnnouncementStatusChip,
    EnumChips,
    NameAvatar,
    ScheduleSummary,
} from '../history/-components/primitives';
import { AnnouncementDetailsDialog } from '../history/-components/AnnouncementDetailsDialog';
import { DeliveryStatsDialog } from '../history/-components/DeliveryStatsDialog';

export const Route = createLazyFileRoute('/announcement/approval/')({
    component: () => (
        <LayoutContainer>
            <AnnouncementApprovalPage />
        </LayoutContainer>
    ),
});

type Tab = 'PENDING_APPROVAL' | 'REJECTED';
/**
 * The list API sorts newest first, so ask for enough rows to hold the whole queue —
 * pending approvals are a handful — and order them oldest first here.
 */
const PAGE_SIZE = 100;

const createdTime = (a: Announcement) =>
    a.createdAt ? parseUtcDate(a.createdAt).getTime() || 0 : 0;

/**
 * Announcement Approval: announcements created by counsellors and teachers wait here
 * until an admin approves them — nothing is sent before that. Oldest first, with the
 * selected one's details, content preview and Approve / Reject on the right.
 */
function AnnouncementApprovalPage() {
    const { setNavHeading } = useNavHeadingStore();
    const { t: tPage } = useTranslation('announcementApprovalIndex');
    const { t } = useTranslation('crmPages');
    const queryClient = useQueryClient();
    const admin = isUserAdmin();

    useEffect(() => {
        setNavHeading(tPage('pageHeading'));
    }, [setNavHeading, tPage]);

    const [tab, setTab] = useState<Tab>('PENDING_APPROVAL');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [details, setDetails] = useState<Announcement | null>(null);
    const [statsFor, setStatsFor] = useState<Announcement | null>(null);
    const [rejectFor, setRejectFor] = useState<Announcement | null>(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const list = useQuery({
        queryKey: ['announcement-approval', tab],
        queryFn: async () =>
            toHistoryPage(
                await AnnouncementService.listByInstitute({
                    page: 0,
                    size: PAGE_SIZE,
                    status: tab,
                }),
                (a: Announcement) => a
            ),
        refetchOnWindowFocus: false,
    });
    const counts = useQuery({
        queryKey: ['announcement-approval-counts'],
        queryFn: async () => {
            const [p, r, s] = await Promise.all(
                ['PENDING_APPROVAL', 'REJECTED', 'SCHEDULED'].map((status) =>
                    AnnouncementService.listByInstitute({ page: 0, size: 1, status })
                )
            );
            const n = (x: unknown) => (x as { totalElements?: number } | undefined)?.totalElements;
            return { pending: n(p), rejected: n(r), scheduled: n(s) };
        },
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const rows = useMemo(
        () =>
            [...(list.data?.content ?? [])].sort((a, b) =>
                tab === 'PENDING_APPROVAL'
                    ? createdTime(a) - createdTime(b)
                    : createdTime(b) - createdTime(a)
            ),
        [list.data, tab]
    );
    const selected = rows.find((a) => a.id === selectedId) ?? rows[0] ?? null;

    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: ['announcement-approval'] });
        void queryClient.invalidateQueries({ queryKey: ['announcement-approval-counts'] });
        void queryClient.invalidateQueries({ queryKey: ['announcement-count'] });
        void queryClient.invalidateQueries({ queryKey: ['announcements'] });
        setSelectedId(null);
    };
    const approve = async (a: Announcement) => {
        setBusy(true);
        try {
            await AnnouncementService.approve(a.id, 'ADMIN');
            toast.success(t('approval.approved', { title: a.title }));
            refresh();
        } catch {
            toast.error(t('approval.approveFailed'));
        } finally {
            setBusy(false);
        }
    };
    const reject = async () => {
        if (!rejectFor) return;
        setBusy(true);
        try {
            await AnnouncementService.reject(rejectFor.id, 'ADMIN', reason.trim());
            toast.success(t('approval.rejected', { title: rejectFor.title }));
            setRejectFor(null);
            setReason('');
            refresh();
        } catch {
            toast.error(t('approval.rejectFailed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h1 className="flex items-center gap-2 font-semibold text-neutral-900">
                    <Stamp size={22} className="text-primary-500" />
                    <span className="text-h2">{tPage('pageHeading')}</span>
                </h1>
                <p className="text-neutral-500">
                    <span className="text-body">{t('approval.subtitle')}</span>
                </p>
            </div>

            <QuickViews
                views={[
                    {
                        key: 'pending',
                        label: t('approval.views.pending'),
                        count: counts.data?.pending,
                        tone: 'warning',
                        active: tab === 'PENDING_APPROVAL',
                        onSelect: () => {
                            setTab('PENDING_APPROVAL');
                            setSelectedId(null);
                        },
                    },
                    {
                        key: 'rejected',
                        label: t('approval.views.rejected'),
                        count: counts.data?.rejected,
                        tone: 'danger',
                        active: tab === 'REJECTED',
                        onSelect: () => {
                            setTab('REJECTED');
                            setSelectedId(null);
                        },
                    },
                    {
                        key: 'scheduled',
                        label: t('approval.views.scheduled'),
                        count: counts.data?.scheduled,
                        tone: 'info',
                        href: '/announcement/schedule',
                    },
                ]}
            />

            {list.isLoading ? (
                <div className="grid gap-4 lg:grid-cols-12">
                    <Skeleton className="h-72 rounded-xl lg:col-span-4" />
                    <Skeleton className="h-72 rounded-xl lg:col-span-8" />
                </div>
            ) : list.isError ? (
                <EmptyChart text={t('approval.error')} className="h-40" />
            ) : rows.length === 0 ? (
                <EmptyChart
                    text={
                        tab === 'PENDING_APPROVAL'
                            ? t('approval.emptyPending')
                            : t('approval.emptyRejected')
                    }
                    className="h-40"
                />
            ) : (
                <div className="grid gap-4 lg:grid-cols-12">
                    <div className="flex flex-col gap-2 lg:col-span-4">
                        {rows.map((a) => (
                            <button
                                key={a.id}
                                type="button"
                                onClick={() => setSelectedId(a.id)}
                                className={cn(
                                    'flex flex-col gap-1.5 rounded-xl border bg-white p-3 text-left shadow-sm transition-colors',
                                    selected?.id === a.id
                                        ? 'border-primary-400 ring-2 ring-primary-100'
                                        : 'border-neutral-200 hover:border-primary-200'
                                )}
                            >
                                <span className="flex items-start justify-between gap-2">
                                    <span className="min-w-0 truncate font-semibold text-neutral-900">
                                        <span className="text-body">{a.title}</span>
                                    </span>
                                    <AnnouncementStatusChip status={a.status} />
                                </span>
                                <span className="flex items-center gap-2 text-neutral-500">
                                    <NameAvatar name={a.createdByName || a.createdByRole || '—'} />
                                    <span className="text-caption">
                                        {[a.createdByRole, joinParts(utcParts(a.createdAt))]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </span>
                                </span>
                                <EnumChips
                                    values={(a.modes ?? []).map((m) => String(m.modeType))}
                                    group="modes"
                                    variant="outline"
                                />
                            </button>
                        ))}
                        {tab === 'PENDING_APPROVAL' && (
                            <p className="px-1 text-neutral-500">
                                <span className="text-caption">{t('approval.oldestFirst')}</span>
                            </p>
                        )}
                    </div>
                    {selected && (
                        <SelectedPanel
                            a={selected}
                            admin={admin}
                            busy={busy}
                            onApprove={() => approve(selected)}
                            onReject={() => setRejectFor(selected)}
                            onDetails={() => setDetails(selected)}
                        />
                    )}
                </div>
            )}

            <AnnouncementDetailsDialog
                announcement={details}
                onClose={() => setDetails(null)}
                onOpenStats={(a) => {
                    setDetails(null);
                    setStatsFor(a);
                }}
            />
            <DeliveryStatsDialog announcement={statsFor} onClose={() => setStatsFor(null)} />

            <MyDialog
                open={!!rejectFor}
                onOpenChange={(o) => !o && setRejectFor(null)}
                heading={t('approval.rejectTitle')}
                dialogWidth="max-w-md"
                footer={
                    <div className="flex justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setRejectFor(null)}
                        >
                            {t('approval.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={busy}
                            onClick={reject}
                        >
                            {t('approval.reject')}
                        </MyButton>
                    </div>
                }
            >
                <div className="flex flex-col gap-2 p-4">
                    <p className="text-neutral-600">
                        <span className="text-caption">
                            {t('approval.rejectHint', { title: rejectFor?.title ?? '' })}
                        </span>
                    </p>
                    <Textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={t('approval.reasonPlaceholder')}
                        rows={3}
                    />
                </div>
            </MyDialog>
        </div>
    );
}

function SelectedPanel({
    a,
    admin,
    busy,
    onApprove,
    onReject,
    onDetails,
}: {
    a: Announcement;
    admin: boolean;
    busy: boolean;
    onApprove: () => void;
    onReject: () => void;
    onDetails: () => void;
}) {
    const { t } = useTranslation('crmPages');
    const raw = a.content?.content?.trim() ?? '';
    const html = useMemo(
        () => (a.content?.type === 'html' && raw ? DOMPurify.sanitize(raw) : ''),
        [a.content?.type, raw]
    );
    const pending = a.status === 'PENDING_APPROVAL';
    return (
        <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm lg:col-span-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="truncate font-semibold text-neutral-900">
                        <span className="text-h3">{a.title}</span>
                    </h2>
                    <span className="mt-1 flex items-center gap-2 text-neutral-500">
                        <NameAvatar name={a.createdByName || a.createdByRole || '—'} />
                        <span className="text-caption">
                            {t('approval.createdBy', {
                                name: a.createdByName || '—',
                                role: a.createdByRole || '—',
                                when: joinParts(utcParts(a.createdAt)),
                            })}
                        </span>
                    </span>
                </div>
                <AnnouncementStatusChip status={a.status} />
            </div>
            <dl className="grid gap-3 sm:grid-cols-3">
                <div>
                    <dt className="text-neutral-500">
                        <span className="text-caption">{t('approval.appearsIn')}</span>
                    </dt>
                    <dd className="mt-1">
                        <EnumChips
                            values={(a.modes ?? []).map((m) => String(m.modeType))}
                            group="modes"
                        />
                    </dd>
                </div>
                <div>
                    <dt className="text-neutral-500">
                        <span className="text-caption">{t('approval.deliveredVia')}</span>
                    </dt>
                    <dd className="mt-1">
                        {(a.mediums ?? []).length ? (
                            <EnumChips
                                values={(a.mediums ?? []).map((m) => String(m.mediumType))}
                                group="mediums"
                            />
                        ) : (
                            <span className="text-neutral-500">
                                <span className="text-caption">{t('approval.inAppOnly')}</span>
                            </span>
                        )}
                    </dd>
                </div>
                <div>
                    <dt className="text-neutral-500">
                        <span className="text-caption">{t('approval.schedule')}</span>
                    </dt>
                    <dd className="mt-1">
                        <ScheduleSummary scheduling={a.scheduling} />
                    </dd>
                </div>
            </dl>
            <section className="rounded-lg border border-neutral-200 p-4">
                <h3 className="mb-2 font-semibold text-neutral-700">
                    <span className="text-caption">{t('approval.preview')}</span>
                </h3>
                {html ? (
                    <div
                        className="prose prose-sm max-h-72 max-w-none overflow-auto text-neutral-700"
                        dangerouslySetInnerHTML={{ __html: html }}
                    />
                ) : raw ? (
                    <p className="max-h-72 overflow-auto whitespace-pre-wrap text-body text-neutral-700">
                        {raw}
                    </p>
                ) : (
                    <p className="text-neutral-400">
                        <span className="text-caption">{t('approval.noContent')}</span>
                    </p>
                )}
            </section>
            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4">
                <span className="flex-1 text-neutral-500">
                    <span className="text-caption">
                        {pending
                            ? admin
                                ? t('approval.footAdmin', {
                                      name: a.createdByName || a.createdByRole || '—',
                                  })
                                : t('approval.footViewer')
                            : t('approval.footRejected')}
                    </span>
                </span>
                <MyButton buttonType="secondary" scale="small" onClick={onDetails}>
                    <Eye size={14} />
                    {t('approval.details')}
                </MyButton>
                {pending && admin && (
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={busy}
                            onClick={onReject}
                        >
                            <X size={14} />
                            {t('approval.reject')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            disable={busy}
                            onClick={onApprove}
                        >
                            <Check size={14} />
                            {t('approval.approve')}
                        </MyButton>
                    </>
                )}
            </div>
        </div>
    );
}
