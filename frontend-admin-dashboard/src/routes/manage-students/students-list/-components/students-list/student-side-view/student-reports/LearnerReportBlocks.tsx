import { ArrowDown, ArrowUp, Books, CalendarCheck, Exam, Medal } from '@phosphor-icons/react';
import {
    BloomPyramid,
    ReportBlock,
    ReportHero,
    StatTile,
    TopicColumn,
} from '@/components/common/report-visuals/blocks';
import {
    CompareBarChart,
    DonutChart,
    HorizontalBars,
    TopicRadar,
    TrendChart,
} from '@/components/common/report-visuals/charts';
import {
    EmptyReportIllustration,
    GrowthIllustration,
} from '@/components/common/report-visuals/illustrations';
import { REPORT_COLORS, pct, scoreColor } from '@/components/common/report-visuals/palette';
import type { LearnerReportModel } from './learner-report-model';

/**
 * The learner report blocks. The Reports tab stacks them in one column; the printable report
 * lays the same blocks out on A4 pages.
 */

const BlockEmpty = ({ brand, text }: { brand: string; text: string }) => (
    <div className="flex flex-col items-center gap-1 py-3 text-center">
        <EmptyReportIllustration brand={brand} className="w-24" />
        <span className="text-xs text-neutral-500">{text}</span>
    </div>
);

interface BlockProps {
    m: LearnerReportModel;
    brand: string;
    animate?: boolean;
}

export const LearnerHero = ({
    m,
    brand,
    compact,
    logo,
}: BlockProps & { compact?: boolean; logo?: { url?: string | null; name?: string | null } }) => (
    <ReportHero
        brand={brand}
        compact={compact}
        logo={logo}
        kicker={`${m.firstName}'s progress`}
        headline={m.headline}
        subline={m.subline || undefined}
        bigValue={m.average != null ? `${Math.round(m.average)}` : m.progress?.percent != null ? `${Math.round(m.progress.percent)}` : '—'}
        bigSuffix={m.average != null || m.progress?.percent != null ? '%' : undefined}
        bigCaption={
            m.average != null
                ? m.classAverage != null
                    ? `Class average ${pct(m.classAverage)}`
                    : 'Average score'
                : m.progress?.percent != null
                  ? 'Course completed'
                  : undefined
        }
        illustration={<GrowthIllustration brand={brand} className="h-auto w-full" />}
        track={
            m.aboveClassShare && m.aboveClassShare.of >= 2
                ? {
                      value: (m.aboveClassShare.above / m.aboveClassShare.of) * 100,
                      left: (
                          <>
                              Above the class in <b>{m.aboveClassShare.above}</b> of{' '}
                              {m.aboveClassShare.of} assessments
                          </>
                      ),
                  }
                : null
        }
    />
);

export const LearnerTiles = ({ m, narrow }: BlockProps & { narrow?: boolean }) => (
    <div className={narrow ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-4 gap-2'}>
        <StatTile
            value={m.assessmentsTaken}
            label="Assessments taken"
            icon={<Exam className="size-3.5" />}
        />
        <StatTile
            value={m.attendance ? pct(m.attendance.percent) : '—'}
            label="Attendance"
            color={m.attendance ? scoreColor(m.attendance.percent) : REPORT_COLORS.muted}
            icon={<CalendarCheck className="size-3.5" />}
        />
        <StatTile
            value={m.progress ? pct(m.progress.percent) : '—'}
            label="Course progress"
            color={m.progress ? scoreColor(m.progress.percent) : REPORT_COLORS.muted}
            icon={<Books className="size-3.5" />}
        />
        <StatTile
            value={m.strengths.length}
            label={m.topicsMastered > 0 ? `Strong topics · ${m.topicsMastered} mastered` : 'Strong topics'}
            color={REPORT_COLORS.good}
            icon={<Medal className="size-3.5" />}
        />
    </div>
);

export const SubjectsBlock = ({ m, brand, animate }: BlockProps) => {
    if (m.subjects.length === 0) {
        return (
            <ReportBlock brand={brand} tag="Marks by subject" title="No graded work yet">
                <BlockEmpty brand={brand} text="Subject scores appear once assessments are graded." />
            </ReportBlock>
        );
    }
    const above = m.subjects.filter((s) => s.klass != null && (s.you ?? 0) > s.klass).length;
    const withClass = m.subjects.filter((s) => s.klass != null).length;
    return (
        <ReportBlock
            brand={brand}
            tag="Marks by subject"
            title={
                withClass > 0
                    ? `Above the class in ${above} of ${withClass} subjects`
                    : `Best in ${m.subjects[0]?.name}`
            }
            lede="Each bar is the share of marks scored in that subject's graded work."
        >
            <CompareBarChart data={m.subjects} brand={brand} animate={animate} />
        </ReportBlock>
    );
};

export const TrendBlock = ({ m, brand, animate }: BlockProps) => {
    if (m.trend.length === 0) {
        return (
            <ReportBlock brand={brand} tag="Score trend" title="No assessments yet">
                <BlockEmpty brand={brand} text="Each assessment taken adds a point here." />
            </ReportBlock>
        );
    }
    const first = m.trend[0]?.you ?? 0;
    const last = m.trend[m.trend.length - 1]?.you ?? 0;
    const delta = Math.round(last - first);
    return (
        <ReportBlock
            brand={brand}
            tag="Score trend"
            title={
                delta >= 5
                    ? `Up ${delta} points from the first assessment`
                    : delta <= -5
                      ? `Down ${-delta} points from the first assessment`
                      : 'Steady across assessments'
            }
            lede="Score in each assessment, in date order."
        >
            <TrendChart data={m.trend} brand={brand} animate={animate} />
        </ReportBlock>
    );
};

export const TopicsBlock = ({ m, brand, animate }: BlockProps) => {
    if (m.strengths.length === 0 && m.weaknesses.length === 0) {
        return (
            <ReportBlock brand={brand} tag="Strengths and weaknesses" title="No analysed attempts yet">
                <BlockEmpty
                    brand={brand}
                    text="Topic strengths appear once assessment attempts are analysed."
                />
            </ReportBlock>
        );
    }
    const title =
        m.topicsMastered > 0
            ? `${m.topicsMastered} topic${m.topicsMastered === 1 ? '' : 's'} mastered, ${m.weaknesses.length} to work on`
            : `${m.strengths.length} strong, ${m.weaknesses.length} to work on`;
    return (
        <ReportBlock
            brand={brand}
            tag="Strengths and weaknesses"
            title={title}
            lede="Questions right in each topic across analysed assessments. 60% or above is a strength."
        >
            {m.radar.length >= 3 && <TopicRadar data={m.radar} brand={brand} animate={animate} />}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TopicColumn
                    title="Strengths"
                    icon={<ArrowUp className="size-4 text-success-600" weight="bold" />}
                    rows={m.strengths}
                    brand={brand}
                    empty="No topic at 60% or above yet."
                    expandable={animate !== false}
                />
                <TopicColumn
                    title="Needs work"
                    icon={<ArrowDown className="size-4 text-danger-600" weight="bold" />}
                    rows={m.weaknesses}
                    brand={brand}
                    empty="No topic below 60%."
                    expandable={animate !== false}
                />
            </div>
        </ReportBlock>
    );
};

export const AttendanceBlock = ({ m, brand, animate }: BlockProps) => {
    if (!m.attendance) {
        return (
            <ReportBlock brand={brand} tag="Attendance" title="No classes in these dates">
                <BlockEmpty brand={brand} text="Live class attendance shows up here." />
            </ReportBlock>
        );
    }
    const a = m.attendance;
    return (
        <ReportBlock
            brand={brand}
            tag="Attendance"
            title={`Present in ${a.slices[0]?.value ?? 0} of ${a.total} classes`}
        >
            <DonutChart
                data={a.slices}
                centerValue={pct(a.percent)}
                centerLabel="attended"
                animate={animate}
            />
            {m.weeklyAttendance.length >= 2 && (
                <div className="flex flex-col gap-1 border-t border-neutral-100 pt-3">
                    <span className="text-xs font-semibold text-neutral-500">Week by week</span>
                    <div className="flex h-20 items-end gap-1">
                        {m.weeklyAttendance.slice(-12).map((w) => (
                            <div
                                key={w.week}
                                className="flex flex-1 flex-col items-center gap-0.5"
                                title={`${w.week}: ${pct(w.percentage)}`}
                            >
                                <div
                                    className="w-full rounded-t"
                                    style={{
                                        height: `${Math.max(4, ((w.percentage ?? 0) / 100) * 64)}px`,
                                        background: scoreColor(w.percentage),
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </ReportBlock>
    );
};

export const ProgressBlock = ({ m, brand }: BlockProps) => {
    if (!m.progress || m.progress.subjects.length === 0) {
        return (
            <ReportBlock brand={brand} tag="Course progress" title="No course progress yet">
                <BlockEmpty brand={brand} text="Pick a batch to see progress through its course." />
            </ReportBlock>
        );
    }
    return (
        <ReportBlock
            brand={brand}
            tag="Course progress"
            title={`${pct(m.progress.percent)} of the course completed`}
            lede="Completion and study time in each subject."
        >
            <HorizontalBars
                color={brand}
                rows={m.progress.subjects.map((s) => ({
                    key: s.subject,
                    label: s.subject,
                    value: s.completion,
                    display: pct(s.completion),
                    sub: s.hours != null ? `${Math.round(s.hours * 10) / 10} h` : undefined,
                }))}
            />
        </ReportBlock>
    );
};

export const ThinkingBlock = ({ m, brand, animate }: BlockProps) => {
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ReportBlock
                brand={brand}
                tag="Bloom's taxonomy"
                title="Thinking skills"
                lede="Each question is tagged with the kind of thinking it needs."
            >
                {m.blooms.length > 0 ? (
                    <BloomPyramid levels={m.blooms} />
                ) : (
                    <BlockEmpty brand={brand} text="Needs analysed assessment attempts." />
                )}
            </ReportBlock>
            {m.confidence ? (
                <ReportBlock
                    brand={brand}
                    tag="Confidence"
                    title="How sure the answers were"
                    lede="Confidently wrong answers point to misconceptions worth a conversation."
                >
                    <DonutChart
                        data={m.confidence}
                        centerValue={String(m.confidence.reduce((s, d) => s + d.value, 0))}
                        centerLabel="answers"
                        size={130}
                        legend="below"
                        animate={animate}
                    />
                </ReportBlock>
            ) : (
                <ReportBlock brand={brand} tag="Confidence" title="How sure the answers were">
                    <BlockEmpty brand={brand} text="Needs analysed assessment attempts." />
                </ReportBlock>
            )}
        </div>
    );
};
