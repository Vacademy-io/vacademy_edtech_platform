package vacademy.io.common.auth.util;

import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SuperAdminAuthUtilTest {

    private static final String ALICE_ID = "8f14e45f-ceea-467e-a2b8-1c5d6e7f8a90";
    private static final String BOB_ID = "c9f0f895-fb98-4b91-a0c3-2d4e5f6a7b8c";

    // Built the way every non-auth service builds the principal (auth_service payload).
    private static CustomUserDetails user(String userId, String username, boolean root) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(username);
        dto.setRootUser(root);
        return new CustomUserDetails(dto);
    }

    @Test
    void allowlistedUserIdPasses_entriesTrimmed() {
        assertDoesNotThrow(() -> SuperAdminAuthUtil.requireSuperAdmin(user(ALICE_ID, "alice", false),
                " " + ALICE_ID + " , " + BOB_ID));
        assertDoesNotThrow(() -> SuperAdminAuthUtil.requireSuperAdmin(user(BOB_ID, "bob", false),
                ALICE_ID + "," + BOB_ID));
    }

    // Usernames are renameable, so they must never be what the allowlist matches.
    @Test
    void usernameEqualToAllowlistedIdIsDenied() {
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(
                user("someone-else-id", ALICE_ID, false), ALICE_ID));
        // Nor does an allowlisted username help a user whose id is not listed.
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(
                user("someone-else-id", "alice_admin", false), "alice_admin"));
    }

    @Test
    void caseVariantsWhitespaceAndPartialIdsAreDenied() {
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(
                user(ALICE_ID.toUpperCase(), "alice", false), ALICE_ID));
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(
                user(ALICE_ID, "alice", false), ALICE_ID.toUpperCase()));
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(
                user(ALICE_ID + " ", "alice", false), ALICE_ID));
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(
                user(ALICE_ID.substring(0, 8), "alice", false), ALICE_ID));
    }

    @Test
    void rootUserNotOnAllowlistIsDenied() {
        assertThrows(VacademyException.class,
                () -> SuperAdminAuthUtil.requireSuperAdmin(user(BOB_ID, "institute_admin", true), ALICE_ID));
    }

    @Test
    void unsetOrBlankAllowlistDeniesEveryone() {
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(user(ALICE_ID, "alice", true), null));
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(user(ALICE_ID, "alice", true), ""));
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(user(ALICE_ID, "alice", true), " , ,"));
    }

    @Test
    void nullUserOrUserIdIsDenied() {
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(null, ALICE_ID));
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(user(null, ALICE_ID, true), ALICE_ID));
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(user("", "alice", true), ALICE_ID));
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(user("  ", "alice", true), ALICE_ID));
        // A no-arg principal (no auth_service payload) carries no id.
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(new CustomUserDetails(), ALICE_ID));
    }

    // The principal comes from a username lookup; the signed "user" claim must agree with it,
    // so a token whose subject was later taken by a staff account cannot pass as that account.
    @Test
    void tokenUserClaimMustMatchResolvedId() {
        assertDoesNotThrow(() -> SuperAdminAuthUtil.requireSuperAdmin(user(ALICE_ID, "alice", false), ALICE_ID, ALICE_ID));
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(
                user(ALICE_ID, "alice", false), ALICE_ID, BOB_ID));
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(
                user(ALICE_ID, "alice", false), ALICE_ID, ALICE_ID.toUpperCase()));
        // No claim recorded (outside a request, or a token without it): the allowlist alone decides.
        assertDoesNotThrow(() -> SuperAdminAuthUtil.requireSuperAdmin(user(ALICE_ID, "alice", false), ALICE_ID, null));
        // A matching claim never rescues an id that is not on the list.
        assertThrows(VacademyException.class, () -> SuperAdminAuthUtil.requireSuperAdmin(
                user(BOB_ID, "bob", true), ALICE_ID, BOB_ID));
    }

    @Test
    void isSuperAdminUserIdIsExactAndFalseWhenUnset() {
        assertTrue(SuperAdminAuthUtil.isSuperAdminUserId(ALICE_ID, " " + ALICE_ID + " ," + BOB_ID));
        assertFalse(SuperAdminAuthUtil.isSuperAdminUserId(ALICE_ID.toUpperCase(), ALICE_ID));
        assertFalse(SuperAdminAuthUtil.isSuperAdminUserId(BOB_ID, ALICE_ID));
        assertFalse(SuperAdminAuthUtil.isSuperAdminUserId(null, ALICE_ID));
        assertFalse(SuperAdminAuthUtil.isSuperAdminUserId("", ALICE_ID));
        assertFalse(SuperAdminAuthUtil.isSuperAdminUserId(ALICE_ID, null));
        assertFalse(SuperAdminAuthUtil.isSuperAdminUserId(ALICE_ID, " , "));
    }
}
