package vacademy.io.admin_core_service.features.commerce.order.checkout;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Every row of the buyer-identity table (P2 contract §3): who the buyer of an order is, per
 * mode, with and without a proved phone and an e-mail; the holder account; and that no phone
 * number is ever sent to the account service.
 */
class CommerceBuyerResolverTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "919811100001";
    private static final String KEY = "unit-test-only-not-a-secret";

    private CommerceCustomerService customerService;
    private AuthService authService;
    private CommerceBuyerResolver resolver;

    @BeforeEach
    void setUp() {
        customerService = mock(CommerceCustomerService.class);
        authService = mock(AuthService.class);
        resolver = new CommerceBuyerResolver(customerService, authService, KEY);
        when(customerService.findByPhone(any(), any())).thenReturn(Optional.empty());
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), eq(INSTITUTE),
                anyBoolean())).thenAnswer(call -> {
                    UserDTO asked = call.getArgument(0);
                    UserDTO user = new UserDTO();
                    user.setId("user-of-" + asked.getEmail());
                    return user;
                });
    }

    /** Every request the account service got: roles empty, mail off, and never a mobile number. */
    private List<UserDTO> sentToAuth() {
        ArgumentCaptor<UserDTO> asked = ArgumentCaptor.forClass(UserDTO.class);
        ArgumentCaptor<Boolean> mail = ArgumentCaptor.forClass(Boolean.class);
        verify(authService, atLeastOnce()).createUserFromAuthServiceForLearnerEnrollment(asked.capture(),
                eq(INSTITUTE), mail.capture());
        for (UserDTO user : asked.getAllValues()) {
            assertNull(user.getMobileNumber(), "no phone is ever sent to the account service");
            assertTrue(user.getRoles().isEmpty(), "no role for a shop buyer");
        }
        for (Boolean sendCredentials : mail.getAllValues()) {
            assertFalse(sendCredentials, "no credentials mail");
        }
        return asked.getAllValues();
    }

    // ------------------------------------------------------------------ PHONE_OTP

    @Test
    void phoneOtp_withoutProof_is403_whateverTheEmail() {
        for (String email : new String[] {null, "asha@example.com"}) {
            CheckoutException e = assertThrows(CheckoutException.class,
                    () -> resolver.resolve(INSTITUTE, BuyerIdentity.PHONE_OTP, PHONE, "Asha", email, false));
            assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
            assertEquals(CheckoutException.PHONE_VERIFICATION_REQUIRED, e.getCode());
            assertEquals("phone_token", e.getDetails().get("param"));
            assertEquals("mode", e.getDetails().get("reason"));
        }
        verifyNoInteractions(customerService, authService);
    }

    @Test
    void phoneOtp_withProof_isTheHolderOfThePhone_andATypedEmailIsNeverSent() {
        CommerceBuyerResolver.Buyer buyer = resolver.resolve(INSTITUTE, BuyerIdentity.PHONE_OTP, PHONE, "Asha",
                "other@example.com", true);

        assertTrue(buyer.holder());
        List<UserDTO> asked = sentToAuth();
        assertEquals(1, asked.size());
        assertEquals(resolver.holderEmail(INSTITUTE, PHONE), asked.get(0).getEmail());
        assertFalse(asked.stream().anyMatch(u -> "other@example.com".equals(u.getEmail())));
        assertEquals("user-of-" + resolver.holderEmail(INSTITUTE, PHONE), buyer.userId());
    }

    // ------------------------------------------------------------------ EMAIL

    @Test
    void email_withoutAnEmail_is400_andTheOtpIsNotOffered() {
        for (boolean proved : new boolean[] {false, true}) {
            CheckoutException e = assertThrows(CheckoutException.class,
                    () -> resolver.resolve(INSTITUTE, BuyerIdentity.EMAIL, PHONE, "Asha", " ", proved));
            assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
            assertEquals(CheckoutException.EMAIL_REQUIRED, e.getCode());
            assertEquals("customer.email", e.getDetails().get("param"));
            assertEquals(Boolean.FALSE, e.getDetails().get("otp_allowed"));
        }
        verifyNoInteractions(customerService, authService);
    }

    @Test
    void email_withOrWithoutProof_isTheAccountOfTheEmail_withNoMobileAndNotAHolder() {
        CommerceBuyerResolver.Buyer unproved = resolver.resolve(INSTITUTE, BuyerIdentity.EMAIL, PHONE, "Asha",
                "asha@example.com", false);
        CommerceBuyerResolver.Buyer proved = resolver.resolve(INSTITUTE, BuyerIdentity.EMAIL, PHONE, "Asha",
                "asha@example.com", true);

        assertEquals("user-of-asha@example.com", unproved.userId());
        assertEquals("user-of-asha@example.com", proved.userId());
        assertFalse(unproved.holder());
        assertFalse(proved.holder(), "the e-mail account never becomes the phone's");
        assertTrue(sentToAuth().stream().allMatch(u -> "asha@example.com".equals(u.getEmail())));
        verifyNoInteractions(customerService);
    }

    // ------------------------------------------------------------------ EITHER

    @Test
    void either_withoutProofOrEmail_is400_andTheOtpIsOffered() {
        CheckoutException e = assertThrows(CheckoutException.class,
                () -> resolver.resolve(INSTITUTE, BuyerIdentity.EITHER, PHONE, "Asha", null, false));
        assertEquals(CheckoutException.EMAIL_REQUIRED, e.getCode());
        assertEquals(Boolean.TRUE, e.getDetails().get("otp_allowed"));
        verifyNoInteractions(customerService, authService);
    }

    @Test
    void either_withoutProof_isTheAccountOfTheEmail_andTheCustomerOfThePhoneIsNotEvenRead() {
        CommerceBuyerResolver.Buyer buyer = resolver.resolve(INSTITUTE, BuyerIdentity.EITHER, PHONE, "Other Buyer",
                "second@example.com", false);

        assertEquals("user-of-second@example.com", buyer.userId());
        assertFalse(buyer.holder());
        sentToAuth();
        verifyNoInteractions(customerService);
    }

    @Test
    void aTypedPlaceholderAddressNeverPicksItsAccount() {
        CheckoutException e = assertThrows(CheckoutException.class, () -> resolver.resolve(INSTITUTE,
                BuyerIdentity.EMAIL, PHONE, "Other Buyer", "b-0123456789abcdef01234567@buyer.invalid", false));
        assertEquals(CheckoutException.INVALID_REQUEST, e.getCode());
        verifyNoInteractions(authService);
    }

    @Test
    void either_withProof_isTheHolder_withOrWithoutATypedEmail() {
        CommerceBuyerResolver.Buyer withEmail = resolver.resolve(INSTITUTE, BuyerIdentity.EITHER, PHONE, "Asha",
                "someone-else@example.com", true);
        CommerceBuyerResolver.Buyer without = resolver.resolve(INSTITUTE, BuyerIdentity.EITHER, PHONE, "Asha", null,
                true);

        assertTrue(withEmail.holder());
        assertEquals(withEmail.userId(), without.userId());
        assertTrue(sentToAuth().stream().noneMatch(u -> "someone-else@example.com".equals(u.getEmail())));
    }

    // ------------------------------------------------------------------ holder

    @Test
    void aKnownCustomerWithAnAccountIsReusedWithNoRemoteCall() {
        CommerceCustomer known = new CommerceCustomer();
        known.setUserId("holder-1");
        when(customerService.findByPhone(INSTITUTE, PHONE)).thenReturn(Optional.of(known));

        CommerceBuyerResolver.Buyer buyer = resolver.resolve(INSTITUTE, BuyerIdentity.EITHER, PHONE, "Asha",
                "asha@example.com", true);

        assertEquals("holder-1", buyer.userId());
        assertTrue(buyer.holder());
        verifyNoInteractions(authService);
    }

    @Test
    void theHolderAddressIsDeterministicKeyedAndCarriesNoDigitOfThePhone() {
        String a = resolver.holderEmail(INSTITUTE, PHONE);

        assertEquals(a, resolver.holderEmail(INSTITUTE, PHONE), "the same phone finds the same holder");
        assertTrue(a.matches("^b-[0-9a-f]{24}@buyer\\.invalid$"), a);
        assertTrue(CommerceBuyerResolver.isHolderEmail(a));
        assertFalse(a.contains("9811100001"));
        assertFalse(a.contains("100001"));
        assertNotEquals(a, resolver.holderEmail("inst-2", PHONE), "another shop, another holder");
        assertNotEquals(a, resolver.holderEmail(INSTITUTE, "919811100002"));
        CommerceBuyerResolver otherKey = new CommerceBuyerResolver(customerService, authService, "another-key");
        assertNotEquals(a, otherKey.holderEmail(INSTITUTE, PHONE), "keyed: not computable without the secret");
    }

    @Test
    void anEmptyHolderSecretFallsBackToTheOrderTokenSecret() {
        CommerceBuyerResolver fallback = new CommerceBuyerResolver(customerService, authService, " ", KEY);
        assertEquals(resolver.holderEmail(INSTITUTE, PHONE), fallback.holderEmail(INSTITUTE, PHONE));
        CommerceBuyerResolver own = new CommerceBuyerResolver(customerService, authService, "own-key", KEY);
        assertNotEquals(resolver.holderEmail(INSTITUTE, PHONE), own.holderEmail(INSTITUTE, PHONE));
    }

    @Test
    void withoutASecretNoHolderIsMade() {
        CommerceBuyerResolver off = new CommerceBuyerResolver(customerService, authService, " ");
        CheckoutException e = assertThrows(CheckoutException.class,
                () -> off.resolve(INSTITUTE, BuyerIdentity.EITHER, PHONE, "Asha", null, true));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        verifyNoInteractions(authService);
    }

    @Test
    void aFailingAccountServiceIsA503WithoutTheBuyersDetails() {
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), eq(INSTITUTE), anyBoolean()))
                .thenThrow(new IllegalStateException("asha@example.com 919811100004"));

        CheckoutException e = assertThrows(CheckoutException.class,
                () -> resolver.resolve(INSTITUTE, BuyerIdentity.EITHER, "919811100004", "Asha", "asha@example.com",
                        false));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        assertEquals(CheckoutException.BUYER_UNAVAILABLE, e.getCode());
        assertFalse(e.getMessage().contains("asha"));
    }

    @Test
    void theAnswerForAKnownAndAnUnknownPhoneWithoutEmailIsTheSame() {
        CommerceCustomer known = new CommerceCustomer();
        known.setUserId("user-1");
        when(customerService.findByPhone(INSTITUTE, PHONE)).thenReturn(Optional.of(known));

        CheckoutException a = assertThrows(CheckoutException.class,
                () -> resolver.resolve(INSTITUTE, BuyerIdentity.EITHER, PHONE, "Asha", null, false));
        CheckoutException b = assertThrows(CheckoutException.class,
                () -> resolver.resolve(INSTITUTE, BuyerIdentity.EITHER, "919899999999", "Asha", null, false));
        assertEquals(a.getStatus(), b.getStatus());
        assertEquals(a.getCode(), b.getCode());
        assertEquals(a.getMessage(), b.getMessage());
        assertEquals(a.getDetails(), b.getDetails());
    }
}
