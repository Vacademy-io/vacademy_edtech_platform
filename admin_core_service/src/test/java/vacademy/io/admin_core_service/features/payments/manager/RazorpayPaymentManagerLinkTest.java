package vacademy.io.admin_core_service.features.payments.manager;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.enums.PaymentType;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** F7: Payment Link options (expire_by, reminders, business name) and the link / refund helpers. */
class RazorpayPaymentManagerLinkTest {

    private static final Instant NOW = Instant.parse("2026-10-16T10:00:00Z");

    private static PaymentInitiationRequestDTO packRequest() {
        PaymentInitiationRequestDTO r = new PaymentInitiationRequestDTO();
        r.setAmount(590.0);
        r.setCurrency("INR");
        r.setOrderId("pp-1");
        r.setInstituteId("inst-1");
        r.setPaymentType(PaymentType.AI_CREDIT_PACK);
        r.setDescription("Pack 500 — 500 AI credits");
        return r;
    }

    private static UserDTO buyer() {
        return UserDTO.builder().id("u1").email("a@b.test").fullName("Admin").build();
    }

    /** keys() works with both org.json and the android-json copy on the test classpath. */
    private static Set<String> keys(JSONObject o) throws Exception {
        Set<String> out = new java.util.HashSet<>();
        for (java.util.Iterator<String> it = o.keys(); it.hasNext(); ) out.add(it.next());
        return out;
    }

    @Test
    void jsonToMapConvertsNestedObjectsAndArrays() throws Exception {
        JSONObject refund = new JSONObject().put("id", "rfnd_1").put("amount", 1500)
                .put("notes", new JSONObject().put("reason", "DUPLICATE"))
                .put("list", new JSONArray().put(1).put("a"));
        Map<String, Object> m = RazorpayPaymentManager.jsonToMap(refund);
        assertEquals("rfnd_1", m.get("id"));
        assertEquals(1500, ((Number) m.get("amount")).intValue());
        assertEquals("DUPLICATE", ((Map<?, ?>) m.get("notes")).get("reason"));
        assertEquals(List.of(1, "a"), m.get("list"));
    }

    @Test
    void withoutOptionsTheBodyIsExactlyThePreF7One() throws Exception {
        JSONObject body = RazorpayPaymentManager.buildPaymentLinkRequest(buyer(), packRequest(),
                "https://dash.vacademy.io/x?topup_pp=pp-1", null, NOW);

        assertEquals(Set.of("amount", "currency", "accept_partial", "reference_id", "description", "customer",
                "notify", "reminder_enable", "notes", "callback_url", "callback_method"), keys(body));
        assertEquals(59000L, body.getLong("amount"));
        assertFalse(body.getBoolean("reminder_enable"));
        assertFalse(body.getJSONObject("notify").getBoolean("sms"));
        assertFalse(body.getJSONObject("notify").getBoolean("email"));
        JSONObject notes = body.getJSONObject("notes");
        assertEquals(Set.of("orderId", "instituteId", "payment_type", "description"), keys(notes));
        assertEquals("AI_CREDIT_PACK", notes.getString("payment_type"));
        assertEquals("get", body.getString("callback_method"));
    }

    @Test
    void expiryReminderAndBusinessNameAreSentWhenGiven() throws Exception {
        Instant expireBy = NOW.plus(Duration.ofHours(48));
        RazorpayPaymentManager.PaymentLinkOptions opts = new RazorpayPaymentManager.PaymentLinkOptions(
                expireBy, false, "Vidyayatan Technologies", Map.of("charge_id", "c-1", "orderId", "forged"));

        JSONObject body = RazorpayPaymentManager.buildPaymentLinkRequest(buyer(), packRequest(), null, opts, NOW);

        assertEquals(expireBy.getEpochSecond(), body.getLong("expire_by"));
        assertFalse(body.getBoolean("reminder_enable"));
        assertEquals("Vidyayatan Technologies", body.getJSONObject("options").getJSONObject("checkout").getString("name"));
        assertEquals("c-1", body.getJSONObject("notes").getString("charge_id"));
        assertEquals("pp-1", body.getJSONObject("notes").getString("orderId"), "routing keys always win");
        assertFalse(body.has("callback_url"));
    }

    @Test
    void expiryTooSoonIsRefusedAndTooFarIsClampedToSixMonths() throws Exception {
        RazorpayPaymentManager.PaymentLinkOptions soon =
                RazorpayPaymentManager.PaymentLinkOptions.expiringAt(NOW.plus(Duration.ofMinutes(5)));
        assertThrows(VacademyException.class,
                () -> RazorpayPaymentManager.buildPaymentLinkRequest(buyer(), packRequest(), null, soon, NOW));

        RazorpayPaymentManager.PaymentLinkOptions far =
                RazorpayPaymentManager.PaymentLinkOptions.expiringAt(NOW.plus(Duration.ofDays(400)));
        JSONObject body = RazorpayPaymentManager.buildPaymentLinkRequest(buyer(), packRequest(), null, far, NOW);
        assertEquals(NOW.plus(Duration.ofDays(180)).getEpochSecond(), body.getLong("expire_by"));
    }

    @Test
    void extraNotesAreCappedSoRazorpaysFifteenKeyLimitHolds() throws Exception {
        java.util.Map<String, String> many = new java.util.HashMap<>();
        for (int i = 0; i < 30; i++) many.put("k" + i, "v");
        JSONObject body = RazorpayPaymentManager.buildPaymentLinkRequest(buyer(), packRequest(), null,
                new RazorpayPaymentManager.PaymentLinkOptions(null, null, null, many), NOW);
        assertTrue(body.getJSONObject("notes").length() <= 15);
    }

    @Test
    void linkSummaryListsItsPayments() throws Exception {
        JSONObject link = new JSONObject()
                .put("id", "plink_1").put("status", "paid").put("reference_id", "pp-1")
                .put("amount", 59000).put("amount_paid", 59000).put("expire_by", 1760900000L)
                .put("payments", new JSONArray().put(new JSONObject()
                        .put("payment_id", "pay_1").put("status", "captured").put("amount", 59000)));

        Map<String, Object> s = RazorpayPaymentManager.summarizePaymentLink(link);

        assertEquals("paid", s.get("status"));
        assertEquals(59000L, s.get("amountPaid"));
        assertEquals(1760900000L, s.get("expireBy"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> payments = (List<Map<String, Object>>) s.get("payments");
        assertEquals("pay_1", payments.get(0).get("paymentId"));
        assertEquals("captured", payments.get(0).get("status"));
    }

    @Test
    void refundBodyCarriesAmountAndAReceiptIdempotencyKey() throws Exception {
        JSONObject partial = RazorpayPaymentManager.buildRefundRequest(1500L, "ar-0123456789012345678901234567890123456789",
                Map.of("reason", "DUPLICATE"));
        assertEquals(1500L, partial.getLong("amount"));
        assertEquals(40, partial.getString("receipt").length());
        assertEquals("normal", partial.getString("speed"));
        assertEquals("DUPLICATE", partial.getJSONObject("notes").getString("reason"));

        JSONObject full = RazorpayPaymentManager.buildRefundRequest(null, null, null);
        assertFalse(full.has("amount"), "no amount = full refund, as before");
        assertThrows(VacademyException.class, () -> RazorpayPaymentManager.buildRefundRequest(0L, null, null));
    }
}
