package vacademy.io.admin_core_service.features.commerce.order.cod;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceVerifiedPhoneAdapter;
import vacademy.io.admin_core_service.features.commerce.order.checkout.VerifiedPhones;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpException;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpPurpose;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceOtpService;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;

import java.math.BigDecimal;
import java.util.Date;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The phone proof and the limits per phone of a COD order, and the token spend of the adapter. */
class CommerceCodPlacementRulesTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "919876543210";

    private VerifiedPhones verifiedPhones;
    private CommerceCustomerRepository customers;
    private CommerceCodPlacementRules rules;

    private static StorefrontSettings.Cod cod(int maxOpen, int maxRefusals) {
        return new StorefrontSettings.Cod(true, new BigDecimal("5000.00"), new BigDecimal("3000.00"), Set.of(),
                maxOpen, maxRefusals, 48);
    }

    @BeforeEach
    void setUp() {
        verifiedPhones = mock(VerifiedPhones.class);
        customers = mock(CommerceCustomerRepository.class);
        rules = new CommerceCodPlacementRules(verifiedPhones, customers, mock(PlatformTransactionManager.class));
    }

    @Test
    void aTokenOfCheckoutOrCodForThisPhoneProvesIt() {
        when(verifiedPhones.phoneOf(INSTITUTE, "t-checkout", "CHECKOUT")).thenReturn(PHONE);
        when(verifiedPhones.phoneOf(INSTITUTE, "t-cod", "COD")).thenReturn(PHONE);
        when(verifiedPhones.phoneOf(INSTITUTE, "t-other", "CHECKOUT")).thenReturn("919999999999");
        assertTrue(rules.proved(INSTITUTE, "t-checkout", PHONE));
        assertTrue(rules.proved(INSTITUTE, "t-cod", PHONE));
        assertFalse(rules.proved(INSTITUTE, "t-other", PHONE));
        assertFalse(rules.proved(INSTITUTE, "t-unknown", PHONE));
        assertFalse(rules.proved(INSTITUTE, null, PHONE));
        CheckoutException e = CommerceCodPlacementRules.phoneNotProved();
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("cod", e.getDetails().get("reason"));
        assertEquals("phone_token", e.getDetails().get("param"));
    }

    @Test
    void theLimitsArePerPhoneAndZeroRefusalsAllowedMeansNone() {
        CommerceCodPlacementRules.check(cod(2, 2), 1, 1);
        assertEquals("OPEN_COD_ORDERS", assertThrows(CheckoutException.class,
                () -> CommerceCodPlacementRules.check(cod(2, 2), 2, 0)).getDetails().get("reason"));
        assertEquals("COD_REFUSALS", assertThrows(CheckoutException.class,
                () -> CommerceCodPlacementRules.check(cod(2, 2), 0, 2)).getDetails().get("reason"));
        // maxRefusals = 0 blocks every phone (kept fail-closed, owner question 14).
        assertEquals("COD_REFUSALS", assertThrows(CheckoutException.class,
                () -> CommerceCodPlacementRules.check(cod(2, 0), 0, 0)).getDetails().get("reason"));
    }

    @Test
    void insideTheWriteTheTokenIsSpentThenTheCustomerRowLockedThenTheLimitsReadAgain() {
        when(verifiedPhones.spendForCod(INSTITUTE, "tok", PHONE)).thenReturn(true);
        when(customers.lockCodRefusalsByPhone(INSTITUTE, PHONE)).thenReturn(null);
        rules.spendAndLock(INSTITUTE, "tok", PHONE, cod(2, 2));
        InOrder order = inOrder(verifiedPhones, customers);
        order.verify(verifiedPhones).spendForCod(INSTITUTE, "tok", PHONE);
        order.verify(customers).insertIfAbsent(anyString(), org.mockito.ArgumentMatchers.eq(INSTITUTE),
                org.mockito.ArgumentMatchers.eq(PHONE));
        order.verify(customers).lockCodRefusalsByPhone(INSTITUTE, PHONE);
        order.verify(customers).countOpenCodOrders(INSTITUTE, PHONE);
    }

    @Test
    void aTokenThatCannotBeSpentTouchesNoCustomerRow() {
        when(verifiedPhones.spendForCod(INSTITUTE, "tok", PHONE)).thenReturn(false);
        CheckoutException e = assertThrows(CheckoutException.class,
                () -> rules.spendAndLock(INSTITUTE, "tok", PHONE, cod(2, 2)));
        assertEquals(CheckoutException.PHONE_VERIFICATION_REQUIRED, e.getCode());
        verify(customers, never()).insertIfAbsent(anyString(), anyString(), anyString());
        verify(customers, never()).lockCodRefusalsByPhone(anyString(), anyString());
    }

    @Test
    void anImplementationThatCannotSpendTokensNeverPlacesCod() {
        VerifiedPhones readOnly = (instituteId, token, purpose) -> PHONE;
        assertFalse(readOnly.spendForCod(INSTITUTE, "tok", PHONE));
    }

    // ------------------------------------------------------------------ the adapter

    @Test
    void theAdapterSpendsOnlyATokenOfThisShopPurposeAndPhone() {
        CommerceOtpService otp = mock(CommerceOtpService.class);
        CommerceVerifiedPhoneAdapter adapter = new CommerceVerifiedPhoneAdapter(otp);
        Date later = new Date(System.currentTimeMillis() + 60_000);
        when(otp.readToken("t-ok")).thenReturn(new CommerceOtpService.VerifiedPhone(INSTITUTE, PHONE,
                CommerceOtpPurpose.CHECKOUT, later, "ch-1"));
        when(otp.readToken("t-cod")).thenReturn(new CommerceOtpService.VerifiedPhone(INSTITUTE, PHONE,
                CommerceOtpPurpose.COD, later, "ch-2"));
        when(otp.readToken("t-shop")).thenReturn(new CommerceOtpService.VerifiedPhone("inst-2", PHONE,
                CommerceOtpPurpose.CHECKOUT, later, "ch-3"));
        when(otp.readToken("t-track")).thenReturn(new CommerceOtpService.VerifiedPhone(INSTITUTE, PHONE,
                CommerceOtpPurpose.TRACK_ORDER, later, "ch-4"));
        when(otp.readToken("t-phone")).thenReturn(new CommerceOtpService.VerifiedPhone(INSTITUTE, "919999999999",
                CommerceOtpPurpose.CHECKOUT, later, "ch-5"));
        when(otp.readToken("t-spent")).thenReturn(new CommerceOtpService.VerifiedPhone(INSTITUTE, PHONE,
                CommerceOtpPurpose.CHECKOUT, later, "ch-6"));
        when(otp.consumeToken("t-spent")).thenThrow(new CommerceOtpException("OTP_TOKEN_INVALID", "spent"));
        when(otp.readToken("t-forged")).thenThrow(new CommerceOtpException("OTP_TOKEN_INVALID", "forged"));

        assertTrue(adapter.spendForCod(INSTITUTE, " t-ok ", PHONE));
        verify(otp).consumeToken("t-ok");
        assertTrue(adapter.spendForCod(INSTITUTE, "t-cod", PHONE));
        for (String token : new String[] {"t-shop", "t-track", "t-phone", "t-forged"}) {
            assertFalse(adapter.spendForCod(INSTITUTE, token, PHONE), token);
            verify(otp, never()).consumeToken(token);
        }
        assertFalse(adapter.spendForCod(INSTITUTE, "t-spent", PHONE));
        assertFalse(adapter.spendForCod(INSTITUTE, null, PHONE));
        assertFalse(adapter.spendForCod(INSTITUTE, "t-ok", null));
    }
}
