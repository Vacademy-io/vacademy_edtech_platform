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

import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Create-or-get tells whether the account was created in the call. Only a new account's
 * first-time password is part of the answer, and in a parent + child create the child's guardian
 * link is set only on a child account created in that call.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CreateOrGetAnswerTest {

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

    private final AtomicInteger ids = new AtomicInteger();

    @BeforeEach
    void setUp() {
        when(instituteSettingsService.getUserIdentifier(anyString())).thenReturn("EMAIL");
        when(roleRepository.findByNameIn(anyList())).thenReturn(List.of());
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(userRepository.findByUsername(anyString())).thenReturn(Optional.empty());
        when(userRepository.findLatestUserByMobileNumberAndInstitute(anyString(), anyString()))
                .thenReturn(Optional.empty());
        when(userRepository.findLatestUserByMobileNumber(anyString())).thenReturn(Optional.empty());
        when(userRepository.save(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            if (u.getId() == null) {
                u.setId("new-" + ids.incrementAndGet());
            }
            return u;
        });
    }

    private static User existing(String id, String email, String password, String linkedParentId) {
        return User.builder()
                .id(id)
                .username(id)
                .email(email)
                .password(password)
                .linkedParentId(linkedParentId)
                .isRootUser(true)
                .build();
    }

    private static UserDTO request(String email, String role) {
        UserDTO dto = new UserDTO();
        dto.setEmail(email);
        dto.setFullName("Typed Name");
        dto.setRoles(List.of(role));
        return dto;
    }

    @Test
    void createOrGetUserMarksAnExistingAccountAsNotCreated() {
        User account = existing("acc-1", "asha@example.com", "stored-secret", null);
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@example.com")).thenReturn(Optional.of(account));

        AuthService.AccountResult result = authService.createOrGetUser(
                request("asha@example.com", "STUDENT"), INSTITUTE_ID, false);

        assertSame(account, result.user());
        assertFalse(result.created());
    }

    @Test
    void createOrGetUserMarksANewAccountAsCreated() {
        AuthService.AccountResult result = authService.createOrGetUser(
                request("new@example.com", "STUDENT"), INSTITUTE_ID, false);

        assertTrue(result.created());
        assertNotNull(result.user().getPassword());
    }

    @Test
    void learnerCreateOrGetTellsNewFromExisting() {
        User account = existing("acc-1", "asha@example.com", "stored-secret", null);
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("asha@example.com")).thenReturn(Optional.of(account));

        assertFalse(authService.createOrGetLearnerForEnrollment(
                request("asha@example.com", "STUDENT"), INSTITUTE_ID, false, null).created());
        assertTrue(authService.createOrGetLearnerForEnrollment(
                request("fresh@example.com", "STUDENT"), INSTITUTE_ID, false, null).created());
    }

    @Test
    void parentAndChildCreateLeavesAnExistingChildsGuardianLinkAsItIs() {
        User child = existing("child-1", "kid@example.com", "child-secret", "guardian-1");
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("kid@example.com")).thenReturn(Optional.of(child));

        List<UserDTO> answer = authService.createMultipleUsers(
                List.of(request("parent@example.com", "PARENT"), request("kid@example.com", "STUDENT")),
                INSTITUTE_ID, false);

        assertEquals("guardian-1", child.getLinkedParentId());
        assertEquals("guardian-1", answer.get(1).getLinkedParentId());
    }

    @Test
    void parentAndChildCreateDoesNotLinkAnExistingChildWithoutAGuardian() {
        User child = existing("child-1", "kid@example.com", "child-secret", null);
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("kid@example.com")).thenReturn(Optional.of(child));

        authService.createMultipleUsers(
                List.of(request("parent@example.com", "PARENT"), request("kid@example.com", "STUDENT")),
                INSTITUTE_ID, false);

        assertNull(child.getLinkedParentId());
    }

    @Test
    void parentAndChildCreateLinksANewChildToTheParent() {
        List<UserDTO> answer = authService.createMultipleUsers(
                List.of(request("parent@example.com", "PARENT"), request("kid@example.com", "STUDENT")),
                INSTITUTE_ID, false);

        assertEquals(answer.get(0).getId(), answer.get(1).getLinkedParentId());
        assertTrue(answer.get(0).getIsParent());
    }

    @Test
    void parentAndChildCreateAnswersPasswordsOnlyForNewAccounts() {
        User parent = existing("parent-1", "parent@example.com", "parent-secret", null);
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("parent@example.com")).thenReturn(Optional.of(parent));

        List<UserDTO> answer = authService.createMultipleUsers(
                List.of(request("parent@example.com", "PARENT"), request("kid@example.com", "STUDENT")),
                INSTITUTE_ID, false);

        assertNull(answer.get(0).getPassword());
        assertNotNull(answer.get(1).getPassword());
    }
}
