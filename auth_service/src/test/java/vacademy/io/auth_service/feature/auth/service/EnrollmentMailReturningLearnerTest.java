package vacademy.io.auth_service.feature.auth.service;

import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.entity.User;

import java.util.Date;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Which enrollment mail a learner gets: "your existing account" only when the account was there
 * before AND they have signed in with it. A paid invite creates the account at form submit and
 * enrolls after payment, so that learner is new to the account even though it already exists.
 */
class EnrollmentMailReturningLearnerTest {

    private static User account(Date lastLogin) {
        User u = User.builder().id("u-1").username("asha").email("asha@example.com").password("x").build();
        u.setLastLoginTime(lastLogin);
        return u;
    }

    @Test
    void aNewAccountGetsTheNewLearnerMail() {
        assertFalse(AuthService.usesAccountAlready(false, account(null)));
    }

    @Test
    void anAccountNeverSignedInGetsTheNewLearnerMail() {
        assertFalse(AuthService.usesAccountAlready(true, account(null)));
    }

    @Test
    void anAccountTheLearnerHasSignedInWithGetsTheReturningMail() {
        assertTrue(AuthService.usesAccountAlready(true, account(new Date())));
    }

    @Test
    void aSignInTimeOnANewAccountDoesNotMakeItReturning() {
        assertFalse(AuthService.usesAccountAlready(false, account(new Date())));
    }
}
