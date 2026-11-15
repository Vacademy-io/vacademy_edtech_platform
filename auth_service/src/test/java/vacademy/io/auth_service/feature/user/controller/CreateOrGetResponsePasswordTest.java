package vacademy.io.auth_service.feature.user.controller;

import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.auth.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.entity.User;

import java.util.HashSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * The create-or-get answer (/internal/create-user-or-get-existing and
 * /internal/create-or-get-existing-learner) includes the password only for an account created
 * in that call.
 */
class CreateOrGetResponsePasswordTest {

    private static User account() {
        User user = User.builder()
                .id("acc-1")
                .username("asha")
                .email("asha@example.com")
                .password("stored-secret")
                .isRootUser(true)
                .build();
        user.setRoles(new HashSet<>());
        return user;
    }

    @Test
    void existingAccountAnswerHasNoPassword() {
        UserDTO answer = UserController.toResponse(new AuthService.AccountResult(account(), false), new UserDTO());

        assertNull(answer.getPassword());
        assertEquals("acc-1", answer.getId());
        assertEquals("asha@example.com", answer.getEmail());
    }

    @Test
    void newAccountAnswerKeepsItsFirstTimePassword() {
        UserDTO answer = UserController.toResponse(new AuthService.AccountResult(account(), true), new UserDTO());

        assertEquals("stored-secret", answer.getPassword());
    }
}
