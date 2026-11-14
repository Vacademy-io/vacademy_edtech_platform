package vacademy.io.admin_core_service.features.credits.client;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * ai_service no longer serves /credits/v1/institutes/{id}/initialize and /credits/v1/check to
 * unauthenticated callers, so both must carry the service token like the other credit calls.
 */
class CreditClientInternalAuthTest {

    private static final String AI = "http://ai.test";

    private final RestTemplate restTemplate = new RestTemplate();
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
    private final CreditClient client = new CreditClient(restTemplate, AI, "s3cret");

    @Test
    void initializeCreditsSendsTheServiceToken() {
        server.expect(requestTo(AI + "/ai-service/credits/v1/institutes/inst-1/initialize"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Service-Token", "s3cret"))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

        client.initializeCredits("inst-1");

        server.verify();
    }

    @Test
    void checkCreditsSendsTheServiceTokenAndReadsTheAnswer() {
        server.expect(requestTo(AI + "/ai-service/credits/v1/check"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Service-Token", "s3cret"))
                .andRespond(withSuccess("{\"has_sufficient_credits\": false}", MediaType.APPLICATION_JSON));

        // false proves the answer was read: a rejected call fails open and returns true.
        assertFalse(client.checkCredits("inst-1", "content", "m", 10));

        server.verify();
    }
}
