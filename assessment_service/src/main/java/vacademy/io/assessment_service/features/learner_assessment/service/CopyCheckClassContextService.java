package vacademy.io.assessment_service.features.learner_assessment.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.AssessmentOverviewDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportClassContext;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.AssessmentOverviewSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.LeaderBoardSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.MarksRankSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionAggregateSnapshot;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The class an AI report compares against, for a paper whose copies were checked without
 * students (Evalezy / "only check").
 *
 * <p>Those copies are kept out of the leaderboard, statistics and releases on purpose: they
 * belong to nobody. For a paper that has ONLY such copies, though, the AI reports had no
 * class at all — no average, no score bands, no section figures. Here, and only for the AI
 * reports, the checked copies are the class.
 *
 * <p>A paper with any learner's attempt is reported exactly as before: {@link #forAiReport}
 * returns {@link LearnerReportService#loadClassContext} unchanged.
 */
@Slf4j
@Service
public class CopyCheckClassContextService {

    /** Mirrors CopyIntakeService: the attempt and registration of a copy checked without a student. */
    static final String COPY_CHECK_ATTEMPT_STATUS = "COPY_CHECK";
    static final String COPY_CHECK_SOURCE = "COPY_CHECK_ONLY";

    private static final String COPIES = """
            FROM student_attempt sa
            JOIN assessment_user_registration aur ON aur.id = sa.registration_id
            WHERE aur.assessment_id = ? AND aur.institute_id = ?
              AND sa.status = 'COPY_CHECK' AND aur.source = 'COPY_CHECK_ONLY' AND aur.status = 'ACTIVE'
              AND sa.total_marks IS NOT NULL
            """;

    private final JdbcTemplate jdbc;
    private final LearnerReportService learnerReportService;

    public CopyCheckClassContextService(JdbcTemplate jdbc, LearnerReportService learnerReportService) {
        this.jdbc = jdbc;
        this.learnerReportService = learnerReportService;
    }

    /** The class for an AI report: the learners, or, on a paper with none, its checked copies. */
    public ReportClassContext forAiReport(String assessmentId, String instituteId) {
        ReportClassContext ctx = learnerReportService.loadClassContext(assessmentId, instituteId);
        if (ctx.getFullLeaderboard() != null && !ctx.getFullLeaderboard().isEmpty()) {
            return ctx;
        }
        try {
            ReportClassContext copies = fromCheckedCopies(ctx, assessmentId, instituteId);
            return copies != null ? copies : ctx;
        } catch (Exception e) {
            log.warn("[copy-check-class] could not build the class of checked copies for {}: {}",
                    assessmentId, e.getMessage());
            return ctx;
        }
    }

    /** Whether the AI reports of this paper read its checked copies as the class. */
    public boolean usesCheckedCopies(String assessmentId, String instituteId) {
        ReportClassContext ctx = learnerReportService.loadClassContext(assessmentId, instituteId);
        if (ctx.getFullLeaderboard() != null && !ctx.getFullLeaderboard().isEmpty()) {
            return false;
        }
        Long copies = jdbc.queryForObject("SELECT COUNT(*) " + COPIES, Long.class, assessmentId, instituteId);
        return copies != null && copies > 0;
    }

    /** Whether any copy of this paper was checked through a bulk AI check. One indexed lookup. */
    public boolean hasBulkCheck(String assessmentId, String instituteId) {
        Boolean found = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM ai_copy_intake_batch WHERE assessment_id = ? AND institute_id = ?)",
                Boolean.class, assessmentId, instituteId);
        return Boolean.TRUE.equals(found);
    }

    /**
     * Of the given attempts, the copies of a bulk AI check whose check has finished - the
     * ones whose analysis is made when a report asks. A copy still being checked is not one
     * (its marks are not final), nor is an online test's own automatic AI marking.
     */
    public java.util.Set<String> bulkCheckedAttemptIds(java.util.Collection<String> attemptIds) {
        if (attemptIds == null || attemptIds.isEmpty()) {
            return java.util.Set.of();
        }
        java.util.Set<String> out = new java.util.HashSet<>();
        new org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate(jdbc).query("""
                SELECT DISTINCT attempt_id FROM ai_copy_intake_item WHERE attempt_id IN (:ids) AND status = 'COMPLETED'
                """, Map.of("ids", attemptIds), (java.sql.ResultSet rs) -> {
            out.add(rs.getString("attempt_id"));
        });
        return out;
    }

    ReportClassContext fromCheckedCopies(ReportClassContext base, String assessmentId, String instituteId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT sa.id AS attempt_id, aur.user_id, aur.participant_name, aur.source_id,
                       sa.total_marks::float8 AS total_marks, sa.total_time_in_seconds::bigint AS time_seconds
                """ + COPIES + " ORDER BY sa.total_marks DESC, sa.created_at", assessmentId, instituteId);
        if (rows.isEmpty()) {
            return null;
        }

        int n = rows.size();
        List<LeaderBoardSnapshot> leaderboard = new ArrayList<>(n);
        Map<Double, MarksRankSnapshot> ranks = new LinkedHashMap<>();
        int rank = 0;
        Double previous = null;
        double sum = 0;
        for (Map<String, Object> r : rows) {
            double marks = round2(((Number) r.get("total_marks")).doubleValue());
            if (previous == null || marks != previous) {
                rank++;
                previous = marks;
            }
            double percentile = round2(100.0 * (1.0 - (rank - 1) / (double) n));
            sum += marks;
            leaderboard.add(LeaderBoardSnapshot.builder()
                    .attemptId((String) r.get("attempt_id"))
                    .userId((String) r.get("user_id"))
                    .studentName((String) r.get("participant_name"))
                    .batchId((String) r.get("source_id"))
                    .completionTimeInSeconds(r.get("time_seconds") instanceof Number t ? t.longValue() : null)
                    .achievedMarks(marks)
                    .rank(rank)
                    .percentile(percentile)
                    .build());
            MarksRankSnapshot band = ranks.get(marks);
            if (band == null) {
                ranks.put(marks, MarksRankSnapshot.builder().marks(marks).rank(rank).noOfParticipants(1)
                        .percentile(percentile).build());
            } else {
                band.setNoOfParticipants(band.getNoOfParticipants() + 1);
            }
        }
        double average = sum / n;

        Map<String, SectionAggregateSnapshot> sectionAggregation = new HashMap<>();
        for (Map<String, Object> r : jdbc.queryForList("""
                SELECT per.section_id, AVG(per.total) AS avg_marks, MAX(per.total) AS max_marks,
                       SUM(per.correct) AS total_correct, SUM(per.questions) AS total_questions
                FROM (
                    SELECT qwm.attempt_id, qwm.section_id, SUM(qwm.marks) AS total,
                           SUM(CASE WHEN qwm.status = 'CORRECT' THEN 1 ELSE 0 END) AS correct,
                           COUNT(*) AS questions
                    FROM question_wise_marks qwm
                    WHERE qwm.attempt_id IN (SELECT sa.id\s""" + COPIES + """
                    )
                    GROUP BY qwm.attempt_id, qwm.section_id
                ) per
                GROUP BY per.section_id
                """, assessmentId, instituteId)) {
            SectionAggregateSnapshot snap = SectionAggregateSnapshot.from(new Object[]{
                    r.get("section_id"), r.get("avg_marks"), r.get("max_marks"),
                    r.get("total_correct"), r.get("total_questions")});
            if (snap.sectionId() != null) {
                sectionAggregation.put(snap.sectionId(), snap);
            }
        }

        Double totalMarks = base.getTotalMarks();
        if (totalMarks == null || totalMarks <= 0) {
            double fromSections = base.getSections() == null ? 0 : base.getSections().stream()
                    .mapToDouble(s -> s.totalMarks() != null ? s.totalMarks() : 0.0).sum();
            totalMarks = fromSections > 0 ? fromSections : 100.0;
        }
        double accuracy = totalMarks > 0 ? Math.max(0.0, Math.min(100.0, average / totalMarks * 100.0)) : 0.0;

        AssessmentOverviewDto o = base.getOverview();
        AssessmentOverviewSnapshot overview = AssessmentOverviewSnapshot.builder()
                .createdOn(o != null ? o.getCreatedOn() : null)
                .startDateAndTime(o != null ? o.getStartDateAndTime() : null)
                .endDateAndTime(o != null ? o.getEndDateAndTime() : null)
                .durationInMin(o != null ? o.getDurationInMin() : null)
                .subjectId(o != null ? o.getSubjectId() : null)
                .totalParticipants((long) n)
                .totalAttempted((long) n)
                .totalOngoing(0L)
                .averageMarks(average)
                .averageDuration(null)
                .build();

        return ReportClassContext.builder()
                .assessmentId(assessmentId)
                .instituteId(instituteId)
                .assessmentName(base.getAssessmentName())
                .overview(overview)
                .marksDistribution(new ArrayList<>(ranks.values()))
                .fullLeaderboard(new ArrayList<>(leaderboard))
                .sectionAggregation(sectionAggregation)
                .totalMarks(totalMarks)
                .classAccuracy(Math.round(accuracy * 10.0) / 10.0)
                .highestMarks(leaderboard.get(0).getAchievedMarks())
                .lowestMarks(leaderboard.get(n - 1).getAchievedMarks())
                .branding(base.getBranding())
                .sections(base.getSections() != null ? base.getSections() : List.of())
                .questionOrderByQuestionAndSection(base.getQuestionOrderByQuestionAndSection() != null
                        ? base.getQuestionOrderByQuestionAndSection() : new HashMap<>())
                .optionDistribution(base.getOptionDistribution() != null
                        ? base.getOptionDistribution() : new HashMap<>())
                .build();
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
