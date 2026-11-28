import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import {
    ChartBar,
    CheckCircle,
    DownloadSimple,
    EnvelopeSimple,
    Eye,
    HourglassMedium,
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ChartLegend, HorizontalBars } from '@/components/common/report-visuals/charts';
import { REPORT_COLORS, useBrandColor } from '@/components/common/report-visuals/palette';
import { getUserBasicDetails } from '@/services/get_user_basic_details';
import {
    AnnouncementService,
    type AnnouncementRecipientRow,
    type RecipientOutcome,
} from '@/services/announcement';
import type { Announcement, AnnouncementStats, ChannelStats } from '../-types';
import { humanize, joinParts, percent, utcParts } from '../-utils/format';
import { useUserNames } from '../-hooks/useRecipientNames';
import {
    AnnouncementStatusChip,
    DateTimeStack,
    MessageStatusChip,
    NameAvatar,
} from './primitives';

type Section = 'overview' | 'email' | 'recipients';

export function DeliveryStatsDialog({
    announcement,
    onClose,
}: {
    announcement: Announcement | null;
    onClose: () => void;
}) {
    const { t } = useTranslation('announcementHistoryIndex');
    const [section, setSection] = useState<Section>('overview');

    const statsQ = useQuery({
        queryKey: ['announcementHistoryStats', announcement?.id],
        queryFn: async (): Promise<AnnouncementStats> =>
            AnnouncementService.stats(announcement!.id),
        enabled: !!announcement,
        refetchOnWindowFocus: false,
    });

    const nav: Array<{ id: Section; label: string; icon: Icon }> = [
        { id: 'overview', label: t('statsDialog.nav.overview'), icon: ChartBar },
        { id: 'email', label: t('statsDialog.nav.email'), icon: EnvelopeSimple },
        { id: 'recipients', label: t('statsDialog.nav.recipients'), icon: UsersThree },
    ];

    return (
        <MyDialog
            heading={t('statsDialog.title')}
            open={!!announcement}
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                    setSection('overview');
                }
            }}
            dialogWidth="max-w-6xl"
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
                        <TabsList className="flex h-auto shrink-0 flex-row flex-wrap items-stretch justify-start gap-1 bg-transparent p-0 md:w-48 md:flex-col">
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
                            <TabsContent value="recipients" className="mt-0">
                                <RecipientsPanel
                                    key={announcement.id}
                                    announcement={announcement}
                                    channels={statsQ.data?.channels ?? []}
                                />
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

// ── shared pieces ───────────────────────────────────────────────────────────

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
        <div className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="min-w-0">
                <p className="text-caption font-semibold text-neutral-500">{label}</p>
                <p className={cn('mt-1 text-h2-semibold', TONE[tone].value)}>
                    {typeof value === 'number' ? value.toLocaleString() : value ?? '-'}
                </p>
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

function Card({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-subtitle font-semibold text-neutral-800">{title}</h4>
                {extra}
            </div>
            {children}
        </div>
    );
}

/** EMAIL / WHATSAPP / PUSH_NOTIFICATION, or an in-app mode such as SYSTEM_ALERT. */
function useChannelLabel() {
    const { t } = useTranslation('announcementHistoryIndex');
    return useCallback(
        (channel?: string | null) => {
            if (!channel) return '-';
            return t(`mediums.${channel}`, {
                defaultValue: t(`modes.${channel}`, { defaultValue: humanize(channel) }),
            });
        },
        [t]
    );
}

// ── Overview ────────────────────────────────────────────────────────────────

// Delivery state, so the reserved status colours: reached / failed / still pending.
const OUTCOME_COLORS = {
    delivered: REPORT_COLORS.good,
    failed: REPORT_COLORS.bad,
    pending: REPORT_COLORS.neutral,
} as const;

function OverviewPanel({ stats: s }: { stats: AnnouncementStats }) {
    const { t } = useTranslation('announcementHistoryIndex');
    const channelLabel = useChannelLabel();
    const channels = s.channels ?? [];
    const pending = s.pendingCount ?? 0;
    const multiChannel = (s.totalMessages ?? 0) > s.totalRecipients;

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatTile
                    label={t('statsDialog.tiles.recipients')}
                    value={s.totalRecipients}
                    sub={
                        multiChannel
                            ? t('statsDialog.tiles.deliveriesSub', { count: s.totalMessages })
                            : undefined
                    }
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
                {pending > 0 && (
                    <StatTile
                        label={t('statsDialog.tiles.pending')}
                        value={pending}
                        icon={HourglassMedium}
                        tone="warning"
                    />
                )}
                {(s.dismissedCount ?? 0) > 0 && (
                    <StatTile
                        label={t('statsDialog.tiles.dismissed')}
                        value={s.dismissedCount}
                        sub={percent(s.dismissRate)}
                        icon={XCircle}
                    />
                )}
            </div>

            {channels.length > 0 && (
                <Card
                    title={t('statsDialog.channels.title')}
                    extra={
                        <ChartLegend
                            items={[
                                { label: t('statsDialog.channels.delivered'), color: OUTCOME_COLORS.delivered },
                                { label: t('statsDialog.channels.failed'), color: OUTCOME_COLORS.failed },
                                { label: t('statsDialog.channels.pending'), color: OUTCOME_COLORS.pending },
                            ]}
                        />
                    }
                >
                    <ul className="flex flex-col gap-3">
                        {channels.map((c) => (
                            <ChannelBar key={c.channel} row={c} label={channelLabel(c.channel)} />
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
}

/** One channel: a 100% bar split into delivered / failed / pending, 2px gaps between segments. */
function ChannelBar({ row, label }: { row: ChannelStats; label: string }) {
    const { t } = useTranslation('announcementHistoryIndex');
    const total = Math.max(row.people, 1);
    const segments = (
        [
            { key: 'delivered', value: row.delivered, color: OUTCOME_COLORS.delivered },
            { key: 'failed', value: row.failed, color: OUTCOME_COLORS.failed },
            { key: 'pending', value: row.pending, color: OUTCOME_COLORS.pending },
        ] as const
    ).filter((seg) => seg.value > 0);

    return (
        <li className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium text-neutral-700">{label}</span>
                <span className="shrink-0 text-xs text-neutral-500">
                    {t('statsDialog.channels.summary', {
                        delivered: row.delivered.toLocaleString(),
                        total: row.people.toLocaleString(),
                    })}{' '}
                    · <strong className="text-neutral-800">{percent((row.delivered / total) * 100)}</strong>
                </span>
            </div>
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-neutral-100">
                {segments.map((seg) => (
                    <div
                        key={seg.key}
                        className="h-full first:rounded-l-full last:rounded-r-full"
                        style={{ width: `${(seg.value / total) * 100}%`, background: seg.color }}
                        title={`${t(`statsDialog.channels.${seg.key}`)}: ${seg.value.toLocaleString()} (${percent((seg.value / total) * 100)})`}
                    />
                ))}
            </div>
        </li>
    );
}

// ── Email ───────────────────────────────────────────────────────────────────

function EmailPanel({ stats: s }: { stats: AnnouncementStats }) {
    const { t } = useTranslation('announcementHistoryIndex');
    const brand = useBrandColor();
    const failedToSend = s.emailsFailedToSend ?? 0;

    if (!s.emailsSent && !failedToSend) {
        return <EmptyState icon={EnvelopeSimple} message={t('statsDialog.noEmails')} />;
    }

    const sent = Math.max(s.emailsSent, 1);
    const funnel = [
        { key: 'sent', label: t('statsDialog.emailTiles.emailsSent'), value: s.emailsSent, rate: undefined },
        { key: 'delivered', label: t('statsDialog.emailTiles.delivered'), value: s.emailsDelivered, rate: s.emailDeliveryRate },
        { key: 'opened', label: t('statsDialog.emailTiles.opened'), value: s.emailsOpened, rate: s.emailOpenRate },
        { key: 'clicked', label: t('statsDialog.emailTiles.clicked'), value: s.emailsClicked, rate: s.emailClickRate },
    ];

    return (
        <div className="flex flex-col gap-4">
            <Card title={t('statsDialog.funnelTitle')} extra={<span className="text-caption text-neutral-500">{t('statsDialog.viaSes')}</span>}>
                <HorizontalBars
                    color={brand}
                    max={sent}
                    rows={funnel.map((f) => ({
                        key: f.key,
                        label: f.label,
                        value: f.value,
                        display: f.value.toLocaleString(),
                        sub: f.rate === undefined ? undefined : percent(f.rate),
                    }))}
                />
            </Card>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatTile
                    label={t('statsDialog.emailTiles.bounced')}
                    value={s.emailsBounced}
                    sub={percent(s.emailBounceRate)}
                    icon={WarningCircle}
                    tone="warning"
                />
                <StatTile
                    label={t('statsDialog.emailTiles.complained')}
                    value={s.emailsComplained}
                    sub={percent(s.emailComplaintRate)}
                    icon={WarningCircle}
                    tone="danger"
                />
                <StatTile
                    label={t('statsDialog.emailTiles.rejected')}
                    value={s.emailsRejected}
                    sub={percent(s.emailRejectRate)}
                    icon={XCircle}
                    tone="danger"
                />
                <StatTile
                    label={t('statsDialog.emailTiles.failedToSend')}
                    value={failedToSend}
                    icon={XCircle}
                    tone="danger"
                />
                <StatTile
                    label={t('statsDialog.emailTiles.awaitingEvents')}
                    value={s.emailsPending}
                    icon={HourglassMedium}
                />
                <StatTile
                    label={t('statsDialog.emailTiles.accepted')}
                    value={s.emailsSend}
                    icon={CheckCircle}
                    tone="success"
                />
            </div>
        </div>
    );
}

// ── Recipients ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;
const EXPORT_PAGE_SIZE = 500;
const ALL = 'ALL';

type RecipientTableRow = AnnouncementRecipientRow & { index: number; displayName: string };

const EMAIL_TONE: Record<string, string> = {
    CLICKED: 'bg-info-50 text-info-700',
    OPENED: 'bg-info-50 text-info-700',
    DELIVERED: 'bg-success-50 text-success-700',
    SENT: 'bg-neutral-100 text-neutral-600',
    BOUNCED: 'bg-warning-50 text-warning-700',
    COMPLAINED: 'bg-danger-50 text-danger-700',
    REJECTED: 'bg-danger-50 text-danger-700',
    FAILED: 'bg-danger-50 text-danger-700',
};

function EmailStatusBadge({ status }: { status?: string | null }) {
    const { t } = useTranslation('announcementHistoryIndex');
    if (!status) return <span className="text-neutral-400">-</span>;
    return (
        <span
            className={cn(
                'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-medium',
                EMAIL_TONE[status] ?? EMAIL_TONE.SENT
            )}
        >
            {t(`statsDialog.emailStatus.${status}`, { defaultValue: humanize(status) })}
        </span>
    );
}

function displayNameOf(r: AnnouncementRecipientRow, names: Map<string, string>, fallback: string) {
    // The stored user_name is empty for system alerts, and sometimes holds the id itself.
    const stored = r.userName?.trim();
    return (stored && stored !== r.userId ? stored : undefined) ?? names.get(r.userId) ?? fallback;
}

function needsNameLookup(r: AnnouncementRecipientRow) {
    return !r.userName?.trim() || r.userName === r.userId;
}

function RecipientsPanel({
    announcement,
    channels,
}: {
    announcement: Announcement;
    channels: ChannelStats[];
}) {
    const { t } = useTranslation('announcementHistoryIndex');
    const channelLabel = useChannelLabel();
    const [page, setPage] = useState(0);
    const [channel, setChannel] = useState<string>(ALL);
    const [outcome, setOutcome] = useState<RecipientOutcome | typeof ALL>(ALL);
    const [exporting, setExporting] = useState(false);

    const filters = {
        channel: channel === ALL ? undefined : channel,
        status: outcome === ALL ? undefined : outcome,
    };

    const q = useQuery({
        queryKey: ['announcementHistoryRecipients', announcement.id, page, filters.channel, filters.status],
        queryFn: () =>
            AnnouncementService.recipients(announcement.id, { ...filters, page, size: PAGE_SIZE }),
        refetchOnWindowFocus: false,
        placeholderData: (prev) => prev,
    });

    const rows = useMemo(() => q.data?.content ?? [], [q.data]);
    const missing = useMemo(() => rows.filter(needsNameLookup).map((r) => r.userId), [rows]);
    const { names, isLoading: namesLoading } = useUserNames(missing);

    const tableData = useMemo(() => {
        const content: RecipientTableRow[] = rows.map((r, i) => ({
            ...r,
            index: page * PAGE_SIZE + i + 1,
            displayName: displayNameOf(r, names, t('recipients.unknownUser')),
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
                size: 44,
                cell: ({ row }) => <span className="text-neutral-500">{row.original.index}</span>,
            },
            {
                id: 'name',
                header: t('statsDialog.recipientsSection.table.name'),
                size: 220,
                cell: ({ row }) => (
                    <div className="flex min-w-0 items-center gap-2">
                        <NameAvatar name={row.original.displayName} />
                        <div className="min-w-0">
                            <div className="truncate text-neutral-800">{row.original.displayName}</div>
                            {row.original.email && (
                                <div className="truncate text-caption text-neutral-500">
                                    {row.original.email}
                                </div>
                            )}
                        </div>
                    </div>
                ),
            },
            {
                id: 'channel',
                header: t('statsDialog.recipientsSection.table.channel'),
                size: 120,
                cell: ({ row }) => (
                    <span className="whitespace-nowrap text-neutral-700">
                        {channelLabel(row.original.mediumType ?? row.original.modeType)}
                    </span>
                ),
            },
            {
                id: 'status',
                header: t('statsDialog.recipientsSection.table.status'),
                size: 100,
                cell: ({ row }) => <MessageStatusChip status={row.original.status} />,
            },
            {
                id: 'email',
                header: t('statsDialog.recipientsSection.table.emailActivity'),
                size: 140,
                cell: ({ row }) =>
                    row.original.mediumType === 'EMAIL' ? (
                        <div className="flex flex-col gap-0.5">
                            <EmailStatusBadge status={row.original.emailStatus} />
                            {row.original.emailOpenedAt && (
                                <span className="text-caption text-neutral-500">
                                    {joinParts(utcParts(row.original.emailOpenedAt))}
                                </span>
                            )}
                        </div>
                    ) : (
                        <span className="text-neutral-400">-</span>
                    ),
            },
            {
                id: 'deliveredAt',
                header: t('statsDialog.recipientsSection.table.deliveredAt'),
                size: 120,
                cell: ({ row }) => <DateTimeStack parts={utcParts(row.original.deliveredAt)} />,
            },
            {
                id: 'readAt',
                header: t('statsDialog.recipientsSection.table.seenAt'),
                size: 120,
                cell: ({ row }) => <DateTimeStack parts={utcParts(row.original.readAt)} />,
            },
            {
                id: 'reason',
                header: t('statsDialog.recipientsSection.table.reason'),
                size: 180,
                cell: ({ row }) =>
                    row.original.errorMessage ? (
                        <span
                            className="line-clamp-2 text-caption text-danger-600"
                            title={row.original.errorMessage}
                        >
                            {row.original.errorMessage}
                        </span>
                    ) : (
                        <span className="text-neutral-400">-</span>
                    ),
            },
        ],
        [t, channelLabel]
    );

    const exportCsv = async () => {
        setExporting(true);
        try {
            const all: AnnouncementRecipientRow[] = [];
            for (let p = 0; ; p++) {
                const res = await AnnouncementService.recipients(announcement.id, {
                    ...filters,
                    page: p,
                    size: EXPORT_PAGE_SIZE,
                });
                all.push(...res.content);
                if (p + 1 >= res.totalPages || res.content.length === 0) break;
            }
            const lookup = Array.from(new Set(all.filter(needsNameLookup).map((r) => r.userId)));
            const exportNames = new Map<string, string>();
            for (let i = 0; i < lookup.length; i += 200) {
                const users = await getUserBasicDetails(lookup.slice(i, i + 200));
                users.forEach((u) => {
                    if (u?.id && u.name?.trim()) exportNames.set(u.id, u.name.trim());
                });
            }
            downloadCsv(
                `${slug(announcement.title)}-report.csv`,
                [
                    t('statsDialog.csv.name'),
                    t('statsDialog.csv.email'),
                    t('statsDialog.csv.channel'),
                    t('statsDialog.csv.status'),
                    t('statsDialog.csv.emailActivity'),
                    t('statsDialog.csv.deliveredAt'),
                    t('statsDialog.csv.openedAt'),
                    t('statsDialog.csv.clickedAt'),
                    t('statsDialog.csv.seenAt'),
                    t('statsDialog.csv.dismissedAt'),
                    t('statsDialog.csv.reason'),
                ],
                all.map((r) => [
                    displayNameOf(r, exportNames, t('recipients.unknownUser')),
                    r.email ?? '',
                    channelLabel(r.mediumType ?? r.modeType),
                    t(`messageStatus.${r.status}`, { defaultValue: humanize(r.status) }),
                    r.emailStatus
                        ? t(`statsDialog.emailStatus.${r.emailStatus}`, {
                              defaultValue: humanize(r.emailStatus),
                          })
                        : '',
                    csvDate(r.deliveredAt),
                    csvDate(r.emailOpenedAt),
                    csvDate(r.emailClickedAt),
                    csvDate(r.readAt),
                    csvDate(r.dismissedAt),
                    r.errorMessage ?? '',
                ])
            );
        } catch {
            toast.error(t('statsDialog.csv.failed'));
        } finally {
            setExporting(false);
        }
    };

    const count = q.data?.totalElements;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <h4 className="text-subtitle font-semibold text-neutral-800">
                    {typeof count === 'number'
                        ? t('statsDialog.recipientsSection.titleCount', { count })
                        : t('statsDialog.recipientsSection.title')}
                </h4>
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={channel}
                        onValueChange={(v) => {
                            setChannel(v);
                            setPage(0);
                        }}
                    >
                        <SelectTrigger className="h-8 w-40">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>{t('statsDialog.filters.allChannels')}</SelectItem>
                            {channels.map((c) => (
                                <SelectItem key={c.channel} value={c.channel}>
                                    {channelLabel(c.channel)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select
                        value={outcome}
                        onValueChange={(v) => {
                            setOutcome(v as RecipientOutcome | typeof ALL);
                            setPage(0);
                        }}
                    >
                        <SelectTrigger className="h-8 w-36">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>{t('statsDialog.filters.allStatuses')}</SelectItem>
                            <SelectItem value="DELIVERED">{t('statsDialog.channels.delivered')}</SelectItem>
                            <SelectItem value="FAILED">{t('statsDialog.channels.failed')}</SelectItem>
                            <SelectItem value="PENDING">{t('statsDialog.channels.pending')}</SelectItem>
                        </SelectContent>
                    </Select>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={exportCsv}
                        disable={exporting || !count}
                    >
                        <DownloadSimple className="mr-1 size-4" />
                        {exporting ? t('statsDialog.csv.exporting') : t('statsDialog.csv.export')}
                    </MyButton>
                </div>
            </div>
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

// ── CSV ─────────────────────────────────────────────────────────────────────

function csvDate(v?: string | null) {
    const p = utcParts(v);
    return p ? `${p.date} ${p.time}` : '';
}

function csvCell(v: string) {
    // Quote everything; a leading = + - @ would run as a formula in Excel.
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
}

function slug(s: string) {
    return (
        s
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'announcement'
    );
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
    const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    // BOM so Excel opens UTF-8 names correctly.
    const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
