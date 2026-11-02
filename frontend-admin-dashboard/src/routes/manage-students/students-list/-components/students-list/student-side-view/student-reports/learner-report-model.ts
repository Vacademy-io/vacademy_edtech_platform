import { format } from 'date-fns';
import type { CompareRow, DonutSlice, TrendPoint } from '@/components/common/report-visuals/charts';
import { REPORT_COLORS } from '@/components/common/report-visuals/palette';
import {
    STRENGTH_THRESHOLD,
    type StudentReportSnapshot,
    type TopicMastery,
} from '@/services/student-report-snapshot';

/**
 * Everything the learner report draws, derived once from the snapshot so the Reports tab and
 * the printable report always agree.
 */
export interface LearnerReportModel {
    studentName: string;
    firstName: string;
    average: number | null;
    classAverage: number | null;
    headline: string;
    subline: string;
    assessmentsTaken: number;
    subjects: CompareRow[];
    trend: TrendPoint[];
    strengths: TopicMastery[];
    weaknesses: TopicMastery[];
    radar: { topic: string; accuracy: number }[];
    topicsMastered: number;
    attendance: { percent: number | null; slices: DonutSlice[]; total: number } | null;
    weeklyAttendance: { week: string; percentage: number | null }[];
    progress: { percent: number | null; subjects: { subject: string; completion: number | null; hours: number | null }[] } | null;
    blooms: NonNullable<NonNullable<StudentReportSnapshot['learning_insights']>['blooms']>;
    confidence: DonutSlice[] | null;
    /** Share of assessments where the learner beat the class average, when known. */
    aboveClassShare: { above: number; of: number } | null;
    summary: string;
    hasAnything: boolean;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const norm = (s: string) => s.trim().toLowerCase();

/** Topics at or above the cut-off are strengths (best first); below it, weaknesses (weakest first). */
export const splitStrengths = (topics: TopicMastery[]) => {
    const scored = topics.filter((t) => t.accuracy != null && t.questions > 0);
    const strengths = scored
        .filter((t) => (t.accuracy ?? 0) >= STRENGTH_THRESHOLD)
        .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));
    const weaknesses = scored
        .filter((t) => (t.accuracy ?? 0) < STRENGTH_THRESHOLD)
        .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));
    return { strengths, weaknesses };
};

const headlineFor = (avg: number | null, klass: number | null, progress: number | null) => {
    if (avg == null) {
        if (progress != null) return progress >= 75 ? 'Great progress through the course' : 'Learning journey so far';
        return 'Learning journey so far';
    }
    if (klass != null) {
        if (avg >= klass + 10) return 'Well above the class average';
        if (avg >= klass) return 'Above the class average';
        return "Let's climb higher next time";
    }
    if (avg >= 85) return 'Excellent work!';
    if (avg >= 60) return 'Good work';
    return "Let's build on this";
};

const joinAnd = (items: string[]) =>
    items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export const buildLearnerReport = (
    s: StudentReportSnapshot,
    fallbackName?: string | null
): LearnerReportModel => {
    const studentName = s.student?.name || fallbackName || 'Learner';
    const firstName = studentName.split(/\s+/)[0] ?? studentName;
    const academics = s.academics;
    const average = academics?.average_percentage ?? null;
    const classAverage = academics?.class_average_percentage ?? null;

    // Subjects: graded marks by subject, with the class average from assessments when present.
    const classBySubject = new Map(
        (academics?.subject_performance ?? []).map((p) => [norm(p.subject), p])
    );
    let subjects: CompareRow[] = (s.subject_marks?.subjects ?? [])
        .filter((m) => m.subject && m.percentage != null)
        .map((m) => ({
            name: m.subject,
            you: round1(m.percentage ?? 0),
            klass: classBySubject.get(norm(m.subject))?.class_average ?? null,
        }));
    if (subjects.length === 0) {
        subjects = (academics?.subject_performance ?? [])
            .filter((p) => p.score_percentage != null)
            .map((p) => ({ name: p.subject, you: round1(p.score_percentage ?? 0), klass: p.class_average }));
    }
    subjects.sort((a, b) => (b.you ?? -1) - (a.you ?? -1));

    const assessments = (academics?.assessments ?? []).filter((a) => a.percentage != null);
    const trend: TrendPoint[] = assessments.map((a) => ({
        label: a.name || 'Assessment',
        sub: a.date && !Number.isNaN(new Date(a.date).getTime()) ? format(new Date(a.date), 'd MMM') : undefined,
        you: round1(a.percentage ?? 0),
        klass:
            a.class_average != null && a.total_marks
                ? round1((a.class_average / a.total_marks) * 100)
                : null,
    }));
    const compared = trend.filter((t) => t.klass != null);
    const aboveClassShare =
        compared.length > 0
            ? { above: compared.filter((t) => (t.you ?? 0) > (t.klass ?? 0)).length, of: compared.length }
            : null;

    const topics = s.learning_insights?.topic_mastery ?? [];
    const { strengths, weaknesses } = splitStrengths(topics);
    const radar = [...strengths, ...weaknesses]
        .slice(0, 10)
        .map((t) => ({ topic: t.topic, accuracy: round1(t.accuracy ?? 0) }));
    const topicsMastered = topics.filter((t) => (t.accuracy ?? 0) >= 99.5 && t.questions > 0).length;

    const att = s.attendance;
    const attendance =
        att?.available && (att.total_sessions ?? 0) > 0
            ? {
                  percent: att.overall_percentage ?? null,
                  total: att.total_sessions ?? 0,
                  slices: [
                      { label: 'Present', value: att.present ?? 0, color: REPORT_COLORS.good },
                      ...((att.late ?? 0) > 0
                          ? [{ label: 'Late', value: att.late ?? 0, color: REPORT_COLORS.warn }]
                          : []),
                      { label: 'Absent', value: att.absent ?? 0, color: REPORT_COLORS.bad },
                  ],
              }
            : null;

    const cp = s.course_progress;
    const progress = cp?.available
        ? {
              percent: cp.overall_completion_percentage ?? null,
              subjects: (cp.subjects ?? []).map((x) => ({
                  subject: x.subject,
                  completion: x.completion_percentage ?? null,
                  hours: x.time_hours ?? null,
              })),
          }
        : null;

    const conf = s.learning_insights?.confidence;
    const confidence =
        conf && (conf.knows ?? 0) + (conf.guesses ?? 0) + (conf.high_confidence_wrong ?? 0) > 0
            ? [
                  { label: 'Knew it', value: conf.knows ?? 0, color: REPORT_COLORS.good },
                  { label: 'Right but unsure', value: conf.guesses ?? 0, color: REPORT_COLORS.warn },
                  {
                      label: 'Confidently wrong',
                      value: conf.high_confidence_wrong ?? 0,
                      color: REPORT_COLORS.bad,
                  },
              ]
            : null;

    // Subline and summary are plain facts, no AI.
    const best = subjects[0];
    const worst = subjects.length > 1 ? subjects[subjects.length - 1] : undefined;
    const sub: string[] = [];
    if (best?.you != null) sub.push(`Strongest in ${best.name} (${Math.round(best.you)}%).`);
    if (worst?.you != null && worst.you < 50) sub.push(`${worst.name} needs the most attention.`);
    const subline = sub.join(' ');

    const summary: string[] = [];
    if (assessments.length > 0) {
        summary.push(
            `${firstName} took ${assessments.length} assessment${assessments.length === 1 ? '' : 's'} in this period` +
                (average != null ? ` with an average of ${round1(average)}%` : '') +
                (classAverage != null ? ` against a class average of ${round1(classAverage)}%.` : '.')
        );
    }
    if (strengths.length > 0) {
        summary.push(`Strong topics: ${joinAnd(strengths.slice(0, 3).map((t) => t.topic))}.`);
    }
    if (weaknesses.length > 0) {
        summary.push(`To work on: ${joinAnd(weaknesses.slice(0, 3).map((t) => t.topic))}.`);
    }
    if (attendance?.percent != null) {
        summary.push(`Attended ${round1(attendance.percent)}% of ${attendance.total} classes.`);
    }
    if (progress?.percent != null) {
        summary.push(`Completed ${round1(progress.percent)}% of the course.`);
    }

    return {
        studentName,
        firstName,
        average,
        classAverage,
        headline: headlineFor(average, classAverage, progress?.percent ?? null),
        subline,
        assessmentsTaken: academics?.assessments?.length ?? 0,
        subjects,
        trend,
        strengths,
        weaknesses,
        radar,
        topicsMastered,
        attendance,
        weeklyAttendance: (att?.weekly ?? []).filter((w) => w.percentage != null),
        progress,
        blooms: (s.learning_insights?.blooms ?? []).filter((b) => (b.total ?? 0) > 0),
        confidence,
        aboveClassShare,
        summary: summary.join(' '),
        hasAnything:
            assessments.length > 0 ||
            subjects.length > 0 ||
            topics.length > 0 ||
            !!attendance ||
            progress?.percent != null,
    };
};
