import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    ArrowsClockwise,
    CalendarDots,
    CaretLeft,
    CaretRight,
    Check,
    PencilSimple,
    Plus,
    Stamp,
    Trash,
    X,
} from '@phosphor-icons/react';
import { AnnouncementService, type ModeType } from '@/services/announcement';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { isUserAdmin } from '@/utils/userDetails';
import { buildModeMeta } from '../create/-utils/constants';
import { AnnouncementStatusChip, EnumChips, modeTone } from '../history/-components/primitives';

type Announcement = {
    id: string;
    title: string;
    status?: string;
    createdByName?: string;
    createdBy?: string;
    createdByRole?: string;
    modes?: Array<{ modeType: ModeType; settings?: Record<string, unknown> }>;
    mediumTypes?: string[];
    scheduling?: {
        scheduleType?: 'IMMEDIATE' | 'ONE_TIME' | 'RECURRING';
        timezone?: string;
        startDate?: string;
        endDate?: string;
        cronExpression?: string;
    };
};

export const Route = createLazyFileRoute('/announcement/schedule/')({
    component: () => (
        <LayoutContainer>
            <AnnouncementSchedulePage />
        </LayoutContainer>
    ),
});

type ViewType = 'week' | '3day' | 'day' | 'month';

const VIEWS: Array<{ value: ViewType; key: string }> = [
    { value: 'day', key: 'tabs.day' },
    { value: '3day', key: 'tabs.threeDay' },
    { value: 'week', key: 'tabs.week' },
    { value: 'month', key: 'tabs.month' },
];

function AnnouncementSchedulePage() {
    const { t } = useTranslation('announcementScheduleIndex');
    const { t: tConstants } = useTranslation('announcementCreateConstants');
    const modeMeta = buildModeMeta(tConstants);
    const { setNavHeading } = useNavHeadingStore();
    const { toast } = useToast();
    const navigate = useNavigate();
    const admin = isUserAdmin();

    useEffect(() => {
        setNavHeading(t('navHeading'));
    }, [setNavHeading, t]);

    const [view, setView] = useState<ViewType>('week');
    const [modeFilter, setModeFilter] = useState<ModeType | 'ALL'>('ALL');
    const [startDate, setStartDate] = useState<Date>(startOfDay(new Date()));

    const range = useMemo(() => getRangeForView(view, startDate), [view, startDate]);

    const {
        data: planned = [],
        isLoading,
        refetch,
    } = useQuery({
        queryKey: [
            'announcement-planned',
            view,
            range.from.toISOString(),
            range.to.toISOString(),
            modeFilter,
        ],
        queryFn: async (): Promise<Announcement[]> => {
            const res = await AnnouncementService.planned({
                page: 0,
                size: 100,
                from: range.from.toISOString(),
                to: range.to.toISOString(),
            });
            // Backend returns AnnouncementCalendarItem (flat shape) — map to the local nested
            // Announcement shape that the rest of this page expects.
            type RawCalendarItem = {
                announcementId: string;
                title: string;
                status?: string;
                createdByRole?: string;
                modeTypes?: string[];
                mediumTypes?: string[];
                scheduleType?: 'IMMEDIATE' | 'ONE_TIME' | 'RECURRING';
                timezone?: string;
                startDate?: string;
                endDate?: string;
                nextRunTime?: string;
            };
            const raw: RawCalendarItem[] = Array.isArray(res) ? res : res?.content ?? [];
            const list: Announcement[] = raw.map((r) => ({
                id: r.announcementId,
                title: r.title,
                status: r.status,
                createdByRole: r.createdByRole,
                modes: (r.modeTypes || []).map((m) => ({ modeType: m as ModeType })),
                mediumTypes: r.mediumTypes || [],
                scheduling: r.scheduleType
                    ? {
                          scheduleType: r.scheduleType,
                          timezone: r.timezone,
                          startDate: r.startDate,
                          endDate: r.endDate,
                      }
                    : undefined,
            }));
            if (modeFilter === 'ALL') return list;
            return list.filter((a) => a.modes?.some((m) => m.modeType === modeFilter));
        },
        refetchOnWindowFocus: false,
    });

    // Approvals
    const [rejectFor, setRejectFor] = useState<Announcement | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    // Destructive: confirm before delete so an accidental click doesn't cancel a scheduled send.
    const [deleteFor, setDeleteFor] = useState<Announcement | null>(null);
    const [deleting, setDeleting] = useState(false);

    const onDelete = async () => {
        if (!deleteFor) return;
        setDeleting(true);
        try {
            await AnnouncementService.remove(deleteFor.id);
            toast({ title: t('toast.deleted') });
            setDeleteFor(null);
            refetch();
        } catch (e) {
            toast({
                title: t('toast.deleteFailedTitle'),
                description: e instanceof Error ? e.message : t('toast.deleteFailedFallback'),
                variant: 'destructive',
            });
        } finally {
            setDeleting(false);
        }
    };

    const onApprove = async (a: Announcement) => {
        try {
            await AnnouncementService.approve(a.id, 'ADMIN');
            toast({ title: t('toast.approved') });
            refetch();
        } catch (e) {
            toast({ title: t('toast.approveFailed'), variant: 'destructive' });
        }
    };
    const onReject = async () => {
        if (!rejectFor) return;
        try {
            await AnnouncementService.reject(rejectFor.id, 'ADMIN', rejectReason || '');
            toast({ title: t('toast.rejected') });
            setRejectReason('');
            setRejectFor(null);
            refetch();
        } catch (e) {
            toast({ title: t('toast.rejectFailed'), variant: 'destructive' });
        }
    };

    // Navigate to create prefilled
    const goToCreateAt = (date: Date) => {
        const iso = new Date(date).toISOString();
        navigate({
            to: '/announcement/create',
            search: {
                scheduleType: 'ONE_TIME',
                startDate: iso,
            },
        });
    };

    // Navigate to edit an existing scheduled campaign in the email-campaigning form
    const goToEdit = (a: Announcement) => {
        navigate({
            to: '/announcement/email-campaigning',
            search: { id: a.id },
        });
    };

    // An announcement is editable as long as it has not already been delivered or cancelled
    const isEditable = (a: Announcement) => {
        const s = a.status;
        if (!s) return true;
        if (s === 'ACTIVE' || s === 'INACTIVE' || s === 'EXPIRED' || s === 'REJECTED') {
            return false;
        }
        // If a schedule exists and its start has passed, treat as no longer editable
        const start = a.scheduling?.startDate;
        if (start) {
            const startMs = Date.parse(start);
            if (!Number.isNaN(startMs) && startMs <= Date.now()) return false;
        }
        return true;
    };

    // View switch and navigation
    const goPrev = () =>
        setStartDate(
            addDays(
                startDate,
                view === 'month' ? -30 : view === 'week' ? -7 : view === '3day' ? -3 : -1
            )
        );
    const goNext = () =>
        setStartDate(
            addDays(
                startDate,
                view === 'month' ? 30 : view === 'week' ? 7 : view === '3day' ? 3 : 1
            )
        );
    const goToday = () => setStartDate(startOfDay(new Date()));

    const grouped = useMemo(() => groupByDay(planned, range.from, range.to), [planned, range]);

    const pending = planned.filter((a) => a.status === 'PENDING_APPROVAL');
    const upcoming = [...planned]
        .filter((a) => a.scheduling?.startDate)
        .sort(
            (x, y) =>
                Date.parse(x.scheduling?.startDate ?? '') -
                Date.parse(y.scheduling?.startDate ?? '')
        )
        .slice(0, 8);

    return (
        <div className="flex flex-col gap-5 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <CalendarDots className="size-6" weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <h1 className="text-h2-semibold text-neutral-900">{t('pageHeading')}</h1>
                        <p className="mt-1 text-body text-neutral-500">{t('subheading')}</p>
                    </div>
                </div>
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={() => goToCreateAt(new Date())}
                >
                    <Plus className="size-4" weight="bold" />
                    {t('scheduleNew')}
                </MyButton>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <span className="text-h3-semibold text-neutral-900">
                    {formatMonthYear(startDate)}
                </span>
                <div className="flex items-center gap-1">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="icon"
                        onClick={goPrev}
                        aria-label={t('nav.prev')}
                        title={t('nav.prev')}
                    >
                        <CaretLeft className="size-4" />
                    </MyButton>
                    <MyButton buttonType="secondary" scale="medium" onClick={goToday}>
                        {t('nav.today')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="icon"
                        onClick={goNext}
                        aria-label={t('nav.next')}
                        title={t('nav.next')}
                    >
                        <CaretRight className="size-4" />
                    </MyButton>
                </div>
                <div
                    role="tablist"
                    aria-label={t('viewLabel')}
                    className="flex rounded-lg border border-neutral-200 bg-white p-0.5"
                >
                    {VIEWS.map((v) => (
                        <button
                            key={v.value}
                            type="button"
                            role="tab"
                            aria-selected={view === v.value}
                            onClick={() => setView(v.value)}
                            className={cn(
                                'rounded-md px-3 py-1 text-caption font-medium transition-colors',
                                view === v.value
                                    ? 'bg-primary-500 text-white'
                                    : 'text-neutral-600 hover:bg-neutral-100'
                            )}
                        >
                            {t(v.key)}
                        </button>
                    ))}
                </div>
                <div className="ml-auto w-full sm:w-56">
                    <Select
                        value={modeFilter}
                        onValueChange={(v) => setModeFilter(v as ModeType | 'ALL')}
                    >
                        <SelectTrigger
                            className="bg-white"
                            aria-label={t('modeFilter.placeholder')}
                        >
                            <SelectValue placeholder={t('modeFilter.placeholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">{t('modeFilter.all')}</SelectItem>
                            {modeMeta.map((m) => (
                                <SelectItem key={m.type} value={m.type}>
                                    {m.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-neutral-600">
                {modeMeta.map((m) => (
                    <span key={m.type} className="flex items-center gap-1.5">
                        <span className={cn('size-2.5 rounded-sm', modeTone(m.type).dot)} />
                        {m.label}
                    </span>
                ))}
                <span className="flex items-center gap-1.5">
                    <ArrowsClockwise className="size-3.5" />
                    {t('legend.recurring')}
                </span>
            </div>

            {view === 'month' ? (
                <MonthGrid
                    start={startOfMonth(startDate)}
                    events={planned}
                    loading={isLoading}
                    onCreate={(d) => goToCreateAt(d)}
                    onOpenDay={(d) => {
                        setStartDate(startOfDay(d));
                        setView('day');
                    }}
                    onApprove={onApprove}
                    onReject={(a) => setRejectFor(a)}
                    admin={admin}
                />
            ) : (
                <Agenda
                    start={range.from}
                    end={range.to}
                    view={view}
                    grouped={grouped}
                    onCreate={(d) => goToCreateAt(d)}
                    onApprove={onApprove}
                    onReject={(a) => setRejectFor(a)}
                    onEdit={goToEdit}
                    onDelete={(a) => setDeleteFor(a)}
                    canEdit={isEditable}
                    admin={admin}
                    loading={isLoading}
                />
            )}

            <p className="text-caption text-neutral-500">
                {t('showingRange', { range: formatRange(range.from, range.to) })}
                {!isLoading && ` · ${t('countInView', { count: planned.length })}`}
            </p>

            <div className="grid gap-4 lg:grid-cols-2">
                <section className="flex flex-col rounded-xl border border-neutral-200 bg-white shadow-sm">
                    <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
                        <CalendarDots className="size-5 text-primary-500" weight="duotone" />
                        <h2 className="text-subtitle font-semibold text-neutral-900">
                            {t('lists.upNext.title')}
                        </h2>
                    </div>
                    {isLoading ? (
                        <div className="flex flex-col gap-2 p-4">
                            {[0, 1, 2].map((i) => (
                                <Skeleton key={i} className="h-10 w-full" />
                            ))}
                        </div>
                    ) : upcoming.length === 0 ? (
                        <p className="p-4 text-body text-neutral-500">{t('lists.upNext.empty')}</p>
                    ) : (
                        <ul className="divide-y divide-neutral-100">
                            {upcoming.map((a) => (
                                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                                    <span
                                        className={cn(
                                            'size-2.5 shrink-0 rounded-full',
                                            modeTone(a.modes?.[0]?.modeType).dot
                                        )}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-body font-medium text-neutral-900">
                                            {a.title}
                                        </p>
                                        <p className="truncate text-caption text-neutral-500">
                                            {formatScheduleTime(t, a.scheduling)}
                                        </p>
                                    </div>
                                    <AnnouncementStatusChip status={a.status} />
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="flex flex-col rounded-xl border border-neutral-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
                        <div className="flex items-center gap-2">
                            <Stamp className="size-5 text-warning-500" weight="duotone" />
                            <h2 className="text-subtitle font-semibold text-neutral-900">
                                {t('lists.pending.title')}
                            </h2>
                        </div>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => navigate({ to: '/announcement/approval' })}
                        >
                            {t('lists.pending.openQueue')}
                        </MyButton>
                    </div>
                    {isLoading ? (
                        <div className="flex flex-col gap-2 p-4">
                            {[0, 1].map((i) => (
                                <Skeleton key={i} className="h-10 w-full" />
                            ))}
                        </div>
                    ) : pending.length === 0 ? (
                        <p className="p-4 text-body text-neutral-500">{t('lists.pending.empty')}</p>
                    ) : (
                        <ul className="divide-y divide-neutral-100">
                            {pending.map((a) => (
                                <li
                                    key={a.id}
                                    className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-body font-medium text-neutral-900">
                                            {a.title}
                                        </p>
                                        <p className="truncate text-caption text-warning-700">
                                            {[
                                                formatScheduleTime(t, a.scheduling),
                                                t('lists.pending.notSentYet'),
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </p>
                                    </div>
                                    {admin && (
                                        <div className="flex items-center gap-2">
                                            <MyButton
                                                buttonType="primary"
                                                scale="small"
                                                onClick={() => onApprove(a)}
                                            >
                                                {t('actions.approve')}
                                            </MyButton>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={() => setRejectFor(a)}
                                            >
                                                {t('actions.reject')}
                                            </MyButton>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>

            <Dialog open={!!rejectFor} onOpenChange={(open) => !open && setRejectFor(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('rejectDialog.title')}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-2">
                        <Textarea
                            placeholder={t('rejectDialog.reasonPlaceholder')}
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => setRejectFor(null)}>
                                {t('rejectDialog.cancel')}
                            </Button>
                            <Button variant="destructive" onClick={onReject}>
                                {t('rejectDialog.reject')}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={!!deleteFor} onOpenChange={(open) => !open && setDeleteFor(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3">
                        <p className="text-sm text-neutral-700">
                            {t('deleteDialog.bodyPrefix')}{' '}
                            <span className="font-medium">
                                {deleteFor?.title || t('deleteDialog.defaultTitle')}
                            </span>
                            {t('deleteDialog.bodySuffix')}
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="secondary"
                                onClick={() => setDeleteFor(null)}
                                disabled={deleting}
                            >
                                {t('deleteDialog.cancel')}
                            </Button>
                            <Button variant="destructive" onClick={onDelete} disabled={deleting}>
                                {deleting ? t('deleteDialog.deleting') : t('deleteDialog.delete')}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function Agenda(props: {
    start: Date;
    end: Date;
    view: ViewType;
    grouped: { date: Date; items: Announcement[] }[];
    onCreate: (d: Date) => void;
    onApprove: (a: Announcement) => void;
    onReject: (a: Announcement) => void;
    onEdit: (a: Announcement) => void;
    onDelete: (a: Announcement) => void;
    canEdit: (a: Announcement) => boolean;
    admin: boolean;
    loading: boolean;
}) {
    const {
        start,
        end,
        view,
        grouped,
        onCreate,
        onApprove,
        onReject,
        onEdit,
        onDelete,
        canEdit,
        admin,
        loading,
    } = props;
    const { t } = useTranslation('announcementScheduleIndex');
    const days: Date[] = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) days.push(new Date(d));
    const columns = cn(
        'grid gap-3',
        view === 'day'
            ? 'grid-cols-1'
            : view === '3day'
              ? 'grid-cols-1 md:grid-cols-3'
              : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-7'
    );

    if (loading) {
        return (
            <div className={columns}>
                {days.map((d) => (
                    <Skeleton key={d.toISOString()} className="h-40 w-full rounded-xl" />
                ))}
            </div>
        );
    }

    if (grouped.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-200 bg-white py-12 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-400">
                    <CalendarDots className="size-6" weight="duotone" />
                </span>
                <div className="text-body font-semibold text-neutral-700">
                    {t('emptyState.title')}
                </div>
                <div className="text-caption text-neutral-500">{t('emptyState.description')}</div>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    className="mt-2"
                    onClick={() => onCreate(atMidday(start))}
                >
                    <Plus className="size-3.5" />
                    {t('scheduleNew')}
                </MyButton>
            </div>
        );
    }

    const today = new Date();
    return (
        <div className={columns}>
            {days.map((date) => {
                const items = grouped.find((g) => isSameDay(g.date, date))?.items ?? [];
                const isToday = isSameDay(date, today);
                return (
                    <div
                        key={date.toISOString()}
                        className={cn(
                            'flex min-w-0 flex-col rounded-xl border bg-white shadow-sm',
                            isToday ? 'border-primary-300' : 'border-neutral-200'
                        )}
                    >
                        <div
                            className={cn(
                                'flex items-center justify-between gap-2 rounded-t-xl border-b px-3 py-2',
                                isToday
                                    ? 'border-primary-100 bg-primary-50'
                                    : 'border-neutral-100 bg-neutral-50'
                            )}
                        >
                            <span
                                className={cn(
                                    'truncate text-caption font-semibold',
                                    isToday ? 'text-primary-600' : 'text-neutral-700'
                                )}
                            >
                                {formatDayLabel(date)}
                            </span>
                            <MyButton
                                buttonType="text"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => onCreate(atMidday(date))}
                                aria-label={t('scheduleHere')}
                                title={t('scheduleHere')}
                            >
                                <Plus className="size-4" weight="bold" />
                            </MyButton>
                        </div>
                        <div className="flex flex-col gap-2 p-2">
                            {items.length === 0 ? (
                                <p className="py-6 text-center text-caption text-neutral-400">
                                    {t('nothingScheduled')}
                                </p>
                            ) : (
                                items.map((a) => (
                                    <EventCard
                                        key={a.id}
                                        a={a}
                                        onApprove={onApprove}
                                        onReject={onReject}
                                        onEdit={onEdit}
                                        onDelete={onDelete}
                                        canEdit={canEdit(a)}
                                        admin={admin}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function MonthGrid(props: {
    start: Date;
    events: Announcement[];
    loading: boolean;
    onCreate: (d: Date) => void;
    onOpenDay: (d: Date) => void;
    onApprove: (a: Announcement) => void;
    onReject: (a: Announcement) => void;
    admin: boolean;
}) {
    const { start, events, loading, onCreate, onOpenDay } = props;
    const { t } = useTranslation('announcementScheduleIndex');
    const { firstOfMonth, lastOfMonth } = useMemo(() => getMonthMeta(start), [start]);
    const byDay = useMemo(
        () => groupByDay(events, firstOfMonth, lastOfMonth),
        [events, firstOfMonth, lastOfMonth]
    );
    const cells = useMemo(() => buildMonthCells(firstOfMonth), [firstOfMonth]);
    const weekdayLabels = [
        t('weekdays.sun'),
        t('weekdays.mon'),
        t('weekdays.tue'),
        t('weekdays.wed'),
        t('weekdays.thu'),
        t('weekdays.fri'),
        t('weekdays.sat'),
    ];
    const today = new Date();
    return (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="grid grid-cols-7 border-b border-neutral-200 bg-neutral-50">
                {weekdayLabels.map((d) => (
                    <div
                        key={d}
                        className="p-2 text-center text-caption font-semibold text-neutral-500"
                    >
                        {d}
                    </div>
                ))}
            </div>
            <div className="grid grid-cols-7">
                {cells.map((cell: Date | null, idx: number) => {
                    if (!cell) {
                        return (
                            <div
                                key={idx}
                                className="min-h-28 border-b border-r border-neutral-100 bg-neutral-50"
                            />
                        );
                    }
                    const items = byDay.find((g) => isSameDay(g.date, cell))?.items ?? [];
                    const isToday = isSameDay(cell, today);
                    return (
                        <div
                            key={idx}
                            className={cn(
                                'group flex min-h-28 min-w-0 flex-col gap-1 border-b border-r border-neutral-100 p-1.5',
                                isToday && 'bg-primary-50'
                            )}
                        >
                            <div className="flex items-center justify-between gap-1">
                                <span
                                    className={cn(
                                        'text-caption font-semibold',
                                        isToday ? 'text-primary-600' : 'text-neutral-600'
                                    )}
                                >
                                    {cell.getDate()}
                                </span>
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    layoutVariant="icon"
                                    onClick={() => onCreate(atMidday(cell))}
                                    aria-label={t('scheduleHere')}
                                    title={t('scheduleHere')}
                                >
                                    <Plus className="size-3.5" weight="bold" />
                                </MyButton>
                            </div>
                            {loading ? (
                                idx % 3 === 0 && <Skeleton className="h-4 w-full" />
                            ) : (
                                <>
                                    {/* Phones get coloured dots; wider screens the titles. */}
                                    {items.length > 0 && (
                                        <div className="flex flex-wrap gap-1 sm:hidden">
                                            {items.slice(0, 4).map((a) => (
                                                <span
                                                    key={a.id}
                                                    className={cn(
                                                        'size-2 rounded-full',
                                                        modeTone(a.modes?.[0]?.modeType).dot
                                                    )}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    <div className="hidden flex-col gap-1 sm:flex">
                                        {items.slice(0, 3).map((a) => (
                                            <EventPill key={a.id} a={a} />
                                        ))}
                                    </div>
                                    {items.length > 3 && (
                                        <button
                                            type="button"
                                            onClick={() => onOpenDay(cell)}
                                            className="text-left text-caption font-semibold text-primary-600 hover:underline"
                                        >
                                            {t('moreCount', { count: items.length - 3 })}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function EventCard({
    a,
    onApprove,
    onReject,
    onEdit,
    onDelete,
    canEdit,
    admin,
}: {
    a: Announcement;
    onApprove: (a: Announcement) => void;
    onReject: (a: Announcement) => void;
    onEdit: (a: Announcement) => void;
    onDelete: (a: Announcement) => void;
    canEdit: boolean;
    admin: boolean;
}) {
    const { t } = useTranslation('announcementScheduleIndex');
    const tone = modeTone(a.modes?.[0]?.modeType);
    // Prefer external-channel badges (EMAIL / WHATSAPP / PUSH_NOTIFICATION) since those are
    // what the recipient actually experiences. Fall back to the in-app mode for announcements
    // with no external channel (pure SYSTEM_ALERT / DASHBOARD_PIN / DM / etc).
    const hasMediums = (a.mediumTypes?.length ?? 0) > 0;
    const timeLabel = formatScheduleTime(t, a.scheduling);
    const recurring = a.scheduling?.scheduleType === 'RECURRING';
    const canReview = a.status === 'PENDING_APPROVAL' && admin;
    return (
        <div className={cn('flex flex-col gap-1.5 rounded-lg border-l-4 p-2.5', tone.event)}>
            {timeLabel && (
                <span className="flex items-center gap-1 text-caption font-semibold text-neutral-600">
                    {recurring && <ArrowsClockwise className="size-3.5 shrink-0" />}
                    <span className="truncate">{timeLabel}</span>
                </span>
            )}
            <p className="break-words text-body font-semibold text-neutral-900">{a.title}</p>
            <div className="flex flex-wrap items-center gap-1">
                {a.status && a.status !== 'DRAFT' && <AnnouncementStatusChip status={a.status} />}
                <EnumChips
                    group={hasMediums ? 'mediums' : 'modes'}
                    variant="outline"
                    values={
                        hasMediums ? a.mediumTypes ?? [] : (a.modes || []).map((m) => m.modeType)
                    }
                />
            </div>
            <p className="break-words text-caption text-neutral-500">
                {renderSchedule(t, a.scheduling)}
            </p>
            {(canEdit || canReview) && (
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    {canEdit && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            layoutVariant="icon"
                            onClick={() => onEdit(a)}
                            aria-label={t('actions.edit')}
                            title={t('actions.edit')}
                            className="bg-white"
                        >
                            <PencilSimple className="size-3.5" />
                        </MyButton>
                    )}
                    {canEdit && (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            layoutVariant="icon"
                            onClick={() => onDelete(a)}
                            aria-label={t('actions.delete')}
                            title={t('actions.delete')}
                            className="bg-white !text-danger-600"
                        >
                            <Trash className="size-3.5" />
                        </MyButton>
                    )}
                    {canReview && (
                        <>
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => onApprove(a)}
                                aria-label={t('actions.approve')}
                                title={t('actions.approve')}
                            >
                                <Check className="size-3.5" weight="bold" />
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                onClick={() => onReject(a)}
                                aria-label={t('actions.reject')}
                                title={t('actions.reject')}
                                className="bg-white !text-danger-600"
                            >
                                <X className="size-3.5" weight="bold" />
                            </MyButton>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function formatScheduleTime(t: TFunction, s?: Announcement['scheduling']): string {
    if (!s) return '';
    if (s.scheduleType === 'IMMEDIATE') return t('schedule.immediate');
    if (s.scheduleType === 'RECURRING') {
        return s.cronExpression
            ? t('schedule.recurringWithCron', { cron: s.cronExpression })
            : t('schedule.recurring');
    }
    // ONE_TIME — prefer just the local-formatted time, no awkward "→ -" tail
    if (!s.startDate) return '';
    try {
        return new Date(s.startDate).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    } catch {
        return s.startDate;
    }
}

function EventPill({ a }: { a: Announcement }) {
    const tone = modeTone(a.modes?.[0]?.modeType);
    const time = shortTime(a.scheduling?.startDate);
    const recurring = a.scheduling?.scheduleType === 'RECURRING';
    return (
        <span
            title={time ? `${a.title} · ${time}` : a.title}
            className={cn(
                'flex min-w-0 items-center gap-1 rounded-md border-l-2 px-1.5 py-0.5 text-caption text-neutral-800',
                tone.event
            )}
        >
            {recurring && <ArrowsClockwise className="size-3 shrink-0" />}
            {time && <span className="shrink-0 font-semibold">{time}</span>}
            <span className="truncate">{a.title}</span>
        </span>
    );
}

function shortTime(v?: string) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDayLabel(d: Date) {
    try {
        return d.toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
        });
    } catch {
        return d.toDateString();
    }
}

// Helpers
function getRangeForView(view: ViewType, start: Date) {
    if (view === 'day') return { from: startOfDay(start), to: endOfDay(start) };
    if (view === '3day') return { from: startOfDay(start), to: endOfDay(addDays(start, 2)) };
    if (view === 'week') return { from: startOfDay(start), to: endOfDay(addDays(start, 6)) };
    // month
    const from = startOfMonth(start);
    const to = endOfMonth(start);
    return { from, to };
}

function groupByDay(items: Announcement[], from: Date, to: Date) {
    const days: { date: Date; items: Announcement[] }[] = [];
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
        days.push({ date: new Date(d), items: [] });
    }
    items.forEach((a) => {
        const startStr = a.scheduling?.startDate;
        if (!startStr) return;
        const dt = new Date(startStr);
        const idx = days.findIndex((g) => isSameDay(g.date, dt));
        if (idx >= 0) {
            const bucket = days[idx];
            if (bucket) bucket.items.push(a);
        }
    });
    return days.filter((g) => g.items.length > 0);
}

function formatRange(from: Date, to: Date) {
    const f = from.toDateString();
    const t = to.toDateString();
    if (f === t) return f;
    return `${f} → ${t}`;
}

function renderSchedule(t: TFunction, s?: Announcement['scheduling']) {
    if (!s) return '-';
    const tzSuffix = s.timezone ? ` · ${s.timezone}` : '';
    if (s.scheduleType === 'RECURRING') {
        const cron = s.cronExpression
            ? t('schedule.cronWithLabel', { cron: s.cronExpression })
            : t('schedule.recurring');
        return `${cron}${tzSuffix}`;
    }
    if (s.scheduleType === 'ONE_TIME') {
        // Render as a range only when an endDate exists. Most one-time campaigns have no
        // endDate, so we surface just the start time + zone — cleaner than "<time> → - (UTC)".
        return s.endDate
            ? `${fmt(s.startDate)} → ${fmt(s.endDate)}${tzSuffix}`
            : `${fmt(s.startDate)}${tzSuffix}`;
    }
    return `${t('schedule.immediate')}${tzSuffix}`;
}

function fmt(v?: string) {
    return v ? new Date(v).toLocaleString() : '-';
}
function startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function endOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
}
function addDays(d: Date, n: number) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}
function startOfMonth(d: Date) {
    const x = new Date(d);
    x.setDate(1);
    x.setHours(0, 0, 0, 0);
    return x;
}
function endOfMonth(d: Date) {
    const x = new Date(d);
    x.setMonth(x.getMonth() + 1, 0);
    x.setHours(23, 59, 59, 999);
    return x;
}
function getMonthMeta(d: Date) {
    const start = startOfMonth(d);
    const end = endOfMonth(d);
    return { firstOfMonth: start, lastOfMonth: end };
}
function buildMonthCells(firstOfMonth: Date) {
    const lastOfMonth = endOfMonth(firstOfMonth);
    const leading = firstOfMonth.getDay();
    const cells: Array<Date | null> = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let x = new Date(firstOfMonth); x <= lastOfMonth; x = addDays(x, 1)) {
        cells.push(new Date(x));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
}
function isSameDay(a: Date, b: Date) {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function formatMonthYear(d: Date) {
    try {
        return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    } catch {
        return `${d.getMonth() + 1}/${d.getFullYear()}`;
    }
}

function atMidday(d: Date) {
    const x = new Date(d);
    x.setHours(12, 0, 0, 0);
    return x;
}
