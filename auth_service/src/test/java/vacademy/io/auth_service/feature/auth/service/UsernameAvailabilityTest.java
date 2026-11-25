package vacademy.io.auth_service.feature.auth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/** The add-learner form's "is this username free?" check. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class UsernameAvailabilityTest {

    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private AuthService authService;

    private User holder;

    @BeforeEach
    void setUp() {
        holder = User.builder()
                .id("holder-id")
                .username("john")
                .email("john@gmail.com")
                .mobileNumber("9876543210")
                .build();
        when(userRepository.findByUsername(anyString())).thenReturn(Optional.empty());
        when(userRepository.findByUsername("john")).thenReturn(Optional.of(holder));
    }

    @Test
    void freeUsernameIsAvailable() {
        assertTrue(authService.isUsernameAvailableForNewLearner("asha", "asha@yahoo.com", null));
    }

    @Test
    void blankUsernameIsAvailable() {
        // Left blank, the server generates one.
        assertTrue(authService.isUsernameAvailableForNewLearner("  ", "asha@yahoo.com", null));
    }

    @Test
    void takenByAnotherEmailIsNotAvailable() {
        assertFalse(authService.isUsernameAvailableForNewLearner("john", "john.new@yahoo.com", null));
    }

    @Test
    void takenByAnotherEmailIsNotAvailableEvenWhenPhoneMatches() {
        assertFalse(authService.isUsernameAvailableForNewLearner("john", "john.new@yahoo.com", "+91 98765 43210"));
    }

    @Test
    void sameEmailIsTheSameLearner() {
        assertTrue(authService.isUsernameAvailableForNewLearner("john", " John@Gmail.com ", null));
    }

    @Test
    void samePhoneWithoutEmailIsTheSameLearner() {
        assertTrue(authService.isUsernameAvailableForNewLearner("john", null, "919876543210"));
    }

    @Test
    void differentPhoneWithoutEmailIsNotAvailable() {
        assertFalse(authService.isUsernameAvailableForNewLearner("john", null, "9000000000"));
    }

    @Test
    void takenWithNothingToCompareIsNotAvailable() {
        // An account without e-mail or phone is still someone else's: no proof it is this learner.
        holder.setEmail(null);
        holder.setMobileNumber(null);

        assertFalse(authService.isUsernameAvailableForNewLearner("john", "asha@yahoo.com", "9000000000"));
    }

    @Test
    void takenAndNothingTypedIsNotAvailable() {
        assertFalse(authService.isUsernameAvailableForNewLearner("john", null, null));
    }
}
