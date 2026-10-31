package vacademy.io.auth_service.feature.user.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.auth_service.feature.user.dto.ModifyUserRolesDTO;
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
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Role writes for users who belong to more than one institute: a grant, a removal or a status
 * change in one institute must never be decided by, or reach, the user's rows in another.
 */
class RoleServiceInstituteScopeTest {

    private static final String A = "inst-a";
    private static final String B = "inst-b";
    private static final String INST_A_CUSTOM = "inst-a";

    private RoleRepository roles;
    private UserRepository users;
    private UserRoleRepository userRoles;
    private UserService userService;
    private RoleService service;
    private User user;
    private final List<UserRole> rows = new ArrayList<>();

    @BeforeEach
    void setUp() {
        roles = mock(RoleRepository.class);
        users = mock(UserRepository.class);
        userRoles = mock(UserRoleRepository.class);
        userService = mock(UserService.class);
        service = new RoleService(roles, users, userRoles, userService, mock(UserOperationService.class));
        user = new User();
        user.setId("u-1");
        user.setUsername("u1");
        when(users.findById("u-1")).thenReturn(Optional.of(user));
        when(userRoles.findByUser(user)).thenAnswer(i -> new ArrayList<>(rows));
        when(userRoles.findByUserAndStatusAndRoleName(eq(user), anyString(), anyString())).thenAnswer(i -> rows.stream()
                .filter(r -> r.getStatus().equals(i.getArgument(1)) && r.getRole().getName().equals(i.getArgument(2)))
                .toList());
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

    private static ModifyUserRolesDTO dto(String instituteId, String... roleNames) {
        ModifyUserRolesDTO d = new ModifyUserRolesDTO();
        d.setUserId("u-1");
        d.setInstituteId(instituteId);
        d.setRoles(List.of(roleNames));
        return d;
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
    void aRoleActiveInAnotherInstituteIsStillGrantedHere() {
        Role counsellor = role("r-c", "COUNSELLOR", null);
        row(counsellor, B, "ACTIVE");
        when(roles.findByNameIn(List.of("COUNSELLOR"))).thenReturn(List.of(counsellor));

        service.addRolesToUser(dto(A, "COUNSELLOR"), Optional.of("ACTIVE"), null);

        List<UserRole> added = saved();
        assertEquals(1, added.size());
        assertEquals(A, added.get(0).getInstituteId());
        assertEquals("ACTIVE", added.get(0).getStatus());
    }

    @Test
    void aRoleAlreadyActiveHereIsNotAddedTwice() {
        Role counsellor = role("r-c", "COUNSELLOR", null);
        row(counsellor, A, "ACTIVE");
        when(roles.findByNameIn(List.of("COUNSELLOR"))).thenReturn(List.of(counsellor));

        service.addRolesToUser(dto(A, "COUNSELLOR"), Optional.of("ACTIVE"), null);

        assertTrue(saved().isEmpty());
    }

    @Test
    void anotherInstitutesCustomRoleOfTheSameNameIsNeverGranted() {
        Role builtIn = role("r-t", "TEACHER", null);
        Role theirs = role("r-x", "TEACHER", B);
        Role ours = role("r-y", "TEACHER", A);
        when(roles.findByNameIn(List.of("TEACHER"))).thenReturn(List.of(builtIn, theirs, ours));

        service.addRolesToUser(dto(A, "TEACHER"), Optional.of("ACTIVE"), null);

        List<String> granted = saved().stream().map(r -> r.getRole().getId()).sorted().toList();
        assertEquals(List.of("r-t", "r-y"), granted);
    }

    @Test
    void removalTouchesOnlyTheNamedInstitute() {
        Role teacher = role("r-t", "TEACHER", null);
        UserRole here = row(teacher, A, "ACTIVE");
        row(teacher, B, "ACTIVE");
        row(role("r-s", "STUDENT", null), A, "ACTIVE");

        service.removeRolesFromUser(dto(A, "TEACHER"), null);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Iterable<UserRole>> c = ArgumentCaptor.forClass(Iterable.class);
        verify(userRoles).deleteAll(c.capture());
        List<UserRole> deleted = new ArrayList<>();
        c.getValue().forEach(deleted::add);
        assertEquals(List.of(here), deleted);
        verify(userRoles, never()).deleteUserRolesByUserIdAndRoleNames(anyString(), anyList());
    }

    @Test
    void removalWithoutAnInstituteIsRefused() {
        assertThrows(VacademyException.class, () -> service.removeRolesFromUser(dto(null, "TEACHER"), null));
        verify(userRoles, never()).deleteAll(any());
    }

    @Test
    void disablingANamedRoleLeavesOtherRolesAndInstitutesAlone() {
        Role counsellor = role("r-c", "COUNSELLOR", null);
        UserRole here = row(counsellor, A, "ACTIVE");
        UserRole elsewhere = row(counsellor, B, "ACTIVE");
        UserRole teacherHere = row(role("r-t", "TEACHER", null), A, "ACTIVE");
        UserRole deleted = row(counsellor, A, "DELETED");

        assertEquals(1, service.updateRoleStatusForRoles(A, "u-1", List.of("COUNSELLOR", "COUNSELOR"), "DISABLED"));
        assertEquals("DISABLED", here.getStatus());
        assertEquals("ACTIVE", elsewhere.getStatus());
        assertEquals("ACTIVE", teacherHere.getStatus());
        assertEquals("DELETED", deleted.getStatus());
    }

    @Test
    void roleNamesMatchIgnoringCaseAndNoUserWideTokenStampIsBumped() {
        UserRole mixed = row(role("r-c2", "Counsellor", INST_A_CUSTOM), A, "ACTIVE");
        assertEquals(1, service.updateRoleStatusForRoles(A, "u-1", List.of("COUNSELLOR"), "DISABLED"));
        assertEquals("DISABLED", mixed.getStatus());
        verify(userService, never()).updateLastTokenUpdatedTime(anyList());
    }

    @Test
    void enablingRestoresOnlyPausedRowsNeverDeletedOnes() {
        Role counsellor = role("r-c", "COUNSELLOR", null);
        UserRole paused = row(counsellor, A, "DISABLED");
        UserRole deleted = row(counsellor, A, "DELETED");

        assertEquals(1, service.updateRoleStatusForRoles(A, "u-1", List.of("COUNSELLOR"), "ACTIVE"));
        assertEquals("ACTIVE", paused.getStatus());
        assertEquals("DELETED", deleted.getStatus());
        // Repeating it is a no-op, not an error.
        assertEquals(0, service.updateRoleStatusForRoles(A, "u-1", List.of("COUNSELLOR"), "ACTIVE"));
    }

    @Test
    void statusUpdateRejectsOtherStatuses() {
        assertThrows(VacademyException.class,
                () -> service.updateRoleStatusForRoles(A, "u-1", List.of("COUNSELLOR"), "DELETED"));
        assertThrows(VacademyException.class,
                () -> service.updateRoleStatusForRoles(A, "u-1", List.of(), "DISABLED"));
    }
}
