package vacademy.io.auth_service.feature.user.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.user.dto.CreateRoleDTO;
import vacademy.io.auth_service.feature.user.dto.CustomRoleDTO;
import vacademy.io.auth_service.feature.user.dto.UpdateRoleDTO;
import vacademy.io.auth_service.feature.user.service.CustomRoleService;
import vacademy.io.auth_service.feature.user.service.UserAccountAccessGuard;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * Custom roles of one institute. The institute comes from the path, so every route checks the
 * caller against it from their user_role rows ({@link UserAccountAccessGuard}): the token's
 * root flag and authorities prove nothing here (learners are root users, and the authorities
 * belong to whatever clientId the caller sent).
 *
 * <ul>
 *   <li>create: ADMIN of the institute; other staff only for a role carrying no permission
 *       beyond {@link #NON_ADMIN_CREATABLE_PERMISSION_IDS} (see there);</li>
 *   <li>update / delete: ADMIN of the institute. Nothing in the dashboards calls these for a
 *       non-admin, and they change what every holder of the role may do;</li>
 *   <li>list: any member of the institute.</li>
 * </ul>
 * A platform super-admin passes every check.
 */
@RestController
@RequestMapping("/auth-service/v1/institute/{instituteId}/roles")
public class CustomRoleController {

    /**
     * Permission ids a non-admin staff member may put on a role they create. A sub-org admin is
     * not an institute ADMIN, yet the sub-org team form (add-member-form.tsx, mode 'subOrg') creates
     * its custom role with exactly ['109'] (the faculty-access permission); the institute-mode form
     * sends ['109'] or []. Anything else (any other permission) needs an ADMIN.
     */
    static final Set<String> NON_ADMIN_CREATABLE_PERMISSION_IDS = Set.of("109");

    @Autowired
    private CustomRoleService customRoleService;

    @Autowired
    private UserAccountAccessGuard userAccountAccessGuard;

    @PostMapping
    public ResponseEntity<CustomRoleDTO> createCustomRole(@PathVariable String instituteId,
            @RequestBody CreateRoleDTO createRoleDTO,
            @RequestAttribute("user") CustomUserDetails user) {
        requireCanCreate(user, instituteId, createRoleDTO == null ? null : createRoleDTO.getPermissionIds());
        return ResponseEntity.ok(customRoleService.createCustomRole(instituteId, createRoleDTO));
    }

    @PutMapping("/{roleId}")
    public ResponseEntity<CustomRoleDTO> updateCustomRole(@PathVariable String instituteId,
            @PathVariable String roleId,
            @RequestBody UpdateRoleDTO updateRoleDTO,
            @RequestAttribute("user") CustomUserDetails user) {
        userAccountAccessGuard.requireAdminOf(user, instituteId);
        return ResponseEntity.ok(customRoleService.updateCustomRole(instituteId, roleId, updateRoleDTO));
    }

    @DeleteMapping("/{roleId}")
    public ResponseEntity<Void> deleteCustomRole(@PathVariable String instituteId,
            @PathVariable String roleId,
            @RequestAttribute("user") CustomUserDetails user) {
        userAccountAccessGuard.requireAdminOf(user, instituteId);
        customRoleService.deleteCustomRole(instituteId, roleId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping
    public ResponseEntity<List<CustomRoleDTO>> getRolesForInstitute(@PathVariable String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        userAccountAccessGuard.requireMemberOf(user, instituteId);
        return ResponseEntity.ok(customRoleService.getRolesForInstitute(instituteId));
    }

    private void requireCanCreate(CustomUserDetails user, String instituteId, List<String> permissionIds) {
        if (userAccountAccessGuard.isAdminOf(user, instituteId)) {
            return;
        }
        userAccountAccessGuard.requireStaffOf(user, instituteId);
        boolean onlyAllowed = permissionIds == null || permissionIds.stream()
                .filter(Objects::nonNull)
                .allMatch(NON_ADMIN_CREATABLE_PERMISSION_IDS::contains);
        if (!onlyAllowed) {
            throw new VacademyException(HttpStatus.FORBIDDEN,
                    "Only an admin of this institute can create a role with these permissions");
        }
    }
}
