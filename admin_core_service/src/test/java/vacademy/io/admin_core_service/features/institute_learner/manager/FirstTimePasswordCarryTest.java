package vacademy.io.admin_core_service.features.institute_learner.manager;

import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.dto.UserDTO;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Enrolment resolves a learner, then runs create-or-get again with the resolved user. auth-service
 * answers the second call without a password (the account now exists); a new learner's first-time
 * password from the first answer is carried on, and nothing else is.
 */
class FirstTimePasswordCarryTest {

    private static UserDTO answer(String id) {
        return UserDTO.builder().id(id).email("asha@example.com").build();
    }

    private static UserDTO request(String id, String password) {
        return UserDTO.builder().id(id).email("asha@example.com").password(password).build();
    }

    @Test
    void newLearnersPasswordFromTheFirstAnswerIsKept() {
        UserDTO result = StudentRegistrationManager.carryFirstTimePassword(answer("acc-1"), request("acc-1", "first-time"));

        assertEquals("first-time", result.getPassword());
    }

    @Test
    void existingAccountAnswerStaysWithoutPasswordWhenTheRequestHadNone() {
        assertNull(StudentRegistrationManager.carryFirstTimePassword(answer("acc-1"), request("acc-1", null)).getPassword());
    }

    @Test
    void aPasswordForAnotherAccountIsNotUsed() {
        assertNull(StudentRegistrationManager.carryFirstTimePassword(answer("acc-1"), request("acc-2", "x")).getPassword());
        assertNull(StudentRegistrationManager.carryFirstTimePassword(answer("acc-1"), request(null, "typed")).getPassword());
    }

    @Test
    void anAnswerWithItsOwnPasswordIsUnchanged() {
        UserDTO withPassword = answer("acc-1");
        withPassword.setPassword("from-auth");

        assertEquals("from-auth",
                StudentRegistrationManager.carryFirstTimePassword(withPassword, request("acc-1", "other")).getPassword());
    }
}
