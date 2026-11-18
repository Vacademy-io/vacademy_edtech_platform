package vacademy.io.assessment_service.features.submission_review;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.assessment_service.features.submission_review.repository.MarkEventRepository;
import vacademy.io.assessment_service.features.submission_review.service.AiVerdictMirror;
import vacademy.io.assessment_service.features.submission_review.service.MarkWriter;
import vacademy.io.assessment_service.features.submission_review.service.PaperOutline;
import vacademy.io.assessment_service.features.submission_review.service.Review;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewAccess;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewService;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewStore;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionSnapshots;
import vacademy.io.assessment_service.features.submission_review.service.UserNames;

import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.key;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.row;

/** A1 outline and A10 summary from mocked reads (acceptance 1, 3). */
class SubmissionReviewServiceTest {

    private SubmissionReviewStore store;
    private SubmissionReviewService service;
    private StudentAttempt attempt;
    private Assessment assessment;
    private MarkWriter markWriter;

    @BeforeEach
    void setUp() {
        store = mock(SubmissionReviewStore.class);
        PaperOutline paper = mock(PaperOutline.class);
        MarkEventRepository events = mock(MarkEventRepository.class);
        SubmissionSnapshots snapshots = new SubmissionSnapshots();
        markWriter = mock(MarkWriter.class);
        service = new SubmissionReviewService(mock(StudentAttemptRepository.class), mock(QuestionWiseMarksRepository.class),
                store, paper, snapshots, markWriter, mock(SubmissionReleaseService.class),
                new SubmissionReviewAccess(), events, mock(AiVerdictMirror.class), new UserNames());
        assessment = ReviewFixtures.assessment("A", "AUTO", false);
        attempt = ReviewFixtures.attempt("att-1", assessment, "ENDED");
        when(paper.get("A")).thenReturn(new Review.Paper("A", List.of(key("s1", "q1", 1, "MCQS", 2),
                key("s1", "q2", 2, "CBE_RESPONSE", 10))));
        String answered = "{\"responseData\":{\"answer\":{\"parts\":{\"p1\":{\"html\":\"<p>Done</p>\"}}}}}";
        when(store.rows(anyList())).thenReturn(List.of(row("r1", "s1", "q1", 2, "CORRECT", null, null, 0),
                new Review.MarkRow("r2", "att-1", "s1", "q2", 0, "PENDING", null, null, 0, null, null, null, false,
                        null, null, new Date(1), answered)));
        when(store.runs("att-1")).thenReturn(Review.RunInfo.NONE);
        when(store.runs(anyList())).thenReturn(Map.of());
        when(store.attempt("att-1")).thenReturn(ReviewFixtures.state("att-1", "ENDED", false, 2.0, 0, null));
        when(events.countPerKey(eq("att-1"), any())).thenReturn(List.of());
    }

    @Test
    @SuppressWarnings("unchecked")
    void acceptance1_outline_shows_answer_key_mcq_and_cbe_needing_marking() {
        Map<String, Object> out = service.outline(ReviewFixtures.user("t-1", "TEACHER"), attempt);
        assertThat(out).containsEntry("marking", "NEEDS_MARKING").containsEntry("total", 2.0)
                .containsEntry("max_total", 12.0).containsEntry("kind", "ONLINE").containsEntry("total_only", false);
        List<Map<String, Object>> sections = (List<Map<String, Object>>) out.get("sections");
        List<Map<String, Object>> qs = (List<Map<String, Object>>) sections.get(0).get("questions");
        assertThat(qs.get(0)).containsEntry("marks", 2.0).containsEntry("max_marks", 2.0)
                .containsEntry("marked_by_kind", "ANSWER_KEY").containsEntry("state", "MARKED")
                .containsEntry("question_number", 1).containsEntry("key", "s1:q1");
        assertThat(qs.get(1)).containsEntry("marks", 0.0).containsEntry("max_marks", 10.0)
                .containsEntry("state", "NEEDS_MARKING").containsEntry("marked_by_kind", "NONE");
        Map<String, Object> release = (Map<String, Object>) out.get("release");
        assertThat(release).containsEntry("status", "NOT_RELEASED").containsEntry("token", "PENDING|0");
        Map<String, Object> perms = (Map<String, Object>) out.get("permissions");
        assertThat(perms).containsEntry("can_edit", true).containsEntry("can_force_answer_key", false);
        Map<String, Object> counts = (Map<String, Object>) out.get("counts");
        assertThat(counts).containsEntry("needs_marking", 1).containsEntry("marked", 1);
    }

    @Test
    @SuppressWarnings("unchecked")
    void acceptance3_released_and_changed_until_the_update_is_sent() {
        var changed = new SubmissionReviewStore.AttemptState("att-1", "ENDED", "RELEASED", new Date(5), 9.0,
                "COMPLETED", 4, 3, new Date(), false, null, new Date());
        var sent = new SubmissionReviewStore.AttemptState("att-1", "ENDED", "RELEASED", new Date(5), 9.0,
                "COMPLETED", 4, 4, new Date(), false, null, new Date());
        assertThat(changed.changedSinceRelease()).isTrue();
        assertThat(sent.changedSinceRelease()).isFalse();
        when(store.attempts(eq("A"), anyList())).thenReturn(List.of(changed));
        when(store.submittedAttempts("A")).thenReturn(List.of(changed));
        Map<String, Object> out = service.markingSummary(ReviewFixtures.user("t-1", "TEACHER"), assessment,
                List.of("att-1"));
        Map<String, Object> per = ((Map<String, Map<String, Object>>) out.get("attempts")).get("att-1");
        assertThat(per).containsEntry("result", "RELEASED_CHANGED").containsEntry("released_with_unmarked", 1)
                .containsEntry("release_token", "RELEASED|5");
        Map<String, Object> summary = (Map<String, Object>) out.get("summary");
        assertThat(summary).containsEntry("submitted", 1).containsEntry("released_changed", 1)
                .containsEntry("needs_marking", 1);
        assertThat((List<String>) summary.get("needs_marking_attempt_ids")).containsExactly("att-1");
    }

    @Test
    @SuppressWarnings("unchecked")
    void release_changed_carries_the_full_release_shape_for_the_edit_dialog() {
        when(markWriter.apply(any())).thenThrow(SubmissionReviewException.conflict("RELEASE_CHANGED", "changed",
                Map.of("release", Map.of("status", "NOT_RELEASED", "token", "PENDING|0"))));
        MarkWriter.MarkChange change = new MarkWriter.MarkChange("att-1", "s1", "q2", MarkWriter.Writer.TEACHER,
                5.0, null, null, false, null, "t-1", 0, "RELEASED|1", false, null, null, null);
        assertThatThrownBy(() -> service.editOne(ReviewFixtures.user("t-1", "TEACHER"), attempt, change, false))
                .isInstanceOfSatisfying(SubmissionReviewException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("RELEASE_CHANGED");
                    Map<String, Object> release = (Map<String, Object>) e.getDetails().get("release");
                    assertThat(release).containsKeys("status", "released_at", "token", "changed_since_release",
                            "unmarked_at_release", "result_revised_at", "marks_revision", "notified_revision",
                            "release_when_marked");
                    assertThat(release).containsEntry("token", "PENDING|0");
                });
    }

    /** PR #3814 parity: the dialog showed the model answer and one-word keys; the card must too. */
    @Test
    void answer_key_text_reads_a_model_answer_object_a_word_and_valid_answers() throws Exception {
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        assertThat(SubmissionReviewService.keyText(json.readTree(
                "{\"answer\":{\"id\":\"1\",\"type\":\"HTML\",\"content\":\"<p>Photosynthesis</p>\"}}")))
                .isEqualTo("<p>Photosynthesis</p>");
        assertThat(SubmissionReviewService.keyText(json.readTree("{\"answer\":\"Paris\"}"))).isEqualTo("Paris");
        assertThat(SubmissionReviewService.keyText(json.readTree("{\"validAnswers\":[\"colour\",\"color\"]}")))
                .isEqualTo("colour / color");
        assertThat(SubmissionReviewService.keyText(json.readTree("{\"answer\":{\"content\":\"  \"}}"))).isNull();
        assertThat(SubmissionReviewService.keyText(json.readTree("{}"))).isNull();
    }
}
