package vacademy.io.assessment_service.features.submission_review;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.submission_review.model.MarkState;
import vacademy.io.assessment_service.features.submission_review.model.MarkedByKind;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionKind;
import vacademy.io.assessment_service.features.submission_review.service.MarkStateDeriver;
import vacademy.io.assessment_service.features.submission_review.service.Review;

import static org.assertj.core.api.Assertions.assertThat;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.key;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.row;
import static vacademy.io.assessment_service.features.submission_review.ReviewFixtures.rowWithAnswer;

/** Contract 4.2 rules 1-9 (acceptance 1). */
class MarkStateDeriverTest {

    private static final Review.PaperKey MCQ = key("s1", "q1", 1, "MCQS", 2);
    private static final Review.PaperKey CBE = key("s1", "q2", 2, "CBE_RESPONSE", 10);
    private static final Review.PaperKey LONG = key("s1", "q3", 3, "LONG_ANSWER", 5);
    private static final Review.PaperKey MATCH = key("s1", "q4", 4, "MATCH", 5);

    private static MarkStateDeriver.Derived derive(Review.MarkRow r, Review.PaperKey k, SubmissionKind kind,
                                                   String evalType, boolean released) {
        return MarkStateDeriver.derive(r, k, kind, evalType, released);
    }

    @Test
    void rule1_stored_state_wins() {
        var d = derive(row("r", "s1", "q2", 7, "CORRECT", "MANUAL", "MARKED", 1), CBE, SubmissionKind.ONLINE, "AUTO", false);
        assertThat(d.state()).isEqualTo(MarkState.MARKED);
        assertThat(d.stored()).isTrue();
        assertThat(d.markedBy()).isEqualTo(MarkedByKind.TEACHER);
        var na = derive(row("r", "s1", "q2", 0, "PENDING", "MANUAL", "NOT_ANSWERED", 1), CBE, SubmissionKind.ONLINE, "AUTO", false);
        assertThat(na.state()).isEqualTo(MarkState.NOT_ANSWERED);
        assertThat(na.markedBy()).isEqualTo(MarkedByKind.NONE);
    }

    @Test
    void rule2_no_row_is_not_answered_online_and_needs_marking_on_paper() {
        assertThat(derive(null, CBE, SubmissionKind.ONLINE, "AUTO", false).state()).isEqualTo(MarkState.NOT_ANSWERED);
        assertThat(derive(null, CBE, SubmissionKind.HANDWRITTEN, "MANUAL", false).state()).isEqualTo(MarkState.NEEDS_MARKING);
        assertThat(derive(null, MCQ, SubmissionKind.SCANNED, "AUTO", false).state()).isEqualTo(MarkState.NEEDS_MARKING);
    }

    @Test
    void rule3_ai_is_a_draft_until_released() {
        var r = row("r", "s1", "q2", 6, "PENDING", "AI", null, 1);
        assertThat(derive(r, CBE, SubmissionKind.ONLINE, "AUTO", false).state()).isEqualTo(MarkState.AI_DRAFT);
        assertThat(derive(r, CBE, SubmissionKind.ONLINE, "AUTO", true).state()).isEqualTo(MarkState.MARKED);
        assertThat(derive(r, CBE, SubmissionKind.ONLINE, "AUTO", true).markedBy()).isEqualTo(MarkedByKind.AI);
    }

    @Test
    void rule4_known_sources_are_marked() {
        assertThat(derive(row("r", "s1", "q1", 2, "CORRECT", "AUTO", null, 0), MCQ, SubmissionKind.ONLINE, "AUTO", false).markedBy())
                .isEqualTo(MarkedByKind.ANSWER_KEY);
        assertThat(derive(row("r", "s1", "q2", 5, "PARTIAL_CORRECT", "AI_REVIEWED", null, 0), CBE, SubmissionKind.ONLINE, "AUTO", false).markedBy())
                .isEqualTo(MarkedByKind.AI_REVIEWED);
    }

    @Test
    void rule5_manual_test_legacy_rows() {
        assertThat(derive(row("r", "s1", "q1", 0, "PENDING", null, null, 0), MCQ, SubmissionKind.HANDWRITTEN, "MANUAL", false).state())
                .isEqualTo(MarkState.NEEDS_MARKING);
        var marked = derive(row("r", "s1", "q1", 2, "CORRECT", null, null, 0), MCQ, SubmissionKind.HANDWRITTEN, "MANUAL", false);
        assertThat(marked.state()).isEqualTo(MarkState.MARKED);
        assertThat(marked.markedBy()).isEqualTo(MarkedByKind.TEACHER_LEGACY);
    }

    @Test
    void rule6_cbe_answered_without_source_needs_marking_and_blank_is_not_answered() {
        String answered = "{\"responseData\":{\"answer\":{\"parts\":{\"p1\":{\"kind\":\"DOCUMENT\",\"html\":\"<p>My answer</p>\"}}}}}";
        var d = derive(rowWithAnswer("r", "s1", "q2", answered), CBE, SubmissionKind.ONLINE, "AUTO", false);
        assertThat(d.state()).isEqualTo(MarkState.NEEDS_MARKING);
        assertThat(derive(rowWithAnswer("r", "s1", "q2", null), CBE, SubmissionKind.ONLINE, "AUTO", false).state())
                .isEqualTo(MarkState.NOT_ANSWERED);
    }

    @Test
    void rule7_long_answer_keyword_score() {
        var scored = derive(row("r", "s1", "q3", 2, "PARTIAL_CORRECT", null, null, 0), LONG, SubmissionKind.ONLINE, "AUTO", false);
        assertThat(scored.state()).isEqualTo(MarkState.MARKED);
        assertThat(scored.markedBy()).isEqualTo(MarkedByKind.KEYWORD);
        String typed = "{\"responseData\":{\"answer\":\"An essay\"}}";
        assertThat(derive(rowWithAnswer("r", "s1", "q3", typed), LONG, SubmissionKind.ONLINE, "AUTO", false).state())
                .isEqualTo(MarkState.NEEDS_MARKING);
        assertThat(derive(rowWithAnswer("r", "s1", "q3", "{\"responseData\":{\"answer\":\"  \"}}"), LONG,
                SubmissionKind.ONLINE, "AUTO", false).state()).isEqualTo(MarkState.NOT_ANSWERED);
    }

    /**
     * Owner decision 2026-11-19: a keyword-match score (source KEYWORD) needs marking whatever
     * the release or evaluation type, and never reads as blank (the store loads no JSON for it).
     */
    @Test
    void keyword_source_needs_marking_until_confirmed() {
        for (boolean released : new boolean[] {false, true}) {
            for (String evalType : new String[] {"AUTO", "MANUAL"}) {
                for (String status : new String[] {"CORRECT", "INCORRECT"}) {
                    var d = derive(row("r", "s1", "q3", -1, status, "KEYWORD", null, 0), LONG,
                            SubmissionKind.ONLINE, evalType, released);
                    String as = released + "/" + evalType + "/" + status;
                    assertThat(d.state()).as(as).isEqualTo(MarkState.NEEDS_MARKING);
                    assertThat(d.markedBy()).as(as).isEqualTo(MarkedByKind.KEYWORD);
                    assertThat(d.stored()).as(as).isFalse();
                }
            }
        }
        // A teacher's confirmation stores MARKED / MANUAL: the stored state wins.
        var confirmed = derive(row("r", "s1", "q3", 3, "PARTIAL_CORRECT", "MANUAL", "MARKED", 1), LONG,
                SubmissionKind.ONLINE, "AUTO", false);
        assertThat(confirmed.state()).isEqualTo(MarkState.MARKED);
        assertThat(confirmed.markedBy()).isEqualTo(MarkedByKind.TEACHER);
        // History is untouched: a NULL-source keyword score stays MARKED (rule 7).
        var legacy = derive(row("r", "s1", "q3", 5, "CORRECT", null, null, 0), LONG, SubmissionKind.ONLINE, "AUTO", true);
        assertThat(legacy.state()).isEqualTo(MarkState.MARKED);
        assertThat(legacy.markedBy()).isEqualTo(MarkedByKind.KEYWORD);
    }

    @Test
    void rule8_objective_correct_is_marked_by_answer_key() {
        var d = derive(row("r", "s1", "q1", 2, "CORRECT", null, null, 0), MCQ, SubmissionKind.ONLINE, "AUTO", false);
        assertThat(d.state()).isEqualTo(MarkState.MARKED);
        assertThat(d.markedBy()).isEqualTo(MarkedByKind.ANSWER_KEY);
        assertThat(derive(row("r", "s1", "q1", 0, "PENDING", null, null, 0), MCQ, SubmissionKind.ONLINE, "AUTO", false).state())
                .isEqualTo(MarkState.NOT_ANSWERED);
    }

    @Test
    void rule9_other_types() {
        assertThat(derive(row("r", "s1", "q4", 0, "PENDING", null, null, 0), MATCH, SubmissionKind.ONLINE, "AUTO", false).state())
                .isEqualTo(MarkState.NEEDS_MARKING);
        assertThat(derive(row("r", "s1", "q4", 3, "CORRECT", null, null, 0), MATCH, SubmissionKind.ONLINE, "AUTO", false).markedBy())
                .isEqualTo(MarkedByKind.TEACHER_LEGACY);
    }

    @Test
    void legacy_teacher_source_reads_exactly_like_manual() {
        var teacher = derive(row("r", "s1", "q1", 2, "CORRECT", "TEACHER", null, 0), MCQ, SubmissionKind.ONLINE, "AUTO", false);
        var manual = derive(row("r", "s1", "q1", 2, "CORRECT", "MANUAL", null, 0), MCQ, SubmissionKind.ONLINE, "AUTO", false);
        assertThat(teacher).isEqualTo(manual);
        assertThat(teacher.state()).isEqualTo(MarkState.MARKED);
        assertThat(teacher.markedBy()).isEqualTo(MarkedByKind.TEACHER);
        assertThat(vacademy.io.assessment_service.features.submission_review.model.MarksSource.isProtected("TEACHER")).isTrue();
        assertThat(vacademy.io.assessment_service.features.submission_review.model.MarksSource.canonical("TEACHER"))
                .isEqualTo("MANUAL");
    }
}
