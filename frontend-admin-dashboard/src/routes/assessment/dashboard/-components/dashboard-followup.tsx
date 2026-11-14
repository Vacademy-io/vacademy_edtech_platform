import { useMemo, useState } from 'react';
import { DownloadSimple, Envelope, WarningDiamond, WhatsappLogo } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContactCallButton } from '@/components/shared/telephony/contact-call-button';
import { cn } from '@/lib/utils';
import { useDialogStore } from '@/routes/manage-students/students-list/-hooks/useDialogStore';
import { buildCsv, downloadCsv } from '@/routes/study-library/live-session/feedback/-utils/csv';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { Avatar } from '@/routes/study-library/live-session/-components/dashboard/dashboard-highlights';
import {
    exportFileName,
    toStudentTable,
} from '@/routes/study-library/live-session/-utils/dashboard-export';
import {
    formatCount,
    formatRate,
    rateTone,
} from '@/routes/study-library/live-session/-utils/dashboard-format';
import type {
    AssessmentDashboardData,
    AssessmentLearnerStats,
} from '../-services/assessment-dashboard';
import { METER_TONE, TONE_TEXT } from './dashboard-highlights';

type View = 'missed' | 'low';
const MIN_MISSED_OPTIONS = [1, 2, 3] as const;

const formatDay = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : format(d, 'dd MMM');
};

/**
 * Who needs a nudge: learners who skipped closed tests (most skipped first), or
 * who are averaging below the low-score line. Message them in bulk, call one,
 * or take the list away as CSV.
 */
export function FollowUpCard({
    data,
    batchLabel,
    learnersTerm,
}: {
    data: AssessmentDashboardData;
    batchLabel: (id: string) => string;
    learnersTerm: string;
}) {
    const { t } = useTranslation('assessmentDashboard');
    const [view, setView] = useState<View>('missed');
    const [minMissed, setMinMissed] = useState<number>(1);
    const { openBulkSendMessageDialog, openBulkSendEmailDialog } = useDialogStore();

    const learners = useMemo(
        () =>
            view === 'missed'
                ? data.missed_learners.filter((l) => l.missed_tests >= minMissed)
                : data.low_scorers,
        [view, minMissed, data.missed_learners, data.low_scorers]
    );
    const total =
        view === 'missed'
            ? data.missed_counts[String(minMissed)] ?? learners.length
            : data.low_scorers_total;
    const lowLine = formatRate(data.low_score_below);

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
            displayText: t('followUp.learnersCount', { n: students.length }),
        };
    };
    const openMessage = (channel: 'whatsapp' | 'email') => {
        if (learners.length === 0) {
            toast.error(t('followUp.nobody'));
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
                t('csv.testsSet'),
                t('csv.testsTaken'),
                t('csv.testsMissed'),
                t('csv.testsScored'),
                t('csv.avgScore'),
                t('csv.bestScore'),
                t('csv.lastSubmitted'),
            ],
            learners.map((l) => [
                l.name,
                l.email,
                l.mobile,
                l.package_session_id ? batchLabel(l.package_session_id) : '',
                l.expected_tests,
                l.attempted_tests,
                l.missed_tests,
                l.scored_tests,
                l.avg_score !== null ? Math.round(l.avg_score * 100) : '',
                l.best_score !== null ? Math.round(l.best_score * 100) : '',
                l.last_submitted_at ?? '',
            ])
        );
        downloadCsv(
            exportFileName(
                view === 'missed' ? 'learners-missed-tests' : 'learners-low-scores',
                data.start_date,
                data.end_date
            ),
            csv
        );
    };

    const subtitle =
        view === 'missed'
            ? total > 0
                ? t('followUp.missedSubtitle', { n: formatCount(total), missed: minMissed })
                : t('followUp.missedNone', { missed: minMissed })
            : total > 0
              ? t('followUp.lowSubtitle', { n: formatCount(total), line: lowLine })
              : t('followUp.lowNone', { line: lowLine });

    return (
        <SectionCard
            icon={WarningDiamond}
            title={t('followUp.title', { term: learnersTerm })}
            subtitle={subtitle}
            className="xl:col-span-2"
            right={
                <Tabs value={view} onValueChange={(v) => setView(v as View)}>
                    <TabsList className="h-auto" aria-label={t('followUp.viewLabel')}>
                        <TabsTrigger value="missed" className="text-caption">
                            {t('followUp.views.missed')}
                        </TabsTrigger>
                        <TabsTrigger value="low" className="text-caption">
                            {t('followUp.views.low')}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            }
        >
            <div className="mb-3 flex flex-wrap items-center gap-2" data-print-hide>
                {view === 'missed' && (
                    <Tabs value={String(minMissed)} onValueChange={(v) => setMinMissed(Number(v))}>
                        <TabsList className="h-auto" aria-label={t('followUp.threshold')}>
                            {MIN_MISSED_OPTIONS.map((n) => (
                                <TabsTrigger key={n} value={String(n)} className="text-caption">
                                    {t('followUp.missedPlus', { n })}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                )}
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    className="gap-1.5 sm:min-w-0"
                    onClick={() => openMessage('whatsapp')}
                    disabled={learners.length === 0}
                >
                    <WhatsappLogo size={16} />
                    {t('followUp.messageAll', { n: learners.length })}
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
                    {t('followUp.email')}
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
                    {t('followUp.csv')}
                </MyButton>
                {total > learners.length && (
                    <span className="text-caption text-neutral-500">
                        {t('followUp.showingTop', {
                            shown: learners.length,
                            total: formatCount(total),
                        })}
                    </span>
                )}
            </div>
            {learners.length === 0 ? (
                <EmptyChart
                    className="h-40"
                    text={
                        view === 'missed'
                            ? t('followUp.missedNone', { missed: minMissed })
                            : t('followUp.lowNone', { line: lowLine })
                    }
                />
            ) : (
                <ul className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
                    {learners.map((l) => (
                        <FollowUpRow
                            key={l.user_id}
                            learner={l}
                            view={view}
                            batchLabel={batchLabel}
                        />
                    ))}
                </ul>
            )}
        </SectionCard>
    );
}

function FollowUpRow({
    learner: l,
    view,
    batchLabel,
}: {
    learner: AssessmentLearnerStats;
    view: View;
    batchLabel: (id: string) => string;
}) {
    const { t } = useTranslation('assessmentDashboard');
    const meter = view === 'missed' ? l.attempt_rate : l.avg_score;
    const tone = rateTone(meter);
    const last = formatDay(l.last_submitted_at);
    return (
        <li className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-neutral-50">
            <Avatar id={l.user_id} name={l.name || l.email} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-body font-semibold text-neutral-900">
                        {l.name || l.email || l.mobile || l.user_id}
                    </span>
                    <span
                        className={cn(
                            'shrink-0 text-body font-semibold tabular-nums',
                            view === 'missed' ? 'text-danger-600' : TONE_TEXT[tone]
                        )}
                    >
                        {view === 'missed'
                            ? t('followUp.missedOf', {
                                  missed: l.missed_tests,
                                  expected: l.expected_tests,
                              })
                            : formatRate(l.avg_score)}
                    </span>
                </div>
                <Progress
                    value={Math.max(0, (meter ?? 0) * 100)}
                    className={cn('h-1.5 !bg-neutral-100', METER_TONE[tone])}
                    aria-hidden
                />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-neutral-500">
                    {l.package_session_id && (
                        <span className="truncate">{batchLabel(l.package_session_id)}</span>
                    )}
                    {view === 'missed' ? (
                        <span>{t('followUp.took', { rate: formatRate(l.attempt_rate) })}</span>
                    ) : (
                        <span>{t('followUp.scoredTests', { count: l.scored_tests })}</span>
                    )}
                    {l.avg_score !== null && view === 'missed' && (
                        <span>{t('followUp.avg', { avg: formatRate(l.avg_score) })}</span>
                    )}
                    <span>
                        {last
                            ? t('followUp.lastSubmitted', { date: last })
                            : t('followUp.neverSubmitted')}
                    </span>
                </div>
            </div>
            <ContactCallButton userId={l.user_id} phone={l.mobile} name={l.name} />
        </li>
    );
}
