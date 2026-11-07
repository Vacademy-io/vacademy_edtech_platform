package vacademy.io.auth_service.feature.super_admin.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.super_admin.dto.InstituteRoleDTO;
import vacademy.io.auth_service.feature.super_admin.dto.InstituteUserDTO;
import vacademy.io.auth_service.feature.super_admin.dto.SuperAdminPageResponse;
import vacademy.io.auth_service.feature.super_admin.service.SuperAdminAnalyticsService;
import vacademy.io.auth_service.feature.super_admin.service.SuperAdminInstituteRoleService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/auth-service/super-admin/v1")
public class SuperAdminUserController {

    @Autowired
    private SuperAdminAnalyticsService superAdminAnalyticsService;

    @Autowired
    private SuperAdminInstituteRoleService superAdminInstituteRoleService;

    @GetMapping("/institutes/{instituteId}/users")
    public ResponseEntity<SuperAdminPageResponse<InstituteUserDTO>> getInstituteUsers(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String instituteId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String role,
            @RequestParam(required = false) String search) {
        try {
            SuperAdminAuthUtil.requireSuperAdmin(user);
            if (size > 50) size = 50;
            return ResponseEntity.ok(superAdminAnalyticsService.getInstituteUsers(
                    instituteId, role, search, page, size));
        } catch (Exception e) {
            log.error("Error in getInstituteUsers: {}", e.getMessage());
            throw e;
        }
    }

    /**
     * Staff roles of an institute (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §12.3): ADMIN, TEACHER,
     * other built-in staff roles (SYSTEM) and the institute's custom roles (CUSTOM), each with
     * its count of ACTIVE users in this institute. Learner-side roles are left out.
     */
    @GetMapping("/institutes/{instituteId}/roles")
    public ResponseEntity<List<InstituteRoleDTO>> getInstituteRoles(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String instituteId) {
        try {
            SuperAdminAuthUtil.requireSuperAdmin(user);
            return ResponseEntity.ok(superAdminInstituteRoleService.getInstituteRoles(instituteId));
        } catch (Exception e) {
            log.error("Error in getInstituteRoles for institute {}: {}", instituteId, e.getMessage());
            throw e;
        }
    }

    @PutMapping("/institutes/{instituteId}/users/{userId}/deactivate")
    public ResponseEntity<Map<String, String>> deactivateUser(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String instituteId,
            @PathVariable String userId) {
        try {
            SuperAdminAuthUtil.requireSuperAdmin(user);
            superAdminAnalyticsService.deactivateUserFromInstitute(instituteId, userId);
            return ResponseEntity.ok(Map.of("status", "success", "message",
                    "User deactivated from institute"));
        } catch (Exception e) {
            log.error("Error deactivating user {} from institute {}: {}", userId, instituteId, e.getMessage());
            throw e;
        }
    }
}
