package vacademy.io.admin_core_service.features.institute_learner.manager;

import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.dto.UserDTO;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * The user an enrolment workflow (welcome message, LMS account set-up) receives is the account as
 * auth-service holds it, and carries a password only when the enrolment already held that
 * account's own login.
 */
class EnrollmentWorkflowUserTest {

    private static UserDTO stored(String id, String password) {
        return UserDTO.builder().id(id).username("asha01").email("asha@example.com")
                .mobileNumber("919812345678").fullName("Asha Verma").password(password).build();
    }

    @Test
    void anotherAccountsIdWithTypedContactsGetsTheAccountsOwnContactsAndNoPassword() {
        UserDTO request = UserDTO.builder().id("acc-1").username("typed").email("typed@example.com")
                .mobileNumber("919900011122").fullName("Typed Name").build();

        UserDTO result = StudentRegistrationManager.workflowUserFrom(request, stored("acc-1", "stored-login"));

        assertNull(result.getPassword());
        assertEquals("asha@example.com", result.getEmail());
        assertEquals("919812345678", result.getMobileNumber());
        assertEquals("asha01", result.getUsername());
        assertEquals("Asha Verma", result.getFullName());
        // The caller's own object is unchanged.
        assertEquals("typed@example.com", request.getEmail());
    }

    @Test
    void aTypedPasswordThatIsNotTheAccountsLoginIsDropped() {
        UserDTO request = UserDTO.builder().id("acc-1").email("typed@example.com").password("typed").build();

        assertNull(StudentRegistrationManager.workflowUserFrom(request, stored("acc-1", "stored-login")).getPassword());
    }

    @Test
    void aNewAccountsFirstTimePasswordIsKept() {
        UserDTO request = UserDTO.builder().id("acc-1").email("asha@example.com").password("first-time").build();

        UserDTO result = StudentRegistrationManager.workflowUserFrom(request, stored("acc-1", "first-time"));

        assertEquals("first-time", result.getPassword());
        assertEquals("asha@example.com", result.getEmail());
    }

    @Test
    void anAccountThatCouldNotBeReadGetsNoPassword() {
        UserDTO request = UserDTO.builder().id("acc-1").email("asha@example.com").password("first-time").build();

        UserDTO result = StudentRegistrationManager.workflowUserFrom(request, null);

        assertNull(result.getPassword());
        assertEquals("first-time", request.getPassword());
    }

    @Test
    void aStoredRecordOfAnotherIdIsNotUsed() {
        UserDTO request = UserDTO.builder().id("acc-1").email("typed@example.com").password("x").build();

        UserDTO result = StudentRegistrationManager.workflowUserFrom(request, stored("acc-2", "x"));

        assertNull(result.getPassword());
        assertEquals("typed@example.com", result.getEmail());
    }
}
