package vacademy.io.assessment_service.features.assessment_dashboard.service;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.AssessmentRow;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.BatchStats;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.DailyPoint;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.LearnerStats;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.Summary;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.AttemptRow;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.Enrollment;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.EvalLog;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.EvaluatorStats;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.Filters;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.Input;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.Period;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.Result;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.TestInfo;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AssessmentDashboardAssemblerTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    // Range 21–27 Sep 2026 (IST), "now" = 28 Sep 10:00 IST.
    private static final Period RANGE = new Period(LocalDate.of(2026, 9, 21), LocalDate.of(2026, 9, 27), IST);
    private static final Instant NOW = Instant.parse("2026-09-28T04:30:00Z");

    private static TestInfo exam(String id, String start, String end) {
        return new TestInfo(id, "Test " + id, "EXAM", "AUTO", "PRIVATE",
                Instant.parse(start), end == null ? null : Instant.parse(end), 60, null, 100.0);
    }

    private static TestInfo mock(String id, String start) {
        return new TestInfo(id, "Mock " + id, "MOCK", "AUTO", "PRIVATE", Instant.parse(start), null, 30, null, 50.0);
    }

    private static AttemptRow ended(String test, String user, double marks, String submitted) {
        return new AttemptRow(test, user, "BATCH_PREVIEW_REGISTRATION", null, user, null, null,
                test + "-" + user + "-" + submitted, "ENDED", "COMPLETED", "RELEASED", marks,
                Instant.parse(submitted).minusSeconds(1800), Instant.parse(submitted), 1800L);
    }

    private static AttemptRow withStatus(AttemptRow a, String resultStatus, String release) {
        return new AttemptRow(a.assessmentId(), a.userId(), a.source(), a.sourceId(), a.participantName(), a.email(),
                a.phone(), a.attemptId(), a.status(), resultStatus, release, a.totalMarks(), a.startTime(),
                a.submitTime(), a.timeSeconds());
    }

    private static AttemptRow registrationOnly(String test, String user, String source) {
        return new AttemptRow(test, user, source, null, user, null, null, null, null, null, null, null, null, null, null);
    }

    private static Enrollment enrolled(String user, String batch, String date) {
        return new Enrollment(user, batch, date == null ? null : LocalDate.parse(date), "Name " + user, null, null);
    }

    private static Result run(List<TestInfo> tests, Map<String, List<String>> batches, List<AttemptRow> attempts,
                              Map<String, List<Enrollment>> enrollments, Filters filters) {
        return AssessmentDashboardAssembler.assemble(new Input(RANGE, NOW, tests, batches, attempts, enrollments, filters));
    }

    private static Filters noFilters() {
        return new Filters(Set.of(), Set.of());
    }

    @Test
    void statusFollowsTheWindowAndAnytimeTestsAreOpen() {
        assertEquals("OPEN", AssessmentDashboardAssembler.statusOf(mock("m", "2026-09-01T00:00:00Z"), NOW));
        assertEquals("UPCOMING", AssessmentDashboardAssembler.statusOf(
                exam("a", "2026-09-29T00:00:00Z", "2026-09-29T02:00:00Z"), NOW));
        assertEquals("CLOSED", AssessmentDashboardAssembler.statusOf(
                exam("a", "2026-09-22T00:00:00Z", "2026-09-22T02:00:00Z"), NOW));
        assertEquals("LIVE", AssessmentDashboardAssembler.statusOf(
                exam("a", "2026-09-28T04:00:00Z", "2026-09-28T06:00:00Z"), NOW));
    }

    @Test
    void audienceIsBatchPlusRegisteredAndLateJoinersAreNotExpected() {
        TestInfo t = exam("t1", "2026-09-22T04:30:00Z", "2026-09-22T06:30:00Z");
        Map<String, List<Enrollment>> enrollments = Map.of("b1", List.of(
                enrolled("u1", "b1", "2026-01-01"),
                enrolled("u2", "b1", "2026-09-22"),   // same day: expected
                enrolled("u3", "b1", "2026-09-25"))); // joined after it closed: not expected
        List<AttemptRow> attempts = List.of(
                ended("t1", "u1", 80, "2026-09-22T05:00:00Z"),
                registrationOnly("t1", "u9", "ADMIN_PRE_REGISTRATION"));

        Result r = run(List.of(t), Map.of("t1", List.of("b1")), attempts, enrollments, noFilters());

        Summary s = r.summary();
        assertEquals(3, s.getExpectedLearners()); // u1, u2, u9
        assertEquals(1, s.getAttemptedLearners());
        assertEquals(2, s.getNotAttempted());
        assertEquals(0.3333, s.getParticipationRate());
        assertEquals(1, s.getClosedAssessments());
        AssessmentRow row = r.assessments().get(0);
        assertEquals(3, row.getExpected());
        assertEquals(2, row.getNotAttempted());
    }

    @Test
    void latestEvaluatedAttemptIsTheScoreAndBadScoresAreLeftOut() {
        TestInfo t = exam("t1", "2026-09-22T04:30:00Z", "2026-09-22T06:30:00Z");
        List<AttemptRow> attempts = new ArrayList<>(List.of(
                ended("t1", "u1", 40, "2026-09-22T05:00:00Z"),
                ended("t1", "u1", 90, "2026-09-22T05:30:00Z"),    // reattempt wins
                ended("t1", "u2", 120, "2026-09-22T05:00:00Z"),   // above the maximum: unusable
                ended("t1", "u3", -10, "2026-09-22T05:00:00Z"),   // negative marking: real
                withStatus(ended("t1", "u4", 70, "2026-09-22T05:00:00Z"), "PENDING", null)));

        Result r = run(List.of(t), Map.of(), attempts, new HashMap<>(), noFilters());

        Summary s = r.summary();
        assertEquals(2, s.getScored());
        assertEquals(0.4, s.getAvgScore()); // (0.9 + -0.1) / 2
        assertEquals(0.9, s.getHighestScore());
        assertEquals(5, s.getSubmissions());
        assertEquals(4, s.getUniqueLearners());
        assertEquals(1, s.getAwaitingEvaluation());
        assertEquals(4, s.getEvaluated());
        assertEquals(1, r.scoreDistribution().get(0).getCount()); // negative lands in 0–10
        assertEquals(1, r.scoreDistribution().get(9).getCount());
    }

    @Test
    void anytimeTestsCountOnlyAttemptsInRangeAndStayOutOfParticipation() {
        TestInfo m = mock("m1", "2026-08-01T00:00:00Z");
        List<AttemptRow> attempts = List.of(
                ended("m1", "u1", 25, "2026-09-23T05:00:00Z"),
                ended("m1", "u2", 50, "2026-09-10T05:00:00Z")); // before the range
        Map<String, List<Enrollment>> enrollments = Map.of("b1", List.of(
                enrolled("u1", "b1", null), enrolled("u2", "b1", null), enrolled("u3", "b1", null)));

        Result r = run(List.of(m), Map.of("m1", List.of("b1")), attempts, enrollments, noFilters());

        Summary s = r.summary();
        assertEquals(1, s.getOpenAssessments());
        assertEquals(0, s.getExpectedLearners());
        assertNull(s.getParticipationRate());
        assertEquals(1, s.getSubmissions());
        assertEquals("OPEN", r.assessments().get(0).getStatus());
        assertTrue(r.missedLearners().isEmpty());
    }

    @Test
    void batchFilterKeepsOnlyThatBatchesLearnersAndLearnerInTwoBatchesCountsInBoth() {
        TestInfo t = exam("t1", "2026-09-22T04:30:00Z", "2026-09-22T06:30:00Z");
        Map<String, List<Enrollment>> enrollments = Map.of(
                "b1", List.of(enrolled("u1", "b1", null), enrolled("u2", "b1", null)),
                "b2", List.of(enrolled("u2", "b2", null), enrolled("u3", "b2", null)));
        List<AttemptRow> attempts = List.of(
                ended("t1", "u2", 60, "2026-09-22T05:00:00Z"),
                ended("t1", "u3", 70, "2026-09-22T05:00:00Z"));
        Map<String, List<String>> batches = Map.of("t1", List.of("b1", "b2"));

        Result all = run(List.of(t), batches, attempts, enrollments, noFilters());
        assertEquals(3, all.summary().getExpectedLearners());
        BatchStats b1 = all.batches().stream().filter(b -> b.getPackageSessionId().equals("b1")).findFirst().orElseThrow();
        BatchStats b2 = all.batches().stream().filter(b -> b.getPackageSessionId().equals("b2")).findFirst().orElseThrow();
        assertEquals(2, b1.getExpected());
        assertEquals(1, b1.getAttempted()); // u2
        assertEquals(2, b2.getExpected());
        assertEquals(2, b2.getAttempted()); // u2, u3

        Result onlyB1 = run(List.of(t), batches, attempts, enrollments, new Filters(Set.of("b1"), Set.of()));
        assertEquals(2, onlyB1.summary().getExpectedLearners());
        assertEquals(1, onlyB1.summary().getSubmissions()); // u3's attempt is not b1's
        assertEquals(0.6, onlyB1.summary().getAvgScore());
    }

    @Test
    void batchFilterDropsTestsNotAssignedToThePickedBatch() {
        TestInfo t = exam("t1", "2026-09-22T04:30:00Z", "2026-09-22T06:30:00Z");
        Result r = run(List.of(t), Map.of("t1", List.of("b1")), List.of(), new HashMap<>(),
                new Filters(Set.of("b9"), Set.of()));
        assertEquals(0, r.summary().getTotalAssessments());
        assertTrue(r.assessments().isEmpty());
    }

    @Test
    void withoutBatchMembershipTheAudienceFallsBackToRegistrations() {
        TestInfo t = exam("t1", "2026-09-22T04:30:00Z", "2026-09-22T06:30:00Z");
        List<AttemptRow> attempts = List.of(ended("t1", "u1", 50, "2026-09-22T05:00:00Z"));
        Result r = run(List.of(t), Map.of("t1", List.of("b1")), attempts, null, noFilters());
        assertEquals(1, r.summary().getExpectedLearners());
        assertEquals(1.0, r.summary().getParticipationRate());
    }

    @Test
    void releaseBacklogCountsEvaluatedButUnreleasedAttempts() {
        TestInfo t = exam("t1", "2026-09-22T04:30:00Z", "2026-09-22T06:30:00Z");
        List<AttemptRow> attempts = List.of(
                withStatus(ended("t1", "u1", 50, "2026-09-22T05:00:00Z"), "COMPLETED", "PENDING"),
                withStatus(ended("t1", "u2", 50, "2026-09-22T05:00:00Z"), "EVALUATING", "PENDING"),
                withStatus(ended("t1", "u3", 50, "2026-09-22T05:00:00Z"), null, null));
        AssessmentRow row = run(List.of(t), Map.of(), attempts, new HashMap<>(), noFilters()).assessments().get(0);
        assertEquals(1, row.getEvaluated());
        assertEquals(1, row.getAwaitingRelease());
        assertEquals(2, row.getAwaitingEvaluation());
    }

    @Test
    void liveTestsShowWhoIsWritingAndWhoHasNotStarted() {
        TestInfo live = exam("t1", "2026-09-28T04:00:00Z", "2026-09-28T06:00:00Z");
        Map<String, List<Enrollment>> enrollments = Map.of("b1", List.of(
                enrolled("u1", "b1", null), enrolled("u2", "b1", null), enrolled("u3", "b1", null)));
        List<AttemptRow> attempts = List.of(
                ended("t1", "u1", 50, "2026-09-28T04:20:00Z"),
                new AttemptRow("t1", "u2", "BATCH_PREVIEW_REGISTRATION", "b1", "u2", null, null, "a2", "LIVE",
                        null, null, null, Instant.parse("2026-09-28T04:10:00Z"), null, null));

        Result r = run(List.of(live), Map.of("t1", List.of("b1")), attempts, enrollments, noFilters());

        assertEquals(1, r.liveNow().size());
        AssessmentRow row = r.liveNow().get(0);
        assertEquals(3, row.getExpected());
        assertEquals(1, row.getAttempted());
        assertEquals(1, row.getInProgress());
        assertEquals(1, row.getNotAttempted());
        // Outside the range (it runs on the 28th): not in the range's totals.
        assertEquals(0, r.summary().getTotalAssessments());
    }

    @Test
    void learnersWhoSkippedTestsAreListedMostMissedFirst() {
        TestInfo t1 = exam("t1", "2026-09-22T04:30:00Z", "2026-09-22T06:30:00Z");
        TestInfo t2 = exam("t2", "2026-09-24T04:30:00Z", "2026-09-24T06:30:00Z");
        Map<String, List<Enrollment>> enrollments = Map.of("b1", List.of(
                enrolled("u1", "b1", null), enrolled("u2", "b1", null), enrolled("u3", "b1", null)));
        List<AttemptRow> attempts = List.of(
                ended("t1", "u1", 90, "2026-09-22T05:00:00Z"),
                ended("t2", "u1", 80, "2026-09-24T05:00:00Z"),
                ended("t1", "u2", 20, "2026-09-22T05:00:00Z"),
                ended("t2", "u2", 30, "2026-09-24T05:00:00Z"));
        Map<String, List<String>> batches = Map.of("t1", List.of("b1"), "t2", List.of("b1"));

        Result r = run(List.of(t1, t2), batches, attempts, enrollments, noFilters());

        assertEquals(1, r.missedLearners().size());
        LearnerStats u3 = r.missedLearners().get(0);
        assertEquals("u3", u3.getUserId());
        assertEquals(2, u3.getMissedTests());
        assertEquals("Name u3", u3.getName());
        assertEquals(1, r.missedCounts().get(2));
        assertEquals(0, r.missedCounts().get(3));
        assertEquals("u1", r.topLearners().get(0).getUserId());
        assertEquals(0.85, r.topLearners().get(0).getAvgScore());
        assertEquals(1, r.lowScorersTotal());
        assertEquals("u2", r.lowScorers().get(0).getUserId());
    }

    @Test
    void dailyPointsAndHeatmapUseTheAdminsTimezone() {
        TestInfo t = exam("t1", "2026-09-22T04:30:00Z", "2026-09-23T06:30:00Z");
        // 20:00 UTC on the 22nd is 01:30 IST on the 23rd.
        List<AttemptRow> attempts = List.of(ended("t1", "u1", 50, "2026-09-22T20:00:00Z"));

        Result r = run(List.of(t), Map.of(), attempts, new HashMap<>(), noFilters());

        DailyPoint the22nd = r.daily().stream().filter(d -> d.getDate().equals("2026-09-22")).findFirst().orElseThrow();
        DailyPoint the23rd = r.daily().stream().filter(d -> d.getDate().equals("2026-09-23")).findFirst().orElseThrow();
        assertEquals(1, the22nd.getAssessments());
        assertEquals(0, the22nd.getSubmissions());
        assertEquals(1, the23rd.getSubmissions());
        assertEquals(0.5, the23rd.getAvgScore());
        assertEquals(7, r.daily().size());
        assertEquals(1, r.heatmap().size());
        assertEquals(2, r.heatmap().get(0).getWeekday()); // Wednesday
        assertEquals(1, r.heatmap().get(0).getHour());
    }

    @Test
    void playModeFilterNarrowsTestsButOptionsListEveryModeInRange() {
        TestInfo e = exam("t1", "2026-09-22T04:30:00Z", "2026-09-22T06:30:00Z");
        TestInfo m = mock("m1", "2026-09-23T00:00:00Z");
        Result r = run(List.of(e, m), Map.of(), List.of(), new HashMap<>(), new Filters(Set.of(), Set.of("MOCK")));
        assertEquals(1, r.summary().getTotalAssessments());
        assertEquals("MOCK", r.assessments().get(0).getPlayMode());
        assertEquals(List.of("EXAM", "MOCK"), r.modeOptions());
        assertFalse(r.assessmentsTruncated());
    }

    @Test
    void eachCheckedCopyIsCreditedToTeacherAiAutoOrOther() {
        TestInfo manual = new TestInfo("t1", "Paper", "EXAM", "MANUAL", "PRIVATE",
                Instant.parse("2026-09-22T04:30:00Z"), Instant.parse("2026-09-22T06:30:00Z"), 60, null, 100.0);
        TestInfo auto = exam("t2", "2026-09-23T04:30:00Z", "2026-09-23T06:30:00Z");
        List<AttemptRow> attempts = List.of(
                ended("t1", "u1", 60, "2026-09-22T05:00:00Z"),            // teacher A
                ended("t1", "u2", 70, "2026-09-22T05:00:00Z"),            // teacher A
                ended("t1", "u3", 80, "2026-09-22T05:00:00Z"),            // AI
                ended("t1", "u4", 50, "2026-09-22T05:00:00Z"),            // marks entered offline
                withStatus(ended("t1", "u5", 0, "2026-09-22T05:00:00Z"), "PENDING", null),
                ended("t2", "u1", 90, "2026-09-23T05:00:00Z"));           // auto-graded
        Map<String, EvalLog> logs = Map.of(
                "t1-u1-2026-09-22T05:00:00Z", new EvalLog("teacherA", 120L, Instant.parse("2026-09-24T10:00:00Z")),
                "t1-u2-2026-09-22T05:00:00Z", new EvalLog("teacherA", 240L, Instant.parse("2026-09-25T10:00:00Z")));
        Map<String, List<Enrollment>> enrollments = Map.of("b1", List.of(
                enrolled("u1", "b1", null), enrolled("u2", "b1", null), enrolled("u5", "b1", null)));

        Result r = AssessmentDashboardAssembler.assemble(new Input(RANGE, NOW, List.of(manual, auto),
                Map.of("t1", List.of("b1"), "t2", List.of("b1")), attempts, enrollments, noFilters(),
                logs, Set.of("t1-u3-2026-09-22T05:00:00Z")));

        Summary s = r.summary();
        assertEquals(5, s.getEvaluated());
        assertEquals(2, s.getCheckedByTeacher());
        assertEquals(1, s.getCheckedByAi());
        assertEquals(1, s.getAutoGraded());
        assertEquals(1, s.getEvaluatedOther());
        assertEquals(1, s.getAwaitingEvaluation());

        AssessmentRow paper = r.assessments().stream().filter(a -> a.getAssessmentId().equals("t1")).findFirst().orElseThrow();
        assertEquals(List.of("teacherA"), paper.getEvaluatorIds());
        assertEquals(2, paper.getCheckedByTeacher());
        assertEquals(1, paper.getCheckedByAi());

        assertEquals(1, r.evaluators().size());
        EvaluatorStats a = r.evaluators().get(0);
        assertEquals("teacherA", a.getUserId());
        assertEquals(2, a.getCopiesChecked());
        assertEquals(1, a.getTests());
        assertEquals(3.0, a.getAvgMinutesPerCopy());
        assertEquals("2026-09-25T10:00:00Z", a.getLastCheckedAt());

        BatchStats b1 = r.batches().get(0);
        assertEquals(3, b1.getEvaluated());          // u1 (twice: t1 + t2), u2
        assertEquals(1, b1.getAwaitingEvaluation()); // u5
    }
}
