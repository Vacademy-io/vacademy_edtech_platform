package vacademy.io.assessment_service.features.submission_review;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.submission_review.model.AnswerStatus;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Live follow-up B1 (2026-11-19): question_wise_marks.status follows the mark for every
 * writer, and the learner report reads rows written before that by their marks.
 */
class AnswerStatusTest {

    @Test
    void status_from_marks_matches_the_scorers_convention() {
        assertThat(AnswerStatus.fromMarks(10, 10.0)).isEqualTo("CORRECT");
        assertThat(AnswerStatus.fromMarks(4, 5.0)).isEqualTo("PARTIAL_CORRECT");
        assertThat(AnswerStatus.fromMarks(0, 5.0)).isEqualTo("INCORRECT");
        assertThat(AnswerStatus.fromMarks(-1, 5.0)).isEqualTo("INCORRECT");
        assertThat(AnswerStatus.fromMarks(3, null)).isEqualTo("CORRECT");
    }

    @Test
    void report_reads_an_ai_or_teacher_mark_with_a_stale_pending_status_by_its_marks() {
        // The live case: CBE marked 10/10 by the AI, accepted on release, status left PENDING.
        assertThat(AnswerStatus.effective("PENDING", 10, 10.0, "AI_REVIEWED", "MARKED")).isEqualTo("CORRECT");
        assertThat(AnswerStatus.effective("PENDING", 6, 10.0, "AI", null)).isEqualTo("PARTIAL_CORRECT");
        assertThat(AnswerStatus.effective(null, 4, null, "MANUAL", "MARKED")).isEqualTo("CORRECT");
    }

    @Test
    void report_leaves_an_old_zero_as_stored() {
        // An old AI row cannot tell a blank answer (the AI's "unattempted": 0) from a wrong
        // one: it stays skipped, as it read before.
        assertThat(AnswerStatus.effective("PENDING", 0, 10.0, "AI", null)).isEqualTo("PENDING");
        assertThat(AnswerStatus.effective("PENDING", 0, 10.0, "AI_REVIEWED", "MARKED")).isEqualTo("PENDING");
        assertThat(AnswerStatus.effective("PENDING", 0, 10.0, "TEACHER", null)).isEqualTo("PENDING");
    }

    @Test
    void report_takes_the_papers_max_when_an_old_row_has_none() {
        // Pre-1a rows have max_marks NULL: 4 of a 10-mark question is partial, not correct.
        assertThat(AnswerStatus.effective("PENDING", 4, null, "AI_REVIEWED", "MARKED", () -> 10.0))
                .isEqualTo("PARTIAL_CORRECT");
        assertThat(AnswerStatus.effective("PENDING", 10, null, "AI", null, () -> 10.0)).isEqualTo("CORRECT");
        // The row's own max wins; the paper is not asked.
        assertThat(AnswerStatus.effective("PENDING", 4, 4.0, "AI", null, () -> {
            throw new AssertionError("not asked");
        })).isEqualTo("CORRECT");
        // Nor for a row read as stored.
        assertThat(AnswerStatus.effective("PARTIAL_CORRECT", 4, null, "MANUAL", "MARKED", () -> {
            throw new AssertionError("not asked");
        })).isEqualTo("PARTIAL_CORRECT");
    }

    @Test
    void report_reads_a_status_that_is_none_of_the_four_by_its_marks() {
        // The PDF evaluation tool sent "evaluated" with every mark; manual submit stored it.
        assertThat(AnswerStatus.effective("evaluated", 3, null, "MANUAL", "MARKED", () -> 5.0))
                .isEqualTo("PARTIAL_CORRECT");
        assertThat(AnswerStatus.effective("evaluated", 5, 5.0, null, null)).isEqualTo("CORRECT");
        assertThat(AnswerStatus.effective("evaluated", 0, 5.0, null, null)).isEqualTo("INCORRECT");
        assertThat(AnswerStatus.knownOrFromMarks("evaluated", 2, 5.0)).isEqualTo("PARTIAL_CORRECT");
        assertThat(AnswerStatus.knownOrFromMarks(null, 5, 5.0)).isEqualTo("CORRECT");
        assertThat(AnswerStatus.knownOrFromMarks("PENDING", 5, 5.0)).isEqualTo("PENDING");
    }

    @Test
    void an_ai_no_answer_verdict_stays_skipped() {
        // ai_service typed_answers.unattempted_verdict: 0 marks, extracted_answer "".
        assertThat(AnswerStatus.forAiVerdict(0, 10.0, "")).isEqualTo("PENDING");
        assertThat(AnswerStatus.forAiVerdict(0, 10.0, null)).isEqualTo("PENDING");
        // A 0 on something the learner wrote is wrong, not skipped.
        assertThat(AnswerStatus.forAiVerdict(0, 10.0, "photosynthesis")).isEqualTo("INCORRECT");
        assertThat(AnswerStatus.forAiVerdict(6, 10.0, "")).isEqualTo("PARTIAL_CORRECT");
    }

    @Test
    void accepting_an_ai_zero_on_a_blank_answer_keeps_it_skipped() {
        assertThat(AnswerStatus.forAcceptedAi(0, 10.0, "PENDING", true)).isEqualTo("PENDING");
        assertThat(AnswerStatus.forAcceptedAi(0, 10.0, "PENDING", false)).isEqualTo("INCORRECT");
        // Uploaded sheet (blank unknown): the callback's PENDING (AI found no answer) is kept.
        assertThat(AnswerStatus.forAcceptedAi(0, 10.0, "PENDING", null)).isEqualTo("PENDING");
        assertThat(AnswerStatus.forAcceptedAi(0, 10.0, "INCORRECT", null)).isEqualTo("INCORRECT");
        assertThat(AnswerStatus.forAcceptedAi(7, 10.0, "PENDING", true)).isEqualTo("PARTIAL_CORRECT");
    }

    @Test
    void report_keeps_every_other_status() {
        // Not answered stays skipped.
        assertThat(AnswerStatus.effective("PENDING", 0, 10.0, "MANUAL", "NOT_ANSWERED")).isEqualTo("PENDING");
        // Unmarked (no source) and machine-scored rows keep what the scorer stored.
        assertThat(AnswerStatus.effective("PENDING", 0, 10.0, null, null)).isEqualTo("PENDING");
        assertThat(AnswerStatus.effective("PENDING", 0, 2.0, "OMR", null)).isEqualTo("PENDING");
        assertThat(AnswerStatus.effective("INCORRECT", 2.5, 5.0, null, null)).isEqualTo("INCORRECT");
        // A status a writer already set wins.
        assertThat(AnswerStatus.effective("PARTIAL_CORRECT", 5, 5.0, "MANUAL", "MARKED"))
                .isEqualTo("PARTIAL_CORRECT");
    }
}
