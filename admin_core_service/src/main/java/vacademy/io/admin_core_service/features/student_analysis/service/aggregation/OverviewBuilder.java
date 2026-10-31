package vacademy.io.admin_core_service.features.student_analysis.service.aggregation;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.*;

import java.util.ArrayList;
import java.util.List;

/**
 * Deterministic overview computation from the assembled collector sections.
 *
 * <p>Computes:
 * <ul>
 *   <li>{@code overall_status} — "On Track" / "Needs Attention" / "At Risk"</li>
 *   <li>{@code overall_grade} — letter grade from average score</li>
 *   <li>{@code headline_metrics[]} — key KPI cards (trend/change are null when no prior report)</li>
 *   <li>{@code one_line} — null here; set later by the LLM layer</li>
 * </ul>
 *
 * <p>Trend and change fields require a prior report. Since fetching the prior report
 * would add a DB round-trip with JSON deserialization inside the aggregation window,
 * they are left null here and can be enriched in a future enhancement.
 */
@Slf4j
@Component
public class OverviewBuilder {

    /**
     * Build the overview section from the assembled report sections.
     * Must be called after all collectors have finished.
     */
    public OverviewSection build(ComprehensiveStudentReport report) {
        try {
            Double avgScore = extractAvgScore(report.getAcademics());
            Double attendancePct = extractAttendancePct(report.getAttendance());
            Double completionPct = extractCompletionPct(report.getCourseProgress());
            Double studyHours = extractStudyHours(report.getStudyHabits());
            Integer avgMinPerDay = extractAvgMinPerDay(report.getStudyHabits());

            String overallStatus = computeStatus(attendancePct, avgScore);
            String overallGrade = computeGrade(avgScore);

            List<OverviewSection.HeadlineMetric> metrics = buildMetrics(
                    attendancePct, avgScore, completionPct, studyHours, avgMinPerDay, report);

            return OverviewSection.builder()
                    .overallStatus(overallStatus)
                    .overallGrade(overallGrade)
                    .oneLine(null)  // set by LLM layer after narration
                    .headlineMetrics(metrics)
                    .build();

        } catch (Exception e) {
            log.error("[OverviewBuilder] Failed to build overview: {}", e.getMessage());
            return OverviewSection.builder()
                    .overallStatus("Unknown")
                    .overallGrade(null)
                    .headlineMetrics(List.of())
                    .build();
        }
    }

    // ── Status logic ──────────────────────────────────────────────────────────

    private String computeStatus(Double attendancePct, Double avgScore) {
        // Both signals missing → we have no basis for a judgement. Previously this fell through
        // every threshold and returned "At Risk", so a learner with no collected data (empty window,
        // batch mismatch, modules excluded) was labelled at risk on the strength of nothing at all.
        if (attendancePct == null && avgScore == null) return "Insufficient Data";

        // Judge only the signals that exist. A missing one (module not selected, no sessions)
        // used to count as a failure, so a 67%-average learner on an academics-only report was
        // capped at "Needs Attention" for having no attendance data.
        boolean attendanceOk = attendancePct == null || attendancePct >= 75;
        boolean scoreOk = avgScore == null || avgScore >= 60;
        boolean attendanceLow = attendancePct != null && attendancePct >= 60;
        boolean scoreLow = avgScore != null && avgScore >= 40;

        if (attendanceOk && scoreOk) return "On Track";
        if (attendanceLow || scoreLow) return "Needs Attention";
        return "At Risk";
    }

    private String computeGrade(Double avgScore) {
        if (avgScore == null) return null;
        if (avgScore >= 90) return "A+";
        if (avgScore >= 80) return "A";
        if (avgScore >= 70) return "B+";
        if (avgScore >= 60) return "B";
        if (avgScore >= 50) return "C";
        return "D";
    }

    // ── Metric cards ──────────────────────────────────────────────────────────

    private List<OverviewSection.HeadlineMetric> buildMetrics(
            Double attendancePct, Double avgScore, Double completionPct,
            Double studyHours, Integer avgMinPerDay,
            ComprehensiveStudentReport report) {

        List<OverviewSection.HeadlineMetric> metrics = new ArrayList<>();

        if (attendancePct != null) {
            metrics.add(OverviewSection.HeadlineMetric.builder()
                    .key("attendance")
                    .label("Attendance")
                    .value(Math.round(attendancePct))
                    .unit("%")
                    .trend(null)
                    .change(null)
                    .sentiment(attendancePct >= 75 ? "good" : (attendancePct >= 60 ? "neutral" : "attention"))
                    .build());
        }

        if (avgScore != null) {
            metrics.add(OverviewSection.HeadlineMetric.builder()
                    .key("average_score")
                    .label("Avg. Score")
                    .value(Math.round(avgScore))
                    .unit("%")
                    .trend(null)
                    .change(null)
                    .sentiment(avgScore >= 70 ? "good" : (avgScore >= 50 ? "neutral" : "attention"))
                    .build());
        }

        // Academic context tiles — on an academics-only report a lone "Avg. Score" tile read as empty.
        AcademicsSection academics = report.getAcademics();
        if (academics != null && academics.isAvailable() && academics.getAssessments() != null
                && !academics.getAssessments().isEmpty()) {
            List<AcademicsSection.AssessmentItem> items = academics.getAssessments();
            metrics.add(OverviewSection.HeadlineMetric.builder()
                    .key("assessments_taken")
                    .label("Assessments")
                    .value(items.size())
                    .sentiment("neutral")
                    .build());
            long compared = items.stream().filter(a -> a.getPercentage() != null && classPct(a) != null).count();
            long above = items.stream().filter(a -> a.getPercentage() != null && classPct(a) != null
                    && a.getPercentage() >= classPct(a)).count();
            if (compared > 0) {
                metrics.add(OverviewSection.HeadlineMetric.builder()
                        .key("above_class_average")
                        .label("Above Class Avg")
                        .value(above + " / " + compared)
                        .sentiment(above * 2 >= compared ? "good" : "attention")
                        .build());
            }
            if (academics.getBestSubject() != null) {
                metrics.add(OverviewSection.HeadlineMetric.builder()
                        .key("best_subject")
                        .label("Best Subject")
                        .value(academics.getBestSubject())
                        .sentiment("good")
                        .build());
            }
        }

        if (completionPct != null) {
            metrics.add(OverviewSection.HeadlineMetric.builder()
                    .key("course_completion")
                    .label("Course Progress")
                    .value(Math.round(completionPct))
                    .unit("%")
                    .trend(null)
                    .change(null)
                    .sentiment(completionPct >= 60 ? "good" : (completionPct >= 30 ? "neutral" : "attention"))
                    .build());
        }

        if (studyHours != null) {
            String changeLabel = avgMinPerDay != null ? "~" + avgMinPerDay + " min/day" : null;
            metrics.add(OverviewSection.HeadlineMetric.builder()
                    .key("study_time")
                    .label("Study Time")
                    .value(studyHours)
                    .unit("hrs")
                    .trend(null)
                    .change(changeLabel)
                    .sentiment("good")
                    .build());
        }

        // Assignments metric
        AssignmentsSection assignments = report.getAssignments();
        if (assignments != null && assignments.isAvailable() && assignments.getSubmitted() != null) {
            Integer submitted = assignments.getSubmitted();
            Integer assigned = assignments.getAssigned();
            // Only show "submitted / assigned" when the assigned total is a sane denominator
            // (>= submitted and > 0). Otherwise assigned is unknown/incomplete (e.g. 0 assigned
            // but 2 submitted) → show just the submitted count instead of a nonsensical "2 / 0".
            String val = (assigned != null && assigned > 0 && assigned >= submitted)
                    ? submitted + " / " + assigned
                    : String.valueOf(submitted);
            metrics.add(OverviewSection.HeadlineMetric.builder()
                    .key("assignments")
                    .label("Assignments Done")
                    .value(val)
                    .unit(null)
                    .trend(null)
                    .change(null)
                    .sentiment("neutral")
                    .build());
        }

        return metrics;
    }

    // ── Extractors ────────────────────────────────────────────────────────────

    /** Class average as a percentage of the paper's total, or null when unknown. */
    private static Double classPct(AcademicsSection.AssessmentItem a) {
        if (a.getClassAverage() == null || a.getTotalMarks() == null || a.getTotalMarks() <= 0) return null;
        return a.getClassAverage() / a.getTotalMarks() * 100.0;
    }

    private Double extractAvgScore(AcademicsSection academics) {
        if (academics == null || !academics.isAvailable()) return null;
        return academics.getAveragePercentage();
    }

    private Double extractAttendancePct(AttendanceSection attendance) {
        if (attendance == null || !attendance.isAvailable()) return null;
        return attendance.getOverallPercentage();
    }

    private Double extractCompletionPct(ProgressSection progress) {
        if (progress == null || !progress.isAvailable()) return null;
        return progress.getOverallCompletionPercentage();
    }

    private Double extractStudyHours(StudyHabitsSection studyHabits) {
        if (studyHabits == null || !studyHabits.isAvailable()) return null;
        return studyHabits.getTotalStudyHours();
    }

    private Integer extractAvgMinPerDay(StudyHabitsSection studyHabits) {
        if (studyHabits == null || !studyHabits.isAvailable()) return null;
        return studyHabits.getAvgMinutesPerDay();
    }
}
