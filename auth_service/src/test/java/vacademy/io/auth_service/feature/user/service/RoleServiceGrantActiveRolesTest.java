package vacademy.io.auth_service.feature.user.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.UserService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The grant behind every team invite: members are ACTIVE on creation, one row per role per
 * institute, and only roles usable in that institute.
 */
class RoleServiceGrantActiveRolesTest {

    private static final String A = "inst-a";
    private static final String B = "inst-b";

    private RoleRepository roles;
    private UserRoleRepository userRoles;
    private UserService userService;
    private RoleService service;
    private User user;
    private final List<UserRole> rows = new ArrayList<>();

    @BeforeEach
    void setUp() {
        roles = mock(RoleRepository.class);
        userRoles = mock(UserRoleRepository.class);
        userService = mock(UserService.class);
        service = new RoleService(roles, mock(UserRepository.class), userRoles, userService,
                mock(UserOperationService.class));
        user = new User();
        user.setId("u-1");
        user.setUsername("u1");
        when(userRoles.findByUser(user)).thenAnswer(i -> new ArrayList<>(rows));
    }

    private static Role role(String id, String name, String instituteId) {
        Role r = new Role();
        r.setId(id);
        r.setName(name);
        r.setInstituteId(instituteId);
        return r;
    }

    private UserRole row(Role role, String instituteId, String status) {
        UserRole ur = new UserRole();
        ur.setId("row-" + rows.size());
        ur.setUser(user);
        ur.setRole(role);
        ur.setInstituteId(instituteId);
        ur.setStatus(status);
        rows.add(ur);
        return ur;
    }

    @SuppressWarnings("unchecked")
    private List<UserRole> saved() {
        ArgumentCaptor<Iterable<UserRole>> c = ArgumentCaptor.forClass(Iterable.class);
        verify(userRoles).saveAll(c.capture());
        List<UserRole> out = new ArrayList<>();
        c.getValue().forEach(out::add);
        return out;
    }

    @Test
    void aNewMemberIsActiveAtOnceInThisInstituteOnly() {
        Role counsellor = role("r-c", "COUNSELLOR", null);
        when(roles.findByNameIn(List.of("COUNSELLOR"))).thenReturn(List.of(counsellor));

        RoleService.RoleGrant grant = service.grantActiveRoles(user, A, List.of("COUNSELLOR"));

        List<UserRole> added = saved();
        assertEquals(1, added.size());
        assertEquals("ACTIVE", added.get(0).getStatus());
        assertEquals(A, added.get(0).getInstituteId());
        assertEquals(List.of("COUNSELLOR"), grant.added());
        verify(userService).updateLastTokenUpdatedTime(List.of("u-1"));
    }

    @Test
    void duplicateNamesInTheRequestMakeOneRow() {
        Role teacher = role("r-t", "TEACHER", null);
        when(roles.findByNameIn(List.of("TEACHER"))).thenReturn(List.of(teacher));

        service.grantActiveRoles(user, A, List.of("TEACHER", "TEACHER"));

        assertEquals(1, saved().size());
    }

    @Test
    void aPaddedRoleNameIsNotTrimmedIntoARealRole() {
        // The admin-grant guard compares names as given; trimming here let "ADMIN " slip past it.
        when(roles.findByNameIn(List.of("ADMIN "))).thenReturn(List.of());

        RoleService.RoleGrant grant = service.grantActiveRoles(user, A, List.of("ADMIN "));

        verify(userRoles, never()).saveAll(any());
        assertEquals(List.of("ADMIN "), grant.unknown());
    }

    @Test
    void aRoleAlreadyActiveHereIsNotAddedAgain() {
        Role teacher = role("r-t", "TEACHER", null);
        row(teacher, A, "ACTIVE");
        when(roles.findByNameIn(List.of("TEACHER"))).thenReturn(List.of(teacher));

        RoleService.RoleGrant grant = service.grantActiveRoles(user, A, List.of("TEACHER"));

        verify(userRoles, never()).saveAll(any());
        assertEquals(List.of("TEACHER"), grant.alreadyActive());
        assertFalse(grant.changed());
    }

    @Test
    void anOldPendingInviteHereBecomesActiveInsteadOfADuplicate() {
        Role counsellor = role("r-c", "COUNSELLOR", null);
        UserRole pending = row(counsellor, A, "INVITED");
        when(roles.findByNameIn(List.of("COUNSELLOR"))).thenReturn(List.of(counsellor));

        RoleService.RoleGrant grant = service.grantActiveRoles(user, A, List.of("COUNSELLOR"));

        assertEquals(List.of(pending), saved());
        assertEquals("ACTIVE", pending.getStatus());
        assertEquals(List.of("COUNSELLOR"), grant.activated());
    }

    @Test
    void aDisabledRoleStaysDisabled() {
        Role counsellor = role("r-c", "COUNSELLOR", null);
        UserRole paused = row(counsellor, A, "DISABLED");
        when(roles.findByNameIn(List.of("COUNSELLOR"))).thenReturn(List.of(counsellor));

        RoleService.RoleGrant grant = service.grantActiveRoles(user, A, List.of("COUNSELLOR"));

        verify(userRoles, never()).saveAll(any());
        assertEquals("DISABLED", paused.getStatus());
        assertEquals(List.of("COUNSELLOR"), grant.paused());
    }

    @Test
    void aRemovedRoleIsGrantedAfreshAndTheSameRoleElsewhereDoesNotCount() {
        Role teacher = role("r-t", "TEACHER", null);
        UserRole removed = row(teacher, A, "DELETED");
        UserRole elsewhere = row(teacher, B, "ACTIVE");
        when(roles.findByNameIn(List.of("TEACHER"))).thenReturn(List.of(teacher));

        service.grantActiveRoles(user, A, List.of("TEACHER"));

        List<UserRole> added = saved();
        assertEquals(1, added.size());
        assertNotSame(removed, added.get(0));
        assertEquals(A, added.get(0).getInstituteId());
        assertEquals("ACTIVE", added.get(0).getStatus());
        assertEquals("DELETED", removed.getStatus());
        assertEquals("ACTIVE", elsewhere.getStatus());
    }

    @Test
    void anotherInstitutesCustomRoleOfTheSameNameIsNeverGranted() {
        Role theirs = role("r-x", "Counsellor Lead", B);
        when(roles.findByNameIn(List.of("Counsellor Lead"))).thenReturn(List.of(theirs));

        RoleService.RoleGrant grant = service.grantActiveRoles(user, A, List.of("Counsellor Lead"));

        verify(userRoles, never()).saveAll(any());
        assertEquals(List.of("Counsellor Lead"), grant.unknown());
    }

    @Test
    void thisInstitutesCustomRoleIsGranted() {
        Role theirs = role("r-x", "Counsellor Lead", B);
        Role ours = role("r-y", "Counsellor Lead", A);
        when(roles.findByNameIn(List.of("Counsellor Lead"))).thenReturn(List.of(theirs, ours));

        service.grantActiveRoles(user, A, List.of("Counsellor Lead"));

        List<UserRole> added = saved();
        assertEquals(1, added.size());
        assertEquals("r-y", added.get(0).getRole().getId());
    }

    @Test
    void anInstituteIsRequired() {
        assertThrows(VacademyException.class, () -> service.grantActiveRoles(user, " ", List.of("TEACHER")));
        verifyNoInteractions(roles);
    }
}
