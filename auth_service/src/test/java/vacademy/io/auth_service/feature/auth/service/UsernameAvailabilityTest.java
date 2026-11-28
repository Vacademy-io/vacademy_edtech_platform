package vacademy.io.auth_service.feature.auth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.auth_service.feature.admin_core_service.dto.InstituteSignupPolicy;
import vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService;
import vacademy.io.auth_service.feature.institute.service.InstituteSettingsService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/** The add-learner username check: same lookup order as the add itself. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class UsernameAvailabilityTest {

    private static final String INSTITUTE_ID = "inst-1";

    @Mock
    private UserRepository userRepository;
    @Mock
    private UserRoleRepository userRoleRepository;
    @Mock
    private InstituteSettingsService instituteSettingsService;
    @Mock
    private InstitutePolicyService institutePolicyService;

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
        when(instituteSettingsService.getUserIdentifier(anyString())).thenReturn("EMAIL");
        when(userRepository.findByUsername(anyString())).thenReturn(Optional.empty());
        when(userRepository.findByUsername("john")).thenReturn(Optional.of(holder));
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(userRepository.findLatestUserByMobileNumberAndInstitute(anyString(), anyString())).thenReturn(Optional.empty());
        when(userRepository.findLatestUserByMobileNumber(anyString())).thenReturn(Optional.empty());
        when(userRoleRepository.findByUser(holder)).thenReturn(List.of());
    }

    private AuthService.UsernameCheck check(String username, String email, String phone) {
        return authService.checkUsernameForNewLearner(username, email, phone, INSTITUTE_ID);
    }

    private static UserRole roleIn(String instituteId, String status) {
        UserRole role = new UserRole();
        role.setInstituteId(instituteId);
        role.setStatus(status);
        return role;
    }

    @Test
    void freeUsernameIsAvailable() {
        AuthService.UsernameCheck c = check("asha", "asha@yahoo.com", null);

        assertTrue(c.available());
        assertFalse(c.existingLearner());
    }

    @Test
    void blankUsernameIsAvailable() {
        // Left blank, the server generates one.
        assertTrue(check("  ", "asha@yahoo.com", null).available());
    }

    @Test
    void takenByAnotherInstitutesLearnerIsNotAvailable() {
        when(userRoleRepository.findByUser(holder)).thenReturn(List.of(roleIn("other-institute", "ACTIVE")));

        assertFalse(check("john", "john.new@yahoo.com", null).available());
    }

    @Test
    void takenByAnotherEmailIsNotAvailableEvenWhenPhoneMatches() {
        assertFalse(check("john", "john.new@yahoo.com", "+91 98765 43210").available());
    }

    @Test
    void sameEmailIsTheSameLearner() {
        assertTrue(check("john", " John@Gmail.com ", null).available());
    }

    @Test
    void samePhoneWithoutEmailIsTheSameLearner() {
        assertTrue(check("john", null, "919876543210").available());
    }

    @Test
    void differentPhoneWithoutEmailIsNotAvailable() {
        assertFalse(check("john", null, "9000000000").available());
    }

    @Test
    void accountWithNothingToCompareIsNotAvailable() {
        // An account without email or phone is still someone else's: no proof it is this learner.
        holder.setEmail(null);
        holder.setMobileNumber(null);

        assertFalse(check("john", "asha@yahoo.com", "9000000000").available());
    }

    @Test
    void ownInstitutesLearnerIsAvailableAndFlagged() {
        when(userRoleRepository.findByUser(holder)).thenReturn(List.of(roleIn(INSTITUTE_ID, "ACTIVE")));

        AuthService.UsernameCheck c = check("john", "someone.else@yahoo.com", null);

        assertTrue(c.available());
        assertTrue(c.existingLearner());
    }

    @Test
    void deletedRoleHereDoesNotMakeItOwn() {
        when(userRoleRepository.findByUser(holder)).thenReturn(List.of(roleIn(INSTITUTE_ID, "DELETED")));

        assertFalse(check("john", "someone.else@yahoo.com", null).available());
    }

    @Test
    void emailThatAlreadyHasAnAccountDecidesAndTheNameIsNotUsed() {
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@yahoo.com"))
                .thenReturn(Optional.of(User.builder().id("asha-id").build()));

        assertTrue(check("john", "Asha@Yahoo.com", null).available());
    }

    @Test
    void phoneLoginKnownPhoneDecides() {
        when(instituteSettingsService.getUserIdentifier(anyString())).thenReturn("PHONE");
        when(userRepository.findLatestUserByMobileNumber("9000000000"))
                .thenReturn(Optional.of(User.builder().id("p-id").build()));

        assertTrue(check("john", null, "9000000000").available());
    }

    @Test
    void phoneLoginNewPhoneNeedsAFreeName() {
        when(instituteSettingsService.getUserIdentifier(anyString())).thenReturn("PHONE");

        assertFalse(check("john", null, "9000000000").available());
        assertTrue(check("asha", null, "9000000000").available());
    }

    @Test
    void typedNameReplacedByTheInstitutesRuleIsAvailable() {
        when(institutePolicyService.fetchSignupPolicyCached(INSTITUTE_ID)).thenReturn(InstituteSignupPolicy.builder()
                .userNameStrategy("phone").usernameApplyToAll(true).usernameOverrideTyped(true).build());

        assertTrue(check("john", "john.new@yahoo.com", "9000000000").available());
    }

    @Test
    void batchAnswersComeBackInRowOrder() {
        UserDTO free = new UserDTO();
        free.setUsername("asha");
        free.setEmail("asha@yahoo.com");
        UserDTO taken = new UserDTO();
        taken.setUsername("john");
        taken.setEmail("john.new@yahoo.com");

        List<AuthService.UsernameCheck> answers =
                authService.checkUsernamesForNewLearners(List.of(free, taken), INSTITUTE_ID);

        assertEquals(2, answers.size());
        assertTrue(answers.get(0).available());
        assertFalse(answers.get(1).available());
    }
}
