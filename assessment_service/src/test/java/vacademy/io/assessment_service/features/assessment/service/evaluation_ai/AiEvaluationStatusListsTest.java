package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every "is a check running?" list must agree. DISPATCHED (a claimed row about to
 * be sent) was in the poller's and sweeper's sets but nowhere else; a list that
 * misses it lets a re-trigger start a second paid run, or the completion notice go
 * out while a copy is still being sent (spec 11.2).
 */
class AiEvaluationStatusListsTest {

    @Test
    void theEnumKnowsDispatchedAndCancelled() {
        assertThat(AiEvaluationStatusEnum.valueOf("DISPATCHED")).isNotNull();
        assertThat(AiEvaluationStatusEnum.valueOf("CANCELLED")).isNotNull();
    }

    @Test
    void activeIsQueuedPlusInFlight() {
        assertThat(AiEvaluationStatusEnum.ACTIVE).startsWith("PENDING")
                .containsAll(AiEvaluationStatusEnum.IN_FLIGHT)
                .hasSize(AiEvaluationStatusEnum.IN_FLIGHT.size() + 1)
                .doesNotContainAnyElementsOf(AiEvaluationStatusEnum.TERMINAL);
        assertThat(AiEvaluationStatusEnum.IN_FLIGHT).contains("DISPATCHED").doesNotContain("PENDING");
        assertThat(AiEvaluationStatusEnum.TERMINAL).containsExactlyInAnyOrder("COMPLETED", "FAILED", "CANCELLED");
    }

    @Test
    void everyActiveListIsTheSharedOne() {
        assertThat(AiEvaluationService.ACTIVE_STATUSES).isEqualTo(AiEvaluationStatusEnum.ACTIVE);
        assertThat(AiEvaluationSubmissionEnqueuer.ACTIVE_STATUSES).isEqualTo(AiEvaluationStatusEnum.ACTIVE);
        assertThat(AiEvaluationCompletionNotifier.ACTIVE).isEqualTo(AiEvaluationStatusEnum.ACTIVE);
        assertThat(AiEvaluationQueuePoller.IN_FLIGHT).isEqualTo(AiEvaluationStatusEnum.IN_FLIGHT);
    }

    @Test
    void theDashboardKeepsShowingAClaimedRowAsPending() {
        assertThat(AiEvaluationProgressService.displayStatus("DISPATCHED")).isEqualTo("PENDING");
        assertThat(AiEvaluationProgressService.displayStatus("PROCESSING")).isEqualTo("PROCESSING");
        assertThat(AiEvaluationProgressService.displayStatus(null)).isNull();
    }
}
