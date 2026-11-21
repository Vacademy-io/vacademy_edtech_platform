package vacademy.io.admin_core_service.features.ai_plans_billing.client;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

/** The ai_service internal plans client: token header, bodies per the [A] contract, errors that throw. */
class AiPlansInternalClientTest {

    static final String AI = "http://ai.test";
    MockRestServiceServer server;
    AiPlansInternalClient client;

    @BeforeEach
    void setUp() {
        RestTemplate rest = new RestTemplate();
        server = MockRestServiceServer.bindTo(rest).build();
        client = new AiPlansInternalClient(rest, AI, "secret-token");
    }

    @Test
    void paidSendsTheTokenAndTheAmount() {
        server.expect(requestTo(AI + "/ai-service/internal/plans/v1/charges/c-1/paid"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("X-Internal-Service-Token", "secret-token"))
                .andExpect(jsonPath("$.vendor_payment_id").value("pay_1"))
                .andExpect(jsonPath("$.amount_minor").value(590000))
                .andExpect(jsonPath("$.platform_payment_id").value("pp-1"))
                .andRespond(withSuccess("{\"action\":\"ACTIVATED\"}", MediaType.APPLICATION_JSON));
        assertEquals("ACTIVATED", client.chargePaid("c-1", "pp-1", "pay_1", 590_000L).get("action"));
        server.verify();
    }

    @Test
    void refundedSendsThisRefundAndTheCumulativeTotal() {
        server.expect(requestTo(AI + "/ai-service/internal/plans/v1/charges/c-1/refunded"))
                .andExpect(jsonPath("$.vendor_payment_id").value("pay_1"))
                .andExpect(jsonPath("$.amount_minor").value(100000))
                .andExpect(jsonPath("$.total_refunded_minor").value(250000))
                .andExpect(jsonPath("$.refund_id").value("rfnd_2"))
                .andRespond(withSuccess("{\"action\":\"PARTIALLY_REFUNDED\"}", MediaType.APPLICATION_JSON));
        client.chargeRefunded("c-1", "pay_1", 100_000L, 250_000L, "rfnd_2");
        server.verify();
    }

    @Test
    void patchUsesPatch() {
        server.expect(requestTo(AI + "/ai-service/internal/plans/v1/charges/c-1"))
                .andExpect(method(HttpMethod.PATCH))
                .andExpect(jsonPath("$.total_minor").value(590000))
                .andRespond(withSuccess("{\"id\":\"c-1\"}", MediaType.APPLICATION_JSON));
        client.patchCharge("c-1", Map.of("total_minor", 590_000L));
        server.verify();
    }

    @Test
    void businessRefusalCarriesTheCodeAndIsNotRetryable() {
        server.expect(requestTo(AI + "/ai-service/internal/plans/v1/charges/c-1/paid"))
                .andRespond(withStatus(HttpStatus.CONFLICT).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"detail\":{\"error_code\":\"AMOUNT_MISMATCH\",\"message\":\"x\"}}"));
        AiPlansUpstreamException e = assertThrows(AiPlansUpstreamException.class,
                () -> client.chargePaid("c-1", "pp", "pay", 1L));
        assertEquals("AMOUNT_MISMATCH", e.getCode());
        assertFalse(e.isRetryable());
        assertEquals(409, e.getStatus().value());
    }

    @Test
    void outageIsRetryable() {
        server.expect(requestTo(AI + "/ai-service/internal/plans/v1/charges/c-1/paid"))
                .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
        AiPlansUpstreamException e = assertThrows(AiPlansUpstreamException.class,
                () -> client.chargePaid("c-1", "pp", "pay", 1L));
        assertTrue(e.isRetryable());
        assertEquals(502, e.getStatus().value());
    }

    @Test
    void chargeLookupFiltersByInstituteAndMatchesTheId() {
        server.expect(requestTo(org.hamcrest.Matchers.startsWith(AI + "/ai-service/internal/plans/v1/charges?charge_id=c-2")))
                .andExpect(queryParam("institute_id", "inst-1"))
                .andRespond(withSuccess("{\"charges\":[{\"id\":\"c-1\"},{\"id\":\"c-2\",\"status\":\"DUE\"}]}",
                        MediaType.APPLICATION_JSON));
        assertEquals("DUE", client.charge("c-2", "inst-1").get("status"));
    }

    @Test
    void unsafeIdsNeverReachTheUrl() {
        assertThrows(IllegalArgumentException.class, () -> client.voidCharge("../roll", "x", "y"));
    }
}
