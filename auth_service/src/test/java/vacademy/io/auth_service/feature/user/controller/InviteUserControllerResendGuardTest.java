package vacademy.io.auth_service.feature.user.controller;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.auth_service.feature.user.service.AdminRoleGrantGuard;
import vacademy.io.auth_service.feature.user.service.InviteUserService;
import vacademy.io.auth_service.feature.user.service.UserAccountAccessGuard;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.UserService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;

/**
 * resend-invitation used to mail any user's login details, branded as whichever institute
 * the account happened to resolve to, for any signed-in caller.
 */
class InviteUserControllerResendGuardTest {

    private final InviteUserService service = mock(InviteUserService.class);
    private final UserAccountAccessGuard guard = mock(UserAccountAccessGuard.class);
    private final InviteUserController controller = new InviteUserController(service,
            mock(AdminRoleGrantGuard.class), guard, mock(UserService.class));
    private final CustomUserDetails caller = caller();

    private static CustomUserDetails caller() {
        User user = new User();
        user.setId("caller");
        user.setUsername("caller");
        return new CustomUserDetails(user, "inst-a", List.of());
    }

    @Test
    void aRefusedCallerSendsNothing() {
        doThrow(new VacademyException(HttpStatus.FORBIDDEN, "no"))
                .when(guard).requireCanResendLogin(caller, "inst-a", "victim");

        assertThrows(VacademyException.class,
                () -> controller.resendInvitation("victim", "inst-a", null, caller));
        verifyNoInteractions(service);
    }

    @Test
    void theInstituteParamDecidesWhoIsCheckedAndWhatIsSent() {
        controller.resendInvitation("member", "inst-a", "inst-b", caller);

        verify(guard).requireCanResendLogin(caller, "inst-a", "member");
        verify(service).resendInvitation("member", "inst-a", caller);
    }

    @Test
    void olderDashboardsFallBackToTheClientIdHeader() {
        controller.resendInvitation("member", null, "inst-b", caller);

        verify(guard).requireCanResendLogin(caller, "inst-b", "member");
        verify(service).resendInvitation("member", "inst-b", caller);
    }
}
