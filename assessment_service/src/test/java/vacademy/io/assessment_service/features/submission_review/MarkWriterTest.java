package vacademy.io.assessment_service.features.submission_review;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.submission_review.entity.MarkEvent;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.assessment_service.features.submission_review.repository.MarkEventRepository;
import vacademy.io.assessment_service.features.submission_review.service.AiVerdictMirror;
import vacademy.io.assessment_service.features.submission_review.service.MarkHistory;
import vacademy.io.assessment_service.features.submission_review.service.MarkWriter;
import vacademy.io.assessment_service.features.submission_review.service.PaperOutline;
import vacademy.io.assessment_service.features.submission_review.service.Review;
import vacademy.io.assessment_service.features.submission_review.service.ReviewEvents;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewStore;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionSnapshots;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.entity;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.key;

/** MarkWriter (contract 3): acceptance 3, 4, 8, 10 and the precedence table. */
class MarkWriterTest {

    private StudentAttemptRepository attempts;
    private QuestionWiseMarksRepository marks;
    private SubmissionReviewStore store;
    private PaperOutline paperOutline;
    private MarkEventRepository events;
    private AiVerdictMirror mirror;
    private ApplicationEventPublisher publisher;
    private MarkWriter writer;
    private Assessment assessment;
    private StudentAttempt attempt;
    private List<QuestionWiseMarks> rows;
    private Review.Paper paper;

    @BeforeEach
    void setUp() {
        attempts = mock(StudentAttemptRepository.class);
        marks = mock(QuestionWiseMarksRepository.class);
        store = mock(SubmissionReviewStore.class);
        paperOutline = mock(PaperOutline.class);
        events = mock(MarkEventRepository.class);
        mirror = mock(AiVerdictMirror.class);
        publisher = mock(ApplicationEventPublisher.class);
        writer = new MarkWriter(attempts, marks, store, paperOutline, new SubmissionSnapshots(),
                new MarkHistory(events), mirror, new ResultLockGuard(), publisher, mock(SectionRepository.class),
                mock(QuestionRepository.class));
        assessment = ReviewFixtures.assessment("A", "AUTO", false);
        attempt = ReviewFixtures.attempt("att-1", assessment, "ENDED");
        paper = new Review.Paper("A", List.of(key("s1", "q1", 1, "MCQS", 2), key("s1", "q2", 2, "LONG_ANSWER", 10)));
        rows = new ArrayList<>(List.of(
                entity("r1", attempt, "s1", "q1", 2, "CORRECT", null),
                entity("r2", attempt, "s1", "q2", 0, "PENDING", null)));
        rows.get(1).setResponseJson("{\"responseData\":{\"answer\":\"An essay\"}}");
        when(attempts.lockById("att-1")).thenReturn("att-1");
        when(attempts.findById("att-1")).thenReturn(Optional.of(attempt));
        when(marks.lockAllForAttempt("att-1")).thenAnswer(i -> rows);
        when(marks.findByStudentAttemptId("att-1")).thenAnswer(i -> rows);
        when(paperOutline.get("A")).thenReturn(paper);
        when(store.runs("att-1")).thenReturn(Review.RunInfo.NONE);
        when(marks.save(any())).thenAnswer(i -> i.getArgument(0));
    }

    private void state(boolean released, double total, int revision) {
        when(store.attempt("att-1")).thenReturn(ReviewFixtures.state("att-1", "ENDED", released, total, revision,
                released ? revision : null));
    }

    private static String token(boolean released) {
        return released ? "RELEASED|1762861800000" : "PENDING|0";
    }

    private MarkWriter.MarkChange teacher(String q, Double value, Integer rev, String release, String reason,
                                          boolean notify) {
        return new MarkWriter.MarkChange("att-1", "s1", q, MarkWriter.Writer.TEACHER, value, null, null, false,
                reason, "teacher-1", rev, release, notify, null, null, null);
    }

    @SuppressWarnings("unchecked")
    private List<MarkEvent> savedEvents() {
        ArgumentCaptor<Collection<MarkEvent>> c = ArgumentCaptor.forClass(Collection.class);
        verify(events).saveAll(c.capture());
        return new ArrayList<>(c.getValue());
    }

    @Test
    void acceptance3_edit_after_release_sets_revised_and_total() {
        state(true, 2.0, 3);
        var result = writer.apply(teacher("q2", 7.0, 0, token(true), "Re-checked the essay", true));

        assertThat(result.totalBefore()).isEqualTo(2.0);
        assertThat(result.totalAfter()).isEqualTo(9.0);
        assertThat(result.marksRevision()).isEqualTo(4);
        assertThat(result.updateQueued()).isTrue();
        verify(attempts).applyMarkTotals(eq("att-1"), eq(9.0), eq("COMPLETED"), eq(true), any(Date.class));
        QuestionWiseMarks q2 = rows.get(1);
        assertThat(q2.getMarks()).isEqualTo(7.0);
        assertThat(q2.getMarksSource()).isEqualTo("MANUAL");
        assertThat(q2.getMarkState()).isEqualTo("MARKED");
        assertThat(q2.getRevision()).isEqualTo(1);
        assertThat(q2.getMarkedBy()).isEqualTo("teacher-1");
        assertThat(q2.getMaxMarks()).isEqualTo(10.0);
        List<MarkEvent> saved = savedEvents();
        assertThat(saved).hasSize(1);
        assertThat(saved.get(0).getEventType()).isEqualTo("TEACHER_EDITED");
        assertThat(saved.get(0).isAfterRelease()).isTrue();
        assertThat(saved.get(0).getReason()).isEqualTo("Re-checked the essay");
        assertThat(saved.get(0).getOldMarks()).isEqualTo(0.0);
        assertThat(saved.get(0).getNewMarks()).isEqualTo(7.0);
        verify(publisher).publishEvent(any(ReviewEvents.SendUpdateRequested.class));
    }

    @Test
    void acceptance4_stale_revision_is_409() {
        state(false, 2.0, 0);
        assertThatThrownBy(() -> writer.apply(teacher("q2", 7.0, 5, token(false), null, false)))
                .isInstanceOfSatisfying(SubmissionReviewException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("STALE_REVISION");
                    assertThat(e.getStatus().value()).isEqualTo(409);
                });
        verify(attempts, never()).applyMarkTotals(anyString(), anyDouble(), anyString(), anyBoolean(), any());
    }

    @Test
    void acceptance4_out_of_range_is_422_with_bounds() {
        state(false, 2.0, 0);
        assertThatThrownBy(() -> writer.apply(teacher("q2", 11.0, 0, token(false), null, false)))
                .isInstanceOfSatisfying(SubmissionReviewException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("OUT_OF_RANGE");
                    assertThat(e.getStatus().value()).isEqualTo(422);
                    assertThat(e.getDetails()).containsEntry("max", 10.0).containsEntry("min", 0.0);
                });
    }

    @Test
    void acceptance4_released_without_reason_is_422() {
        state(true, 2.0, 1);
        assertThatThrownBy(() -> writer.apply(teacher("q2", 7.0, 0, token(true), "  ", false)))
                .isInstanceOfSatisfying(SubmissionReviewException.class,
                        e -> assertThat(e.getCode()).isEqualTo("REASON_REQUIRED"));
    }

    @Test
    void acceptance4_release_token_mismatch_is_409() {
        state(true, 2.0, 1);
        assertThatThrownBy(() -> writer.apply(teacher("q2", 7.0, 0, token(false), "x", false)))
                .isInstanceOfSatisfying(SubmissionReviewException.class,
                        e -> assertThat(e.getCode()).isEqualTo("RELEASE_CHANGED"));
    }

    @Test
    void unsubmitted_attempt_and_key_off_the_paper_are_422() {
        state(false, 2.0, 0);
        assertThatThrownBy(() -> writer.apply(new MarkWriter.MarkChange("att-1", "s9", "q9", MarkWriter.Writer.TEACHER,
                1.0, null, null, false, null, "t", 0, token(false), false, null, null, null)))
                .isInstanceOfSatisfying(SubmissionReviewException.class,
                        e -> assertThat(e.getCode()).isEqualTo("NOT_IN_PAPER"));
        when(store.attempt("att-1")).thenReturn(ReviewFixtures.state("att-1", "LIVE", false, 0.0, 0, null));
        assertThatThrownBy(() -> writer.apply(teacher("q2", 1.0, 0, token(false), null, false)))
                .isInstanceOfSatisfying(SubmissionReviewException.class,
                        e -> assertThat(e.getCode()).isEqualTo("ATTEMPT_NOT_SUBMITTED"));
    }

    @Test
    void acceptance8_quick_marks_one_lock_one_update_ten_events() {
        List<Review.PaperKey> keys = new ArrayList<>();
        rows.clear();
        for (int i = 1; i <= 10; i++) {
            keys.add(key("s1", "q" + i, i, "LONG_ANSWER", 10));
            QuestionWiseMarks r = entity("r" + i, attempt, "s1", "q" + i, 0, "PENDING", null);
            r.setResponseJson("{\"responseData\":{\"answer\":\"text " + i + "\"}}");
            rows.add(r);
        }
        when(paperOutline.get("A")).thenReturn(new Review.Paper("A", keys));
        state(false, 0.0, 0);
        List<MarkWriter.MarkChange> items = new ArrayList<>();
        for (int i = 1; i <= 6; i++) items.add(teacher("q" + i, (double) i, 0, null, null, false));
        for (int i = 7; i <= 10; i++) {
            items.add(new MarkWriter.MarkChange("att-1", "s1", "q" + i, MarkWriter.Writer.TEACHER, null, null, null,
                    true, null, "teacher-1", 0, null, false, null, null, null));
        }
        var r = writer.applyAll("att-1", items, new MarkWriter.BatchContext(null, token(false), false, "teacher-1",
                MarkWriter.Writer.TEACHER));

        assertThat(r.changed()).isEqualTo(10);
        assertThat(r.totalAfter()).isEqualTo(21.0);
        verify(attempts, times(1)).lockById("att-1");
        verify(attempts, times(1)).applyMarkTotals(eq("att-1"), eq(21.0), eq("COMPLETED"), eq(false), any());
        assertThat(savedEvents()).hasSize(10).allMatch(e -> e.getEventType().equals("TEACHER_EDITED"));
        assertThat(rows.get(9).getMarkState()).isEqualTo("NOT_ANSWERED");
        assertThat(rows.get(9).getStatus()).isEqualTo("PENDING");
    }

    @Test
    void quick_marks_with_one_stale_item_writes_nothing() {
        state(false, 2.0, 0);
        List<MarkWriter.MarkChange> items = List.of(teacher("q1", 1.0, 0, null, null, false),
                teacher("q2", 5.0, 3, null, null, false));
        assertThatThrownBy(() -> writer.applyAll("att-1", items, new MarkWriter.BatchContext(null, token(false), false,
                "t", MarkWriter.Writer.TEACHER)))
                .isInstanceOfSatisfying(SubmissionReviewException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("STALE_REVISION");
                    assertThat(e.getDetails()).containsEntry("stale_keys", List.of("s1:q2"));
                });
        verify(marks, never()).save(any());
    }

    @Test
    void acceptance10_completing_a_flagged_attempt_publishes_ready_event() {
        when(store.attempt("att-1")).thenReturn(new SubmissionReviewStore.AttemptState("att-1", "ENDED", "PENDING",
                null, 2.0, "PENDING", 0, null, null, true, null, new Date()));
        var r = writer.apply(teacher("q2", 6.0, 0, token(false), null, false));
        assertThat(r.releaseQueued()).isTrue();
        verify(publisher).publishEvent(any(ReviewEvents.AttemptReadyForRelease.class));
    }

    @Test
    void auto_after_submission_test_is_released_once_a_teacher_completes_it() {
        assessment.setResultType("AUTO_AFTER_SUBMISSION");
        state(false, 2.0, 0);
        writer.apply(teacher("q2", 6.0, 0, token(false), null, false));
        verify(publisher).publishEvent(any(ReviewEvents.AttemptReadyForRelease.class));
    }

    @Test
    void teacher_keeping_the_ai_value_marks_it_ai_reviewed_and_changing_it_marks_manual() {
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(6);
        state(false, 8.0, 0);
        writer.apply(teacher("q2", 6.0, 0, token(false), null, false));
        assertThat(rows.get(1).getMarksSource()).isEqualTo("AI_REVIEWED");

        rows.get(1).setMarksSource("AI");
        writer.apply(teacher("q2", 4.0, 1, token(false), null, false));
        assertThat(rows.get(1).getMarksSource()).isEqualTo("MANUAL");
    }

    @Test
    void answer_key_never_overwrites_a_teacher_mark_without_force() {
        rows.get(0).setMarksSource("MANUAL");
        rows.get(0).setMarkState("MARKED");
        state(false, 2.0, 0);
        var change = new MarkWriter.MarkChange("att-1", "s1", "q1", MarkWriter.Writer.ANSWER_KEY, 0.0, null, null,
                false, null, "t", null, token(false), false, null, "INCORRECT", null);
        assertThatThrownBy(() -> writer.apply(change)).isInstanceOfSatisfying(SubmissionReviewException.class,
                e -> assertThat(e.getCode()).isEqualTo("PROTECTED_MARK"));

        var forced = new MarkWriter.MarkChange("att-1", "s1", "q1", MarkWriter.Writer.ANSWER_KEY_FORCE, 0.0, null,
                null, false, null, "admin-1", null, token(false), false, null, "INCORRECT", null);
        writer.apply(forced);
        assertThat(rows.get(0).getMarksSource()).isEqualTo("AUTO");
        assertThat(savedEvents().get(0).getEventType()).isEqualTo("OVERRIDE_TEACHER");
    }

    @Test
    void legacy_manual_submit_clamps_and_never_needs_a_reason() {
        state(true, 2.0, 2);
        var change = new MarkWriter.MarkChange("att-1", "s1", "q2", MarkWriter.Writer.LEGACY_MANUAL_SUBMIT, 15.0, null,
                null, false, null, "t", null, null, false, null, null, null);
        writer.applyAll("att-1", List.of(change), new MarkWriter.BatchContext(null, null, false, "t",
                MarkWriter.Writer.LEGACY_MANUAL_SUBMIT));
        assertThat(rows.get(1).getMarks()).isEqualTo(10.0);
        assertThat(rows.get(1).getMarksSource()).isEqualTo("MANUAL");
        assertThat(savedEvents().get(0).getReason()).isEqualTo("Marked on the answer sheet");
    }

    @Test
    void part_marks_must_add_up() {
        state(false, 2.0, 0);
        var change = new MarkWriter.MarkChange("att-1", "s1", "q2", MarkWriter.Writer.TEACHER, 7.0,
                List.of(new MarkWriter.PartMark("Defines", 2, 2.0), new MarkWriter.PartMark("Explains", 4, 8.0)), null,
                false, null, "t", 0, token(false), false, null, null, null);
        assertThatThrownBy(() -> writer.apply(change)).isInstanceOfSatisfying(SubmissionReviewException.class,
                e -> assertThat(e.getCode()).isEqualTo("PART_MARKS_SUM_MISMATCH"));
    }

    @Test
    void preview_writes_nothing_and_reports_the_new_total() {
        state(false, 2.0, 0);
        var r = writer.preview(teacher("q2", 5.0, 9, token(false), null, false));
        assertThat(r.totalAfter()).isEqualTo(7.0);
        verify(marks, never()).save(any());
        verify(attempts, never()).lockById(anyString());
        verify(attempts, never()).applyMarkTotals(anyString(), anyDouble(), anyString(), anyBoolean(), any());
    }

    @Test
    void stored_total_that_disagrees_logs_total_recomputed() {
        state(false, 13.0, 0);
        var r = writer.apply(teacher("q2", 6.0, 0, token(false), null, false));
        assertThat(r.totalRecomputed()).isNotNull();
        assertThat(r.totalRecomputed().storedTotal()).isEqualTo(13.0);
        assertThat(r.totalRecomputed().r6Before()).isEqualTo(2.0);
        assertThat(savedEvents()).extracting(MarkEvent::getEventType).contains("TOTAL_RECOMPUTED", "TEACHER_EDITED");
    }

    // ---------------------------------------------------------------- review fixes (2026-11-18)

    /** Review 1 #5: an imported total with no question rows is not replaced by one question's mark. */
    @Test
    void total_only_attempt_refuses_a_single_question_edit() {
        rows.clear();
        state(false, 78.0, 0);
        assertThatThrownBy(() -> writer.apply(teacher("q2", 5.0, 0, token(false), null, false)))
                .isInstanceOfSatisfying(SubmissionReviewException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("TOTAL_ONLY");
                    assertThat(e.getStatus().value()).isEqualTo(422);
                });
        verify(attempts, never()).applyMarkTotals(anyString(), anyDouble(), any(), anyBoolean(), any());
    }

    /** Review 1 #6: the PDF tool's empty boxes on a hand-marked copy become Not answered (COMPLETED). */
    @Test
    void manual_submit_on_a_handwritten_copy_records_empty_boxes_as_not_answered() {
        Assessment handwritten = ReviewFixtures.assessment("A", "MANUAL", false);
        attempt.getRegistration().setAssessment(handwritten);
        state(false, 0.0, 0);
        rows.clear();
        rows.add(entity("r1", attempt, "s1", "q1", 0, "PENDING", null));
        rows.add(entity("r2", attempt, "s1", "q2", 0, "PENDING", null));
        var change = new MarkWriter.MarkChange("att-1", "s1", "q1", MarkWriter.Writer.LEGACY_MANUAL_SUBMIT, 2.0, null,
                null, false, null, "teacher-1", null, null, false, null, null, null);
        var r = writer.applyAll("att-1", List.of(change), new MarkWriter.BatchContext(null, null, false, "teacher-1",
                MarkWriter.Writer.LEGACY_MANUAL_SUBMIT));
        assertThat(r.changed()).isEqualTo(2);
        QuestionWiseMarks q2 = rows.get(1);
        assertThat(q2.getMarkState()).isEqualTo("NOT_ANSWERED");
        assertThat(q2.getMarksSource()).isEqualTo("MANUAL");
        assertThat(q2.getStatus()).isEqualTo("PENDING");
        verify(attempts).applyMarkTotals(eq("att-1"), eq(2.0), eq("COMPLETED"), eq(false), any(Date.class));
        assertThat(savedEvents()).extracting(MarkEvent::getReason).contains("Left blank on the answer sheet");
    }

    private List<MarkWriter.MarkChange> pdfToolSubmit(String... questionIds) {
        List<MarkWriter.MarkChange> out = new ArrayList<>();
        for (String q : questionIds) {
            out.add(new MarkWriter.MarkChange("att-1", "s1", q, MarkWriter.Writer.LEGACY_MANUAL_SUBMIT, 2.0, null,
                    null, false, null, "teacher-1", null, null, false, null, null, null));
        }
        return out;
    }

    private void fivePendingLongAnswers(Assessment a) {
        attempt.getRegistration().setAssessment(a);
        List<Review.PaperKey> keys = new ArrayList<>();
        rows.clear();
        for (int i = 1; i <= 5; i++) {
            keys.add(key("s1", "q" + i, i, "LONG_ANSWER", 5));
            rows.add(entity("r" + i, attempt, "s1", "q" + i, 0, "PENDING", null));
        }
        paper = new Review.Paper("A", keys);
        when(paperOutline.get("A")).thenReturn(paper);
    }

    /**
     * Pre-ship review R4: a homework marked by hand is kind HOMEWORK, not HANDWRITTEN. The PDF
     * tool marks its uploaded sheet the same way: the teacher fills 4 of 5 boxes, the 5th is
     * recorded Not answered, the attempt is COMPLETED and the release that follows has no
     * unmarked answers.
     */
    @Test
    void manual_submit_on_a_manual_homework_records_the_empty_box_and_completes() {
        Assessment homework = ReviewFixtures.assessment("A", "MANUAL", false);
        homework.setAssessmentType("HOMEWORK");
        fivePendingLongAnswers(homework);
        attempt.setAttemptData("{\"fileId\":\"sheet-1\",\"sections\":[]}");
        state(false, 0.0, 0);
        var r = writer.applyAll("att-1", pdfToolSubmit("q1", "q2", "q3", "q4"), new MarkWriter.BatchContext(null,
                null, false, "teacher-1", MarkWriter.Writer.LEGACY_MANUAL_SUBMIT));
        assertThat(r.changed()).isEqualTo(5);
        assertThat(rows.get(4).getMarkState()).isEqualTo("NOT_ANSWERED");
        assertThat(rows.get(4).getMarksSource()).isEqualTo("MANUAL");
        assertThat(rows.get(4).getMarks()).isEqualTo(0.0);
        verify(attempts).applyMarkTotals(eq("att-1"), eq(8.0), eq("COMPLETED"), eq(false), any(Date.class));

        // The PDF tool's release right after: nothing is left unmarked.
        when(store.attempt("att-1")).thenReturn(new SubmissionReviewStore.AttemptState("att-1", "ENDED", "PENDING",
                null, 8.0, "COMPLETED", 1, null, null, false, null, new Date(), null));
        var release = new vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService(
                attempts, marks, store, paperOutline, new SubmissionSnapshots(), new MarkHistory(events),
                mock(vacademy.io.assessment_service.features.assessment.service.ReleaseStateWriter.class),
                mock(vacademy.io.assessment_service.features.submission_review.service.SubmissionResultMailer.class));
        var out = release.markReleased("att-1", null, new vacademy.io.assessment_service.features.submission_review
                .service.SubmissionReleaseService.ReleaseContext("teacher-1", vacademy.io.assessment_service.features
                .submission_review.service.SubmissionReleaseService.Source.MANUAL_SUBMIT, false));
        assertThat(out.unmarkedKeys()).isEmpty();
        ArgumentCaptor<MarkEvent> released = ArgumentCaptor.forClass(MarkEvent.class);
        verify(events).save(released.capture());
        assertThat(released.getValue().getEventType()).isEqualTo("RELEASED");
    }

    /** R4: a homework answered with an uploaded file (any evaluation type) is an uploaded sheet too. */
    @Test
    void manual_submit_on_a_homework_with_an_uploaded_file_fills_empty_boxes() {
        Assessment homework = ReviewFixtures.assessment("A", "AUTO", false);
        homework.setAssessmentType("HOMEWORK");
        fivePendingLongAnswers(homework);
        // Answers stored with the upload (non-blank), so each one needs marking.
        for (QuestionWiseMarks q : rows) q.setResponseJson("{\"responseData\":{\"answer\":\"(on the sheet)\"}}");
        attempt.setAttemptData("{\"fileId\":\"sheet-1\"}");
        state(false, 0.0, 0);
        writer.applyAll("att-1", pdfToolSubmit("q1"), new MarkWriter.BatchContext(null, null, false, "teacher-1",
                MarkWriter.Writer.LEGACY_MANUAL_SUBMIT));
        assertThat(rows.subList(1, 5)).allSatisfy(q -> assertThat(q.getMarkState()).isEqualTo("NOT_ANSWERED"));
        verify(attempts).applyMarkTotals(eq("att-1"), eq(2.0), eq("COMPLETED"), eq(false), any(Date.class));
    }

    /** R4: an online homework (typed answers, no file, not hand-marked) keeps its unsent answers. */
    @Test
    void manual_submit_on_an_online_homework_leaves_unsent_answers() {
        Assessment homework = ReviewFixtures.assessment("A", "AUTO", false);
        homework.setAssessmentType("HOMEWORK");
        fivePendingLongAnswers(homework);
        for (QuestionWiseMarks q : rows) q.setResponseJson("{\"responseData\":{\"answer\":\"An essay\"}}");
        state(false, 0.0, 0);
        writer.applyAll("att-1", pdfToolSubmit("q1"), new MarkWriter.BatchContext(null, null, false, "teacher-1",
                MarkWriter.Writer.LEGACY_MANUAL_SUBMIT));
        assertThat(rows.get(4).getMarkState()).isNull();
        verify(attempts).applyMarkTotals(eq("att-1"), eq(2.0), eq("PENDING"), eq(false), any(Date.class));
    }

    /**
     * Second review of F3: an answer the AI failed on is filled like any other empty box.
     * Submitting the whole sheet in the PDF tool is the person looking at it (RF10).
     */
    @Test
    void manual_submit_fills_an_answer_the_ai_failed_on_as_not_answered() {
        Assessment homework = ReviewFixtures.assessment("A", "MANUAL", false);
        homework.setAssessmentType("HOMEWORK");
        fivePendingLongAnswers(homework);
        state(false, 0.0, 0);
        var done = new Review.ProcessInfo("p1", "COMPLETED", "COPY", "teacher-1", null, null, 4, 5, 3, null,
                new Date());
        when(store.runs("att-1")).thenReturn(new Review.RunInfo(null, done, done, java.util.Map.of("q5", "FAILED")));
        writer.applyAll("att-1", pdfToolSubmit("q1", "q2", "q3", "q4"), new MarkWriter.BatchContext(null, null,
                false, "teacher-1", MarkWriter.Writer.LEGACY_MANUAL_SUBMIT));
        assertThat(rows.get(4).getMarkState()).isEqualTo("NOT_ANSWERED");
        assertThat(rows.get(4).getMarksSource()).isEqualTo("MANUAL");
        verify(attempts).applyMarkTotals(eq("att-1"), eq(8.0), eq("COMPLETED"), eq(false), any(Date.class));
    }

    /**
     * Second review of F3: a scanned copy whose AI copy check FAILED flags every unmarked
     * answer as "AI couldn't mark". The teacher marks 4 of 5 boxes in the PDF tool and
     * submits: the 5th is Not answered, the attempt is COMPLETED and the release that
     * follows is RELEASED (not RELEASED_WITH_UNMARKED), as before 1a.
     */
    @Test
    void manual_submit_on_a_scanned_copy_after_a_failed_ai_check_completes_and_releases() {
        fivePendingLongAnswers(ReviewFixtures.assessment("A", "MANUAL", false));
        attempt.setStatus("COPY_CHECK");
        attempt.setAttemptData("{\"fileId\":\"scan-1\"}");
        when(store.attempt("att-1")).thenReturn(ReviewFixtures.state("att-1", "COPY_CHECK", false, 0.0, 0, null));
        var failed = new Review.ProcessInfo("p1", "FAILED", "COPY", null, null, "Could not read the copy", 0, 5, 3,
                null, new Date());
        Review.RunInfo run = new Review.RunInfo(null, failed, failed, java.util.Map.of());
        when(store.runs("att-1")).thenReturn(run);

        // Before the submit every answer is Needs marking with the run's failure reason.
        var groups = new SubmissionSnapshots().groups("A");
        var facts = SubmissionSnapshots.Facts.of(attempt.getRegistration().getAssessment(),
                SubmissionSnapshots.kind("COPY_CHECK", attempt.getRegistration().getAssessment(),
                        attempt.getAttemptData(), true));
        List<Review.MarkRow> before = new ArrayList<>();
        for (QuestionWiseMarks q : rows) before.add(Review.MarkRow.of(q));
        var snap = new SubmissionSnapshots().compute(facts, false, paper, Review.targets(paper, before), run, groups);
        assertThat(snap.keys()).allSatisfy(k -> assertThat(k.aiFailedReason()).isEqualTo("Could not read the copy"));

        writer.applyAll("att-1", pdfToolSubmit("q1", "q2", "q3", "q4"), new MarkWriter.BatchContext(null, null,
                false, "teacher-1", MarkWriter.Writer.LEGACY_MANUAL_SUBMIT));
        assertThat(rows.get(4).getMarkState()).isEqualTo("NOT_ANSWERED");
        assertThat(rows.get(4).getMarks()).isEqualTo(0.0);
        verify(attempts).applyMarkTotals(eq("att-1"), eq(8.0), eq("COMPLETED"), eq(false), any(Date.class));

        when(store.attempt("att-1")).thenReturn(new SubmissionReviewStore.AttemptState("att-1", "COPY_CHECK",
                "PENDING", null, 8.0, "COMPLETED", 1, null, null, false, null, new Date(), null));
        var release = new vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService(
                attempts, marks, store, paperOutline, new SubmissionSnapshots(), new MarkHistory(events),
                mock(vacademy.io.assessment_service.features.assessment.service.ReleaseStateWriter.class),
                mock(vacademy.io.assessment_service.features.submission_review.service.SubmissionResultMailer.class));
        var out = release.markReleased("att-1", null, new vacademy.io.assessment_service.features.submission_review
                .service.SubmissionReleaseService.ReleaseContext("teacher-1", vacademy.io.assessment_service.features
                .submission_review.service.SubmissionReleaseService.Source.MANUAL_SUBMIT, false));
        assertThat(out.unmarkedKeys()).isEmpty();
        ArgumentCaptor<MarkEvent> released = ArgumentCaptor.forClass(MarkEvent.class);
        verify(events).save(released.capture());
        assertThat(released.getValue().getEventType()).isEqualTo("RELEASED");
    }

    /** Review 1 #6: an online test's unsent answers are left alone (only the sent row changes). */
    @Test
    void manual_submit_on_an_online_test_leaves_unsent_answers() {
        state(false, 2.0, 0);
        var change = new MarkWriter.MarkChange("att-1", "s1", "q1", MarkWriter.Writer.LEGACY_MANUAL_SUBMIT, 1.0, null,
                null, false, null, "teacher-1", null, null, false, null, null, null);
        var r = writer.applyAll("att-1", List.of(change), new MarkWriter.BatchContext(null, null, false, "teacher-1",
                MarkWriter.Writer.LEGACY_MANUAL_SUBMIT));
        assertThat(r.changed()).isEqualTo(1);
        assertThat(rows.get(1).getMarkState()).isNull();
    }

    /** Review 1 #7: accepting an AI mark that changed since the teacher saw it is a 409. */
    @Test
    void accept_ai_with_a_stale_revision_is_refused() {
        state(false, 8.0, 1);
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(6);
        rows.get(1).setRevision(2);
        var accept = new MarkWriter.MarkChange("att-1", "s1", "q2", MarkWriter.Writer.ACCEPT_AI, null, null, null,
                false, null, "teacher-1", 1, token(false), false, null, null, null);
        assertThatThrownBy(() -> writer.applyAll("att-1", List.of(accept), new MarkWriter.BatchContext(null,
                token(false), false, "teacher-1", MarkWriter.Writer.ACCEPT_AI)))
                .isInstanceOfSatisfying(SubmissionReviewException.class,
                        e -> assertThat(e.getCode()).isEqualTo("STALE_REVISION"));
        assertThat(rows.get(1).getMarksSource()).isEqualTo("AI");
    }

    /** Review 1 #8: events of one save get distinct, increasing times (History order). */
    @Test
    void events_of_one_save_are_ordered_by_distinct_times() {
        state(false, 0.0, 0);
        paper = new Review.Paper("A", List.of(key("s1", "q2", 1, "LONG_ANSWER", 10), key("s1", "q3", 2, "LONG_ANSWER", 10),
                key("s1", "q4", 3, "LONG_ANSWER", 10)));
        when(paperOutline.get("A")).thenReturn(paper);
        rows.clear();
        for (String q : List.of("q2", "q3", "q4")) {
            QuestionWiseMarks m = entity("r-" + q, attempt, "s1", q, 0, "PENDING", null);
            m.setResponseJson("{\"responseData\":{\"answer\":\"text\"}}");
            rows.add(m);
        }
        writer.applyAll("att-1", List.of(teacher("q2", 1.0, null, token(false), null, false),
                teacher("q3", 2.0, null, token(false), null, false), teacher("q4", 3.0, null, token(false), null, false)),
                new MarkWriter.BatchContext(null, token(false), false, "teacher-1", MarkWriter.Writer.TEACHER));
        List<MarkEvent> saved = savedEvents();
        assertThat(saved).hasSize(3);
        for (int i = 1; i < saved.size(); i++) {
            assertThat(saved.get(i).getCreatedAt()).isAfter(saved.get(i - 1).getCreatedAt());
        }
    }

    /** Review 2 #4: a flagged attempt is released once nothing blocks, even if it already said COMPLETED. */
    @Test
    void flagged_attempt_publishes_ready_when_no_blocker_is_left() {
        when(store.attempt("att-1")).thenReturn(new SubmissionReviewStore.AttemptState("att-1", "ENDED", "PENDING",
                null, 2.0, "COMPLETED", 0, null, null, true, null, new Date()));
        var r = writer.apply(teacher("q2", 4.0, 0, token(false), null, false));
        assertThat(r.releaseQueued()).isTrue();
        verify(publisher).publishEvent(any(ReviewEvents.AttemptReadyForRelease.class));
    }

    /** Review 2 #1: "Hide result again" wins over AUTO_AFTER_SUBMISSION when marking completes. */
    @Test
    void hidden_result_is_not_auto_released_when_marking_completes() {
        assessment.setResultType("AUTO_AFTER_SUBMISSION");
        when(store.attempt("att-1")).thenReturn(new SubmissionReviewStore.AttemptState("att-1", "ENDED", "PENDING",
                new Date(5), 2.0, "PENDING", 3, 3, new Date(4), false, null, new Date(), new Date(6)));
        var r = writer.apply(teacher("q2", 4.0, 0, token(false).replace("|0", "|5"), null, false));
        assertThat(r.releaseQueued()).isFalse();
        verify(publisher, never()).publishEvent(any(ReviewEvents.AttemptReadyForRelease.class));
    }

    // ---------------------------------------------- PR #3814 reconcile (question-marks PUT, TEACHER)

    private MarkWriter.MarkChange put(String q, double value, String reason) {
        return new MarkWriter.MarkChange("att-1", "s1", q, MarkWriter.Writer.QUESTION_MARKS_PUT, value, null, null,
                false, reason, "teacher-1", null, null, false, null, null, null);
    }

    @Test
    void question_marks_put_writes_a_manual_mark_with_history_and_a_revision_bump() {
        state(false, 2.0, 3);
        var r = writer.apply(put("q2", 7.0, null));
        QuestionWiseMarks q2 = rows.get(1);
        assertThat(q2.getMarksSource()).isEqualTo("MANUAL");
        assertThat(q2.getMarkState()).isEqualTo("MARKED");
        assertThat(q2.getRevision()).isEqualTo(1);
        assertThat(q2.getMarkedBy()).isEqualTo("teacher-1");
        assertThat(r.marksRevision()).isEqualTo(4);
        verify(attempts).applyMarkTotals(eq("att-1"), eq(9.0), eq("COMPLETED"), eq(false), any(Date.class));
        assertThat(savedEvents().get(0).getEventType()).isEqualTo("TEACHER_EDITED");
        verify(mirror).apply(eq("att-1"), any(), eq("q2"), eq(7.0), any(), any(), eq("teacher-1"));
    }

    @Test
    void question_marks_put_clamps_into_the_range_instead_of_refusing() {
        state(false, 2.0, 0);
        writer.apply(put("q2", 15.0, null));
        assertThat(rows.get(1).getMarks()).isEqualTo(10.0);
        writer.apply(put("q2", -3.0, null));
        assertThat(rows.get(1).getMarks()).isEqualTo(0.0);
    }

    @Test
    void question_marks_put_after_release_records_the_reason_and_marks_the_result_revised() {
        state(true, 2.0, 2);
        var r = writer.apply(put("q2", 6.0, "Changed with the question marks endpoint (no reason given)"));
        assertThat(r.resultRevisedAt()).isNotNull();
        assertThat(r.updateQueued()).isFalse();
        MarkEvent e = savedEvents().get(0);
        assertThat(e.isAfterRelease()).isTrue();
        assertThat(e.getReason()).isEqualTo("Changed with the question marks endpoint (no reason given)");
        verify(attempts).applyMarkTotals(eq("att-1"), eq(8.0), eq("COMPLETED"), eq(true), any(Date.class));
    }

    @Test
    void question_marks_put_refuses_an_answer_the_ai_is_checking_but_not_one_a_person_marked() {
        var active = new Review.ProcessInfo("p1", "PROCESSING", "TYPED", "teacher-1", null, null, 0, 1, null, null,
                new Date());
        when(store.runs("att-1")).thenReturn(new Review.RunInfo(active, active, null, java.util.Map.of()));
        state(false, 2.0, 0);
        assertThatThrownBy(() -> writer.apply(put("q2", 5.0, null)))
                .isInstanceOfSatisfying(SubmissionReviewException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("AI_CHECKING");
                    assertThat(e.getStatus().value()).isEqualTo(409);
                });
        verify(marks, never()).save(any());

        // An MCQ is never AI-graded; a hand-marked written answer is protected from the run.
        writer.apply(put("q1", 1.0, null));
        assertThat(rows.get(0).getMarks()).isEqualTo(1.0);
        rows.get(1).setMarksSource("TEACHER");
        writer.apply(put("q2", 5.0, null));
        assertThat(rows.get(1).getMarks()).isEqualTo(5.0);
        assertThat(rows.get(1).getMarksSource()).isEqualTo("MANUAL");
    }

    @Test
    void legacy_teacher_row_is_a_protected_hand_mark() {
        rows.get(0).setMarksSource("TEACHER");
        state(false, 2.0, 0);
        var change = new MarkWriter.MarkChange("att-1", "s1", "q1", MarkWriter.Writer.ANSWER_KEY, 0.0, null, null,
                false, null, "t", null, token(false), false, null, "INCORRECT", null);
        assertThatThrownBy(() -> writer.apply(change)).isInstanceOfSatisfying(SubmissionReviewException.class, e -> {
            assertThat(e.getCode()).isEqualTo("PROTECTED_MARK");
            assertThat(e.getDetails()).containsEntry("marks_source", "MANUAL");
        });
    }

    // ---------------------------------------------------------------- live follow-ups 2026-11-19

    /** B1: every writer keeps the legacy status in line with the mark (learner report "skipped"). */
    @Test
    void teacher_marks_set_the_legacy_status_from_the_mark() {
        state(false, 2.0, 0);
        writer.apply(teacher("q2", 10.0, 0, token(false), null, false));
        assertThat(rows.get(1).getStatus()).isEqualTo("CORRECT");
        writer.apply(teacher("q2", 4.0, 1, token(false), null, false));
        assertThat(rows.get(1).getStatus()).isEqualTo("PARTIAL_CORRECT");
        writer.apply(teacher("q2", 0.0, 2, token(false), null, false));
        assertThat(rows.get(1).getStatus()).isEqualTo("INCORRECT");
        writer.apply(new MarkWriter.MarkChange("att-1", "s1", "q2", MarkWriter.Writer.TEACHER, null, null, null, true,
                null, "teacher-1", 3, token(false), false, null, null, null));
        assertThat(rows.get(1).getStatus()).isEqualTo("PENDING");
        assertThat(rows.get(1).getMarkState()).isEqualTo("NOT_ANSWERED");
    }

    @Test
    void accepting_an_ai_mark_sets_the_status_from_the_mark_even_over_an_old_keyword_status() {
        state(false, 8.0, 0);
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(6);
        rows.get(1).setStatus("INCORRECT"); // the keyword scorer's verdict from submit time
        var accept = new MarkWriter.MarkChange("att-1", "s1", "q2", MarkWriter.Writer.ACCEPT_AI, null, null, null,
                false, null, "teacher-1", null, token(false), false, null, null, null);
        writer.applyAll("att-1", List.of(accept), new MarkWriter.BatchContext(null, token(false), false, "teacher-1",
                MarkWriter.Writer.ACCEPT_AI));
        assertThat(rows.get(1).getMarksSource()).isEqualTo("AI_REVIEWED");
        assertThat(rows.get(1).getStatus()).isEqualTo("PARTIAL_CORRECT");
    }

    @Test
    void saving_the_same_mark_repairs_a_stale_pending_status_without_history() {
        state(true, 12.0, 2);
        rows.get(1).setMarksSource("MANUAL");
        rows.get(1).setMarkState("MARKED");
        rows.get(1).setMarks(10);
        rows.get(1).setStatus("PENDING"); // a stale status left by an older writer
        rows.get(1).setRevision(2);
        var r = writer.apply(teacher("q2", 10.0, 2, token(true), "Same mark", false));
        assertThat(r.changed()).isZero();
        assertThat(rows.get(1).getStatus()).isEqualTo("CORRECT");
        assertThat(rows.get(1).getRevision()).isEqualTo(2);
        verify(events, never()).saveAll(any());
        verify(attempts, never()).applyMarkTotals(anyString(), anyDouble(), anyString(), anyBoolean(), any());
    }

    /**
     * Review issue B1-pdf-tool-status-evaluated: the PDF evaluation tool sends status
     * "evaluated" with every mark. It is none of the four statuses, so the status comes from
     * the mark - on the first submit and on a re-submit of the same mark.
     */
    @Test
    void manual_submit_ignores_the_pdf_tools_evaluated_status() {
        state(false, 2.0, 0);
        var change = new MarkWriter.MarkChange("att-1", "s1", "q2", MarkWriter.Writer.LEGACY_MANUAL_SUBMIT, 4.0, null,
                null, false, null, "t", null, null, false, null, "evaluated", null);
        writer.applyAll("att-1", List.of(change), new MarkWriter.BatchContext(null, null, false, "t",
                MarkWriter.Writer.LEGACY_MANUAL_SUBMIT));
        assertThat(rows.get(1).getMarks()).isEqualTo(4.0);
        assertThat(rows.get(1).getStatus()).isEqualTo("PARTIAL_CORRECT");

        // Same mark again (the tool re-submits every box): the status stays a real one.
        rows.get(1).setStatus("evaluated"); // as a pre-fix submit stored it
        var again = new MarkWriter.MarkChange("att-1", "s1", "q2", MarkWriter.Writer.LEGACY_MANUAL_SUBMIT, 4.0, null,
                null, false, null, "t", null, null, false, null, "evaluated", null);
        writer.applyAll("att-1", List.of(again), new MarkWriter.BatchContext(null, null, false, "t",
                MarkWriter.Writer.LEGACY_MANUAL_SUBMIT));
        assertThat(rows.get(1).getStatus()).isEqualTo("PARTIAL_CORRECT");

        // A real status the caller sends is still kept.
        var keyed = new MarkWriter.MarkChange("att-1", "s1", "q2", MarkWriter.Writer.LEGACY_MANUAL_SUBMIT, 10.0, null,
                null, false, null, "t", null, null, false, null, "CORRECT", null);
        writer.applyAll("att-1", List.of(keyed), new MarkWriter.BatchContext(null, null, false, "t",
                MarkWriter.Writer.LEGACY_MANUAL_SUBMIT));
        assertThat(rows.get(1).getStatus()).isEqualTo("CORRECT");
    }

    /**
     * Review issue B1-blank-ai-zero-now-incorrect: accepting the AI's 0 on a blank online answer
     * keeps it skipped (PENDING); a 0 on a written answer is wrong (INCORRECT).
     */
    @Test
    void accepting_an_ai_zero_on_a_blank_answer_keeps_it_skipped() {
        state(false, 2.0, 0);
        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarks(0);
        rows.get(1).setStatus("PENDING");
        rows.get(1).setResponseJson("{\"responseData\":{\"answer\":\"  \"}}");
        var accept = new MarkWriter.MarkChange("att-1", "s1", "q2", MarkWriter.Writer.ACCEPT_AI, null, null, null,
                false, null, "teacher-1", null, token(false), false, null, null, null);
        writer.applyAll("att-1", List.of(accept), new MarkWriter.BatchContext(null, token(false), false, "teacher-1",
                MarkWriter.Writer.ACCEPT_AI));
        assertThat(rows.get(1).getMarksSource()).isEqualTo("AI_REVIEWED");
        assertThat(rows.get(1).getStatus()).isEqualTo("PENDING");

        rows.get(1).setMarksSource("AI");
        rows.get(1).setMarkState(null);
        rows.get(1).setStatus("PENDING");
        rows.get(1).setResponseJson("{\"responseData\":{\"answer\":\"Water boils at 50\"}}");
        writer.applyAll("att-1", List.of(accept), new MarkWriter.BatchContext(null, token(false), false, "teacher-1",
                MarkWriter.Writer.ACCEPT_AI));
        assertThat(rows.get(1).getStatus()).isEqualTo("INCORRECT");
    }

    /** B5: the Edit marks dialog's live total runs before the reason is typed. */
    @Test
    void preview_after_release_needs_no_reason_but_the_save_does() {
        state(true, 2.0, 1);
        var r = writer.preview(teacher("q2", 5.0, 0, token(true), null, false));
        assertThat(r.totalAfter()).isEqualTo(7.0);
        verify(marks, never()).save(any());
        assertThatThrownBy(() -> writer.apply(teacher("q2", 5.0, 0, token(true), null, false)))
                .isInstanceOfSatisfying(SubmissionReviewException.class,
                        e -> assertThat(e.getCode()).isEqualTo("REASON_REQUIRED"));
    }
}
