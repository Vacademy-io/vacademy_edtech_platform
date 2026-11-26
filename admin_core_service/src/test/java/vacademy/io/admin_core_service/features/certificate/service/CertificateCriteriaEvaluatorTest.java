package vacademy.io.admin_core_service.features.certificate.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.certificate.client.AssessmentScoreClient;
import vacademy.io.admin_core_service.features.certificate.dao.CertificateCriteriaDao;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateCriteriaDto;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateEligibilityDto;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateTestOptionDto;
import vacademy.io.admin_core_service.features.certificate.dto.ResolvedCertificateConfig;
import vacademy.io.admin_core_service.features.quiz_results.service.QuizResultsService;
import vacademy.io.admin_core_service.features.quiz_results.service.QuizResultsService.QuizBestScore;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The course certificate earning rule. What these protect:
 * <ul>
 *   <li>a course with no score rule behaves exactly as before and never touches test data;</li>
 *   <li>a score rule fails closed - no tests, or marks that could not be fetched, never
 *       produce a certificate;</li>
 *   <li>marks still held for a teacher are never read as a pass.</li>
 * </ul>
 */
class CertificateCriteriaEvaluatorTest {

    private static final String BATCH = "batch-1";
    private static final String USER = "user-1";

    private CertificateCriteriaDao dao;
    private QuizResultsService quizResults;
    private AssessmentScoreClient assessments;
    private CertificateCriteriaEvaluator evaluator;

    @BeforeEach
    void setUp() {
        dao = mock(CertificateCriteriaDao.class);
        quizResults = mock(QuizResultsService.class);
        assessments = mock(AssessmentScoreClient.class);
        evaluator = new CertificateCriteriaEvaluator(dao, quizResults, assessments);
    }

    // ------------------------------------------------------------------ fixtures

    private static CertificateTestOptionDto quiz(String slideId, Double ownPass) {
        return CertificateTestOptionDto.builder()
                .slideId(slideId).title(slideId).type("QUIZ").status("PUBLISHED")
                .moduleId("m-" + slideId).chapterId("c-" + slideId)
                .ownPassPercent(ownPass).build();
    }

    private static CertificateTestOptionDto assessment(String slideId, String assessmentId) {
        return CertificateTestOptionDto.builder()
                .slideId(slideId).title(slideId).type("ASSESSMENT").status("PUBLISHED")
                .moduleId("m-" + slideId).chapterId("c-" + slideId)
                .assessmentId(assessmentId).build();
    }

    private static ResolvedCertificateConfig config(CertificateCriteriaDto criteria) {
        return ResolvedCertificateConfig.builder().enabled(true).thresholdPercent(80).criteria(criteria).build();
    }

    private void quizScores(Map<String, Double> bestBySlide) {
        Map<String, Map<String, QuizBestScore>> scores = new HashMap<>();
        bestBySlide.forEach((slide, pct) ->
                scores.put(slide, Map.of(USER, new QuizBestScore(pct, null, 1, false))));
        when(quizResults.getBestScores(BATCH, USER)).thenReturn(scores);
    }

    private CertificateEligibilityDto evaluate(CertificateCriteriaDto criteria, Double completion) {
        return evaluator.evaluateOne(BATCH, USER, config(criteria), completion);
    }

    // ------------------------------------------------------------------ progress

    @Test
    void progressOnlyRuleIsUnchangedAndReadsNoTestData() {
        CertificateEligibilityDto below = evaluate(null, 79.9);
        CertificateEligibilityDto at = evaluate(null, 80.0);

        assertFalse(below.isEligible());
        assertTrue(at.isEligible());
        assertEquals("PROGRESS", at.getMode());
        verifyNoInteractions(dao, quizResults, assessments);
    }

    @Test
    void unknownModeFallsBackToProgress() {
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder().mode("SOMETHING").build();
        assertTrue(evaluate(criteria, 90.0).isEligible());
        verifyNoInteractions(dao);
    }

    // --------------------------------------------------------------------- score

    @Test
    void allRuleNeedsEveryTestAndUsesEachQuizsOwnPassMark() {
        when(dao.findTests(anyList())).thenReturn(List.of(quiz("q1", 70.0), quiz("q2", null)));
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder().mode("SCORE").passPercent(50).build();

        // q1: 65 < its own 70 -> fail; q2: 65 >= common 50 -> pass
        quizScores(Map.of("q1", 65.0, "q2", 65.0));
        CertificateEligibilityDto failing = evaluate(criteria, null);
        assertFalse(failing.isEligible());
        assertEquals(1, failing.getTestsPassed());
        assertEquals(2, failing.getTestsRequired());
        assertEquals("FAILED", failing.getTests().get(0).getStatus());

        quizScores(Map.of("q1", 70.0, "q2", 50.0));
        assertTrue(evaluate(criteria, null).isEligible());
    }

    @Test
    void commonPassMarkCanOverrideEachQuizsOwn() {
        when(dao.findTests(anyList())).thenReturn(List.of(quiz("q1", 90.0)));
        quizScores(Map.of("q1", 60.0));
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder()
                .mode("SCORE").passPercent(60).useOwnPassPercent(false).build();

        assertTrue(evaluate(criteria, null).isEligible());
    }

    @Test
    void atLeastRuleCountsPassesAndCapsAtTheNumberOfTests() {
        when(dao.findTests(anyList())).thenReturn(List.of(quiz("q1", null), quiz("q2", null), quiz("q3", null)));
        quizScores(Map.of("q1", 80.0, "q2", 75.0));

        CertificateCriteriaDto twoOfThree = CertificateCriteriaDto.builder()
                .mode("SCORE").passRule("AT_LEAST").minTestsToPass(2).passPercent(60).build();
        CertificateEligibilityDto result = evaluate(twoOfThree, null);
        assertTrue(result.isEligible());
        assertEquals(1, result.getTestsNotAttempted());

        CertificateCriteriaDto tenOfThree = CertificateCriteriaDto.builder()
                .mode("SCORE").passRule("AT_LEAST").minTestsToPass(10).passPercent(60).build();
        CertificateEligibilityDto capped = evaluate(tenOfThree, null);
        assertEquals(3, capped.getTestsRequired());
        assertFalse(capped.isEligible());
    }

    @Test
    void averageRuleCountsUnattemptedTestsAsZero() {
        when(dao.findTests(anyList())).thenReturn(List.of(quiz("q1", null), quiz("q2", null)));
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder()
                .mode("SCORE").passRule("AVERAGE").passPercent(60).build();

        quizScores(Map.of("q1", 100.0));
        CertificateEligibilityDto half = evaluate(criteria, null);
        assertEquals(50.0, half.getAverageScorePercent());
        assertFalse(half.isEligible());
        assertNull(half.getTests().get(0).getPassPercent());
        assertEquals("COMPLETED", half.getTests().get(0).getStatus());

        quizScores(Map.of("q1", 100.0, "q2", 20.0));
        assertTrue(evaluate(criteria, null).isEligible());
    }

    @Test
    void heldAssessmentMarksAreAwaitingNotPassed() {
        when(dao.findTests(anyList())).thenReturn(List.of(assessment("a-slide", "asmt-1")));
        when(assessments.fetchBestScores(anyList(), anyList())).thenReturn(Map.of(USER, Map.of(
                "asmt-1", new AssessmentScoreClient.AssessmentScore(null, 0, 1))));
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder().mode("SCORE").passPercent(40).build();

        CertificateEligibilityDto result = evaluate(criteria, null);
        assertFalse(result.isEligible());
        assertEquals(1, result.getTestsAwaitingResult());
        assertEquals("AWAITING_RESULT", result.getTests().get(0).getStatus());
    }

    @Test
    void assessmentPassesOnItsBestReleasedMarks() {
        when(dao.findTests(anyList())).thenReturn(List.of(assessment("a-slide", "asmt-1")));
        when(assessments.fetchBestScores(anyList(), anyList())).thenReturn(Map.of(USER, Map.of(
                "asmt-1", new AssessmentScoreClient.AssessmentScore(72.5, 2, 0))));
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder().mode("SCORE").passPercent(70).build();

        CertificateEligibilityDto result = evaluate(criteria, null);
        assertTrue(result.isEligible());
        assertEquals(2, result.getTests().get(0).getAttempts());
    }

    @Test
    void unreachableAssessmentServiceFailsClosed() {
        when(dao.findTests(anyList())).thenReturn(List.of(quiz("q1", null), assessment("a-slide", "asmt-1")));
        quizScores(Map.of("q1", 100.0));
        when(assessments.fetchBestScores(anyList(), anyList())).thenReturn(null);
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder()
                .mode("SCORE").passRule("AT_LEAST").minTestsToPass(1).build();

        CertificateEligibilityDto result = evaluate(criteria, null);
        assertFalse(result.isEligible());
        assertEquals(CertificateEligibilityDto.BLOCKER_SCORES_UNAVAILABLE, result.getScoreBlocker());
    }

    @Test
    void noMatchingTestsFailsClosed() {
        when(dao.findTests(anyList())).thenReturn(List.of());
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder().mode("SCORE").build();

        CertificateEligibilityDto result = evaluate(criteria, 100.0);
        assertFalse(result.isEligible());
        assertEquals(CertificateEligibilityDto.BLOCKER_NO_TESTS, result.getScoreBlocker());
        verify(quizResults, never()).getBestScores(anyString(), any());
    }

    @Test
    void progressAndScoreNeedsBoth() {
        when(dao.findTests(anyList())).thenReturn(List.of(quiz("q1", null)));
        quizScores(Map.of("q1", 90.0));
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder()
                .mode("PROGRESS_AND_SCORE").passPercent(60).build();

        assertFalse(evaluate(criteria, 50.0).isEligible());
        assertTrue(evaluate(criteria, 85.0).isEligible());
    }

    // --------------------------------------------------------------------- scope

    @Test
    void customScopeExpandsModulesAndChaptersByTypeAndAlwaysKeepsPickedSlides() {
        CertificateTestOptionDto quizInModule = CertificateTestOptionDto.builder()
                .slideId("q-mod").type("QUIZ").status("PUBLISHED").moduleId("M").chapterId("C1").build();
        CertificateTestOptionDto assessmentInModule = CertificateTestOptionDto.builder()
                .slideId("a-mod").type("ASSESSMENT").status("PUBLISHED").moduleId("M").chapterId("C1")
                .assessmentId("asmt-mod").build();
        CertificateTestOptionDto pickedAssessment = CertificateTestOptionDto.builder()
                .slideId("a-pick").type("ASSESSMENT").status("UNSYNC").moduleId("X").chapterId("C9")
                .assessmentId("asmt-pick").build();
        CertificateTestOptionDto draftInModule = CertificateTestOptionDto.builder()
                .slideId("q-draft").type("QUIZ").status("DRAFT").moduleId("M").chapterId("C1").build();
        CertificateTestOptionDto elsewhere = CertificateTestOptionDto.builder()
                .slideId("q-else").type("QUIZ").status("PUBLISHED").moduleId("Y").chapterId("C2").build();

        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder()
                .mode("SCORE").testScope("CUSTOM")
                .moduleIds(List.of("M")).slideIds(List.of("a-pick"))
                .testTypes(List.of("QUIZ"))
                .build();

        List<String> counted = CertificateCriteriaEvaluator.testsInRule(criteria,
                        List.of(quizInModule, assessmentInModule, pickedAssessment, draftInModule, elsewhere))
                .stream().map(CertificateTestOptionDto::getSlideId).toList();

        assertEquals(List.of("q-mod", "a-pick"), counted);
    }

    @Test
    void anAssessmentSlideLinkedToNoAssessmentIsNotATest() {
        CertificateTestOptionDto unlinked = CertificateTestOptionDto.builder()
                .slideId("a-none").type("ASSESSMENT").status("PUBLISHED").moduleId("M").chapterId("C1").build();
        when(dao.findTests(anyList())).thenReturn(List.of(quiz("q1", null), unlinked));
        quizScores(Map.of("q1", 90.0));
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder().mode("SCORE").build();

        CertificateEligibilityDto result = evaluate(criteria, null);
        assertEquals(1, result.getTestsTotal());
        assertTrue(result.isEligible());
    }

    @Test
    void averageRuleShowsAQuizStillBeingGradedAsAwaiting() {
        when(dao.findTests(anyList())).thenReturn(List.of(quiz("q1", null)));
        when(quizResults.getBestScores(BATCH, USER)).thenReturn(Map.of(
                "q1", Map.of(USER, new QuizBestScore(40.0, null, 1, true))));
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder()
                .mode("SCORE").passRule("AVERAGE").passPercent(60).build();

        CertificateEligibilityDto result = evaluate(criteria, null);
        assertEquals("AWAITING_RESULT", result.getTests().get(0).getStatus());
        assertEquals(1, result.getTestsAwaitingResult());
    }

    @Test
    void retryingAfterPassingKeepsThePass() {
        when(dao.findTests(anyList())).thenReturn(List.of(quiz("q1", 60.0)));
        // getBestScores already folds attempts to the best one; three attempts, best 80
        when(quizResults.getBestScores(BATCH, USER)).thenReturn(Map.of(
                "q1", Map.of(USER, new QuizBestScore(80.0, 60.0, 3, false))));
        CertificateCriteriaDto criteria = CertificateCriteriaDto.builder().mode("SCORE").build();

        CertificateEligibilityDto result = evaluate(criteria, null);
        assertTrue(result.isEligible());
        assertEquals(3, result.getTests().get(0).getAttempts());
    }
}
