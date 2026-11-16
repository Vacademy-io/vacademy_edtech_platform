package vacademy.io.admin_core_service.features.payments.manager;

import com.razorpay.PaymentClient;
import com.razorpay.RazorpayClient;
import com.razorpay.RazorpayException;
import com.razorpay.Refund;
import org.json.JSONObject;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedConstruction;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockConstruction;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The two refund reads the shop's refund poll uses; no credential ever reaches a message. */
class RazorpayPaymentManagerRefundReadTest {

    private static final Map<String, Object> CREDS = Map.of("apiKey", "rzp_test_unit", "keySecret",
            "very-secret-value");

    private static MockedConstruction<RazorpayClient> client(PaymentClient payments) {
        return mockConstruction(RazorpayClient.class, (mock, context) -> {
            java.lang.reflect.Field field = RazorpayClient.class.getField("payments");
            field.setAccessible(true);
            field.set(mock, payments);
        });
    }

    @Test
    void theRefundsOfAPaymentAreReadAsMapsAtMostAHundred() throws Exception {
        PaymentClient payments = mock(PaymentClient.class);
        when(payments.fetchAllRefunds(eq("pay_1"), any(JSONObject.class))).thenReturn(List.of(
                new Refund(new JSONObject("{\"id\":\"rfnd_1\",\"amount\":100,\"receipt\":\"r-1\",\"status\":\"processed\"}"))));
        try (MockedConstruction<RazorpayClient> ignored = client(payments)) {
            List<Map<String, Object>> refunds = new RazorpayPaymentManager().fetchPaymentRefunds("pay_1", CREDS);
            assertEquals(1, refunds.size());
            assertEquals("rfnd_1", refunds.get(0).get("id"));
            assertEquals("r-1", refunds.get(0).get("receipt"));
            ArgumentCaptor<JSONObject> request = ArgumentCaptor.forClass(JSONObject.class);
            verify(payments).fetchAllRefunds(eq("pay_1"), request.capture());
            assertEquals(100, request.getValue().getInt("count"));
        }
    }

    @Test
    void oneRefundOfAPaymentIsRead() throws Exception {
        PaymentClient payments = mock(PaymentClient.class);
        when(payments.fetchRefund("pay_1", "rfnd_1")).thenReturn(new Refund(new JSONObject(
                "{\"id\":\"rfnd_1\",\"payment_id\":\"pay_1\",\"status\":\"pending\"}")));
        try (MockedConstruction<RazorpayClient> ignored = client(payments)) {
            Map<String, Object> refund = new RazorpayPaymentManager().fetchPaymentRefund("pay_1", "rfnd_1", CREDS);
            assertEquals("pending", refund.get("status"));
        }
    }

    @Test
    void errorsNameNoCredentialAndMissingIdsAreRefusedWithoutACall() throws Exception {
        PaymentClient payments = mock(PaymentClient.class);
        when(payments.fetchAllRefunds(anyString(), any(JSONObject.class)))
                .thenThrow(new RazorpayException("auth failed for very-secret-value"));
        when(payments.fetchRefund(anyString(), anyString()))
                .thenThrow(new RazorpayException("auth failed for very-secret-value"));
        try (MockedConstruction<RazorpayClient> ignored = client(payments)) {
            RazorpayPaymentManager manager = new RazorpayPaymentManager();
            VacademyException many = assertThrows(VacademyException.class,
                    () -> manager.fetchPaymentRefunds("pay_1", CREDS));
            assertFalse(many.getMessage().contains("very-secret-value"), many.getMessage());
            VacademyException one = assertThrows(VacademyException.class,
                    () -> manager.fetchPaymentRefund("pay_1", "rfnd_1", CREDS));
            assertFalse(one.getMessage().contains("very-secret-value"), one.getMessage());
            assertThrows(VacademyException.class, () -> manager.fetchPaymentRefunds(" ", CREDS));
            assertThrows(VacademyException.class, () -> manager.fetchPaymentRefund("pay_1", null, CREDS));
            assertEquals(2, ignored.constructed().size(), "no client is made for a missing id");
        }
    }
}
