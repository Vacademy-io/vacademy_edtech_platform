package vacademy.io.auth_service.feature.auth.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

/**
 * The create-user paths never grant a commerce role: those names are dropped before the role
 * rows are built. Shop staff are added from the team screen only.
 */
class AuthServiceCommerceRoleSignupTest {

    @Test
    void commerceRolesAreDroppedFromACreateUserRequest() {
        assertEquals(List.of("STUDENT"),
                AuthService.withoutCommerceRoles(List.of("STUDENT", "COMMERCE_STORE_MANAGER")));
        assertEquals(List.of(), AuthService.withoutCommerceRoles(
                List.of("COMMERCE_STORE_MANAGER", "commerce_pos_cashier", " COMMERCE_ACCOUNTANT ",
                        "COMMERCE_WAREHOUSE_STAFF")));
    }

    @Test
    void otherRequestsAreUntouched() {
        List<String> learner = List.of("STUDENT", "TEACHER");
        assertSame(learner, AuthService.withoutCommerceRoles(learner));
        assertNull(AuthService.withoutCommerceRoles(null));
    }
}
