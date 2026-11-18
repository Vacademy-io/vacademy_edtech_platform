package vacademy.io.assessment_service.features.submission_review;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.DashboardChoiceGroups;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.submission_review.model.MarkingStatus;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionKind;
import vacademy.io.assessment_service.features.submission_review.service.QuestionMaxResolver;
import vacademy.io.assessment_service.features.submission_review.service.Review;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionSnapshots;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.key;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.paper;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.row;

/** R6 totals (AttemptTotalsTest), result status (ResultStatusRuleTest), counts and W1 marking. */
class SubmissionSnapshotsTest {

    private final SubmissionSnapshots plain = new SubmissionSnapshots();

    private static SubmissionSnapshots.Facts facts(Boolean ai) {
        return new SubmissionSnapshots.Facts("A", "AUTO", ai, SubmissionKind.ONLINE);
    }

    @Test
    void acceptance1_mcq_by_key_and_cbe_needs_marking() {
        Review.Paper p = paper("A", key("s1", "q1", 1, "MCQS", 2), key("s1", "q2", 2, "CBE_RESPONSE", 10));
        String answered = "{\"responseData\":{\"answer\":{\"parts\":{\"p1\":{\"html\":\"<p>Done</p>\"}}}}}";
        var rows = List.of(row("r1", "s1", "q1", 2, "CORRECT", null, null, 0),
                new Review.MarkRow("r2", "att-1", "s1", "q2", 0, "PENDING", null, null, 0, null, null, null, false,
                        null, null, new Date(1), answered));
        var snap = plain.compute(facts(false), false, p, rows, Review.RunInfo.NONE, List.of());
        assertThat(snap.total()).isEqualTo(2.0);
        assertThat(snap.maxTotal()).isEqualTo(12.0);
        assertThat(snap.counts().needsMarking()).isEqualTo(1);
        assertThat(snap.counts().marked()).isEqualTo(1);
        assertThat(snap.resultStatus()).isEqualTo("PENDING");
        assertThat(SubmissionSnapshots.marking("ENDED", true, 2.0, snap.counts())).isEqualTo(MarkingStatus.NEEDS_MARKING);
    }

    @Test
    void same_question_in_two_sections_counts_per_section() {
        Review.Paper p = paper("A", key("s1", "q1", 1, "MCQS", 2), key("s2", "q1", 2, "MCQS", 2));
        var rows = List.of(row("r1", "s1", "q1", 2, "CORRECT", null, null, 0),
                row("r2", "s2", "q1", 2, "CORRECT", null, null, 0));
        var snap = plain.compute(facts(false), false, p, rows, Review.RunInfo.NONE, List.of());
        assertThat(snap.total()).isEqualTo(4.0);
    }

    @Test
    void newest_duplicate_row_is_the_mark() {
        Review.Paper p = paper("A", key("s1", "q1", 1, "LONG_ANSWER", 5));
        var older = new Review.MarkRow("old", "att-1", "s1", "q1", 1, "CORRECT", "MANUAL", "MARKED", 1, null, null,
                null, false, null, null, new Date(1000), null);
        var newer = new Review.MarkRow("new", "att-1", "s1", "q1", 4, "CORRECT", "MANUAL", "MARKED", 2, null, null,
                null, false, null, null, new Date(2000), null);
        var snap = plain.compute(facts(false), false, p, List.of(older, newer), Review.RunInfo.NONE, List.of());
        assertThat(snap.total()).isEqualTo(4.0);
    }

    @Test
    void section_less_legacy_row_is_used_when_the_question_sits_in_one_section() {
        Review.Paper p = paper("A", key("s1", "q1", 1, "MCQS", 2));
        var snap = plain.compute(facts(false), false, p, List.of(row("r1", null, "q1", 2, "CORRECT", null, null, 0)),
                Review.RunInfo.NONE, List.of());
        assertThat(snap.total()).isEqualTo(2.0);
    }

    @Test
    void choice_group_any_two_of_three_leaves_the_lowest_out() {
        ChoiceGroupStore store = mock(ChoiceGroupStore.class);
        QuestionAssessmentSectionMappingRepository mappings = mock(QuestionAssessmentSectionMappingRepository.class);
        var group = new ChoiceGroupStore.ChoiceGroupRow("g", "Choice", List.of("q1", "q2", "q3"), 2, "best", 0);
        List<QuestionAssessmentSectionMapping> ms = new ArrayList<>();
        for (String q : List.of("q1", "q2", "q3", "q4")) {
            QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
            Question question = new Question();
            question.setId(q);
            m.setQuestion(question);
            m.setStatus("ACTIVE");
            m.setMarkingJson(ReviewFixtures.marking(q.equals("q4") ? 2 : 10, 0));
            ms.add(m);
        }
        when(mappings.getQuestionAssessmentSectionMappingByAssessmentId("A")).thenReturn(ms);
        SubmissionSnapshots s = new SubmissionSnapshots(new DashboardChoiceGroups(store, mappings, new ObjectMapper()));
        Review.Paper p = paper("A", key("s1", "q1", 1, "LONG_ANSWER", 10), key("s1", "q2", 2, "LONG_ANSWER", 10),
                key("s1", "q3", 3, "LONG_ANSWER", 10), key("s1", "q4", 4, "MCQS", 2));
        var rows = List.of(row("r1", "s1", "q1", 7, "CORRECT", "MANUAL", "MARKED", 1),
                row("r2", "s1", "q2", 3, "CORRECT", "MANUAL", "MARKED", 1),
                row("r3", "s1", "q3", 9, "CORRECT", "MANUAL", "MARKED", 1),
                row("r4", "s1", "q4", 2, "CORRECT", null, null, 0));
        var snap = s.compute(facts(false), false, p, rows, Review.RunInfo.NONE, List.of(group));
        assertThat(snap.total()).isEqualTo(18.0); // 7 + 9 + 2, q2 not counted
        assertThat(snap.maxTotal()).isEqualTo(22.0); // 10 + 10 + 2
        assertThat(snap.counts().notCounted()).isEqualTo(1);
        assertThat(snap.keys().get(1).counted()).isFalse();
    }

    private static Review.RunInfo finished(String triggeredBy, String apiKeyId) {
        var done = new Review.ProcessInfo("p1", "COMPLETED", "TYPED", triggeredBy, apiKeyId, null, 1, 1, null, null,
                new Date());
        return new Review.RunInfo(null, done, done, Map.of());
    }

    @Test
    void acceptance11_ai_on_drafts_complete_ai_off_drafts_stay_evaluating() {
        Review.Paper p = paper("A", key("s1", "q1", 1, "CBE_RESPONSE", 10));
        var rows = List.of(row("r1", "s1", "q1", 6, "PENDING", "AI", null, 1));
        Review.RunInfo cbeOnlyRun = finished(null, null);
        assertThat(plain.compute(facts(true), false, p, rows, cbeOnlyRun, List.of()).resultStatus())
                .isEqualTo("COMPLETED");
        assertThat(plain.compute(facts(false), false, p, rows, cbeOnlyRun, List.of()).resultStatus())
                .isEqualTo("EVALUATING");
        assertThat(plain.compute(facts(null), false, p, rows, cbeOnlyRun, List.of()).resultStatus())
                .isEqualTo("EVALUATING");
        var snap = plain.compute(facts(false), false, p, rows, cbeOnlyRun, List.of());
        assertThat(SubmissionSnapshots.marking("ENDED", true, 6.0, snap.counts())).isEqualTo(MarkingStatus.CHECK_AI);
    }

    /**
     * Pre-ship review R3: on an AI-off test only the automatic CBE-only run holds its drafts.
     * A run a teacher (row menu "Evaluate with AI", copy check) or a partner started ends
     * COMPLETED, as the AI callback stores it; an edit afterwards keeps COMPLETED.
     */
    @Test
    void ai_off_drafts_from_a_teacher_or_partner_run_do_not_hold_the_attempt() {
        Review.Paper p = paper("A", key("s1", "q1", 1, "CBE_RESPONSE", 10), key("s1", "q2", 2, "LONG_ANSWER", 5));
        var rows = List.of(row("r1", "s1", "q1", 6, "PENDING", "AI", null, 1),
                row("r2", "s1", "q2", 3, "PENDING", "AI", null, 1));
        for (Boolean flag : new Boolean[]{false, null}) {
            assertThat(plain.compute(facts(flag), false, p, rows, finished("teacher-1", null), List.of())
                    .resultStatus()).isEqualTo("COMPLETED");
            assertThat(plain.compute(facts(flag), false, p, rows, finished(null, "key-1"), List.of())
                    .resultStatus()).isEqualTo("COMPLETED");
            // No run on record (old drafts): nothing to hold, as before 1a.
            assertThat(plain.compute(facts(flag), false, p, rows, Review.RunInfo.NONE, List.of()).resultStatus())
                    .isEqualTo("COMPLETED");
        }
        var snap = plain.compute(facts(false), false, p, rows, finished("teacher-1", null), List.of());
        assertThat(snap.counts().aiDraft()).isEqualTo(2);
    }

    /** A CBE-only run holds its CBE drafts only; an older long-answer draft alone does not hold. */
    @Test
    void cbe_only_run_holds_only_when_a_cbe_draft_is_left() {
        Review.Paper p = paper("A", key("s1", "q1", 1, "CBE_RESPONSE", 10), key("s1", "q2", 2, "LONG_ANSWER", 5));
        var rows = List.of(row("r1", "s1", "q1", 6, "CORRECT", "MANUAL", "MARKED", 2),
                row("r2", "s1", "q2", 3, "PENDING", "AI", null, 1));
        assertThat(plain.compute(facts(false), false, p, rows, finished(null, null), List.of()).resultStatus())
                .isEqualTo("COMPLETED");
    }

    @Test
    void active_ai_run_marks_written_answers_as_checking_but_not_teacher_marks() {
        Review.Paper p = paper("A", key("s1", "q1", 1, "CBE_RESPONSE", 10), key("s1", "q2", 2, "LONG_ANSWER", 5),
                key("s1", "q3", 3, "MCQS", 2));
        var active = new Review.ProcessInfo("p1", "EVALUATING", "TYPED", "teacher-1", null, null, 0, 2, null, null,
                new Date());
        var run = new Review.RunInfo(active, active, null, Map.of());
        var rows = List.of(row("r1", "s1", "q1", 0, "PENDING", null, null, 0),
                row("r2", "s1", "q2", 4, "CORRECT", "MANUAL", "MARKED", 1),
                row("r3", "s1", "q3", 2, "CORRECT", null, null, 0));
        var snap = plain.compute(facts(true), false, p, rows, run, List.of());
        assertThat(snap.keys().get(0).aiChecking()).isTrue();
        assertThat(snap.keys().get(1).aiChecking()).isFalse();
        assertThat(snap.keys().get(2).aiChecking()).isFalse();
        assertThat(snap.counts().aiChecking()).isEqualTo(1);
        assertThat(snap.resultStatus()).isEqualTo("EVALUATING");
        assertThat(SubmissionSnapshots.marking("ENDED", true, 0.0, snap.counts())).isEqualTo(MarkingStatus.AI_CHECKING);
    }

    @Test
    void failed_ai_run_gives_the_reason_on_unmarked_answers() {
        Review.Paper p = paper("A", key("s1", "q1", 1, "CBE_RESPONSE", 10));
        var failed = new Review.ProcessInfo("p1", "FAILED", "TYPED", null, null, "Out of credits", 0, 1, null, null,
                new Date());
        String answered = "{\"responseData\":{\"answer\":{\"parts\":{\"p1\":{\"html\":\"<p>Done</p>\"}}}}}";
        var rows = List.of(new Review.MarkRow("r1", "att-1", "s1", "q1", 0, "PENDING", null, null, 0, null, null, null,
                false, null, null, new Date(1), answered));
        var snap = plain.compute(facts(false), false, p, rows, new Review.RunInfo(null, failed, failed, Map.of()),
                List.of());
        assertThat(snap.keys().get(0).aiFailedReason()).isEqualTo("Out of credits");
        assertThat(snap.counts().aiFailed()).isEqualTo(1);
        assertThat(snap.resultStatus()).isEqualTo("EVALUATING");
    }

    @Test
    void question_max_and_min() {
        var k = new Review.PaperKey("s", "S", 1, 4.0, "q", 1, 1, "MCQS", ReviewFixtures.marking(0, 1), null);
        assertThat(QuestionMaxResolver.max(k)).isEqualTo(4.0); // falls back to marks_per_question
        assertThat(QuestionMaxResolver.min(k)).isEqualTo(-1.0);
        var written = new Review.PaperKey("s", "S", 1, null, "q", 1, 1, "LONG_ANSWER", "{}", null);
        assertThat(QuestionMaxResolver.max(written)).isNull();
        assertThat(QuestionMaxResolver.min(written)).isEqualTo(0.0);
        assertThat(QuestionMaxResolver.max(key("s", "q", 1, "LONG_ANSWER", 8))).isEqualTo(8.0);
    }
}
