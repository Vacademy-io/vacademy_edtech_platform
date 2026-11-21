package vacademy.io.auth_service.feature.auth.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.auth_service.feature.auth.dto.VimotionSignupRequest;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;

import java.util.HashSet;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Vimotion sign-up: an existing account found by the e-mail keeps its sign-in identifiers; only
 * an empty name is filled. A new account takes the phone number.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class VimotionExistingAccountIdentifiersTest {

    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private VimotionAuthManager manager;

    @BeforeEach
    void setUp() {
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private static VimotionSignupRequest signup(String email) {
        return VimotionSignupRequest.builder()
                .email(email)
                .phoneNumber("+91 90000 00001")
                .fullName("Typed Name")
                .password("chosen-pass")
                .build();
    }

    @Test
    void existingAccountKeepsItsEmptyMobileNumber() {
        User existing = User.builder().id("acc-1").username("asha").email("asha@example.com").isRootUser(true).build();
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@example.com")).thenReturn(Optional.of(existing));

        User user = manager.upsertVimotionUser(signup("asha@example.com"), new HashSet<>());

        assertNull(user.getMobileNumber());
        assertEquals("Typed Name", user.getFullName());
    }

    @Test
    void existingAccountKeepsItsOwnMobileNumber() {
        User existing = User.builder().id("acc-1").username("asha").email("asha@example.com")
                .mobileNumber("9876543210").fullName("Asha").isRootUser(true).build();
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@example.com")).thenReturn(Optional.of(existing));

        User user = manager.upsertVimotionUser(signup("asha@example.com"), new HashSet<>());

        assertEquals("9876543210", user.getMobileNumber());
        assertEquals("Asha", user.getFullName());
    }

    @Test
    void newAccountTakesThePhoneNumber() {
        User user = manager.upsertVimotionUser(signup("new@example.com"), new HashSet<>());

        assertEquals("919000000001", user.getMobileNumber());
        assertEquals("new@example.com", user.getEmail());
    }
}
