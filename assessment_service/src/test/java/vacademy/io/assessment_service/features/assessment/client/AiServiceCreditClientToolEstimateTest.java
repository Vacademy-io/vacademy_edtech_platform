package vacademy.io.assessment_service.features.assessment.client;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCreditClient.ToolEstimate;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The credit gate's quote (10.6): an answer is parsed with its rate, and anything
 * that is not an answer reads as "unreachable" - never as "allowed".
 */
class AiServiceCreditClientToolEstimateTest {

        @Test
        void anAnswerCarriesQuoteBalanceAndTheNestedRateSnapshot() {
                Map<String, Object> response = new HashMap<>();
                response.put("tool_key", "copy_check_evaluation_api");
                response.put("unit_field", "pages");
                response.put("estimated_credits", 12.0);
                response.put("current_balance", 340.5);
                response.put("sufficient", true);
                response.put("rate_snapshot", Map.of("flat_base_credits", 0, "per_unit_credits", 1,
                                "params", Map.of("fixed_price", true), "rate_source", "global"));

                ToolEstimate estimate = AiServiceCreditClient.toToolEstimate("copy_check_evaluation_api", response);

                assertThat(estimate.reachable()).isTrue();
                assertThat(estimate.credits()).isEqualByComparingTo("12");
                assertThat(estimate.currentBalance()).isEqualByComparingTo("340.5");
                assertThat(estimate.sufficient()).isTrue();
                assertThat(estimate.rateSnapshot()).containsEntry("tool_key", "copy_check_evaluation_api")
                                .containsEntry("unit_field", "pages").containsEntry("rate_source", "global")
                                .containsEntry("per_unit_credits", 1).containsKey("params");
        }

        @Test
        void topLevelRateFieldsAreKeptWhenThereIsNoNestedSnapshot() {
                Map<String, Object> response = new HashMap<>();
                response.put("unit_field", "questions");
                response.put("estimated_credits", 3);
                response.put("flat_base_credits", 1);
                response.put("per_unit_credits", 0.2);
                response.put("rate_source", "override:x");

                ToolEstimate estimate = AiServiceCreditClient.toToolEstimate("copy_check_evaluation", response);

                assertThat(estimate.rateSnapshot()).containsEntry("tool_key", "copy_check_evaluation")
                                .containsEntry("flat_base_credits", 1).containsEntry("rate_source", "override:x");
                assertThat(estimate.currentBalance()).isNull();
        }

        @Test
        void todaysResponseWithoutRateFieldsStillQuotes() {
                ToolEstimate estimate = AiServiceCreditClient.toToolEstimate("copy_check_evaluation",
                                Map.of("unit_field", "questions", "estimated_credits", 3, "current_balance", 10));

                assertThat(estimate.reachable()).isTrue();
                assertThat(estimate.rateSnapshot()).containsOnlyKeys("tool_key", "unit_field");
        }

        @Test
        void noBodyIsNotAnAnswer() {
                assertThat(AiServiceCreditClient.toToolEstimate("x", null).reachable()).isFalse();
        }

        @Test
        void anUnreachableServiceIsReportedNotHidden() {
                AiServiceCreditClient client = new AiServiceCreditClient("http://127.0.0.1:1", "token");

                ToolEstimate estimate = client.estimate("copy_check_evaluation", Map.of("num_questions", 3), "inst-1",
                                Duration.ofSeconds(2));

                assertThat(estimate.reachable()).isFalse();
                assertThat(estimate.credits()).isNull();
                assertThat(estimate.error()).isNotBlank();
        }
}
