package vacademy.io.assessment_service.features.submission_review;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.ReleaseStateWriter;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.submission_review.entity.MarkEvent;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.assessment_service.features.submission_review.repository.MarkEventRepository;
import vacademy.io.assessment_service.features.submission_review.service.MarkHistory;
import vacademy.io.assessment_service.features.submission_review.service.PaperOutline;
import vacademy.io.assessment_service.features.submission_review.service.Review;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionResultMailer;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewListeners;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewStore;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionSnapshots;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.entity;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.key;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.row;

/** Release, withdraw, send update, release-when-marked and the release classifier (contract 6). */
class SubmissionReleaseServiceTest {

    private StudentAttemptRepository attempts;
    private QuestionWiseMarksRepository marks;
    private SubmissionReviewStore store;
    private PaperOutline paperOutline;
    private MarkEventRepository events;
    private SubmissionResultMailer mailer;
    private SubmissionReleaseService service;
    private Assessment assessment;
    private StudentAttempt attempt;
    private List<QuestionWiseMarks> rows;

    @BeforeEach
    void setUp() {
        attempts = mock(StudentAttemptRepository.class);
        marks = mock(QuestionWiseMarksRepository.class);
        store = mock(SubmissionReviewStore.class);
        paperOutline = mock(PaperOutline.class);
        events = mock(MarkEventRepository.class);
        mailer = mock(SubmissionResultMailer.class);
        service = new SubmissionReleaseService(attempts, marks, store, paperOutline, new SubmissionSnapshots(),
                new MarkHistory(events), mock(ReleaseStateWriter.class), mailer);
        assessment = ReviewFixtures.assessment("A", "AUTO", false);
        attempt = ReviewFixtures.attempt("att-1", assessment, "ENDED");
        when(attempts.findById("att-1")).thenReturn(Optional.of(attempt));
        when(paperOutline.get("A")).thenReturn(new Review.Paper("A", List.of(key("s1", "q1", 1, "MCQS", 2),
                key("s1", "q2", 2, "CBE_RESPONSE", 10))));
        when(store.runs("att-1")).thenReturn(Review.RunInfo.NONE);
        when(store.runs(anyList())).thenReturn(Map.of());
        rows = new ArrayList<>(List.of(entity("r1", attempt, "s1", "q1", 2, "CORRECT", null),
                entity("r2", attempt, "s1", "q2", 0, "PENDING", null)));
        rows.get(1).setResponseJson("{\"responseData\":{\"answer\":{\"parts\":{\"p1\":{\"html\":\"<p>Done</p>\"}}}}}");
        when(marks.lockAllForAttempt("att-1")).thenAnswer(i -> rows);
        when(store.rows(anyList())).thenAnswer(i -> rows.stream().map(Review.MarkRow::of).toList());
        when(store.attempt("att-1")).thenReturn(ReviewFixtures.state("att-1", "ENDED", false, 2.0, 0, null));
    }

    private List<MarkEvent> savedEvents() {
        ArgumentCaptor<MarkEvent> c = ArgumentCaptor.forClass(MarkEvent.class);
        verify(events, org.mockito.Mockito.atLeastOnce()).save(c.capture());
        return c.getAllValues();
    }

    @Test
    void acceptance2_release_blocked_returns_blockers() {
        assertThatThrownBy(() -> service.releaseOne("att-1", true, false, false, "PENDING|0", "teacher-1"))
                .isInstanceOfSatisfying(SubmissionReviewException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("BLOCKERS");
                    assertThat(e.getStatus().value()).isEqualTo(409);
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> blockers = (List<Map<String, Object>>) e.getDetails().get("blockers");
                    assertThat(blockers).hasSize(1);
                    assertThat(blockers.get(0)).containsEntry("key", "s1:q2").containsEntry("state", "NEEDS_MARKING")
                            .containsEntry("question_number", 2);
                });
        verify(attempts, never()).markReleasedState(anyString(), any(), anyBoolean(), any(), anyBoolean());
    }

    @Test
    void acceptance2_allow_unmarked_logs_released_with_unmarked() {
        var r = service.releaseOne("att-1", false, true, false, "PENDING|0", "teacher-1");
        assertThat(r.released()).isTrue();
        verify(attempts).markReleasedState(eq("att-1"), isNull(), eq(false), any(Date.class), eq(true));
        MarkEvent e = savedEvents().get(0);
        assertThat(e.getEventType()).isEqualTo("RELEASED_WITH_UNMARKED");
        assertThat(e.getPayloadJson()).contains("\"count\":1").contains("s1:q2");
        verify(mailer, never()).render(anyString(), any(), any());
    }

    @Test
    void release_when_marked_flags_instead_of_releasing() {
        var r = service.releaseOne("att-1", true, false, true, "PENDING|0", "teacher-1");
        assertThat(r.released()).isFalse();
        assertThat(r.releaseWhenMarked()).isTrue();
        verify(attempts).markReleaseWhenMarked(List.of("att-1"));
        verify(attempts, never()).markReleasedState(anyString(), any(), anyBoolean(), any(), anyBoolean());
    }

    @Test
    void ready_attempt_is_released_and_emailed_once() {
        rows.get(1).setMarksSource("MANUAL");
        rows.get(1).setMarkState("MARKED");
        rows.get(1).setMarks(7);
        var r = service.releaseOne("att-1", true, false, false, "PENDING|0", "teacher-1");
        assertThat(r.released()).isTrue();
        assertThat(savedEvents().get(0).getEventType()).isEqualTo("RELEASED");
        verify(mailer, times(1)).render("att-1", SubmissionReleaseService.Source.RENDER, "teacher-1");
    }

    @Test
    void already_released_and_api_exam_are_refused() {
        when(store.attempt("att-1")).thenReturn(ReviewFixtures.state("att-1", "ENDED", true, 2.0, 1, 1));
        assertThatThrownBy(() -> service.releaseOne("att-1", true, false, false, null, "t"))
                .isInstanceOfSatisfying(SubmissionReviewException.class,
                        e -> assertThat(e.getCode()).isEqualTo("ALREADY_RELEASED"));
        assessment.setSource("API");
        assertThatThrownBy(() -> service.sendUpdate("att-1", "t"))
                .isInstanceOfSatisfying(SubmissionReviewException.class, e -> assertThat(e.getCode()).isEqualTo("API_EXAM"));
    }

    @Test
    void acceptance10_drafts_logged_ai_accepted_on_release() {
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(6);
        rows.get(1).setMarkState("AI_DRAFT");
        service.markReleased("att-1", null, new SubmissionReleaseService.ReleaseContext("teacher-1",
                SubmissionReleaseService.Source.ROW, false));
        assertThat(rows.get(1).getMarkState()).isEqualTo("MARKED");
        assertThat(rows.get(1).getMarksSource()).isEqualTo("AI_REVIEWED");
        assertThat(rows.get(1).getRevision()).isEqualTo(1);
        List<String> types = savedEvents().stream().map(MarkEvent::getEventType).toList();
        assertThat(types).containsExactly("AI_ACCEPTED_ON_RELEASE", "RELEASED");
    }

    @Test
    void re_release_by_an_old_caller_is_logged_as_a_resend_and_keeps_nothing_else() {
        when(store.attempt("att-1")).thenReturn(ReviewFixtures.state("att-1", "ENDED", true, 2.0, 1, 1));
        service.markReleased("att-1", "pdf-1", SubmissionReleaseService.ReleaseContext.legacy("teacher-1"));
        verify(attempts).markReleasedState(eq("att-1"), eq("pdf-1"), eq(false), any(), eq(false));
        MarkEvent e = savedEvents().get(0);
        assertThat(e.getEventType()).isEqualTo("RELEASED");
        assertThat(e.getPayloadJson()).contains("\"resend\":true");
    }

    @Test
    void cron_release_writes_no_event_and_keeps_its_date() {
        when(store.attempt("att-1")).thenReturn(ReviewFixtures.state("att-1", "ENDED", true, 2.0, 1, 1));
        service.markReleased("att-1", "pdf-1", new SubmissionReleaseService.ReleaseContext(null,
                SubmissionReleaseService.Source.AUTO, false));
        verify(attempts).markReleasedState(eq("att-1"), eq("pdf-1"), eq(true), any(), eq(false));
        verify(events, never()).save(any());
    }

    @Test
    void acceptance3_send_update_releases_exactly_one_attempt() {
        when(store.attempt("att-1")).thenReturn(new SubmissionReviewStore.AttemptState("att-1", "ENDED", "RELEASED",
                new Date(1), 9.0, "COMPLETED", 4, 3, new Date(), false, null, new Date()));
        service.sendUpdate("att-1", "teacher-1");
        verify(attempts).markNotifiedToCurrent("att-1");
        MarkEvent e = savedEvents().get(0);
        assertThat(e.getEventType()).isEqualTo("UPDATE_SENT");
        assertThat(e.getPayloadJson()).contains("\"marks_revision\":4");
        verify(mailer, times(1)).render("att-1", SubmissionReleaseService.Source.SEND_UPDATE, "teacher-1");
    }

    @Test
    void send_update_render_keeps_the_release_date_and_writes_no_release_event() {
        when(store.attempt("att-1")).thenReturn(ReviewFixtures.state("att-1", "ENDED", true, 2.0, 4, 4));
        service.markReleased("att-1", "pdf-2", new SubmissionReleaseService.ReleaseContext("t",
                SubmissionReleaseService.Source.SEND_UPDATE, false));
        verify(attempts).markReleasedState(eq("att-1"), eq("pdf-2"), eq(true), any(), eq(false));
        verify(events, never()).save(any());
    }

    @Test
    void withdraw_needs_a_released_result() {
        assertThatThrownBy(() -> service.withdraw("att-1", null, "t"))
                .isInstanceOfSatisfying(SubmissionReviewException.class,
                        e -> assertThat(e.getCode()).isEqualTo("NOT_RELEASED"));
        when(store.attempt("att-1")).thenReturn(ReviewFixtures.state("att-1", "ENDED", true, 2.0, 1, 1));
        service.withdraw("att-1", "Wrong key", "t");
        verify(attempts).markWithdrawn(eq("att-1"), any(Date.class));
        assertThat(savedEvents().get(0).getEventType()).isEqualTo("WITHDRAWN");
    }

    @Test
    void acceptance10_release_when_marked_listener_releases_a_completed_attempt_once() {
        when(store.attempt("att-1")).thenReturn(new SubmissionReviewStore.AttemptState("att-1", "ENDED", "PENDING",
                null, 9.0, "COMPLETED", 2, null, null, true, null, new Date()));
        rows.get(1).setMarksSource("MANUAL");
        rows.get(1).setMarkState("MARKED");
        new SubmissionReviewListeners(service).onReadyForRelease(
                new vacademy.io.assessment_service.features.submission_review.service.ReviewEvents.AttemptReadyForRelease(
                        "att-1", "teacher-1"));
        verify(attempts).markReleasedState(eq("att-1"), isNull(), eq(false), any(), eq(true));
        verify(mailer, times(1)).render("att-1", SubmissionReleaseService.Source.RENDER, "teacher-1");
    }

    @Test
    void release_when_marked_does_nothing_for_an_incomplete_attempt() {
        assertThat(service.releaseWhenMarked("att-1", "t")).isFalse();
        verify(mailer, never()).render(anyString(), any(), any());
    }

    /** Acceptance 10: 49 attempts - 41 ready, 3 unmarked, 2 AI active, 3 drafts. */
    @Test
    void acceptance10_release_classifier_and_bulk_plan() {
        when(paperOutline.get("A")).thenReturn(new Review.Paper("A", List.of(key("s1", "q1", 1, "CBE_RESPONSE", 10))));
        List<SubmissionReviewStore.AttemptState> states = new ArrayList<>();
        List<Review.MarkRow> allRows = new ArrayList<>();
        Map<String, Review.RunInfo> runs = new HashMap<>();
        String answered = "{\"responseData\":{\"answer\":{\"parts\":{\"p1\":{\"html\":\"<p>x</p>\"}}}}}";
        for (int i = 0; i < 49; i++) {
            String id = String.format("a%02d", i);
            states.add(ReviewFixtures.state(id, "ENDED", false, 5.0, 0, null));
            if (i < 41) {
                allRows.add(withAttempt(row("r" + i, "s1", "q1", 5, "CORRECT", "MANUAL", "MARKED", 1), id));
            } else if (i < 44) {
                allRows.add(new Review.MarkRow("r" + i, id, "s1", "q1", 0, "PENDING", null, null, 0, null, null, null,
                        false, null, null, new Date(1), answered));
            } else if (i < 46) {
                allRows.add(new Review.MarkRow("r" + i, id, "s1", "q1", 0, "PENDING", null, null, 0, null, null, null,
                        false, null, null, new Date(1), answered));
                var p = new Review.ProcessInfo("p" + i, "EVALUATING", "TYPED", "t", null, null, 0, 3, null, null,
                        new Date());
                runs.put(id, new Review.RunInfo(p, p, null, Map.of()));
            } else {
                allRows.add(withAttempt(row("r" + i, "s1", "q1", 6, "PENDING", "AI", null, 1), id));
            }
        }
        when(store.rows(anyList())).thenReturn(allRows);
        when(store.runs(anyList())).thenReturn(runs);
        var classes = service.classify(assessment, states);
        Map<SubmissionReleaseService.ReleaseClass, Long> counts = new HashMap<>();
        classes.forEach(c -> counts.merge(c.cls(), 1L, Long::sum));
        assertThat(counts).containsEntry(SubmissionReleaseService.ReleaseClass.READY, 41L)
                .containsEntry(SubmissionReleaseService.ReleaseClass.UNMARKED, 3L)
                .containsEntry(SubmissionReleaseService.ReleaseClass.AI_CHECKING, 2L)
                .containsEntry(SubmissionReleaseService.ReleaseClass.AI_DRAFTS, 3L);

        when(store.attempts(eq("A"), anyList())).thenReturn(states);
        List<String> release = service.planBulkRelease(assessment,
                states.stream().map(SubmissionReviewStore.AttemptState::id).toList(), true, true, null, true);
        assertThat(release).hasSize(44);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<java.util.Collection<String>> flagged = ArgumentCaptor.forClass(java.util.Collection.class);
        verify(attempts).markReleaseWhenMarked(flagged.capture());
        assertThat(flagged.getValue()).hasSize(5);
        verify(attempts).lockByIdsOrdered(anyList());
    }

    // ---------------------------------------------------------------- review fixes (2026-11-18)

    private SubmissionReviewStore.AttemptState pending(String resultStatus, boolean flagged, Date withheldAt) {
        return new SubmissionReviewStore.AttemptState("att-1", "ENDED", "PENDING", null, 2.0, resultStatus, 1, null,
                null, flagged, null, new Date(), withheldAt);
    }

    /** Review 1 #2 / 2 #3: an AI draft as the callback writes it (source AI, no state) is accepted. */
    @Test
    void release_accepts_derived_ai_drafts_as_reviewed() {
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(6);
        rows.get(1).setRevision(3);
        var out = service.markReleased("att-1", null, new SubmissionReleaseService.ReleaseContext("teacher-1",
                SubmissionReleaseService.Source.ROW, false));
        assertThat(out.acceptedAiDrafts()).isEqualTo(1);
        assertThat(rows.get(1).getMarkState()).isEqualTo("MARKED");
        assertThat(rows.get(1).getMarksSource()).isEqualTo("AI_REVIEWED");
        assertThat(rows.get(1).getMarkedBy()).isEqualTo("teacher-1");
        assertThat(rows.get(1).getRevision()).isEqualTo(4);
        verify(marks).save(rows.get(1));
        assertThat(savedEvents().get(0).getEventType()).isEqualTo("AI_ACCEPTED_ON_RELEASE");
    }

    /**
     * Pre-ship review R3: a CBE-only run held the attempt EVALUATING with an AI draft. The
     * teacher's release accepts the draft, so the stored result status becomes COMPLETED
     * (and the total the R6 total) through MarkWriter's write - never released EVALUATING.
     */
    @Test
    void release_that_accepts_held_drafts_stores_completed() {
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(6);
        var cbeOnly = new Review.ProcessInfo("p1", "COMPLETED", "TYPED", null, null, null, 1, 1, null, null,
                new Date());
        when(store.runs("att-1")).thenReturn(new Review.RunInfo(null, cbeOnly, cbeOnly, Map.of()));
        when(store.attempt("att-1")).thenReturn(pending("EVALUATING", false, null));
        var out = service.markReleased("att-1", "pdf-1", new SubmissionReleaseService.ReleaseContext("teacher-1",
                SubmissionReleaseService.Source.MANUAL_SUBMIT, false));
        assertThat(out.acceptedAiDrafts()).isEqualTo(1);
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(attempts);
        order.verify(attempts).applyMarkTotals(eq("att-1"), eq(8.0), eq("COMPLETED"), eq(false), any(Date.class));
        order.verify(attempts).markReleasedState(eq("att-1"), eq("pdf-1"), eq(false), any(), eq(true));
    }

    /** No draft accepted (nothing changed): the release does not touch the stored totals. */
    @Test
    void release_without_drafts_does_not_rewrite_totals() {
        rows.get(1).setMarksSource("MANUAL");
        rows.get(1).setMarkState("MARKED");
        when(store.attempt("att-1")).thenReturn(pending("COMPLETED", false, null));
        service.markReleased("att-1", null, new SubmissionReleaseService.ReleaseContext("teacher-1",
                SubmissionReleaseService.Source.ROW, false));
        verify(attempts, never()).applyMarkTotals(anyString(), org.mockito.ArgumentMatchers.anyDouble(), any(),
                anyBoolean(), any());
        verify(attempts).markReleasedState(eq("att-1"), isNull(), eq(false), any(), eq(true));
    }

    /** The cron accepts nothing, so it leaves a held attempt's status for a teacher. */
    @Test
    void cron_release_does_not_rewrite_totals() {
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(6);
        when(store.attempt("att-1")).thenReturn(pending("EVALUATING", false, null));
        service.markReleased("att-1", null, new SubmissionReleaseService.ReleaseContext(null,
                SubmissionReleaseService.Source.AUTO, false));
        verify(attempts, never()).applyMarkTotals(anyString(), org.mockito.ArgumentMatchers.anyDouble(), any(),
                anyBoolean(), any());
    }

    /** Acceptance 11: the cron (no teacher) leaves the AI's drafts as they are. */
    @Test
    void cron_release_does_not_accept_drafts() {
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(6);
        service.markReleased("att-1", "pdf-1", new SubmissionReleaseService.ReleaseContext(null,
                SubmissionReleaseService.Source.AUTO, false));
        assertThat(rows.get(1).getMarksSource()).isEqualTo("AI");
        assertThat(rows.get(1).getMarkState()).isNull();
        verify(marks, never()).save(any());
    }

    /** Review 2 #2: a render / update that runs after "Hide result again" does not release. */
    @Test
    void render_after_a_hide_does_not_release_again() {
        var out = service.markReleased("att-1", "pdf-1", new SubmissionReleaseService.ReleaseContext("t",
                SubmissionReleaseService.Source.RENDER, false));
        assertThat(out.released()).isFalse();
        var update = service.markReleased("att-1", "pdf-1", new SubmissionReleaseService.ReleaseContext("t",
                SubmissionReleaseService.Source.SEND_UPDATE, false));
        assertThat(update.released()).isFalse();
        verify(attempts, never()).markReleasedState(anyString(), any(), anyBoolean(), any(), anyBoolean());
    }

    /** Review 2 #2: a bulk release asked for before the teacher hid the result is skipped. */
    @Test
    void bulk_release_planned_before_a_hide_is_skipped() {
        Date asked = new Date(1_000L);
        when(store.attempt("att-1")).thenReturn(pending("COMPLETED", false, new Date(2_000L)));
        var out = service.markReleased("att-1", "pdf-1", new SubmissionReleaseService.ReleaseContext("t",
                SubmissionReleaseService.Source.BULK, false, asked));
        assertThat(out.released()).isFalse();
        verify(attempts, never()).markReleasedState(anyString(), any(), anyBoolean(), any(), anyBoolean());

        // Hidden earlier, released again by a teacher now: goes out, and starts a fresh "Revised".
        when(store.attempt("att-1")).thenReturn(pending("COMPLETED", false, new Date(500L)));
        assertThat(service.markReleased("att-1", "pdf-1", new SubmissionReleaseService.ReleaseContext("t",
                SubmissionReleaseService.Source.BULK, false, asked)).released()).isTrue();
        verify(attempts).markReleasedState(eq("att-1"), eq("pdf-1"), eq(false), any(), eq(true));
    }

    /** Review 2 #1: the cron's AUTO write never re-releases a hidden result. */
    @Test
    void automatic_release_of_a_hidden_result_is_skipped() {
        when(store.attempt("att-1")).thenReturn(pending("COMPLETED", false, new Date(500L)));
        assertThat(service.markReleased("att-1", null, new SubmissionReleaseService.ReleaseContext(null,
                SubmissionReleaseService.Source.AUTO, false)).released()).isFalse();
    }

    /** Review 2 #4: flagged + only AI drafts left (EVALUATING on an AI-off test) is released. */
    @Test
    void release_when_marked_releases_a_flagged_attempt_with_only_drafts() {
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(6);
        when(store.attempt("att-1")).thenReturn(pending("EVALUATING", true, null));
        assertThat(service.releaseWhenMarked("att-1", "teacher-1")).isTrue();
        verify(attempts).markReleasedState(eq("att-1"), isNull(), eq(false), any(), eq(true));
        verify(mailer, times(1)).render("att-1", SubmissionReleaseService.Source.RENDER, "teacher-1");
    }

    @Test
    void release_when_marked_waits_while_an_answer_needs_marking() {
        when(store.attempt("att-1")).thenReturn(pending("COMPLETED", true, null));
        assertThat(service.releaseWhenMarked("att-1", "teacher-1")).isFalse();
        verify(attempts, never()).markReleasedState(anyString(), any(), anyBoolean(), any(), anyBoolean());
    }

    /** Review 2 #6: AUTO_AFTER_SUBMISSION practice test - released, but no result message. */
    @Test
    void auto_release_on_marking_sends_no_message_for_a_practice_test() {
        assessment.setResultType("AUTO_AFTER_SUBMISSION");
        assessment.setPlayMode("PRACTICE");
        rows.get(1).setMarksSource("MANUAL");
        rows.get(1).setMarkState("MARKED");
        when(store.attempt("att-1")).thenReturn(pending("COMPLETED", false, null));
        assertThat(service.releaseWhenMarked("att-1", "teacher-1")).isTrue();
        verify(attempts).markReleasedState(eq("att-1"), isNull(), eq(false), any(), eq(true));
        verify(mailer, never()).render(anyString(), any(), any());

        assessment.setPlayMode("EXAM");
        service.releaseWhenMarked("att-1", "teacher-1");
        verify(mailer, times(1)).render("att-1", SubmissionReleaseService.Source.RENDER, "teacher-1");
    }

    /** Review 2 #1: a hidden AUTO_AFTER_SUBMISSION result is not released when marking completes. */
    @Test
    void auto_release_on_marking_skips_a_hidden_result() {
        assessment.setResultType("AUTO_AFTER_SUBMISSION");
        when(store.attempt("att-1")).thenReturn(pending("COMPLETED", false, new Date()));
        assertThat(service.releaseWhenMarked("att-1", "teacher-1")).isFalse();
    }

    /** Review 2 #5: W9 never releases a learner who has not submitted (incl. one still taking the test). */
    @Test
    void bulk_plan_skips_live_and_not_submitted_attempts() {
        var live = ReviewFixtures.state("live", "LIVE", false, null, 0, null);
        var preview = ReviewFixtures.state("prev", "PREVIEW", false, null, 0, null);
        when(store.attempts(eq("A"), anyList())).thenReturn(List.of(live, preview));
        when(store.rows(anyList())).thenReturn(List.of());
        assertThat(service.planBulkRelease(assessment, List.of("live", "prev"), true, true, null, true)).isEmpty();
        assertThat(service.planBulkRelease(assessment, List.of("live", "prev"), null, null, true, null)).isEmpty();
    }

    private static Review.MarkRow withAttempt(Review.MarkRow r, String attemptId) {
        return new Review.MarkRow(r.id(), attemptId, r.sectionId(), r.questionId(), r.marks(), r.status(),
                r.marksSource(), r.markState(), r.revision(), r.maxMarks(), r.markedBy(), r.markedAt(), r.hasFeedback(),
                r.answerPages(), r.aiQuestionEvaluationId(), r.createdAt(), r.responseJson());
    }

    // ---------------------------------------------------------------- live follow-ups 2026-11-19

    /** B1: release-time AI acceptance sets the legacy status from the mark (10 of 10 = CORRECT). */
    @Test
    void release_accepting_ai_drafts_sets_the_status_from_the_mark() {
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(10);
        service.markReleased("att-1", null, new SubmissionReleaseService.ReleaseContext("teacher-1",
                SubmissionReleaseService.Source.ROW, false));
        assertThat(rows.get(1).getStatus()).isEqualTo("CORRECT");

        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarkState(null);
        rows.get(1).setMarks(6);
        rows.get(1).setStatus("PENDING");
        service.markReleased("att-1", null, new SubmissionReleaseService.ReleaseContext("teacher-1",
                SubmissionReleaseService.Source.ROW, false));
        assertThat(rows.get(1).getStatus()).isEqualTo("PARTIAL_CORRECT");
    }

    /**
     * Review issue B1-blank-ai-zero-now-incorrect: Release taking the AI's 0 for a CBE answer
     * left blank keeps it PENDING (skipped on the learner report); a 0 on a written one is
     * INCORRECT.
     */
    @Test
    void release_accepting_an_ai_zero_on_a_blank_answer_keeps_it_skipped() {
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(0);
        rows.get(1).setResponseJson("{\"responseData\":{\"answer\":{\"parts\":{\"p1\":{\"html\":\"\"}}}}}");
        service.markReleased("att-1", null, new SubmissionReleaseService.ReleaseContext("teacher-1",
                SubmissionReleaseService.Source.ROW, false));
        assertThat(rows.get(1).getMarksSource()).isEqualTo("AI_REVIEWED");
        assertThat(rows.get(1).getStatus()).isEqualTo("PENDING");

        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarkState(null);
        rows.get(1).setResponseJson("{\"responseData\":{\"answer\":{\"parts\":{\"p1\":{\"html\":\"<p>Done</p>\"}}}}}");
        service.markReleased("att-1", null, new SubmissionReleaseService.ReleaseContext("teacher-1",
                SubmissionReleaseService.Source.ROW, false));
        assertThat(rows.get(1).getStatus()).isEqualTo("INCORRECT");
    }

    /** B3: the 200 of "release anyway" carries the answers it left unmarked (history says the same). */
    @Test
    void release_anyway_reports_the_answers_left_unmarked() {
        var r = service.releaseOne("att-1", false, true, false, "PENDING|0", "teacher-1");
        assertThat(r.released()).isTrue();
        assertThat(r.unmarkedAtRelease()).isEqualTo(1);
        assertThat(savedEvents().get(0).getPayloadJson()).contains("\"count\":1");
    }
}
