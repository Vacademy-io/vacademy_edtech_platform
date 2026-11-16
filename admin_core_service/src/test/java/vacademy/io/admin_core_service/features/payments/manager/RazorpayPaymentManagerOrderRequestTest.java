package vacademy.io.admin_core_service.features.payments.manager;

import org.json.JSONObject;
import org.junit.jupiter.api.Test;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * The body of the plain Razorpay order create. A shop order asks for automatic capture (it is
 * confirmed by the captured event alone); every other order is created exactly as before.
 */
class RazorpayPaymentManagerOrderRequestTest {

    private static PaymentInitiationRequestDTO request(String description) {
        PaymentInitiationRequestDTO request = new PaymentInitiationRequestDTO();
        request.setCurrency("inr");
        request.setOrderId("receipt-1");
        request.setInstituteId("inst-1");
        request.setDescription(description);
        return request;
    }

    @Test
    void aShopOrderAsksForAutomaticCapture() throws Exception {
        JSONObject body = RazorpayPaymentManager.orderRequestOf(
                request(RazorpayPaymentManager.COMMERCE_ORDER_DESCRIPTION_PREFIX + "order-1; order_number=ORD-1"),
                49900L);

        assertEquals(1, body.getInt("payment_capture"));
        assertEquals(49900L, body.getLong("amount"));
        assertEquals("INR", body.getString("currency"));
        assertEquals("receipt-1", body.getString("receipt"));
    }

    @Test
    void aCourseOrderIsCreatedExactlyAsBefore() throws Exception {
        for (String description : new String[] {null, "", "Course fee", "about commerce_order_id=1"}) {
            JSONObject body = RazorpayPaymentManager.orderRequestOf(request(description), 49900L);

            assertFalse(body.has("payment_capture"), String.valueOf(description));
            assertEquals("receipt-1", body.getJSONObject("notes").getString("orderId"));
            assertEquals("inst-1", body.getJSONObject("notes").getString("instituteId"));
            assertEquals("INITIAL", body.getJSONObject("notes").getString("payment_type"));
        }
    }
}
