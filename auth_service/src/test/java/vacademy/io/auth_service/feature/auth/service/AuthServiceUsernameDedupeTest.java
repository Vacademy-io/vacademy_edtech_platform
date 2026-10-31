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
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AuthServiceUsernameDedupeTest {

    private static final String INSTITUTE_ID = "inst-1";

    @Mock
    private UserRepository userRepository;
    @Mock
    private RoleRepository roleRepository;
    @Mock
    private UserRoleRepository userRoleRepository;
    @Mock
    private InstituteSettingsService instituteSettingsService;
    @Mock
    private InstitutePolicyService institutePolicyService;

    @InjectMocks
    private AuthService authService;

    private User existing;

    @BeforeEach
    void setUp() {
        existing = User.builder()
                .id("existing-id")
                .username("john")
                .email("john@gmail.com")
                .mobileNumber("9876543210")
                .fullName("John Gmail")
                .isRootUser(true)
                .build();

        when(instituteSettingsService.getUserIdentifier(anyString())).thenReturn("EMAIL");
        when(roleRepository.findByNameIn(anyList())).thenReturn(List.of());
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(userRepository.findByUsername(anyString())).thenReturn(Optional.empty());
        when(userRepository.findByUsername("john")).thenReturn(Optional.of(existing));
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private UserDTO request(String email, String username, String mobile) {
        UserDTO dto = new UserDTO();
        dto.setEmail(email);
        dto.setUsername(username);
        dto.setMobileNumber(mobile);
        dto.setFullName("John Yahoo");
        dto.setRoles(List.of("STUDENT"));
        return dto;
    }

    @Test
    void selfSignupWithDifferentEmailAndTakenUsernameCreatesNewUserWithSuffix() {
        User user = authService.createUserForLearnerSelfSignup(
                request("john@yahoo.com", "john", null), INSTITUTE_ID, false);

        assertNotSame(existing, user);
        assertEquals("john@yahoo.com", user.getEmail());
        assertTrue(user.getUsername().startsWith("john_"), user.getUsername());
    }

    @Test
    void selfSignupEmailCaseDifferenceStillMatches() {
        existing.setEmail("John@Yahoo.com");

        User user = authService.createUserForLearnerSelfSignup(
                request("john@yahoo.com", "john", null), INSTITUTE_ID, false);

        assertSame(existing, user);
    }

    @Test
    void selfSignupExistingAccountWithoutEmailStillMatches() {
        existing.setEmail(null);

        User user = authService.createUserForLearnerSelfSignup(
                request("john@yahoo.com", "john", "+91 98765 43210"), INSTITUTE_ID, false);

        assertSame(existing, user);
    }

    @Test
    void selfSignupDifferentMobileIsNotTheSamePerson() {
        User user = authService.createUserForLearnerSelfSignup(
                request(null, "john", "9000000000"), INSTITUTE_ID, false);

        assertNotSame(existing, user);
        assertTrue(user.getUsername().startsWith("john_"), user.getUsername());
    }

    @Test
    void selfSignupFreeUsernameIsKeptAsIs() {
        User user = authService.createUserForLearnerSelfSignup(
                request("asha@yahoo.com", "asha", null), INSTITUTE_ID, false);

        assertEquals("asha", user.getUsername());
    }

    @Test
    void adminEnrollmentKeepsUsernameMatchAsBefore() {
        // Re-enroll / CSV-by-username pass a known learner's username on purpose.
        User user = authService.createUserForLearnerEnrollment(
                request("john.new@yahoo.com", "john", "9000000000"), INSTITUTE_ID, false, null);

        assertSame(existing, user);
    }

    @Test
    void createUserKeepsUsernameMatchAsBefore() {
        User user = authService.createUser(request("john@yahoo.com", "john", null), INSTITUTE_ID, false);

        assertSame(existing, user);
    }

    @Test
    void generatedUsernameThatCollidesGetsSuffix() {
        UserDTO dto = request("new@yahoo.com", null, null);
        dto.setFullName("John");
        when(userRepository.findByUsername(org.mockito.ArgumentMatchers.startsWith("john")))
                .thenAnswer(inv -> ((String) inv.getArgument(0)).contains("_")
                        ? Optional.empty() : Optional.of(existing));

        User user = authService.createUser(dto, INSTITUTE_ID, false);

        assertNotSame(existing, user);
        assertTrue(user.getUsername().contains("_"), user.getUsername());
    }

    // ---- institute username strategy ----

    private void strategy(String name, boolean applyToAll, String fieldId, String prefix) {
        when(institutePolicyService.fetchSignupPolicyCached(INSTITUTE_ID)).thenReturn(InstituteSignupPolicy.builder()
                .userNameStrategy(name).usernameApplyToAll(applyToAll)
                .usernameCustomFieldId(fieldId).usernamePrefix(prefix).build());
    }

    @Test
    void noPolicyKeepsOldUsername() {
        User user = authService.createUserForLearnerEnrollment(
                request("asha@yahoo.com", "asha", null), INSTITUTE_ID, false, null);

        assertEquals("asha", user.getUsername());
    }

    @Test
    void legacyEmailStrategyDoesNotTouchAdminPathsWhenApplyToAllOff() {
        strategy("email", false, null, null);

        User user = authService.createUserForLearnerEnrollment(
                request("asha@yahoo.com", "asha", null), INSTITUTE_ID, false, null);

        assertEquals("asha", user.getUsername());
    }

    @Test
    void customFieldStrategyUsesRollNumberWithPrefixOnAdminPath() {
        strategy("customField", true, "roll-field", "TTS-");
        UserDTO dto = request("asha@yahoo.com", "asha1234", null);
        dto.setUsernameFieldValues(Map.of("roll-field", " 21 CS/045 "));

        User user = authService.createUserForLearnerEnrollment(dto, INSTITUTE_ID, false, null);

        assertEquals("tts-21cs-045", user.getUsername());
    }

    @Test
    void customFieldStrategyFallsBackWhenFieldMissing() {
        strategy("customField", true, "roll-field", null);

        User user = authService.createUserForLearnerEnrollment(
                request("asha@yahoo.com", "asha1234", null), INSTITUTE_ID, false, null);

        assertEquals("asha1234", user.getUsername());
    }

    @Test
    void adminTypedUsernameWinsOverStrategy() {
        strategy("phone", true, null, null);
        UserDTO dto = request("asha@yahoo.com", "asha.typed", "9876500000");
        dto.setUsernameExplicit(true);

        User user = authService.createUserForLearnerEnrollment(dto, INSTITUTE_ID, false, null);

        assertEquals("asha.typed", user.getUsername());
    }

    private void strategyOverridingTyped(String name) {
        when(institutePolicyService.fetchSignupPolicyCached(INSTITUTE_ID)).thenReturn(InstituteSignupPolicy.builder()
                .userNameStrategy(name).usernameApplyToAll(true).usernameOverrideTyped(true).build());
    }

    @Test
    void emailStrategyReplacesTypedUsernameWhenOverrideTypedOn() {
        strategyOverridingTyped("email");
        UserDTO dto = request("Asha@Yahoo.com", "asha.typed", null);
        dto.setUsernameExplicit(true);

        User user = authService.createUserForLearnerEnrollment(dto, INSTITUTE_ID, false, null);

        assertEquals("asha@yahoo.com", user.getUsername());
    }

    @Test
    void emailStrategyKeepsTypedUsernameWhenOverrideTypedOff() {
        strategy("email", true, null, null);
        UserDTO dto = request("asha@yahoo.com", "asha.typed", null);
        dto.setUsernameExplicit(true);

        User user = authService.createUserForLearnerEnrollment(dto, INSTITUTE_ID, false, null);

        assertEquals("asha.typed", user.getUsername());
    }

    @Test
    void overrideTypedKeepsTypedUsernameWhenStrategyHasNoValue() {
        strategyOverridingTyped("email");
        UserDTO dto = request(null, "asha.typed", "9876500000");
        dto.setUsernameExplicit(true);

        User user = authService.createUserForLearnerEnrollment(dto, INSTITUTE_ID, false, null);

        assertEquals("asha.typed", user.getUsername());
    }

    @Test
    void overrideTypedNeverReplacesTypedUsernameWithRandom() {
        strategyOverridingTyped("random");
        UserDTO dto = request("asha@yahoo.com", "asha.typed", null);
        dto.setUsernameExplicit(true);

        User user = authService.createUserForLearnerEnrollment(dto, INSTITUTE_ID, false, null);

        assertEquals("asha.typed", user.getUsername());
    }

    @Test
    void phoneStrategyAppliesToSelfSignupEvenWhenApplyToAllOff() {
        strategy("phone", false, null, null);

        User user = authService.createUserForLearnerSelfSignup(
                request("asha@yahoo.com", "asha", "+91 98765 00000"), INSTITUTE_ID, false);

        assertEquals("919876500000", user.getUsername());
    }

    @Test
    void phoneStrategyDoesNotTouchAdminPathsWhenApplyToAllOff() {
        strategy("phone", false, null, null);

        User user = authService.createUserForLearnerEnrollment(
                request("asha@yahoo.com", "asha", "9876500000"), INSTITUTE_ID, false, null);

        assertEquals("asha", user.getUsername());
    }

    @Test
    void strategyValueTakenByAnotherUserGetsSuffix() {
        strategy("email", true, null, null);
        when(userRepository.findByUsername("asha@yahoo.com")).thenReturn(Optional.of(existing));

        User user = authService.createUser(request("asha@yahoo.com", null, null), INSTITUTE_ID, false);

        assertTrue(user.getUsername().startsWith("asha@yahoo.com_"), user.getUsername());
    }

    @Test
    void strategyNeverAppliesToExistingUsers() {
        strategy("phone", true, null, null);

        User user = authService.createUserForLearnerEnrollment(
                request(null, "john", "9876543210"), INSTITUTE_ID, false, null);

        assertSame(existing, user);
        assertEquals("john", user.getUsername());
    }

    @Test
    void strategyLeavesStaffUsernamesAlone() {
        strategy("phone", true, null, null);
        UserDTO dto = request("teacher@yahoo.com", "teac1234", "9876500000");
        dto.setRoles(List.of("TEACHER"));

        User user = authService.createUser(dto, INSTITUTE_ID, false);

        assertEquals("teac1234", user.getUsername());
    }

    @Test
    void strategyAppliesWhenLearnerFlowSendsNoRoles() {
        strategy("phone", true, null, null);
        UserDTO dto = request("asha@yahoo.com", "asha@yahoo.com", "9876500000");
        dto.setRoles(null);

        User user = authService.createUser(dto, INSTITUTE_ID, false);

        assertEquals("9876500000", user.getUsername());
    }
}
