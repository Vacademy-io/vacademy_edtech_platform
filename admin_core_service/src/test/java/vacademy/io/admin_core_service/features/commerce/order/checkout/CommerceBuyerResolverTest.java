package vacademy.io.admin_core_service.features.commerce.order.checkout;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CommerceBuyerResolverTest {

    @Mock
    private CommerceCustomerService customerService;
    @Mock
    private AuthService authService;
    @InjectMocks
    private CommerceBuyerResolver resolver;

    @Test
    void aProvedPhoneTheShopKnowsReusesItsUserAndMakesNoRemoteCall() {
        CommerceCustomer known = new CommerceCustomer();
        known.setUserId("user-1");
        when(customerService.findByPhone("inst", "919811100001")).thenReturn(Optional.of(known));

        assertEquals("user-1", resolver.resolveUserId("inst", "919811100001", "Asha", null, true));
        verifyNoInteractions(authService);
    }

    @Test
    void aTypedPhoneIsNotAnIdentity_theBuyerIsTheAccountOfTheEmailAndTheCustomerRowIsNotEvenRead() {
        UserDTO attacker = new UserDTO();
        attacker.setId("user-of-the-email");
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), eq("inst"), anyBoolean()))
                .thenReturn(attacker);

        // The shop knows this phone (it is the victim's, with user-1). Nobody proved it here.
        assertEquals("user-of-the-email",
                resolver.resolveUserId("inst", "919811100001", "Mallory", "mallory@example.com", false));
        verifyNoInteractions(customerService);
    }

    @Test
    void withoutAProvedPhoneAKnownAndAnUnknownPhoneGetTheSameAnswerWhenTheEmailIsMissing() {
        CheckoutException known = assertThrows(CheckoutException.class,
                () -> resolver.resolveUserId("inst", "919811100001", "Asha", null, false));
        CheckoutException unknown = assertThrows(CheckoutException.class,
                () -> resolver.resolveUserId("inst", "919899999999", "Asha", null, false));

        assertEquals(known.getStatus(), unknown.getStatus());
        assertEquals(known.getCode(), unknown.getCode());
        assertEquals(known.getMessage(), unknown.getMessage());
        assertEquals(CheckoutException.EMAIL_REQUIRED, known.getCode());
        // Neither answer came from a look at the customers of the shop.
        verifyNoInteractions(customerService, authService);
    }

    @Test
    void aNewPhoneWithoutAnEmailIsAnswered400AndNoAccountIsAskedFor() {
        when(customerService.findByPhone("inst", "919811100002")).thenReturn(Optional.empty());

        CheckoutException e = assertThrows(CheckoutException.class,
                () -> resolver.resolveUserId("inst", "919811100002", "Asha", " ", true));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertEquals(CheckoutException.EMAIL_REQUIRED, e.getCode());
        assertEquals("customer.email", e.getDetails().get("param"));
        verifyNoInteractions(authService);
    }

    @Test
    void aNewPhoneWithAnEmailIsCreatedWithNoRoleAndNoMail() {
        UserDTO created = new UserDTO();
        created.setId("user-9");
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), eq("inst"), anyBoolean()))
                .thenReturn(created);

        assertEquals("user-9", resolver.resolveUserId("inst", "919811100003", "Asha", "asha@example.com", false));
        ArgumentCaptor<UserDTO> asked = ArgumentCaptor.forClass(UserDTO.class);
        ArgumentCaptor<Boolean> mail = ArgumentCaptor.forClass(Boolean.class);
        verify(authService).createUserFromAuthServiceForLearnerEnrollment(asked.capture(), eq("inst"), mail.capture());
        assertEquals("asha@example.com", asked.getValue().getEmail());
        assertTrue(asked.getValue().getRoles().isEmpty(), "no role for a shop buyer");
        assertFalse(mail.getValue(), "no credentials mail");
    }

    @Test
    void aFailingAccountServiceIsA503WithoutTheBuyersDetails() {
        when(authService.createUserFromAuthServiceForLearnerEnrollment(any(UserDTO.class), eq("inst"), anyBoolean()))
                .thenThrow(new IllegalStateException("asha@example.com 919811100004"));

        CheckoutException e = assertThrows(CheckoutException.class,
                () -> resolver.resolveUserId("inst", "919811100004", "Asha", "asha@example.com", false));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        assertEquals(CheckoutException.BUYER_UNAVAILABLE, e.getCode());
        assertFalse(e.getMessage().contains("asha"));
    }
}
