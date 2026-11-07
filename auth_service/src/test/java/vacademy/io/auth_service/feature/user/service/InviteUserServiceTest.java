package vacademy.io.auth_service.feature.user.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.auth_service.feature.institute.InstituteInfoDTO;
import vacademy.io.auth_service.feature.institute.InstituteInternalService;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.auth_service.feature.user.dto.InvitedUserDTO;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.UserService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.notification.dto.GenericEmailRequest;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Team invites make members ACTIVE on creation, add roles to an existing account without
 * mailing its password, edit an invite as a diff (never demoting ACTIVE roles), and resend
 * login details for one institute only. Runs the real RoleService on mocked repositories so
 * the rows written are the ones asserted.
 */
class InviteUserServiceTest {

    private static final String A = "inst-a";
    private static final String B = "inst-b";

    private final UserService userService = mock(UserService.class);
    private final RoleRepository roleRepository = mock(RoleRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final UserRoleRepository userRoleRepository = mock(UserRoleRepository.class);
    private final NotificationService notificationService = mock(NotificationService.class);
    private final InstituteInternalService instituteInternalService = mock(InstituteInternalService.class);
    private InviteUserService service;

    private final List<UserRole> rows = new ArrayList<>();
    private final List<UserRole> savedRows = new ArrayList<>();
    private final List<UserRole> deletedRows = new ArrayList<>();

    private final Role admin = role("r-admin", "ADMIN", null);
    private final Role teacher = role("r-teacher", "TEACHER", null);
    private final Role counsellor = role("r-counsellor", "COUNSELLOR", null);
    private final Role evaluator = role("r-evaluator", "EVALUATOR", null);
    private final Role otherInstitutesLead = role("r-lead-b", "Lead", B);

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        RoleService roleService = new RoleService(roleRepository, userRepository, userRoleRepository, userService,
                mock(UserOperationService.class));
        service = new InviteUserService(userService, roleService, notificationService, userRoleRepository);
        ReflectionTestUtils.setField(service, "instituteInternalService", instituteInternalService);

        when(roleRepository.findByNameIn(anyList())).thenAnswer(inv -> {
            List<String> names = inv.getArgument(0);
            return List.of(admin, teacher, counsellor, evaluator, otherInstitutesLead).stream()
                    .filter(r -> names.contains(r.getName())).toList();
        });
        when(userRoleRepository.findByUser(any())).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            return rows.stream().filter(r -> r.getUser().getId().equals(u.getId())).toList();
        });
        when(userRoleRepository.saveAll(any())).thenAnswer(inv -> {
            for (UserRole ur : (Iterable<UserRole>) inv.getArgument(0)) {
                savedRows.add(ur);
                if (!rows.contains(ur)) {
                    rows.add(ur);
                }
            }
            return inv.getArgument(0);
        });
        doAnswer(inv -> {
            for (UserRole ur : (Iterable<UserRole>) inv.getArgument(0)) {
                deletedRows.add(ur);
                rows.remove(ur);
            }
            return null;
        }).when(userRoleRepository).deleteAll(any());
        when(instituteInternalService.getInstituteByInstituteId(A)).thenReturn(
                InstituteInfoDTO.builder().id(A).instituteName("Acme Academy").adminPortalUrl("admin.acme.test").build());
        when(instituteInternalService.getInstituteByInstituteId(B)).thenReturn(
                InstituteInfoDTO.builder().id(B).instituteName("Other School").build());
    }

    private static Role role(String id, String name, String instituteId) {
        Role r = new Role();
        r.setId(id);
        r.setName(name);
        r.setInstituteId(instituteId);
        return r;
    }

    private static User user(String id, String password, Date lastLogin) {
        User u = new User();
        u.setId(id);
        u.setUsername(id + "_login");
        u.setEmail(id + "@example.com");
        u.setFullName("Priya " + id);
        u.setPassword(password);
        u.setLastLoginTime(lastLogin);
        return u;
    }

    private UserRole row(User u, Role role, String instituteId, String status) {
        UserRole ur = new UserRole();
        ur.setId("row-" + rows.size());
        ur.setUser(u);
        ur.setRole(role);
        ur.setInstituteId(instituteId);
        ur.setStatus(status);
        rows.add(ur);
        return ur;
    }

    private UserRole rowOf(String userId, String instituteId, String roleName) {
        return rows.stream().filter(r -> r.getUser().getId().equals(userId)
                && instituteId.equals(r.getInstituteId()) && r.getRole().getName().equals(roleName))
                .findFirst().orElse(null);
    }

    private static UserDTO request(String email, String... roles) {
        UserDTO dto = new UserDTO();
        dto.setEmail(email);
        dto.setFullName("Priya Sharma");
        dto.setRoles(new ArrayList<>(List.of(roles)));
        return dto;
    }

    private List<GenericEmailRequest> sentEmails() {
        ArgumentCaptor<GenericEmailRequest> c = ArgumentCaptor.forClass(GenericEmailRequest.class);
        verify(notificationService, atLeast(0)).sendGenericHtmlMailViaUnified(c.capture(), anyString());
        return c.getAllValues();
    }

    // ---- invite: new account -------------------------------------------------------------

    @Test
    void aNewAccountIsActiveAtOnceAndGetsItsLoginDetails() {
        User created = user("new", null, null);
        when(userService.findExistingUserByEmail("priya@example.com")).thenReturn(Optional.empty());
        when(userService.createNewUserFromUserDto(any())).thenAnswer(inv -> {
            UserDTO dto = inv.getArgument(0);
            created.setPassword(dto.getPassword());
            created.setUsername(dto.getUsername());
            dto.setId(created.getId());
            return created;
        });

        InvitedUserDTO response = service.inviteUser(request("priya@example.com", "COUNSELLOR", "COUNSELLOR"), A);

        assertFalse(response.isExistingAccount());
        assertEquals("new", response.getId());
        assertNotNull(response.getPassword());
        assertEquals(1, savedRows.size(), "one row, however often the role is named");
        assertEquals("ACTIVE", savedRows.get(0).getStatus());
        assertEquals(A, savedRows.get(0).getInstituteId());
        verify(userService, never()).addUserRoles(any(), any(), any(), any());
        verify(userService, never()).createUserFromUserDto(any());

        List<GenericEmailRequest> mails = sentEmails();
        assertEquals(1, mails.size());
        GenericEmailRequest mail = mails.get(0);
        assertEquals("priya@example.com", mail.getTo());
        assertEquals("Your Acme Academy account is ready", mail.getSubject());
        assertTrue(mail.getBody().contains(response.getPassword()));
        assertTrue(mail.getBody().contains("https://admin.acme.test/login"));
        assertFalse(mail.getBody().toLowerCase().contains("waiting"));
        assertFalse(mail.getBody().contains("Accept invitation"));
    }

    @Test
    void anotherInstitutesCustomRoleIsNotAttached() {
        User created = user("new", "pw", null);
        when(userService.findExistingUserByEmail(anyString())).thenReturn(Optional.empty());
        when(userService.createNewUserFromUserDto(any())).thenReturn(created);

        service.inviteUser(request("priya@example.com", "Lead", "TEACHER"), A);

        assertEquals(List.of("r-teacher"), savedRows.stream().map(r -> r.getRole().getId()).toList());
    }

    // ---- invite: existing account --------------------------------------------------------

    @Test
    void anExistingAccountGetsTheRoleActiveAndNoPassword() {
        User existing = user("old", "their-own-secret", new Date());
        row(existing, teacher, B, "ACTIVE");
        when(userService.findExistingUserByEmail("old@example.com")).thenReturn(Optional.of(existing));

        InvitedUserDTO response = service.inviteUser(request("old@example.com", "COUNSELLOR"), A);

        assertTrue(response.isExistingAccount());
        assertFalse(response.isAlreadyMember());
        assertEquals("old", response.getId());
        assertNull(response.getPassword(), "the inviter never sees the stored password");
        verify(userService, never()).createNewUserFromUserDto(any());
        verify(userService, never()).createUserFromUserDto(any());
        assertEquals("ACTIVE", rowOf("old", A, "COUNSELLOR").getStatus());
        assertEquals("ACTIVE", rowOf("old", B, "TEACHER").getStatus());

        List<GenericEmailRequest> mails = sentEmails();
        assertEquals(1, mails.size());
        assertEquals("You've been added to Acme Academy", mails.get(0).getSubject());
        assertFalse(mails.get(0).getBody().contains("their-own-secret"));
        assertTrue(mails.get(0).getBody().contains("old_login"));
    }

    @Test
    void reInvitingSomeoneAlreadyActiveHereChangesAndSendsNothing() {
        User existing = user("old", "secret", new Date());
        row(existing, counsellor, A, "ACTIVE");
        when(userService.findExistingUserByEmail(anyString())).thenReturn(Optional.of(existing));

        InvitedUserDTO response = service.inviteUser(request("old@example.com", "COUNSELLOR"), A);

        assertTrue(response.isExistingAccount());
        assertTrue(response.isAlreadyMember());
        assertTrue(savedRows.isEmpty());
        assertTrue(sentEmails().isEmpty());
    }

    @Test
    void reInvitingSomeoneDisabledHereIsA409AndWritesNothing() {
        User existing = user("old", "secret", new Date());
        row(existing, counsellor, A, "DISABLED");
        when(userService.findExistingUserByEmail(anyString())).thenReturn(Optional.of(existing));

        VacademyException sameRole = assertThrows(VacademyException.class,
                () -> service.inviteUser(request("old@example.com", "COUNSELLOR"), A));
        assertEquals(HttpStatus.CONFLICT, sameRole.getStatus());
        assertTrue(sameRole.getMessage().contains("use Enable on the Members tab"));

        // A different role must not sneak a disabled member back in either.
        VacademyException otherRole = assertThrows(VacademyException.class,
                () -> service.inviteUser(request("old@example.com", "TEACHER"), A));
        assertEquals(HttpStatus.CONFLICT, otherRole.getStatus());

        assertTrue(savedRows.isEmpty());
        assertTrue(sentEmails().isEmpty());
        assertEquals("DISABLED", rowOf("old", A, "COUNSELLOR").getStatus());
    }

    @Test
    void aPausedRoleRequestedAgainIsRefusedEvenWhileAnotherRoleIsLive() {
        User existing = user("old", "secret", new Date());
        row(existing, teacher, A, "ACTIVE");
        row(existing, counsellor, A, "DISABLED");
        when(userService.findExistingUserByEmail(anyString())).thenReturn(Optional.of(existing));

        assertThrows(VacademyException.class,
                () -> service.inviteUser(request("old@example.com", "COUNSELLOR", "EVALUATOR"), A));
        assertTrue(savedRows.isEmpty());
    }

    // ---- edit invite ---------------------------------------------------------------------

    @Test
    void editingRolesIsADiffThatNeverDemotesActiveRoles() {
        User member = user("m", "pw", null);
        UserRole teacherHere = row(member, teacher, A, "ACTIVE");
        UserRole counsellorHere = row(member, counsellor, A, "ACTIVE");
        UserRole evaluatorPending = row(member, evaluator, A, "INVITED");
        UserRole counsellorElsewhere = row(member, counsellor, B, "ACTIVE");
        when(userService.getUserById("m")).thenReturn(member);
        when(userRepository.findById("m")).thenReturn(Optional.of(member));

        UserDTO edit = request(null, "TEACHER", "EVALUATOR", "ADMIN");
        edit.setId("m");
        service.updateInvitationUser(edit, A, null);

        assertEquals("ACTIVE", teacherHere.getStatus(), "kept role keeps ACTIVE");
        assertEquals("INVITED", evaluatorPending.getStatus(), "kept role keeps its status");
        assertEquals(List.of(counsellorHere), deletedRows, "dropped role removed in this institute only");
        assertTrue(rows.contains(counsellorElsewhere));
        assertEquals("ACTIVE", counsellorElsewhere.getStatus());
        UserRole adminHere = rowOf("m", A, "ADMIN");
        assertNotNull(adminHere);
        assertEquals("ACTIVE", adminHere.getStatus(), "new role is ACTIVE, never INVITED");
        assertEquals(1, savedRows.size());
    }

    @Test
    void editingCannotStripEveryRole() {
        User member = user("m", "pw", null);
        row(member, teacher, A, "ACTIVE");
        UserDTO edit = request(null);
        edit.setId("m");

        assertThrows(VacademyException.class, () -> service.updateInvitationUser(edit, A, null));
        assertTrue(deletedRows.isEmpty());
        verify(userService, never()).updateUser(any());
    }

    // ---- resend login details ------------------------------------------------------------

    @Test
    void resendForAnAccountThisInstituteCreatedAndNobodyUsedCarriesItsLoginDetails() {
        User member = user("m", "pw-123", null);
        member.setCreatedAt(Timestamp.valueOf(LocalDateTime.of(2026, 10, 1, 9, 0, 0)));
        row(member, counsellor, A, "ACTIVE").setCreatedAt(LocalDateTime.of(2026, 10, 1, 9, 0, 1));
        when(userService.getUserById("m")).thenReturn(member);

        assertEquals("Login details sent", service.resendInvitation("m", A, null));

        List<GenericEmailRequest> mails = sentEmails();
        assertEquals(1, mails.size());
        GenericEmailRequest mail = mails.get(0);
        assertEquals("Your login details for Acme Academy", mail.getSubject());
        assertTrue(mail.getBody().contains("pw-123"));
        assertTrue(mail.getBody().contains("Counsellor"));
        verify(notificationService).sendGenericHtmlMailViaUnified(any(), eq(A));
    }

    @Test
    void anAccountSharedWithAnotherInstituteNeverGetsItsPasswordResent() {
        User member = user("m", "pw-123", null);
        row(member, counsellor, A, "ACTIVE");
        // Any status counts — even a removed row means another institute knows this account.
        row(member, admin, B, "DELETED");
        when(userService.getUserById("m")).thenReturn(member);

        assertEquals("Sign-in reminder sent", service.resendInvitation("m", A, null));

        GenericEmailRequest mail = sentEmails().get(0);
        assertFalse(mail.getBody().contains("pw-123"));
        assertTrue(mail.getBody().contains("Forgot password"));
        assertTrue(mail.getBody().contains("Counsellor"));
        assertFalse(mail.getBody().contains("Admin"), "roles from another institute are not listed");
        assertFalse(mail.getBody().contains("Other School"));
        verify(notificationService).sendGenericHtmlMailViaUnified(any(), eq(A));
    }

    @Test
    void anAccountThatExistedBeforeThisInstituteAddedItNeverGetsItsPasswordResent() {
        User member = user("m", "pw-123", null);
        member.setCreatedAt(Timestamp.valueOf(LocalDateTime.of(2025, 1, 1, 9, 0)));
        row(member, counsellor, A, "ACTIVE").setCreatedAt(LocalDateTime.of(2026, 10, 1, 9, 0));
        when(userService.getUserById("m")).thenReturn(member);

        assertEquals("Sign-in reminder sent", service.resendInvitation("m", A, null));
        assertFalse(sentEmails().get(0).getBody().contains("pw-123"));
    }

    @Test
    void resendAfterTheFirstSignInNeverMailsThePassword() {
        User member = user("m", "their-own-secret", new Date());
        row(member, counsellor, A, "ACTIVE");
        when(userService.getUserById("m")).thenReturn(member);

        assertEquals("Sign-in reminder sent", service.resendInvitation("m", A, null));

        GenericEmailRequest mail = sentEmails().get(0);
        assertFalse(mail.getBody().contains("their-own-secret"));
        assertTrue(mail.getBody().contains("Forgot password"));
        assertEquals("Sign in to Acme Academy", mail.getSubject());
    }

    @Test
    void aHashedPasswordIsNeverMailed() {
        String hash = "$2a$10$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0";
        User member = user("m", hash, null);
        row(member, counsellor, A, "ACTIVE");
        when(userService.getUserById("m")).thenReturn(member);

        assertEquals("Sign-in reminder sent", service.resendInvitation("m", A, null));
        assertFalse(sentEmails().get(0).getBody().contains(hash));
    }

    @Test
    void resendNeedsALiveRoleInThisInstitute() {
        User member = user("m", "pw", null);
        row(member, counsellor, A, "DISABLED");
        row(member, counsellor, B, "ACTIVE");
        when(userService.getUserById("m")).thenReturn(member);

        assertThrows(VacademyException.class, () -> service.resendInvitation("m", A, null));
        assertThrows(VacademyException.class, () -> service.resendInvitation("m", null, null));
        assertTrue(sentEmails().isEmpty());
    }
}
