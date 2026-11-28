package vacademy.io.admin_core_service.features.ai_plans_billing.gateway;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.PaymentLink;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.PaymentLinkRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RecurringDebit;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RecurringDebitRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RegistrationLink;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RegistrationLinkRequest;

import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

/** The Razorpay REST calls of the platform account, against a mocked HTTP server (no live calls). */
class RazorpayHttpPlatformGatewayTest {

    static final String BASE = "https://api.razorpay.test/v1";
    RestTemplate rest;
    MockRestServiceServer server;
    RazorpayHttpPlatformGateway gw;

    @BeforeEach
    void setUp() {
        rest = new RestTemplate();
        server = MockRestServiceServer.bindTo(rest).build();
        gw = new RazorpayHttpPlatformGateway(rest, BASE, () -> new String[] { "rzp_key", "rzp_secret" });
    }

    static String basic() {
        return "Basic " + Base64.getEncoder().encodeToString("rzp_key:rzp_secret".getBytes());
    }

    @Test
    void paymentLinkCarriesExpiryNeutralNameNotesAndNoRazorpayNotifications() {
        server.expect(requestTo(BASE + "/payment_links"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", basic()))
                .andExpect(jsonPath("$.amount").value(590000))
                .andExpect(jsonPath("$.currency").value("INR"))
                .andExpect(jsonPath("$.accept_partial").value(false))
                .andExpect(jsonPath("$.reference_id").value("pp-1"))
                .andExpect(jsonPath("$.expire_by").value(1_800_000_000L))
                .andExpect(jsonPath("$.notify.sms").value(false))
                .andExpect(jsonPath("$.notify.email").value(false))
                .andExpect(jsonPath("$.reminder_enable").value(false))
                .andExpect(jsonPath("$.options.checkout.name").value("Vidyayatan Technologies"))
                .andExpect(jsonPath("$.notes.payment_type").value("AI_SUBSCRIPTION"))
                .andExpect(jsonPath("$.callback_url").value("https://admin.inst.test/x?plan_pp=pp-1"))
                .andExpect(jsonPath("$.callback_method").value("get"))
                .andRespond(withSuccess("{\"id\":\"plink_1\",\"short_url\":\"https://rzp.io/l/1\",\"status\":\"created\","
                        + "\"expire_by\":1800000000}", MediaType.APPLICATION_JSON));
        PaymentLink l = gw.createPaymentLink(new PaymentLinkRequest("pp-1", 590_000L, "INR", "AI Pro subscription",
                "Inst", "a@inst.test", null, 1_800_000_000L, "Vidyayatan Technologies",
                "https://admin.inst.test/x?plan_pp=pp-1", Map.of("payment_type", "AI_SUBSCRIPTION", "orderId", "pp-1")));
        assertEquals("plink_1", l.id());
        assertEquals("https://rzp.io/l/1", l.shortUrl());
        server.verify();
    }

    @Test
    void registrationLinkIsARecurringAuthLink() {
        server.expect(requestTo(BASE + "/subscription_registration/auth_links"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.type").value("link"))
                .andExpect(jsonPath("$.amount").value(590000))
                .andExpect(jsonPath("$.subscription_registration.method").value("upi"))
                .andExpect(jsonPath("$.subscription_registration.max_amount").value(1500000))
                .andExpect(jsonPath("$.subscription_registration.frequency").value("as_presented"))
                .andExpect(jsonPath("$.sms_notify").value(false))
                .andExpect(jsonPath("$.email_notify").value(false))
                .andExpect(jsonPath("$.customer.contact").value("9876543210"))
                .andRespond(withSuccess("{\"id\":\"inv_1\",\"short_url\":\"https://rzp.io/i/1\",\"order_id\":\"order_1\","
                        + "\"status\":\"issued\"}", MediaType.APPLICATION_JSON));
        RegistrationLink l = gw.createRegistrationLink(new RegistrationLinkRequest("Inst", "a@inst.test", "9876543210",
                590_000L, "INR", "AI Pro subscription", "upi", 1_500_000L, "as_presented", null, 1_800_000_000L,
                "aisub_x", Map.of("orderId", "pp-1")));
        assertEquals("inv_1", l.id());
        assertEquals("order_1", l.orderId());
        server.verify();
    }

    @Test
    void recurringDebitCreatesTheOrderThenTheRecurringPaymentOnTheToken() {
        server.expect(requestTo(BASE + "/orders"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.amount").value(590000))
                .andExpect(jsonPath("$.payment_capture").value(true))
                .andExpect(jsonPath("$.token_id").doesNotExist())
                .andExpect(jsonPath("$.notification").doesNotExist())
                .andRespond(withSuccess("{\"id\":\"order_9\"}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(BASE + "/payments/create/recurring"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.order_id").value("order_9"))
                .andExpect(jsonPath("$.customer_id").value("cust_1"))
                .andExpect(jsonPath("$.token").value("token_1"))
                .andExpect(jsonPath("$.recurring").value(true))
                .andExpect(jsonPath("$.amount").value(590000))
                .andExpect(jsonPath("$.contact").value("9876543210"))
                .andRespond(withSuccess("{\"razorpay_payment_id\":\"pay_9\"}", MediaType.APPLICATION_JSON));
        RecurringDebit d = gw.createRecurringDebit(new RecurringDebitRequest(590_000L, "INR", "aisub_x", "cust_1",
                "token_1", "a@inst.test", "9876543210", "AI Pro renewal", Map.of("orderId", "pp-2")));
        assertEquals("order_9", d.orderId());
        assertEquals("pay_9", d.paymentId());
        server.verify();
    }

    @Test
    void razorpayErrorsThrowWithTheirCode() {
        server.expect(requestTo(BASE + "/payment_links/plink_1/cancel"))
                .andRespond(withStatus(HttpStatus.BAD_REQUEST).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"error\":{\"code\":\"BAD_REQUEST_ERROR\",\"description\":\"cannot cancel a paid link\"}}"));
        RazorpayGatewayException e = assertThrows(RazorpayGatewayException.class, () -> gw.cancelPaymentLink("plink_1"));
        assertEquals(400, e.getHttpStatus());
        assertEquals("BAD_REQUEST_ERROR", e.getRazorpayCode());
        assertTrue(e.getMessage().contains("cannot cancel a paid link"));
    }

    @Test
    void noCredentialsNoCall() {
        RazorpayHttpPlatformGateway none = new RazorpayHttpPlatformGateway(rest, BASE, () -> new String[] { "", "" });
        assertThrows(RazorpayGatewayException.class, () -> none.fetchPayment("pay_1"));
        server.verify(); // nothing was sent
    }

    @Test
    void idsArePathSafe() {
        assertThrows(IllegalArgumentException.class, () -> gw.fetchPaymentLink("plink_1/../../x"));
    }

    @Test
    void upiMandatesAreCancelledAndCardTokensDeleted() {
        server.expect(requestTo(BASE + "/customers/cust_1/tokens/token_u/cancel")).andExpect(method(HttpMethod.PUT))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(BASE + "/customers/cust_1/tokens/token_c")).andExpect(method(HttpMethod.DELETE))
                .andRespond(withSuccess("{\"deleted\":true}", MediaType.APPLICATION_JSON));
        gw.cancelToken("cust_1", "token_u", "UPI");
        gw.cancelToken("cust_1", "token_c", "CARD");
        server.verify();
    }

    @Test
    void tokensAndRegistrationStatusesAreRead() {
        server.expect(requestTo(BASE + "/customers/cust_1/tokens"))
                .andRespond(withSuccess("{\"items\":[{\"id\":\"token_1\",\"method\":\"upi\",\"max_amount\":1500000,"
                        + "\"recurring_details\":{\"status\":\"confirmed\"}}]}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(BASE + "/invoices/inv_1"))
                .andRespond(withSuccess("{\"id\":\"inv_1\",\"status\":\"paid\",\"payment_id\":\"pay_1\",\"amount_paid\":590000}",
                        MediaType.APPLICATION_JSON));
        List<PlatformRazorpayGateway.TokenInfo> t = gw.fetchTokens("cust_1");
        assertEquals("confirmed", t.get(0).status());
        PaymentLink inv = gw.fetchRegistrationLink("inv_1");
        assertTrue(inv.isPaid());
        assertEquals("pay_1", inv.payments().get(0).paymentId());
    }
}
