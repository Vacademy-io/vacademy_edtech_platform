package vacademy.io.assessment_service.features.assessment.service.aireport;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.Outcome;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * "Every answer" of an AI-checked copy: marked by its marks, skipped only when the AI read
 * nothing. Before, a checked copy (status PENDING, no typed response) showed every question
 * as skipped.
 */
class AiReportDataServiceCopyCheckTest {

    private static AiReportDataService.StudentAnswer checked(double marks, boolean read) {
        return new AiReportDataService.StudentAnswer(marks, AiReportDataService.AI_CHECKED_STATUS, null, read);
    }

    @Test
    void aiCheckedAnswerIsJudgedByItsMarks() {
        assertThat(AiReportDataService.outcomeOf(checked(5, true), 5)).isEqualTo(Outcome.CORRECT);
        assertThat(AiReportDataService.outcomeOf(checked(2, true), 5)).isEqualTo(Outcome.PARTIAL);
        assertThat(AiReportDataService.outcomeOf(checked(0, true), 5)).isEqualTo(Outcome.WRONG);
    }

    @Test
    void anAnswerTheAiFoundNothingForIsSkipped() {
        assertThat(AiReportDataService.outcomeOf(checked(0, false), 5)).isEqualTo(Outcome.SKIPPED);
    }

    @Test
    void storedStatusesAreReadAsBefore() {
        AiReportDataService.StudentAnswer pendingUnanswered = new AiReportDataService.StudentAnswer(0, "PENDING", null, false);
        AiReportDataService.StudentAnswer pendingTyped = new AiReportDataService.StudentAnswer(0, "PENDING", null, true);
        AiReportDataService.StudentAnswer correct = new AiReportDataService.StudentAnswer(4, "CORRECT", null, true);
        assertThat(AiReportDataService.outcomeOf(pendingUnanswered, 5)).isEqualTo(Outcome.SKIPPED);
        // An online test's typed answer still waiting (or AI-marked 0) reads as before: pending.
        assertThat(AiReportDataService.outcomeOf(pendingTyped, 5)).isEqualTo(Outcome.PENDING);
        assertThat(AiReportDataService.outcomeOf(correct, 5)).isEqualTo(Outcome.CORRECT);
    }
}
