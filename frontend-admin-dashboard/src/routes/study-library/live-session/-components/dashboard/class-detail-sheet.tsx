import { useMemo, useState } from 'react';
import {
    ArrowSquareOut,
    ChatCircle,
    ChatText,
    Clock,
    DownloadSimple,
    Envelope,
    Eye,
    HandPalm,
    MagnifyingGlass,
    Microphone,
    WhatsappLogo,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContactCallButton } from '@/components/shared/telephony/contact-call-button';
import { cn } from '@/lib/utils';
import { getInstituteId } from '@/constants/helper';
import { useDialogStore } from '@/routes/manage-students/students-list/-hooks/useDialogStore';
import { buildCsv, downloadCsv } from '../../feedback/-utils/csv';
import {
    useClassLearners,
    type DashboardClassLearner,
    type DashboardClassRow,
    type LearnerAttendanceStatus,
} from '../../-services/live-class-dashboard';
import { formatMeetingDate, formatTimeRange } from '../../-utils/live-sesstions';
import {
    EMPTY_VALUE,
    formatCount,
    formatDuration,
    formatRate,
    formatRating,
    platformLabelKey,
} from '../../-utils/dashboard-format';
import { exportFileName, toStudentTable } from '../../-utils/dashboard-export';
import { EmptyChart } from './dashboard-charts';
import { Avatar } from './dashboard-highlights';
import { Stars } from './dashboard-kpis';
import { instructorLabel } from './dashboard-tables';

type LearnerFilter = 'ALL' | LearnerAttendanceStatus;
const FILTERS: LearnerFilter[] = ['ALL', 'PRESENT', 'BELOW_RULE', 'NOT_JOINED'];

const STATUS_PILL: Record<LearnerAttendanceStatus, string> = {
    PRESENT: 'bg-success-50 text-success-700',
    BELOW_RULE: 'bg-warning-50 text-warning-700',
    NOT_JOINED: 'bg-neutral-100 text-neutral-600',
};

const learnerName = (l: DashboardClassLearner, guestLabel: string) =>
    l.name || l.email || guestLabel;

const isNum = (v: number | null | undefined): v is number =>
    typeof v === 'number' && !Number.isNaN(v);

/** >=70 good, 40-69 medium, <40 low. */
const activenessTone = (score: number) =>
    score >= 70
        ? 'bg-success-50 text-success-700'
        : score >= 40
          ? 'bg-warning-50 text-warning-700'
          : 'bg-danger-50 text-danger-700';

function ActivenessChip({
    learner,
    label,
    detail,
    stateLabel,
}: {
    learner: DashboardClassLearner;
    label: string;
    detail: string;
    /** Why there is no score (phone, turned off, camera blocked …), when there is none. */
    stateLabel: string | null;
}) {
    const score = learner.activeness;
    return (
        <span
            className="flex items-center gap-1"
            title={[label, detail].filter(Boolean).join(' · ')}
        >
            <Eye size={13} className="text-neutral-400" aria-hidden />
            <span className="sr-only">{label}</span>
            {isNum(score) ? (
                <span
                    className={cn(
                        'rounded-full px-2 py-0.5 font-semibold tabular-nums',
                        activenessTone(score)
                    )}
                >
                    {Math.round(score)}%
                </span>
            ) : stateLabel ? (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">{stateLabel}</span>
            ) : (
                EMPTY_VALUE
            )}
            {detail && <span className="sr-only">{detail}</span>}
        </span>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <span className="text-caption text-neutral-500">{label}</span>
            <span className="text-subtitle font-semibold tabular-nums text-neutral-900">
                {value}
            </span>
        </div>
    );
}

function Metric({
    icon: IconCmp,
    value,
    label,
}: {
    icon: typeof Clock;
    value: string;
    label: string;
}) {
    return (
        <span className="flex items-center gap-1" title={label}>
            <IconCmp size={13} className="text-neutral-400" aria-hidden />
            <span className="sr-only">{label}</span>
            {value}
        </span>
    );
}

/**
 * Side panel for one class: every expected learner (and, without a batch
 * filter, anyone else who joined) with status, time stayed, engagement and
 * written feedback — plus call / WhatsApp / email / CSV for the list on screen.
 */
export function ClassDetailSheet({
    row,
    onClose,
    batchIds,
    batchLabel,
    onOpenFullPage,
}: {
    row: DashboardClassRow | null;
    onClose: () => void;
    batchIds: string[];
    batchLabel: (id: string) => string;
    onOpenFullPage: (row: DashboardClassRow) => void;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const instituteId = getInstituteId() ?? '';
    const [filter, setFilter] = useState<LearnerFilter>('ALL');
    const [search, setSearch] = useState('');
    const { openBulkSendMessageDialog, openBulkSendEmailDialog } = useDialogStore();
    const units = { h: t('units.hourShort'), m: t('units.minuteShort') };
    const guestLabel = t('drilldown.guest');

    const {
        data: learners,
        isLoading,
        error,
        refetch,
    } = useClassLearners({
        instituteId,
        scheduleId: row?.schedule_id ?? null,
        batchIds,
    });

    const counts = useMemo(() => {
        const c: Record<LearnerFilter, number> = {
            ALL: 0,
            PRESENT: 0,
            BELOW_RULE: 0,
            NOT_JOINED: 0,
        };
        (learners ?? []).forEach((l) => {
            c.ALL += 1;
            c[l.status] += 1;
        });
        return c;
    }, [learners]);

    // The activeness score is opt-in per class: show it only when someone has one,
    // or a reason for not having one (phone, turned off, camera blocked …).
    const showActiveness = useMemo(
        () => (learners ?? []).some((l) => isNum(l.activeness) || isNum(l.activeness_state)),
        [learners]
    );
    const activenessState = (l: DashboardClassLearner, short: boolean): string | null =>
        isNum(l.activeness_state) && l.activeness_state !== 1
            ? t(`${short ? 'activenessStateShort' : 'activenessState'}.${l.activeness_state}`, { defaultValue: '' }) || null
            : null;

    // "On screen 90% · Attention 76% · tracked 42m · stepped away 3×" — missing parts omitted.
    const activenessDetail = (l: DashboardClassLearner) =>
        [
            isNum(l.activeness_on_screen)
                ? t('drilldown.activenessOnScreen', {
                      value: Math.round(l.activeness_on_screen),
                  })
                : null,
            isNum(l.activeness_attention)
                ? t('drilldown.activenessAttention', {
                      value: Math.round(l.activeness_attention),
                  })
                : null,
            isNum(l.activeness_seconds) && l.activeness_seconds > 0
                ? t('drilldown.activenessTracked', {
                      duration: formatDuration(l.activeness_seconds / 60, units),
                  })
                : null,
            isNum(l.activeness_away_count) && l.activeness_away_count > 0
                ? t('drilldown.activenessAway', { count: l.activeness_away_count })
                : null,
            activenessState(l, false),
        ]
            .filter(Boolean)
            .join(' · ');

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (learners ?? []).filter((l) => {
            if (filter !== 'ALL' && l.status !== filter) return false;
            if (!q) return true;
            return [l.name, l.email, l.mobile].some((v) => v && v.toLowerCase().includes(q));
        });
    }, [learners, filter, search]);

    // Only enrolled learners can be messaged through the shared dialogs.
    const messageable = visible.filter((l) => l.source_type === 'USER');

    const bulkInfo = () => {
        const students = messageable.map((l) =>
            toStudentTable({
                userId: l.id,
                name: l.name,
                email: l.email,
                mobile: l.mobile,
                packageSessionId: l.package_session_id,
            })
        );
        return {
            selectedStudentIds: students.map((s) => s.user_id),
            selectedStudents: students,
            displayText: t('actions.learnersCount', { n: students.length }),
        };
    };

    const openMessage = (channel: 'whatsapp' | 'email') => {
        if (messageable.length === 0) {
            toast.error(t('actions.nobodyToMessage'));
            return;
        }
        if (channel === 'whatsapp') openBulkSendMessageDialog(bulkInfo());
        else openBulkSendEmailDialog(bulkInfo());
    };

    const exportCsv = () => {
        if (!row) return;
        const csv = buildCsv(
            [
                t('csv.name'),
                t('csv.email'),
                t('csv.mobile'),
                t('csv.batch'),
                t('csv.status'),
                t('csv.minutesInClass'),
                t('csv.talks'),
                t('csv.chats'),
                t('csv.hands'),
                t('csv.pollVotes'),
                t('csv.rating'),
                t('csv.feedback'),
                ...(showActiveness
                    ? [
                          t('csv.activeness'),
                          t('csv.activenessOnScreen'),
                          t('csv.activenessAttention'),
                          t('csv.activenessMinutesTracked'),
                          t('csv.activenessAwayCount'),
                          t('csv.activenessStatus'),
                      ]
                    : []),
            ],
            visible.map((l) => [
                learnerName(l, guestLabel),
                l.email,
                l.mobile,
                l.package_session_id ? batchLabel(l.package_session_id) : '',
                t(`drilldown.status.${l.status}`),
                l.seconds_in_class !== null ? Math.round(l.seconds_in_class / 60) : '',
                l.talks,
                l.chats,
                l.raise_hands,
                l.poll_votes,
                l.rating,
                l.answers.map((a) => `${a.label}: ${a.text}`).join(' | '),
                ...(showActiveness
                    ? [
                          l.activeness ?? '',
                          l.activeness_on_screen ?? '',
                          l.activeness_attention ?? '',
                          isNum(l.activeness_seconds) ? Math.round(l.activeness_seconds / 60) : '',
                          l.activeness_away_count ?? '',
                          activenessState(l, false) ?? '',
                      ]
                    : []),
            ])
        );
        downloadCsv(
            exportFileName(`class_${row.title ?? 'live'}`, row.meeting_date, row.meeting_date),
            csv
        );
    };

    return (
        <Sheet open={!!row} onOpenChange={(open) => !open && onClose()}>
            <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
                {row && (
                    <>
                        <div className="flex flex-col gap-4 border-b border-neutral-200 bg-gradient-to-br from-primary-50 via-white to-white p-5 pr-12">
                            <div className="flex flex-col gap-1">
                                <SheetTitle className="text-h3-semibold text-neutral-900">
                                    {row.title || t('table.untitled')}
                                </SheetTitle>
                                <SheetDescription className="text-body text-neutral-600">
                                    {[
                                        row.subject,
                                        formatMeetingDate(row.meeting_date),
                                        formatTimeRange(row.start_time, row.end_time),
                                        t(`platforms.names.${platformLabelKey(row.platform)}`),
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </SheetDescription>
                                {row.instructors.length > 0 && (
                                    <div className="mt-1 flex flex-wrap items-center gap-3">
                                        {row.instructors.map((ins) => (
                                            <span
                                                key={ins.user_id}
                                                className="flex items-center gap-2 text-body text-neutral-700"
                                            >
                                                <Avatar
                                                    id={ins.user_id}
                                                    name={instructorLabel(ins)}
                                                    className="size-7"
                                                />
                                                {instructorLabel(ins)}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <Stat
                                    label={t('drilldown.joined')}
                                    value={
                                        row.expected > 0
                                            ? `${formatCount(row.joined)} / ${formatCount(row.expected)}`
                                            : formatCount(row.joined)
                                    }
                                />
                                <Stat
                                    label={t('table.attendance')}
                                    value={formatRate(row.attendance_rate)}
                                />
                                <Stat
                                    label={t('table.avgTime')}
                                    value={formatDuration(row.avg_attended_minutes, units)}
                                />
                                <Stat
                                    label={t('table.feedback')}
                                    value={
                                        row.avg_rating !== null
                                            ? `${formatRating(row.avg_rating)} ★`
                                            : EMPTY_VALUE
                                    }
                                />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    className="gap-1.5 bg-white sm:min-w-0"
                                    onClick={() => openMessage('whatsapp')}
                                >
                                    <WhatsappLogo size={16} />
                                    {t('actions.whatsapp')}
                                </MyButton>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    className="gap-1.5 bg-white sm:min-w-0"
                                    onClick={() => openMessage('email')}
                                >
                                    <Envelope size={16} />
                                    {t('actions.email')}
                                </MyButton>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    className="gap-1.5 bg-white sm:min-w-0"
                                    onClick={exportCsv}
                                    disabled={visible.length === 0}
                                >
                                    <DownloadSimple size={16} />
                                    {t('actions.csv')}
                                </MyButton>
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="medium"
                                    className="ml-auto gap-1.5"
                                    onClick={() => onOpenFullPage(row)}
                                >
                                    {t('drilldown.openFull')}
                                    <ArrowSquareOut size={16} />
                                </MyButton>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 border-b border-neutral-100 px-5 py-3">
                            <Tabs
                                value={filter}
                                onValueChange={(v) => setFilter(v as LearnerFilter)}
                            >
                                <TabsList className="h-auto w-full flex-wrap justify-start">
                                    {FILTERS.map((f) => (
                                        <TabsTrigger
                                            key={f}
                                            value={f}
                                            className="gap-1 text-caption"
                                        >
                                            {t(`drilldown.filters.${f}`)}
                                            <span className="tabular-nums text-neutral-400">
                                                {counts[f]}
                                            </span>
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>
                            <div className="relative">
                                <MagnifyingGlass
                                    size={16}
                                    className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                                />
                                <MyInput
                                    input={search}
                                    inputPlaceholder={t('drilldown.search')}
                                    onChangeFunction={(e) => setSearch(e.target.value)}
                                    size="medium"
                                    className="w-full pl-9"
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 py-3">
                            {isLoading ? (
                                <div className="flex flex-col gap-3">
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <Skeleton key={i} className="h-16 rounded-lg" />
                                    ))}
                                </div>
                            ) : error ? (
                                <div className="flex flex-col items-center gap-3 py-10 text-center text-body text-neutral-600">
                                    {t('error.body')}
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="medium"
                                        onClick={() => refetch()}
                                    >
                                        {t('error.retry')}
                                    </MyButton>
                                </div>
                            ) : visible.length === 0 ? (
                                <EmptyChart className="h-32" text={t('drilldown.empty')} />
                            ) : (
                                <ul className="flex flex-col divide-y divide-neutral-100">
                                    {visible.map((l) => (
                                        <li
                                            key={`${l.source_type}-${l.id}`}
                                            className="flex flex-col gap-2 py-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <Avatar
                                                    id={l.id}
                                                    name={learnerName(l, guestLabel)}
                                                />
                                                <div className="flex min-w-0 flex-1 flex-col">
                                                    <span className="truncate text-body font-semibold text-neutral-900">
                                                        {learnerName(l, guestLabel)}
                                                    </span>
                                                    <span className="truncate text-caption text-neutral-500">
                                                        {l.source_type !== 'USER'
                                                            ? t('drilldown.guestNote')
                                                            : !l.expected
                                                              ? t('drilldown.notExpected')
                                                              : l.package_session_id
                                                                ? batchLabel(l.package_session_id)
                                                                : l.mobile || l.email || ''}
                                                    </span>
                                                </div>
                                                <span
                                                    className={cn(
                                                        'shrink-0 rounded-full px-2.5 py-1 text-caption font-semibold',
                                                        STATUS_PILL[l.status]
                                                    )}
                                                >
                                                    {t(`drilldown.status.${l.status}`)}
                                                </span>
                                                {l.source_type === 'USER' && (
                                                    <ContactCallButton
                                                        userId={l.id}
                                                        phone={l.mobile}
                                                        name={l.name}
                                                    />
                                                )}
                                            </div>
                                            {l.status !== 'NOT_JOINED' && (
                                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-12 text-caption text-neutral-600">
                                                    <Metric
                                                        icon={Clock}
                                                        label={t('drilldown.timeInClass')}
                                                        value={
                                                            l.seconds_in_class !== null
                                                                ? formatDuration(
                                                                      l.seconds_in_class / 60,
                                                                      units
                                                                  )
                                                                : EMPTY_VALUE
                                                        }
                                                    />
                                                    {l.talks !== null && (
                                                        <>
                                                            <Metric
                                                                icon={Microphone}
                                                                label={t('engagement.talks')}
                                                                value={formatCount(l.talks)}
                                                            />
                                                            <Metric
                                                                icon={ChatCircle}
                                                                label={t('engagement.chats')}
                                                                value={formatCount(l.chats)}
                                                            />
                                                            <Metric
                                                                icon={HandPalm}
                                                                label={t('engagement.raiseHands')}
                                                                value={formatCount(l.raise_hands)}
                                                            />
                                                        </>
                                                    )}
                                                    {showActiveness && (
                                                        <ActivenessChip
                                                            learner={l}
                                                            label={t('drilldown.activeness')}
                                                            detail={activenessDetail(l)}
                                                            stateLabel={activenessState(l, true)}
                                                        />
                                                    )}
                                                </div>
                                            )}
                                            {(l.rating !== null || l.answers.length > 0) && (
                                                <div className="ml-12 flex flex-col gap-1.5 rounded-lg bg-neutral-50 px-3 py-2">
                                                    {l.rating !== null && (
                                                        <Stars rating={l.rating} size={12} />
                                                    )}
                                                    {l.answers.map((a) => (
                                                        <p
                                                            key={a.question_id}
                                                            className="text-caption text-neutral-700"
                                                        >
                                                            <ChatText
                                                                size={12}
                                                                className="mr-1 inline text-neutral-400"
                                                                aria-hidden
                                                            />
                                                            <span className="text-neutral-500">
                                                                {a.label}:{' '}
                                                            </span>
                                                            {a.text}
                                                        </p>
                                                    ))}
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}
