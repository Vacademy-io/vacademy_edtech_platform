package vacademy.io.admin_core_service.features.commerce.order.checkout;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.common.auth.dto.UserDTO;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The walk-in customer's placeholder address and account (counter sales without a phone). */
class CommerceBuyerResolverWalkInTest {

    private final CommerceCustomerService customers = mock(CommerceCustomerService.class);
    private final AuthService authService = mock(AuthService.class);
    private final CommerceBuyerResolver resolver = new CommerceBuyerResolver(customers, authService, "test-secret");

    @Test
    void theAddressIsDeterministicPerInstituteAndDiffersBetweenInstitutes() {
        String first = resolver.walkInEmail("inst-1");
        assertEquals(first, resolver.walkInEmail("inst-1"));
        assertNotEquals(first, resolver.walkInEmail("inst-2"));
        assertTrue(first.startsWith("w-"));
        assertTrue(first.endsWith(CommerceBuyerResolver.HOLDER_DOMAIN));
        assertTrue(first.endsWith("@buyer.invalid"));
        assertEquals(2 + 24 + CommerceBuyerResolver.HOLDER_DOMAIN.length(), first.length());
        assertTrue(CommerceBuyerResolver.isHolderEmail(first));
    }

    @Test
    void theAddressIsNotAPhoneHolderAddressOfTheSameInstitute() {
        assertNotEquals(resolver.walkInEmail("inst-1"), resolver.holderEmail("inst-1", "919876543210"));
        assertFalse(resolver.walkInEmail("inst-1").startsWith("b-"));
    }

    @Test
    void theAccountIsMadeWithNoPhoneNoRoleAndTheWalkInName() {
        UserDTO made = new UserDTO();
        made.setId("user-walk-in");
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), eq("inst-1"), anyBoolean()))
                .thenReturn(made);

        assertEquals("user-walk-in", resolver.walkInAccount("inst-1"));

        ArgumentCaptor<UserDTO> sent = ArgumentCaptor.forClass(UserDTO.class);
        verify(authService).createUserFromAuthServiceForLearnerEnrollment(sent.capture(), eq("inst-1"), eq(false));
        assertEquals(resolver.walkInEmail("inst-1"), sent.getValue().getEmail());
        assertNull(sent.getValue().getMobileNumber());
        assertTrue(sent.getValue().getRoles().isEmpty());
        assertEquals("Walk-in customer", sent.getValue().getFullName());
    }

    @Test
    void withoutASecretTheCounterIsNotConfigured() {
        CommerceBuyerResolver unset = new CommerceBuyerResolver(customers, authService, "");
        CheckoutException e = assertThrows(CheckoutException.class, () -> unset.walkInEmail("inst-1"));
        assertEquals(CheckoutException.NOT_CONFIGURED, e.getCode());
    }
}
