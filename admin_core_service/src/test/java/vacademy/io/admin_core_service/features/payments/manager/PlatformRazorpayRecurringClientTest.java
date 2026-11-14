package vacademy.io.admin_core_service.features.payments.manager;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.payments.manager.PlatformRazorpayRecurringClient.Method;
import vacademy.io.admin_core_service.features.payments.manager.PlatformRazorpayRecurringClient.RazorpayApiException;
import vacademy.io.admin_core_service.features.payments.manager.PlatformRazorpayRecurringClient.RecurringNotAllowedException;
import vacademy.io.admin_core_service.features.payments.manager.PlatformRazorpayRecurringClient.Transport;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformPaymentConfigService;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The platform-account recurring client against a mocked Razorpay transport (no live calls). */
class PlatformRazorpayRecurringClientTest {

    private static final ObjectMapper M = new ObjectMapper();

    private record Call(String method, String url, String auth, JsonNode body) {}

    private final List<Call> calls = new ArrayList<>();
    private final List<Transport.Response> replies = new ArrayList<>();
    private PlatformRazorpayRecurringClient client;

    @BeforeEach
    void setUp() {
        PlatformPaymentConfigService config = mock(PlatformPaymentConfigService.class);
        when(config.getRazorpayCredsMap()).thenReturn(Map.of("apiKey", "rzp_key", "keySecret", "rzp_secret"));
        Transport transport = (method, url, auth, body) -> {
            try {
                calls.add(new Call(method, url, auth, body == null ? null : M.readTree(body)));
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
            return replies.isEmpty() ? new Transport.Response(200, "{}") : replies.remove(0);
        };
        client = new PlatformRazorpayRecurringClient(config, transport, "https://api.test/v1");
    }

    private void reply(int status, String body) {
        replies.add(new Transport.Response(status, body));
    }

    @Test
    void createCustomerUsesPlatformCredentialsAndNeverFailsOnAnExistingCustomer() {
        reply(200, "{\"id\":\"cust_1\"}");

        assertEquals("cust_1", client.createCustomer("Shiksha Nation", "a@b.test", "+919876543210",
                Map.of("institute_id", "inst-1")));

        Call c = calls.get(0);
        assertEquals("POST", c.method());
        assertEquals("https://api.test/v1/customers", c.url());
        assertEquals("Basic " + Base64.getEncoder().encodeToString("rzp_key:rzp_secret".getBytes(StandardCharsets.UTF_8)),
                c.auth());
        assertEquals("0", c.body().get("fail_existing").asText());
        assertEquals("inst-1", c.body().path("notes").path("institute_id").asText());
    }

    @Test
    void registrationLinkBodyFollowsTheDocs() {
        reply(200, "{\"id\":\"inv_1\",\"short_url\":\"https://rzp.io/i/x\",\"order_id\":\"order_1\",\"status\":\"issued\"}");
        Instant mandateEnd = Instant.parse("2036-10-16T00:00:00Z");
        Instant linkEnd = Instant.parse("2026-10-18T00:00:00Z");

        Map<String, Object> r = client.createRegistrationLink(new PlatformRazorpayRecurringClient.RegistrationLinkRequest(
                "Admin", "a@b.test", "+919876543210", 118000, "AI Pro, monthly", Method.UPI, 118000,
                mandateEnd, "as_presented", "pp-1", linkEnd, Map.of("orderId", "pp-1", "payment_type", "AI_SUBSCRIPTION")));

        assertEquals("inv_1", r.get("id"));
        assertEquals("order_1", r.get("order_id"));
        Call c = calls.get(0);
        assertEquals("https://api.test/v1/subscription_registration/auth_links", c.url());
        JsonNode b = c.body();
        assertEquals("link", b.get("type").asText());
        assertEquals(118000, b.get("amount").asLong());
        assertEquals("INR", b.get("currency").asText());
        assertEquals("upi", b.path("subscription_registration").path("method").asText());
        assertEquals(118000, b.path("subscription_registration").path("max_amount").asLong());
        assertEquals(mandateEnd.getEpochSecond(), b.path("subscription_registration").path("expire_at").asLong());
        assertEquals(linkEnd.getEpochSecond(), b.get("expire_by").asLong());
        assertEquals(0, b.get("sms_notify").asInt());
        assertEquals(0, b.get("email_notify").asInt());
        assertEquals("AI_SUBSCRIPTION", b.path("notes").path("payment_type").asText());
    }

    @Test
    void mandatesAndDebitsAboveTheAfaCeilingNeverReachRazorpay() {
        long over = PlatformRazorpayRecurringClient.AFA_FREE_CEILING_MINOR + 1;
        assertThrows(RecurringNotAllowedException.class, () -> client.createRegistrationLink(
                new PlatformRazorpayRecurringClient.RegistrationLinkRequest("A", "a@b.test", null, over, "x",
                        Method.CARD, over, null, null, null, null, null)));
        assertThrows(RecurringNotAllowedException.class, () -> client.createRecurringOrder(
                new PlatformRazorpayRecurringClient.RecurringOrderRequest(over, over, "r", "token_1", null, null)));
        assertThrows(RecurringNotAllowedException.class, () -> client.createRecurringPayment(
                new PlatformRazorpayRecurringClient.RecurringPaymentRequest("a@b.test", "+91", 5000, 4000, "order_1",
                        "cust_1", "token_1", null, null)));
        assertTrue(calls.isEmpty());
    }

    @Test
    void renewalDebitIsAnOrderWithPreDebitNotificationThenARecurringPayment() {
        reply(200, "{\"id\":\"order_9\"}");
        reply(200, "{\"razorpay_payment_id\":\"pay_9\"}");
        Instant after = Instant.parse("2026-11-01T06:00:00Z");

        String orderId = client.createRecurringOrder(new PlatformRazorpayRecurringClient.RecurringOrderRequest(
                118000, 150000, "pp-9", "token_1", after, Map.of("orderId", "pp-9", "payment_type", "AI_SUBSCRIPTION")));
        String payId = client.createRecurringPayment(new PlatformRazorpayRecurringClient.RecurringPaymentRequest(
                "a@b.test", "+919876543210", 118000, 150000, orderId, "cust_1", "token_1", "AI Pro renewal",
                Map.of("orderId", "pp-9", "payment_type", "AI_SUBSCRIPTION")));

        assertEquals("pay_9", payId);
        JsonNode order = calls.get(0).body();
        assertEquals("https://api.test/v1/orders", calls.get(0).url());
        assertTrue(order.get("payment_capture").asBoolean());
        assertEquals("token_1", order.path("notification").path("token_id").asText());
        assertEquals(after.getEpochSecond(), order.path("notification").path("payment_after").asLong());
        JsonNode pay = calls.get(1).body();
        assertEquals("https://api.test/v1/payments/create/recurring", calls.get(1).url());
        assertEquals("order_9", pay.get("order_id").asText());
        assertEquals("token_1", pay.get("token").asText());
        assertEquals("cust_1", pay.get("customer_id").asText());
        assertEquals("1", pay.get("recurring").asText());
        assertEquals("AI_SUBSCRIPTION", pay.path("notes").path("payment_type").asText());
    }

    @Test
    void orderWithoutPaymentAfterCarriesNoNotification() {
        reply(200, "{\"id\":\"order_9\"}");
        client.createRecurringOrder(new PlatformRazorpayRecurringClient.RecurringOrderRequest(
                1000, 0, "r", null, null, null));
        assertFalse(calls.get(0).body().has("notification"));
    }

    @Test
    void cancelTokenUsesPutCancelForUpiAndDeleteForCards() {
        client.cancelToken("cust_1", "token_u", Method.UPI);
        client.cancelToken("cust_1", "token_c", Method.CARD);
        assertEquals("PUT", calls.get(0).method());
        assertEquals("https://api.test/v1/customers/cust_1/tokens/token_u/cancel", calls.get(0).url());
        assertEquals("DELETE", calls.get(1).method());
        assertEquals("https://api.test/v1/customers/cust_1/tokens/token_c", calls.get(1).url());
    }

    @Test
    void fetchTokenAndStatus() {
        reply(200, "{\"id\":\"token_1\",\"recurring_details\":{\"status\":\"CONFIRMED\"}}");
        JsonNode token = client.fetchToken("cust_1", "token_1");
        assertEquals("confirmed", PlatformRazorpayRecurringClient.tokenStatus(token));
        assertEquals("GET", calls.get(0).method());
        assertNull(calls.get(0).body());
    }

    @Test
    void razorpayErrorsCarryTheirCode() {
        reply(400, "{\"error\":{\"code\":\"BAD_REQUEST_ERROR\",\"description\":\"The token is invalid\"}}");
        RazorpayApiException e = assertThrows(RazorpayApiException.class, () -> client.fetchPayment("pay_x"));
        assertEquals(400, e.getHttpStatus());
        assertEquals("BAD_REQUEST_ERROR", e.getCode());
        assertTrue(e.getMessage().contains("The token is invalid"));
    }

    @Test
    void registrationAndPaymentLookupsHitTheDocumentedPaths() {
        reply(200, "{\"id\":\"inv_1\",\"status\":\"paid\",\"payment_id\":\"pay_1\"}");
        reply(200, "{\"id\":\"inv_1\",\"status\":\"cancelled\"}");
        reply(200, "{\"items\":[{\"id\":\"token_1\"},{\"id\":\"token_2\"}]}");
        assertEquals("pay_1", client.fetchRegistrationLink("inv_1").get("payment_id"));
        assertEquals("cancelled", client.cancelRegistrationLink("inv_1").get("status"));
        assertEquals(2, client.fetchTokens("cust_1").size());
        assertEquals("https://api.test/v1/invoices/inv_1", calls.get(0).url());
        assertEquals("https://api.test/v1/invoices/inv_1/cancel", calls.get(1).url());
        assertEquals("https://api.test/v1/customers/cust_1/tokens", calls.get(2).url());
    }
}
