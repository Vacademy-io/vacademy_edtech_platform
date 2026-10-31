package vacademy.io.admin_core_service.features.credits.client;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/** The attributed token deduct, with and without an idempotency key. */
class CreditClientIdempotentDeductTest {

    private static final String AI = "http://ai.test";
    private static final String OK = "{\"success\": true, \"credits_deducted\": 1, \"new_balance\": 9, \"message\": \"ok\"}";

    private final RestTemplate restTemplate = new RestTemplate();
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
    private final CreditClient client = new CreditClient(restTemplate, AI, "s3cret");

    @Test
    void keyIsSentWithThePostPaidTokenCharge() {
        server.expect(requestTo(AI + "/ai-service/credits/v1/deduct"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Service-Token", "s3cret"))
                .andExpect(jsonPath("$.idempotency_key").value("java-llm-usage:u-1"))
                .andExpect(jsonPath("$.usage_log_id").value("u-1"))
                .andExpect(jsonPath("$.allow_negative").value(true))
                .andExpect(jsonPath("$.prompt_tokens").value(1200))
                .andExpect(jsonPath("$.completion_tokens").value(300))
                .andExpect(jsonPath("$.model").value("anthropic/claude-sonnet-4.5"))
                .andExpect(jsonPath("$.request_type").value("agent"))
                .andExpect(jsonPath("$.user_role").value("ADMIN"))
                .andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

        assertTrue(client.deductAttributedTokenUsage("inst-1", "agent", "anthropic/claude-sonnet-4.5", 1200, 300,
                "u-1", "user-1", "ADMIN", null, "agent using anthropic/claude-sonnet-4.5", null,
                "java-llm-usage:u-1"));
        server.verify();
    }

    @Test
    void aChargeWithoutAPreflightGateNeverGoesNegative() {
        String refused = "{\"success\": false, \"credits_deducted\": 0, \"message\": \"Insufficient balance\"}";
        server.expect(requestTo(AI + "/ai-service/credits/v1/deduct"))
                .andExpect(jsonPath("$.allow_negative").value(false))
                .andExpect(jsonPath("$.idempotency_key").value("java-llm-usage:u-3"))
                .andRespond(withSuccess(refused, MediaType.APPLICATION_JSON));

        assertFalse(client.deductAttributedTokenUsage("inst-1", "agent", "m", 1, 1,
                "u-3", "user-1", "ADMIN", null, "d", null, "java-llm-usage:u-3", false));
        server.verify();
    }

    @Test
    void theOriginalSignatureSendsNoKey() {
        server.expect(requestTo(AI + "/ai-service/credits/v1/deduct"))
                .andExpect(jsonPath("$.idempotency_key").doesNotExist())
                .andExpect(jsonPath("$.subject_user_id").doesNotExist())
                .andExpect(jsonPath("$.allow_negative").value(true))
                .andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

        assertTrue(client.deductAttributedTokenUsage("inst-1", "chatbot", "m", 1, 1,
                "u-2", "user-1", "LEARNER", null, "d", "flow-1"));
        server.verify();
    }
}
