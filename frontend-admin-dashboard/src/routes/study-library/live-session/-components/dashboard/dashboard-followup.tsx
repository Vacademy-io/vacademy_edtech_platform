import { useMemo, useState } from 'react';
import {
    ChatsTeardrop,
    DownloadSimple,
    Envelope,
    Quotes,
    WarningDiamond,
    WhatsappLogo,
} from '@phosphor-icons/react';
import { format, parse } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContactCallButton } from '@/components/shared/telephony/contact-call-button';
import { cn } from '@/lib/utils';
import { useDialogStore } from '@/routes/manage-students/students-list/-hooks/useDialogStore';
import { buildCsv, downloadCsv } from '../../feedback/-utils/csv';
import {
    useAtRiskLearners,
    useFeedbackWall,
    type AtRiskView,
    type DashboardAtRiskLearner,
    type DashboardFeedbackComment,
    type LiveClassDashboardParams,
} from '../../-services/live-class-dashboard';
import { formatCount, formatRate, formatRating, rateTone } from '../../-utils/dashboard-format';
import { exportFileName, toStudentTable } from '../../-utils/dashboard-export';
import { isDoubt } from '../../-utils/dashboard-insights';
import { EmptyChart, SectionCard } from './dashboard-charts';
import { Avatar } from './dashboard-highlights';
import { Stars } from './dashboard-kpis';
import { instructorNames } from './dashboard-tables';

const METER_TONE = {
    success: '[&>div]:bg-success-500',
    warning: '[&>div]:bg-warning-500',
    danger: '[&>div]:bg-danger-500',
    neutral: '[&>div]:bg-neutral-300',
} as const;

const formatDay = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = parse(iso, 'yyyy-MM-dd', new Date());
    return Number.isNaN(d.getTime()) ? iso : format(d, 'dd MMM');
};

// ─── Learners at risk ───────────────────────────────────────────────────────

const MIN_MISSED_OPTIONS = [3, 5, 10] as const;
// Stopped coming first: learners who were attending and dropped off are the
// most recoverable, and "never came" would otherwise crowd them out of the list.
const AT_RISK_VIEWS: AtRiskView[] = ['DROPPED', 'NEVER', 'ALL'];

export function AtRiskCard({
    params,
    batchLabel,
    classesTerm,
}: {
    params: LiveClassDashboardParams;
    batchLabel: (id: string) => string;
    classesTerm: string;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const [minMissed, setMinMissed] = useState<number>(3);
    const [view, setView] = useState<AtRiskView>('DROPPED');
    const { data, isLoading, isFetching, error, refetch } = useAtRiskLearners(
        params,
        minMissed,
        view
    );
    const { openBulkSendMessageDialog, openBulkSendEmailDialog } = useDialogStore();
    const learners = data?.learners ?? [];

    const bulkInfo = () => {
        const students = learners.map((l) =>
            toStudentTable({
                userId: l.user_id,
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
        if (learners.length === 0) {
            toast.error(t('actions.nobodyToMessage'));
            return;
        }
        if (channel === 'whatsapp') openBulkSendMessageDialog(bulkInfo());
        else openBulkSendEmailDialog(bulkInfo());
    };
    const exportCsv = () => {
        const csv = buildCsv(
            [
                t('csv.name'),
                t('csv.email'),
                t('csv.mobile'),
                t('csv.batch'),
                t('csv.expected'),
                t('csv.attended'),
                t('csv.missed'),
                t('csv.attendance'),
                t('csv.missStreak'),
                t('csv.lastAttended'),
            ],
            learners.map((l) => [
                l.name,
                l.email,
                l.mobile,
                l.package_session_id ? batchLabel(l.package_session_id) : '',
                l.expected,
                l.attended,
                l.missed,
                l.attendance_rate !== null ? Math.round(l.attendance_rate * 100) : '',
                l.miss_streak,
                l.last_attended ?? '',
            ])
        );
        downloadCsv(exportFileName('at-risk-learners', params.startDate, params.endDate), csv);
    };

    const subtitle = data
        ? data.total > 0
            ? t(`atRisk.subtitles.${data.view ?? 'ALL'}`, {
                  n: formatCount(data.total),
                  missed: data.min_missed,
                  term: classesTerm.toLowerCase(),
              })
            : t('atRisk.none', { missed: data.min_missed, term: classesTerm.toLowerCase() })
        : t('atRisk.loading');

    return (
        <SectionCard
            icon={WarningDiamond}
            title={t('atRisk.title')}
            subtitle={subtitle}
            className="xl:col-span-2"
            right={
                <Tabs value={String(minMissed)} onValueChange={(v) => setMinMissed(Number(v))}>
                    <TabsList className="h-auto" aria-label={t('atRisk.threshold')}>
                        {MIN_MISSED_OPTIONS.map((n) => (
                            <TabsTrigger key={n} value={String(n)} className="text-caption">
                                {t('atRisk.missedPlus', { n })}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            }
        >
            <div className="mb-3 flex flex-wrap items-center gap-2" data-print-hide>
                <Tabs value={view} onValueChange={(v) => setView(v as AtRiskView)}>
                    <TabsList className="h-auto" aria-label={t('atRisk.viewLabel')}>
                        {AT_RISK_VIEWS.map((v) => (
                            <TabsTrigger key={v} value={v} className="text-caption">
                                {t(`atRisk.views.${v}`)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    className="gap-1.5 sm:min-w-0"
                    onClick={() => openMessage('whatsapp')}
                    disabled={learners.length === 0}
                >
                    <WhatsappLogo size={16} />
                    {t('atRisk.messageAll', { n: learners.length })}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    className="gap-1.5 sm:min-w-0"
                    onClick={() => openMessage('email')}
                    disabled={learners.length === 0}
                >
                    <Envelope size={16} />
                    {t('actions.email')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    className="gap-1.5 sm:min-w-0"
                    onClick={exportCsv}
                    disabled={learners.length === 0}
                >
                    <DownloadSimple size={16} />
                    {t('actions.csv')}
                </MyButton>
                {data && data.total > learners.length && (
                    <span className="text-caption text-neutral-500">
                        {t('atRisk.showingTop', {
                            shown: learners.length,
                            total: formatCount(data.total),
                        })}
                    </span>
                )}
            </div>
            {isLoading ? (
                <div className="flex flex-col gap-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-14 rounded-lg" />
                    ))}
                </div>
            ) : error ? (
                <div className="flex flex-col items-center gap-3 py-8 text-body text-neutral-600">
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
            ) : learners.length === 0 ? (
                <EmptyChart
                    className="h-40"
                    text={t('atRisk.none', {
                        missed: minMissed,
                        term: classesTerm.toLowerCase(),
                    })}
                />
            ) : (
                <ul
                    className={cn(
                        '-mx-2 flex max-h-96 flex-col overflow-y-auto transition-opacity',
                        isFetching && 'opacity-60'
                    )}
                >
                    {learners.map((l) => (
                        <AtRiskRow key={l.user_id} learner={l} batchLabel={batchLabel} />
                    ))}
                </ul>
            )}
        </SectionCard>
    );
}

function AtRiskRow({
    learner: l,
    batchLabel,
}: {
    learner: DashboardAtRiskLearner;
    batchLabel: (id: string) => string;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const tone = rateTone(l.attendance_rate);
    return (
        <li className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-neutral-50">
            <Avatar id={l.user_id} name={l.name || l.email} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-body font-semibold text-neutral-900">
                        {l.name || l.email || l.mobile || l.user_id}
                    </span>
                    <span className="shrink-0 text-body font-semibold tabular-nums text-danger-600">
                        {t('atRisk.missedOf', { missed: l.missed, expected: l.expected })}
                    </span>
                </div>
                <Progress
                    value={(l.attendance_rate ?? 0) * 100}
                    className={cn('h-1.5 !bg-neutral-100', METER_TONE[tone])}
                    aria-hidden
                />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-neutral-500">
                    {l.package_session_id && (
                        <span className="truncate">{batchLabel(l.package_session_id)}</span>
                    )}
                    <span className={cn(l.miss_streak >= 3 && 'font-semibold text-danger-600')}>
                        {t('atRisk.streak', { n: l.miss_streak })}
                    </span>
                    <span>
                        {l.last_attended
                            ? t('atRisk.lastAttended', { date: formatDay(l.last_attended) })
                            : t('atRisk.neverAttended')}
                    </span>
                    <span>{t('atRisk.rate', { rate: formatRate(l.attendance_rate) })}</span>
                </div>
            </div>
            <ContactCallButton userId={l.user_id} phone={l.mobile} name={l.name} />
        </li>
    );
}

// ─── Feedback wall ──────────────────────────────────────────────────────────

type WallFilter = 'all' | 'low' | 'doubts';
const WALL_FILTERS: WallFilter[] = ['all', 'low', 'doubts'];
const WALL_PAGE = 9;

export function FeedbackWall({
    params,
    classesTerm,
    onOpenClass,
}: {
    params: LiveClassDashboardParams;
    classesTerm: string;
    onOpenClass: (scheduleId: string, sessionId: string) => void;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const [filter, setFilter] = useState<WallFilter>('all');
    const [showAll, setShowAll] = useState(false);
    const { data, isLoading, error, refetch } = useFeedbackWall(params);

    const counts = useMemo(() => {
        const all = data ?? [];
        return {
            all: all.length,
            low: all.filter((c) => c.rating !== null && c.rating <= 3).length,
            doubts: all.filter(isDoubt).length,
        };
    }, [data]);

    const filtered = useMemo(() => {
        const all = data ?? [];
        if (filter === 'low') return all.filter((c) => c.rating !== null && c.rating <= 3);
        if (filter === 'doubts') return all.filter(isDoubt);
        return all;
    }, [data, filter]);
    const visible = showAll ? filtered : filtered.slice(0, WALL_PAGE);

    return (
        <SectionCard
            icon={ChatsTeardrop}
            title={t('wall.title')}
            subtitle={t('wall.subtitle', { term: classesTerm.toLowerCase() })}
            right={
                <Tabs
                    value={filter}
                    onValueChange={(v) => {
                        setFilter(v as WallFilter);
                        setShowAll(false);
                    }}
                >
                    <TabsList className="h-auto">
                        {WALL_FILTERS.map((f) => (
                            <TabsTrigger key={f} value={f} className="gap-1 text-caption">
                                {t(`wall.filters.${f}`)}
                                <span className="tabular-nums text-neutral-400">{counts[f]}</span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            }
        >
            {isLoading ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-40 rounded-xl" />
                    ))}
                </div>
            ) : error ? (
                <div className="flex flex-col items-center gap-3 py-8 text-body text-neutral-600">
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
                <EmptyChart className="h-32" text={t('wall.empty')} />
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {visible.map((c) => (
                            <CommentCard
                                key={`${c.schedule_id}-${c.user_id}`}
                                comment={c}
                                onOpen={() => onOpenClass(c.schedule_id, c.session_id)}
                            />
                        ))}
                    </div>
                    {filtered.length > WALL_PAGE && (
                        <div className="mt-4 flex justify-center" data-print-hide>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => setShowAll((v) => !v)}
                            >
                                {showAll
                                    ? t('wall.showLess')
                                    : t('wall.showMore', { n: filtered.length - WALL_PAGE })}
                            </MyButton>
                        </div>
                    )}
                </>
            )}
        </SectionCard>
    );
}

function CommentCard({
    comment: c,
    onOpen,
}: {
    comment: DashboardFeedbackComment;
    onOpen: () => void;
}) {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const low = c.rating !== null && c.rating <= 3;
    return (
        <Card
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
            className={cn(
                'flex cursor-pointer break-inside-avoid flex-col gap-3 rounded-xl border-neutral-200 p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                low && 'border-danger-100 bg-danger-50'
            )}
        >
            <div className="flex items-center justify-between gap-2">
                {c.rating !== null ? (
                    <span className="flex items-center gap-2">
                        <Stars rating={c.rating} size={14} />
                        <span className="text-caption font-semibold text-neutral-700">
                            {formatRating(c.rating)}
                        </span>
                    </span>
                ) : (
                    <span />
                )}
                <Quotes size={20} weight="fill" className="text-primary-200" aria-hidden />
            </div>
            <div className="flex flex-col gap-2">
                {c.answers.map((a) => (
                    <div key={a.question_id} className="flex flex-col">
                        <span className="text-caption text-neutral-500">{a.label}</span>
                        <p className="line-clamp-4 whitespace-pre-line text-body text-neutral-800">
                            {a.text}
                        </p>
                    </div>
                ))}
            </div>
            <div className="mt-auto flex items-center gap-2 border-t border-neutral-100 pt-3">
                <Avatar id={c.user_id} name={c.learner_name} className="size-7" />
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-caption font-semibold text-neutral-800">
                        {c.learner_name || t('wall.anonymous')}
                    </span>
                    <span className="truncate text-caption text-neutral-500">
                        {[c.title, formatDay(c.meeting_date), instructorNames(c.instructors)]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                </div>
            </div>
        </Card>
    );
}
