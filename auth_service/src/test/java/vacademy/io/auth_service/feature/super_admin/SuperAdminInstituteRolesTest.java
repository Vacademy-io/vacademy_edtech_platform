package vacademy.io.auth_service.feature.super_admin;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.auth_service.feature.super_admin.controller.SuperAdminUserController;
import vacademy.io.auth_service.feature.super_admin.dto.InstituteRoleDTO;
import vacademy.io.auth_service.feature.super_admin.service.SuperAdminInstituteRoleService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashSet;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * GET /auth-service/super-admin/v1/institutes/{id}/roles: allowlist guard, kinds, learner-side
 * and legacy roles left out, ACTIVE user counts per role.
 */
class SuperAdminInstituteRolesTest {

    private static Role role(String id, String name, String instituteId) {
        return new Role(id, name, instituteId, new HashSet<>(), null, null);
    }

    private static SuperAdminInstituteRoleService service() {
        RoleRepository roles = mock(RoleRepository.class);
        when(roles.findAllByInstituteIdIsNull()).thenReturn(List.of(
                role("r-admin", "ADMIN", null), role("r-teacher", "TEACHER", null),
                role("r-student", "STUDENT", null), role("r-parent", "PARENT", null),
                role("r-eval", "EVALUATOR", null), role("r-hr", "HR_ADMIN", null),
                role("r-legacy", "Admin", null)));
        when(roles.findAllByInstituteId("inst-1")).thenReturn(List.of(role("r-c1", "Counsellor", "inst-1")));

        EntityManager em = mock(EntityManager.class);
        Query query = mock(Query.class);
        when(em.createNativeQuery(anyString())).thenReturn(query);
        when(query.setParameter("instituteId", "inst-1")).thenReturn(query);
        when(query.getResultList()).thenReturn(List.of(
                new Object[]{"r-admin", 2L}, new Object[]{"r-c1", 5L}, new Object[]{"r-student", 900L}));

        SuperAdminInstituteRoleService service = new SuperAdminInstituteRoleService(roles);
        ReflectionTestUtils.setField(service, "entityManager", em);
        return service;
    }

    @Test
    void listsStaffRolesWithKindsAndActiveCounts() {
        List<InstituteRoleDTO> out = service().getInstituteRoles("inst-1");
        // HR_ADMIN is a platform role but the admin app lets admins configure it like a custom
        // role, so it is CUSTOM; only Evaluator / Content / Assessment Creator are SYSTEM.
        assertEquals(List.of("ADMIN", "TEACHER", "EVALUATOR", "Counsellor", "HR_ADMIN"),
                out.stream().map(InstituteRoleDTO::getRoleName).toList());
        assertEquals(List.of("ADMIN", "TEACHER", "SYSTEM", "CUSTOM", "CUSTOM"),
                out.stream().map(InstituteRoleDTO::getKind).toList());
        assertEquals(2L, out.get(0).getUserCount());
        assertEquals(0L, out.get(1).getUserCount());
        assertEquals(5L, out.get(3).getUserCount());
        assertEquals("r-c1", out.get(3).getRoleId());
    }

    @Test
    void routeIsAllowlistOnly() {
        SuperAdminInstituteRoleService service = mock(SuperAdminInstituteRoleService.class);
        SuperAdminUserController controller = new SuperAdminUserController();
        ReflectionTestUtils.setField(controller, "superAdminInstituteRoleService", service);
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setRootUser(true);
        dto.setAuthorities(List.of("ADMIN"));
        VacademyException ex = assertThrows(VacademyException.class,
                () -> controller.getInstituteRoles(new CustomUserDetails(dto), "inst-1"));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
        verifyNoInteractions(service);
    }
}
