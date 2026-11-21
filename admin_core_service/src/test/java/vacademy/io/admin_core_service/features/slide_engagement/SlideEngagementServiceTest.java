package vacademy.io.admin_core_service.features.slide_engagement;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.SlideMembershipRow;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsLedger;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsSourceType;
import vacademy.io.admin_core_service.features.points_ledger.repository.PointsLedgerRepository;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;
import vacademy.io.admin_core_service.features.points_ledger.service.ScoringConfigService;
import vacademy.io.admin_core_service.features.slide_engagement.SlideEngagementRepository.OperationRow;
import vacademy.io.admin_core_service.features.slide_engagement.SlideEngagementRepository.SlideKindRow;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SlideEngagementServiceTest {

    private static final String SLIDE = "question-1";
    private static final String USER = "u1";
    private static final String INST = "inst-1";
    private static final String BATCH = "ps-1";

    private SlideEngagementRepository repo;
    private LearnerQuizAttemptRepository memberships;
    private PointsLedgerService ledger;
    private PointsLedgerRepository ledgerRepo;
    private ScoringConfigService scoring;
    private SlideEngagementService service;
    private CustomUserDetails user;

    @BeforeEach
    void setUp() {
        repo = mock(SlideEngagementRepository.class);
        memberships = mock(LearnerQuizAttemptRepository.class);
        ledger = mock(PointsLedgerService.class);
        ledgerRepo = mock(PointsLedgerRepository.class);
        scoring = mock(ScoringConfigService.class);
        service = new SlideEngagementService(repo, memberships, ledger, ledgerRepo, scoring,
                mock(InstituteAccessValidator.class));
        user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn(USER);
        when(scoring.isEnabled(INST)).thenReturn(true);
    }

    // ── fixtures ─────────────────────────────────────────────────────────────

    private void config(boolean enabled, int points) {
        SlideEngagement c = new SlideEngagement();
        c.setSlideId(SLIDE);
        c.setEnabled(enabled);
        c.setPoints(points);
        when(repo.findById(SLIDE)).thenReturn(Optional.of(c));
    }

    private static SlideKindRow slide(String status, String sourceType, String docType) {
        return new SlideKindRow() {
            public String getSlideId() { return SLIDE; }
            public String getTitle() { return "Which one behaviour?"; }
            public String getStatus() { return status; }
            public String getSourceType() { return sourceType; }
            public String getDocumentType() { return docType; }
        };
    }

    private static SlideMembershipRow member(String inst, String ps) {
        return new SlideMembershipRow() {
            public String getInstituteId() { return inst; }
            public String getPackageSessionId() { return ps; }
            public String getChapterId() { return "ch"; }
        };
    }

    private static OperationRow op(String operation, String value) {
        return new OperationRow() {
            public String getOperation() { return operation; }
            public String getValue() { return value; }
        };
    }

    private void publishedQuestion() {
        when(repo.findSlideKind(SLIDE)).thenReturn(Optional.of(slide("PUBLISHED", "QUESTION", null)));
    }

    private void enrolled() {
        when(memberships.findLiveMemberships(USER, SLIDE)).thenReturn(List.of(member(INST, BATCH)));
    }

    // ── eligibility ──────────────────────────────────────────────────────────

    @Test
    void onlyActivityKindsAreEligible() {
        assertTrue(SlideEngagementService.isEligible("QUESTION", null));
        assertTrue(SlideEngagementService.isEligible("QUIZ", null));
        assertTrue(SlideEngagementService.isEligible("DOCUMENT", "HTML"));
        assertTrue(SlideEngagementService.isEligible("DOCUMENT", "FLASHCARDS"));
        assertTrue(SlideEngagementService.isEligible("DOCUMENT", "POLL"));
        assertTrue(SlideEngagementService.isEligible("DOCUMENT", "GAME"));
        assertFalse(SlideEngagementService.isEligible("DOCUMENT", "PDF"));
        assertFalse(SlideEngagementService.isEligible("VIDEO", null));
        assertFalse(SlideEngagementService.isEligible(null, "HTML"));
    }

    @Test
    void completionIsTheTickOrEightyPercent() {
        assertTrue(SlideEngagementService.isCompleted(List.of(op("PERCENTAGE_QUESTION_COMPLETED", "100.0"))));
        assertTrue(SlideEngagementService.isCompleted(List.of(op("PERCENTAGE_DOCUMENT_COMPLETED", "80"))));
        assertTrue(SlideEngagementService.isCompleted(List.of(op("MARKED_AS_WATCHED", "true"))));
        assertFalse(SlideEngagementService.isCompleted(List.of(op("PERCENTAGE_DOCUMENT_COMPLETED", "79.9"))));
        assertFalse(SlideEngagementService.isCompleted(List.of(op("MARKED_AS_WATCHED", "false"))));
        assertFalse(SlideEngagementService.isCompleted(List.of(op("PERCENTAGE_QUIZ_COMPLETED", "n/a"))));
        assertFalse(SlideEngagementService.isCompleted(List.of()));
    }

    // ── claim ────────────────────────────────────────────────────────────────

    @Test
    void aSlideNobodyMarkedEarnsNothing() {
        when(repo.findById(SLIDE)).thenReturn(Optional.empty());
        SlideEngagementService.LearnerView v = service.claim(user, SLIDE, BATCH);
        assertFalse(v.active());
        verify(ledger, never()).award(anyString(), anyString(), any(), any(), anyString(), anyInt(), anyString(),
                anyString());
    }

    @Test
    void completedSlidePaysOnceWithTheSlidesPoints() {
        config(true, 15);
        publishedQuestion();
        enrolled();
        when(repo.findCompletionRows(SLIDE, USER)).thenReturn(List.of(op("PERCENTAGE_QUESTION_COMPLETED", "100.0")));
        when(ledger.award(eq(USER), eq(INST), eq(BATCH), eq(PointsSourceType.COURSE_ACTIVITY), eq(SLIDE), eq(15),
                anyString(), eq("COURSE_ACTIVITY:question-1:u1"))).thenReturn(Optional.of(new PointsLedger()));
        when(ledgerRepo.sumForUser(INST, USER)).thenReturn(145L);

        SlideEngagementService.LearnerView v = service.claim(user, SLIDE, BATCH);

        assertTrue(v.active());
        assertTrue(v.earned());
        assertEquals(15, v.pointsAwarded());
        assertEquals(145L, v.newTotalPoints());
    }

    @Test
    void notCompletedYetPaysNothingButShowsWhatItIsWorth() {
        config(true, 10);
        publishedQuestion();
        enrolled();
        when(repo.findCompletionRows(SLIDE, USER)).thenReturn(List.of());

        SlideEngagementService.LearnerView v = service.claim(user, SLIDE, BATCH);

        assertTrue(v.active());
        assertFalse(v.completed());
        assertEquals(10, v.points());
        assertEquals(0, v.pointsAwarded());
        verify(ledger, never()).award(anyString(), anyString(), any(), any(), anyString(), anyInt(), anyString(),
                anyString());
    }

    @Test
    void alreadyEarnedIsNotPaidAgain() {
        config(true, 10);
        publishedQuestion();
        enrolled();
        when(ledgerRepo.existsByIdempotencyKey("COURSE_ACTIVITY:question-1:u1")).thenReturn(true);

        SlideEngagementService.LearnerView v = service.claim(user, SLIDE, BATCH);

        assertTrue(v.earned());
        assertEquals(0, v.pointsAwarded());
        assertNull(v.newTotalPoints());
        verify(repo, never()).findCompletionRows(anyString(), anyString());
    }

    @Test
    void aTeacherPreviewingIsNotEnrolledAndEarnsNothing() {
        config(true, 10);
        publishedQuestion();
        when(memberships.findLiveMemberships(USER, SLIDE)).thenReturn(List.of());

        assertFalse(service.claim(user, SLIDE, BATCH).active());
    }

    @Test
    void institutesWithPointsOffEarnNothing() {
        config(true, 10);
        publishedQuestion();
        enrolled();
        when(scoring.isEnabled(INST)).thenReturn(false);

        assertFalse(service.claim(user, SLIDE, BATCH).active());
    }

    @Test
    void switchedOffKeepsEarnedPointsOnShowButPaysNoMore() {
        config(false, 10);
        publishedQuestion();
        enrolled();
        when(ledgerRepo.existsByIdempotencyKey("COURSE_ACTIVITY:question-1:u1")).thenReturn(true);

        SlideEngagementService.LearnerView v = service.claim(user, SLIDE, BATCH);

        assertFalse(v.active());
        assertTrue(v.earned());
        assertEquals(10, v.points());
    }

    @Test
    void draftSlidesEarnNothing() {
        config(true, 10);
        when(repo.findSlideKind(SLIDE)).thenReturn(Optional.of(slide("DRAFT", "QUESTION", null)));
        enrolled();

        assertFalse(service.claim(user, SLIDE, BATCH).active());
    }

    @Test
    void theRequestedBatchIsCreditedWhenTheLearnerIsInSeveral() {
        config(true, 10);
        publishedQuestion();
        when(memberships.findLiveMemberships(USER, SLIDE))
                .thenReturn(List.of(member(INST, "other"), member(INST, BATCH)));
        when(repo.findCompletionRows(SLIDE, USER)).thenReturn(List.of(op("MARKED_AS_WATCHED", "true")));
        when(ledger.award(anyString(), anyString(), any(), any(), anyString(), anyInt(), anyString(), anyString()))
                .thenReturn(Optional.of(new PointsLedger()));

        service.claim(user, SLIDE, BATCH);

        verify(ledger).award(eq(USER), eq(INST), eq(BATCH), eq(PointsSourceType.COURSE_ACTIVITY), eq(SLIDE),
                eq(10), anyString(), anyString());
    }

    @Test
    void claimNeedsASignedInLearner() {
        assertThrows(ForbiddenException.class, () -> service.claim(null, SLIDE, BATCH));
    }

    // ── staff ────────────────────────────────────────────────────────────────

    @Test
    void staffCannotMarkAVideo() {
        when(repo.findSlideKind(SLIDE)).thenReturn(Optional.of(slide("PUBLISHED", "VIDEO", null)));
        when(memberships.findInstitutesOfSlide(SLIDE)).thenReturn(List.of(INST));

        assertThrows(VacademyException.class, () -> service.adminSet(user, INST, SLIDE, true, 10));
    }

    @Test
    void staffCannotTouchAnotherInstitutesSlide() {
        publishedQuestion();
        when(memberships.findInstitutesOfSlide(SLIDE)).thenReturn(List.of("someone-else"));

        assertThrows(ForbiddenException.class, () -> service.adminSet(user, INST, SLIDE, true, 10));
    }

    @Test
    void pointsMustBeBetweenOneAndAHundred() {
        publishedQuestion();
        when(memberships.findInstitutesOfSlide(SLIDE)).thenReturn(List.of(INST));
        when(repo.findById(SLIDE)).thenReturn(Optional.empty());

        assertThrows(VacademyException.class, () -> service.adminSet(user, INST, SLIDE, true, 0));
        assertThrows(VacademyException.class, () -> service.adminSet(user, INST, SLIDE, true, 101));
    }

    @Test
    void switchingOnSavesTheDefaultPoints() {
        publishedQuestion();
        when(memberships.findInstitutesOfSlide(SLIDE)).thenReturn(List.of(INST));
        when(repo.findById(SLIDE)).thenReturn(Optional.empty());
        when(repo.save(any(SlideEngagement.class))).thenAnswer(i -> i.getArgument(0));

        SlideEngagementService.AdminView v = service.adminSet(user, INST, SLIDE, true, null);

        assertTrue(v.enabled());
        assertEquals(SlideEngagementService.DEFAULT_POINTS, v.points());
        assertTrue(v.gamificationOn());
    }
}
