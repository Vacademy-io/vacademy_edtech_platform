package vacademy.io.admin_core_service.features.credits.client;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.math.BigDecimal;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * F1: the credit grant for a paid pack must THROW unless ai_service confirms it, so the webhook
 * returns 500 and Razorpay retries (it used to return a failure map that was ignored).
 */
class CreditClientGrantFromPaymentTest {

    private static final String AI = "http://ai.test";
    private static final String URL = AI + "/ai-service/credits/v1/internal/grant-from-payment";

    private final RestTemplate restTemplate = new RestTemplate();
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(restTemplate).build();
    private final CreditClient client = new CreditClient(restTemplate, AI, "s3cret");

    @Test
    void confirmedGrantReturnsTheBodyUnchanged() {
        server.expect(requestTo(URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Service-Token", "s3cret"))
                .andExpect(jsonPath("$.external_reference_id").value("pay_1"))
                .andExpect(jsonPath("$.platform_payment_id").value("pp-1"))
                .andRespond(withSuccess("{\"success\":true,\"already_processed\":false}", MediaType.APPLICATION_JSON));

        Map<String, Object> r = client.grantFromPayment("inst-1", new BigDecimal("500"), "pay_1", "pp-1", "PACK");

        assertEquals(Boolean.TRUE, r.get("success"));
        server.verify();
    }

    @Test
    void anAlreadyProcessedRepeatIsASuccess() {
        server.expect(requestTo(URL))
                .andRespond(withSuccess("{\"success\":true,\"already_processed\":true}", MediaType.APPLICATION_JSON));
        assertEquals(Boolean.TRUE, client.grantFromPayment("inst-1", BigDecimal.TEN, "pay_1", "pp-1", null)
                .get("already_processed"));
    }

    @Test
    void serverErrorThrows() {
        server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
        assertThrows(CreditClient.PaymentGrantException.class,
                () -> client.grantFromPayment("inst-1", BigDecimal.TEN, "pay_1", "pp-1", null));
    }

    @Test
    void authFailureThrows() {
        server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
        assertThrows(CreditClient.PaymentGrantException.class,
                () -> client.grantFromPayment("inst-1", BigDecimal.TEN, "pay_1", "pp-1", null));
    }

    @Test
    void refusedBodyThrows() {
        server.expect(requestTo(URL))
                .andRespond(withSuccess("{\"success\":false,\"message\":\"nope\"}", MediaType.APPLICATION_JSON));
        assertThrows(CreditClient.PaymentGrantException.class,
                () -> client.grantFromPayment("inst-1", BigDecimal.TEN, "pay_1", "pp-1", null));
    }
}
