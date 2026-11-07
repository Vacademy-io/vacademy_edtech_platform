import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import {
    ChartBar,
    CheckCircle,
    EnvelopeSimple,
    Eye,
    PaperPlaneTilt,
    UsersThree,
    WarningCircle,
    XCircle,
    type Icon,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { MyButton } from '@/components/design-system/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AnnouncementService, type AnnouncementRecipientRow } from '@/services/announcement';
import type { Announcement, AnnouncementStats } from '../-types';
import { percent, utcParts } from '../-utils/format';
import { useUserNames } from '../-hooks/useRecipientNames';
import {
    AnnouncementStatusChip,
    DateTimeStack,
    EnumChips,
    MessageStatusChip,
    NameAvatar,
} from './primitives';

type Section = 'recipients' | 'overview' | 'email';

export function DeliveryStatsDialog({
    announcement,
    onClose,
}: {
    announcement: Announcement | null;
    onClose: () => void;
}) {
    const { t } = useTranslation('announcementHistoryIndex');
    const [section, setSection] = useState<Section>('recipients');

    const statsQ = useQuery({
        queryKey: ['announcementHistoryStats', announcement?.id],
        queryFn: async (): Promise<AnnouncementStats> =>
            AnnouncementService.stats(announcement!.id),
        enabled: !!announcement,
        refetchOnWindowFocus: false,
    });

    const nav: Array<{ id: Section; label: string; icon: Icon }> = [
        { id: 'recipients', label: t('statsDialog.nav.recipients'), icon: UsersThree },
        { id: 'overview', label: t('statsDialog.nav.overview'), icon: ChartBar },
        { id: 'email', label: t('statsDialog.nav.email'), icon: EnvelopeSimple },
    ];

    return (
        <MyDialog
            heading={t('statsDialog.title')}
            open={!!announcement}
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                    setSection('recipients');
                }
            }}
            dialogWidth="max-w-5xl"
        >
            {announcement && (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <h3 className="min-w-0 truncate text-title font-semibold text-neutral-900">
                            {announcement.title}
                        </h3>
                        <AnnouncementStatusChip status={announcement.status} />
                    </div>
                    <Tabs
                        value={section}
                        onValueChange={(v) => setSection(v as Section)}
                        orientation="vertical"
                        className="flex flex-col gap-4 md:flex-row md:gap-6"
                    >
                        <TabsList className="flex h-auto shrink-0 flex-row flex-wrap items-stretch justify-start gap-1 bg-transparent p-0 md:w-52 md:flex-col">
                            {nav.map(({ id, label, icon: NavIcon }) => (
                                <TabsTrigger
                                    key={id}
                                    value={id}
                                    className="justify-start gap-2 rounded-md px-3 py-2 text-body text-neutral-600 data-[state=active]:bg-primary-50 data-[state=active]:text-primary-600 data-[state=active]:shadow-none"
                                >
                                    <NavIcon className="size-4" />
                                    {label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        <div className="min-w-0 flex-1 md:border-l md:border-neutral-100 md:pl-6">
                            <TabsContent value="recipients" className="mt-0">
                                <RecipientsPanel
                                    key={announcement.id}
                                    announcementId={announcement.id}
                                    total={statsQ.data?.totalRecipients}
                                />
                            </TabsContent>
                            <TabsContent value="overview" className="mt-0">
                                <StatsState q={statsQ}>
                                    {(s) => <OverviewPanel stats={s} />}
                                </StatsState>
                            </TabsContent>
                            <TabsContent value="email" className="mt-0">
                                <StatsState q={statsQ}>
                                    {(s) => <EmailPanel stats={s} />}
                                </StatsState>
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>
            )}
        </MyDialog>
    );
}

function StatsState({
    q,
    children,
}: {
    q: { data?: AnnouncementStats; isLoading: boolean; isError: boolean; refetch: () => void };
    children: (s: AnnouncementStats) => React.ReactNode;
}) {
    const { t } = useTranslation('announcementHistoryIndex');
    if (q.isLoading) {
        return (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-24 w-full rounded-lg" />
                ))}
            </div>
        );
    }
    if (q.isError || !q.data) {
        return <ErrorState message={t('toasts.statsLoadFailed')} onRetry={() => q.refetch()} />;
    }
    return <>{children(q.data)}</>;
}

// ── Recipients ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

type RecipientTableRow = AnnouncementRecipientRow & { index: number; displayName: string };

function RecipientsPanel({ announcementId, total }: { announcementId: string; total?: number }) {
    const { t } = useTranslation('announcementHistoryIndex');
    const [page, setPage] = useState(0);

    const q = useQuery({
        queryKey: ['announcementHistoryRecipients', announcementId, page],
        queryFn: () => AnnouncementService.recipients(announcementId, { page, size: PAGE_SIZE }),
        refetchOnWindowFocus: false,
        placeholderData: (prev) => prev,
    });

    const rows = useMemo(() => q.data?.content ?? [], [q.data]);
    // The stored user_name is empty for system alerts, and sometimes holds the id itself.
    const missing = useMemo(
        () =>
            rows.filter((r) => !r.userName?.trim() || r.userName === r.userId).map((r) => r.userId),
        [rows]
    );
    const { names, isLoading: namesLoading } = useUserNames(missing);

    const tableData = useMemo(() => {
        const content: RecipientTableRow[] = rows.map((r, i) => ({
            ...r,
            index: page * PAGE_SIZE + i + 1,
            displayName:
                (r.userName?.trim() && r.userName !== r.userId ? r.userName.trim() : undefined) ??
                names.get(r.userId) ??
                t('recipients.unknownUser'),
        }));
        return {
            content,
            total_pages: q.data?.totalPages ?? 0,
            page_no: page,
            page_size: PAGE_SIZE,
            total_elements: q.data?.totalElements ?? 0,
            last: page + 1 >= (q.data?.totalPages ?? 0),
        };
    }, [rows, names, page, q.data, t]);

    const columns = useMemo<ColumnDef<RecipientTableRow>[]>(
        () => [
            {
                id: 'index',
                header: '#',
                size: 48,
                cell: ({ row }) => <span className="text-neutral-500">{row.original.index}</span>,
            },
            {
                id: 'name',
                header: t('statsDialog.recipientsSection.table.name'),
                size: 240,
                cell: ({ row }) => (
                    <div className="flex items-center gap-2">
                        <NameAvatar name={row.original.displayName} />
                        <span className="truncate text-neutral-800">
                            {row.original.displayName}
                        </span>
                    </div>
                ),
            },
            {
                id: 'mode',
                header: t('statsDialog.recipientsSection.table.mode'),
                size: 130,
                cell: ({ row }) => <EnumChips group="modes" values={[row.original.modeType]} />,
            },
            {
                id: 'status',
                header: t('statsDialog.recipientsSection.table.status'),
                size: 110,
                cell: ({ row }) => <MessageStatusChip status={row.original.status} />,
            },
            {
                id: 'deliveredAt',
                header: t('statsDialog.recipientsSection.table.deliveredAt'),
                size: 130,
                cell: ({ row }) => <DateTimeStack parts={utcParts(row.original.deliveredAt)} />,
            },
            {
                id: 'readAt',
                header: t('statsDialog.recipientsSection.table.seenAt'),
                size: 130,
                cell: ({ row }) => <DateTimeStack parts={utcParts(row.original.readAt)} />,
            },
            {
                id: 'dismissedAt',
                header: t('statsDialog.recipientsSection.table.dismissedAt'),
                size: 130,
                cell: ({ row }) => <DateTimeStack parts={utcParts(row.original.dismissedAt)} />,
            },
        ],
        [t]
    );

    const count = q.data?.totalElements ?? total;

    return (
        <div className="flex flex-col gap-3">
            <h4 className="text-subtitle font-semibold text-neutral-800">
                {typeof count === 'number'
                    ? t('statsDialog.recipientsSection.titleCount', { count })
                    : t('statsDialog.recipientsSection.title')}
            </h4>
            {q.isError ? (
                <ErrorState
                    message={t('statsDialog.recipientsSection.loadFailed')}
                    onRetry={() => q.refetch()}
                />
            ) : !q.isLoading && rows.length === 0 ? (
                <EmptyState icon={UsersThree} message={t('statsDialog.recipientsSection.empty')} />
            ) : (
                <MyTable<RecipientTableRow>
                    data={tableData}
                    columns={columns}
                    isLoading={q.isLoading || namesLoading}
                    error={q.error}
                    currentPage={page}
                    enableColumnResizing={false}
                />
            )}
            {tableData.total_pages > 1 && (
                <MyPagination
                    currentPage={page}
                    totalPages={tableData.total_pages}
                    totalElements={tableData.total_elements}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage}
                />
            )}
        </div>
    );
}

// ── Overview / Email ────────────────────────────────────────────────────────

type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

const TONE: Record<Tone, { icon: string; value: string }> = {
    neutral: { icon: 'bg-neutral-100 text-neutral-600', value: 'text-neutral-900' },
    success: { icon: 'bg-success-50 text-success-600', value: 'text-success-600' },
    info: { icon: 'bg-info-50 text-info-600', value: 'text-info-600' },
    warning: { icon: 'bg-warning-50 text-warning-600', value: 'text-warning-600' },
    danger: { icon: 'bg-danger-50 text-danger-600', value: 'text-danger-600' },
};

function StatTile({
    label,
    value,
    sub,
    icon: TileIcon,
    tone = 'neutral',
}: {
    label: string;
    value: number | string | undefined;
    sub?: string;
    icon: Icon;
    tone?: Tone;
}) {
    return (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="min-w-0">
                <p className="text-caption font-semibold text-neutral-500">{label}</p>
                <p className={cn('mt-1 text-h2-semibold', TONE[tone].value)}>{value ?? '-'}</p>
                {sub && <p className="text-caption text-neutral-500">{sub}</p>}
            </div>
            <span
                className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-md',
                    TONE[tone].icon
                )}
            >
                <TileIcon className="size-5" />
            </span>
        </div>
    );
}

function RateBar({ label, value, tone }: { label: string; value: number; tone: Tone }) {
    const bar: Record<Tone, string> = {
        neutral: '[&>div]:bg-neutral-400',
        success: '[&>div]:bg-success-500',
        info: '[&>div]:bg-info-500',
        warning: '[&>div]:bg-warning-500',
        danger: '[&>div]:bg-danger-500',
    };
    const clamped = Math.max(0, Math.min(100, value || 0));
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-caption">
                <span className="text-neutral-600">{label}</span>
                <span className="font-semibold text-neutral-800">{percent(clamped)}</span>
            </div>
            <Progress value={clamped} className={cn('h-2 !bg-neutral-100', bar[tone])} />
        </div>
    );
}

function OverviewPanel({ stats: s }: { stats: AnnouncementStats }) {
    const { t } = useTranslation('announcementHistoryIndex');
    return (
        <div className="flex flex-col gap-4">
            <h4 className="text-subtitle font-semibold text-neutral-800">
                {t('statsDialog.overviewTitle')}
            </h4>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatTile
                    label={t('statsDialog.tiles.recipients')}
                    value={s.totalRecipients}
                    icon={UsersThree}
                />
                <StatTile
                    label={t('statsDialog.tiles.delivered')}
                    value={s.deliveredCount}
                    sub={percent(s.deliveryRate)}
                    icon={PaperPlaneTilt}
                    tone="success"
                />
                <StatTile
                    label={t('statsDialog.tiles.read')}
                    value={s.readCount}
                    sub={percent(s.readRate)}
                    icon={Eye}
                    tone="info"
                />
                <StatTile
                    label={t('statsDialog.tiles.failed')}
                    value={s.failedCount}
                    icon={WarningCircle}
                    tone="danger"
                />
                <StatTile
                    label={t('statsDialog.tiles.dismissed')}
                    value={s.dismissedCount}
                    sub={percent(s.dismissRate)}
                    icon={XCircle}
                />
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <RateBar
                    label={t('statsDialog.rates.delivery')}
                    value={s.deliveryRate}
                    tone="success"
                />
                <RateBar label={t('statsDialog.rates.read')} value={s.readRate} tone="info" />
                <RateBar
                    label={t('statsDialog.rates.dismiss')}
                    value={s.dismissRate ?? 0}
                    tone="neutral"
                />
            </div>
        </div>
    );
}

function EmailPanel({ stats: s }: { stats: AnnouncementStats }) {
    const { t } = useTranslation('announcementHistoryIndex');
    if (!s.emailsSent) {
        return <EmptyState icon={EnvelopeSimple} message={t('statsDialog.noEmails')} />;
    }
    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
                <h4 className="text-subtitle font-semibold text-neutral-800">
                    {t('statsDialog.emailEventsTitle')}
                </h4>
                <span className="text-caption text-neutral-500">{t('statsDialog.viaSes')}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile
                    label={t('statsDialog.emailTiles.emailsSent')}
                    value={s.emailsSent}
                    icon={PaperPlaneTilt}
                />
                <StatTile
                    label={t('statsDialog.emailTiles.delivered')}
                    value={s.emailsDelivered}
                    sub={percent(s.emailDeliveryRate)}
                    icon={CheckCircle}
                    tone="success"
                />
                <StatTile
                    label={t('statsDialog.emailTiles.opened')}
                    value={s.emailsOpened}
                    sub={percent(s.emailOpenRate)}
                    icon={Eye}
                    tone="info"
                />
                <StatTile
                    label={t('statsDialog.emailTiles.clicked')}
                    value={s.emailsClicked}
                    sub={percent(s.emailClickRate)}
                    icon={ChartBar}
                    tone="info"
                />
                <StatTile
                    label={t('statsDialog.emailTiles.bounced')}
                    value={s.emailsBounced}
                    sub={percent(s.emailBounceRate)}
                    icon={WarningCircle}
                    tone="warning"
                />
                <StatTile
                    label={t('statsDialog.emailTiles.rejected')}
                    value={s.emailsRejected}
                    sub={percent(s.emailRejectRate)}
                    icon={XCircle}
                    tone="danger"
                />
                <StatTile
                    label={t('statsDialog.emailTiles.complained')}
                    value={s.emailsComplained}
                    sub={percent(s.emailComplaintRate)}
                    icon={WarningCircle}
                    tone="danger"
                />
                <StatTile
                    label={t('statsDialog.emailTiles.awaitingEvents')}
                    value={s.emailsPending}
                    icon={EnvelopeSimple}
                />
            </div>
            {s.emailsDelivered === 0 &&
                s.emailsBounced === 0 &&
                s.emailsRejected === 0 &&
                s.emailsPending > 0 && (
                    <p className="text-caption text-neutral-500">{t('statsDialog.pendingNote')}</p>
                )}
        </div>
    );
}

// ── states ─────────────────────────────────────────────────────────────────

function EmptyState({ icon: EmptyIcon, message }: { icon: Icon; message: string }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-200 p-8 text-center">
            <EmptyIcon className="size-8 text-neutral-300" />
            <p className="text-body text-neutral-500">{message}</p>
        </div>
    );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    const { t } = useTranslation('announcementHistoryIndex');
    return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-danger-200 p-8 text-center">
            <p className="text-body text-danger-600">{message}</p>
            <MyButton buttonType="secondary" scale="small" onClick={onRetry}>
                {t('retry')}
            </MyButton>
        </div>
    );
}
