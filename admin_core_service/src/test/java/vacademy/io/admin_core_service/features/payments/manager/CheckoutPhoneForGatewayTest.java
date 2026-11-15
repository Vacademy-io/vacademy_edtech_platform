package vacademy.io.admin_core_service.features.payments.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.admin_core_service.features.payments.util.GatewayCustomerContact;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

/**
 * Checkout for an existing account that has no mobile number: the gateway still gets the phone
 * typed at checkout (Cashfree needs customer_phone on the order), while the account's user, the
 * one stored and returned to the caller, keeps no mobile number.
 */
class CheckoutPhoneForGatewayTest {

    private static UserDTO accountWithoutMobile() {
        return UserDTO.builder().id("acc-1").email("asha@example.com").fullName("Asha").build();
    }

    private static UserDTO typed(String mobile) {
        return UserDTO.builder().email("asha@example.com").mobileNumber(mobile).build();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> cashfreeCustomer(UserDTO user) {
        CashfreePaymentManager manager = new CashfreePaymentManager(WebClient.builder(), new ObjectMapper());
        PaymentInitiationRequestDTO request = new PaymentInitiationRequestDTO();
        request.setOrderId("order-1");
        request.setAmount(499.0);
        request.setCurrency("INR");
        return (Map<String, Object>) manager.buildOrderPayload(user, request).get("customer_details");
    }

    @Test
    void cashfreeOrderCarriesTheTypedPhoneForAnAccountWithoutMobile() {
        UserDTO account = accountWithoutMobile();

        Map<String, Object> customer = cashfreeCustomer(
                GatewayCustomerContact.withCheckoutPhone(account, typed("+91 98765 43210")));

        assertEquals("+919876543210", customer.get("customer_phone"));
        assertEquals("acc-1", customer.get("customer_id"));
        assertNull(account.getMobileNumber(), "the account's own user is not changed");
    }

    @Test
    void withoutTheTypedPhoneTheOrderWouldHaveNone() {
        assertFalse(cashfreeCustomer(accountWithoutMobile()).containsKey("customer_phone"));
    }

    @Test
    void anAccountWithItsOwnMobileKeepsIt() {
        UserDTO account = accountWithoutMobile();
        account.setMobileNumber("9123456789");

        UserDTO forGateway = GatewayCustomerContact.withCheckoutPhone(account, typed("9876543210"));

        assertSame(account, forGateway);
        assertEquals("9123456789", cashfreeCustomer(forGateway).get("customer_phone"));
    }

    @Test
    void theGatewayUserIsACopy() {
        UserDTO account = accountWithoutMobile();
        account.setRoles(java.util.List.of("STUDENT"));

        UserDTO forGateway = GatewayCustomerContact.withCheckoutPhone(account, typed("98765-43210"));

        assertNotSame(account, forGateway);
        assertEquals("9876543210", forGateway.getMobileNumber());
        assertEquals("acc-1", forGateway.getId());
        assertEquals("asha@example.com", forGateway.getEmail());
        assertEquals(java.util.List.of("STUDENT"), forGateway.getRoles());
        assertNull(account.getMobileNumber());
    }

    @Test
    void nothingTypedLeavesTheAccountAsItIs() {
        UserDTO account = accountWithoutMobile();

        assertSame(account, GatewayCustomerContact.withCheckoutPhone(account, typed(null)));
        assertSame(account, GatewayCustomerContact.withCheckoutPhone(account, null));
        assertSame(account, GatewayCustomerContact.withCheckoutPhone(account, typed("--")));
    }

    @Test
    void theEnrolmentsKeptPhoneReachesTheGatewayWhileTheCarriedUserHasNone() {
        // The learner enrolment request carries the user create-or-get answered (no mobile);
        // the typed number is kept in the enrolment's extra data for the gateway only.
        UserDTO carried = accountWithoutMobile();
        Map<String, Object> extraData = Map.of(GatewayCustomerContact.CHECKOUT_MOBILE_NUMBER, "+91 98765 43210");

        Map<String, Object> customer = cashfreeCustomer(
                GatewayCustomerContact.withCheckoutPhone(carried, carried, extraData));

        assertEquals("+919876543210", customer.get("customer_phone"));
        assertNull(carried.getMobileNumber());
    }

    @Test
    void withoutAKeptPhoneTheTypedUserIsUsed() {
        UserDTO account = accountWithoutMobile();

        assertEquals("9876543210",
                GatewayCustomerContact.withCheckoutPhone(account, typed("98765 43210"), Map.of()).getMobileNumber());
        assertSame(account, GatewayCustomerContact.withCheckoutPhone(account, typed(null), null));
    }
}
