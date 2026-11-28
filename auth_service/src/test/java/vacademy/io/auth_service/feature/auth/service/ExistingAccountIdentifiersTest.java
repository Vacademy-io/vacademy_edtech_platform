package vacademy.io.auth_service.feature.auth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService;
import vacademy.io.auth_service.feature.institute.service.InstituteSettingsService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;

import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Create-or-get of a learner or user account. When the account already exists, only its
 * empty profile fields are filled from the request; its sign-in identifiers (e-mail, mobile
 * number) and guardian link stay as they are, whichever caller reached it (public form,
 * enrolment, self-signup, or staff add / CSV import, which all share these methods). Those are
 * set only by flows that verify them or by staff editing the learner. New accounts take the
 * typed e-mail and mobile number as before.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ExistingAccountIdentifiersTest {

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

    @BeforeEach
    void setUp() {
        when(instituteSettingsService.getUserIdentifier(anyString())).thenReturn("EMAIL");
        when(roleRepository.findByNameIn(anyList())).thenReturn(List.of());
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(userRepository.findByUsername(anyString())).thenReturn(Optional.empty());
        when(userRepository.findLatestUserByMobileNumberAndInstitute(anyString(), anyString()))
                .thenReturn(Optional.empty());
        when(userRepository.findLatestUserByMobileNumber(anyString())).thenReturn(Optional.empty());
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private static User accountWithEmailOnly() {
        return User.builder()
                .id("acc-1")
                .username("asha")
                .email("asha@example.com")
                .isRootUser(true)
                .build();
    }

    private static User accountWithMobileOnly() {
        return User.builder()
                .id("acc-2")
                .username("ravi")
                .email("")
                .mobileNumber("9876543210")
                .isRootUser(true)
                .build();
    }

    private static UserDTO request(String email, String mobile) {
        UserDTO dto = new UserDTO();
        dto.setEmail(email);
        dto.setMobileNumber(mobile);
        dto.setFullName("Typed Name");
        dto.setRoles(List.of("STUDENT"));
        return dto;
    }

    // ---- EMAIL-identifier institutes: existing account found by e-mail ----

    @Test
    void learnerEnrollmentKeepsEmptyMobileOfExistingAccount() {
        User existing = accountWithEmailOnly();
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@example.com"))
                .thenReturn(Optional.of(existing));

        User user = authService.createUserForLearnerEnrollment(
                request("asha@example.com", "9000000001"), INSTITUTE_ID, false);

        assertSame(existing, user);
        assertNull(user.getMobileNumber());
        assertEquals("asha@example.com", user.getEmail());
    }

    @Test
    void createUserKeepsEmptyMobileOfExistingAccount() {
        // createUser is shared by public forms and staff add / CSV import alike.
        User existing = accountWithEmailOnly();
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@example.com"))
                .thenReturn(Optional.of(existing));

        User user = authService.createUser(request("asha@example.com", "9000000001"), INSTITUTE_ID, false);

        assertSame(existing, user);
        assertNull(user.getMobileNumber());
    }

    @Test
    void selfSignupKeepsEmptyMobileOfExistingAccount() {
        User existing = accountWithEmailOnly();
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@example.com"))
                .thenReturn(Optional.of(existing));

        User user = authService.createUserForLearnerSelfSignup(
                request("asha@example.com", "9000000001"), INSTITUTE_ID, false);

        assertSame(existing, user);
        assertNull(user.getMobileNumber());
    }

    @Test
    void accountMatchedByUsernameKeepsItsEmailAndEmptyMobile() {
        User existing = accountWithEmailOnly();
        when(userRepository.findByUsername("asha")).thenReturn(Optional.of(existing));
        // No e-mail in the request: a different e-mail would make it another person
        // (AuthServiceUsernameDedupeTest), and the username would not match at all.
        UserDTO dto = request(null, "9000000001");
        dto.setUsername("asha");

        User user = authService.createUserForLearnerEnrollment(dto, INSTITUTE_ID, false);

        assertSame(existing, user);
        assertEquals("asha@example.com", user.getEmail());
        assertNull(user.getMobileNumber());
    }

    @Test
    void existingMobileIsNeverReplaced() {
        User existing = accountWithEmailOnly();
        existing.setMobileNumber("9111111111");
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@example.com"))
                .thenReturn(Optional.of(existing));

        User user = authService.createUser(request("asha@example.com", "9000000001"), INSTITUTE_ID, false);

        assertEquals("9111111111", user.getMobileNumber());
    }

    // ---- PHONE-identifier institutes: existing account found by phone ----

    @Test
    void phoneInstituteLearnerEnrollmentKeepsEmptyEmailOfExistingAccount() {
        when(instituteSettingsService.getUserIdentifier(INSTITUTE_ID)).thenReturn("PHONE");
        User existing = accountWithMobileOnly();
        when(userRepository.findLatestUserByMobileNumberAndInstitute("9876543210", INSTITUTE_ID))
                .thenReturn(Optional.of(existing));

        User user = authService.createUserForLearnerEnrollment(
                request("ravi@example.com", "9876543210"), INSTITUTE_ID, false);

        assertSame(existing, user);
        assertEquals("", user.getEmail());
    }

    @Test
    void phoneInstituteCreateUserKeepsEmptyEmailOfExistingAccount() {
        when(instituteSettingsService.getUserIdentifier(INSTITUTE_ID)).thenReturn("PHONE");
        User existing = accountWithMobileOnly();
        when(userRepository.findLatestUserByMobileNumberAndInstitute("9876543210", INSTITUTE_ID))
                .thenReturn(Optional.of(existing));

        User user = authService.createUser(request("ravi@example.com", "9876543210"), INSTITUTE_ID, false);

        assertSame(existing, user);
        assertEquals("", user.getEmail());
    }

    // ---- guardian link and other profile fields ----

    @Test
    void guardianLinkOfExistingAccountIsNotSetFromRequest() {
        User existing = accountWithEmailOnly();
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@example.com"))
                .thenReturn(Optional.of(existing));
        UserDTO dto = request("asha@example.com", null);
        dto.setLinkedParentId("parent-9");

        User viaCreateUser = authService.createUser(dto, INSTITUTE_ID, false);
        assertNull(viaCreateUser.getLinkedParentId());

        User viaLearner = authService.createUserForLearnerEnrollment(dto, INSTITUTE_ID, false);
        assertNull(viaLearner.getLinkedParentId());
    }

    @Test
    void emptyProfileFieldsOfExistingAccountAreStillFilled() {
        User existing = accountWithEmailOnly();
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@example.com"))
                .thenReturn(Optional.of(existing));
        Date dob = new Date(0);
        UserDTO dto = request("asha@example.com", "9000000001");
        dto.setAddressLine("12 Park Road");
        dto.setCity("Pune");
        dto.setPinCode("411001");
        dto.setDateOfBirth(dob);
        dto.setGender("FEMALE");

        User user = authService.createUserForLearnerEnrollment(dto, INSTITUTE_ID, false);

        assertEquals("Typed Name", user.getFullName());
        assertEquals("12 Park Road", user.getAddressLine());
        assertEquals("Pune", user.getCity());
        assertEquals("411001", user.getPinCode());
        assertEquals(dob, user.getDateOfBirth());
        assertEquals("FEMALE", user.getGender());
        assertNull(user.getMobileNumber());
    }

    @Test
    void filledProfileFieldsOfExistingAccountAreKept() {
        User existing = accountWithEmailOnly();
        existing.setFullName("Asha Rao");
        existing.setCity("Delhi");
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@example.com"))
                .thenReturn(Optional.of(existing));
        UserDTO dto = request("asha@example.com", null);
        dto.setCity("Pune");

        User user = authService.createUser(dto, INSTITUTE_ID, false);

        assertEquals("Asha Rao", user.getFullName());
        assertEquals("Delhi", user.getCity());
    }

    // ---- new accounts ----

    @Test
    void newAccountTakesTypedEmailAndMobile() {
        User viaLearner = authService.createUserForLearnerEnrollment(
                request("new@example.com", "+91 90000 00002"), INSTITUTE_ID, false);
        assertEquals("new@example.com", viaLearner.getEmail());
        assertEquals("919000000002", viaLearner.getMobileNumber());

        User viaCreateUser = authService.createUser(
                request("new2@example.com", "9000000003"), INSTITUTE_ID, false);
        assertEquals("new2@example.com", viaCreateUser.getEmail());
        assertEquals("9000000003", viaCreateUser.getMobileNumber());
    }

    @Test
    void newAccountKeepsTypedGuardianLink() {
        UserDTO dto = request("child@example.com", null);
        dto.setLinkedParentId("parent-9");

        User user = authService.createUser(dto, INSTITUTE_ID, false);

        assertEquals("parent-9", user.getLinkedParentId());
    }

    @Test
    void selfSignupNewAccountTakesTypedEmailAndMobile() {
        User user = authService.createUserForLearnerSelfSignup(
                request("fresh@example.com", "9000000004"), INSTITUTE_ID, false);

        assertEquals("fresh@example.com", user.getEmail());
        assertEquals("9000000004", user.getMobileNumber());
    }

    @Test
    void phoneInstituteNewAccountTakesTypedEmail() {
        when(instituteSettingsService.getUserIdentifier(INSTITUTE_ID)).thenReturn("PHONE");

        User user = authService.createUserForLearnerEnrollment(
                request("ravi@example.com", "9876543210"), INSTITUTE_ID, false);

        assertEquals("ravi@example.com", user.getEmail());
        assertEquals("9876543210", user.getMobileNumber());
    }
}
