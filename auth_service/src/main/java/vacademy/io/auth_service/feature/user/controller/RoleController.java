package vacademy.io.auth_service.feature.user.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.user.dto.ModifyUserRolesDTO;
import vacademy.io.auth_service.feature.user.dto.UserRoleFilterDTO;
import vacademy.io.auth_service.feature.user.service.AdminRoleGrantGuard;
import vacademy.io.auth_service.feature.user.service.RoleService;
import vacademy.io.auth_service.feature.user.service.UserAccountAccessGuard;
import vacademy.io.common.auth.dto.PagedUserWithRolesResponse;
import vacademy.io.common.auth.dto.RoleCountProjection;
import vacademy.io.common.auth.dto.UserWithRolesDTO;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

@RestController
@RequestMapping("auth-service/v1/user-roles")
public class RoleController {

    private final RoleService roleService;
    private final AdminRoleGrantGuard adminRoleGrantGuard;
    private final UserAccountAccessGuard userAccountAccessGuard;

    public RoleController(RoleService roleService, AdminRoleGrantGuard adminRoleGrantGuard,
                          UserAccountAccessGuard userAccountAccessGuard) {
        this.roleService = roleService;
        this.adminRoleGrantGuard = adminRoleGrantGuard;
        this.userAccountAccessGuard = userAccountAccessGuard;
    }

    @PostMapping("/add-user-roles")
    public ResponseEntity<String> addRolesToUser(
            @RequestBody ModifyUserRolesDTO addRolesToUserDTO,
            @RequestAttribute("user") CustomUserDetails customUserDetails) {

        // Without this anyone could make themselves staff (e.g. TEACHER) of any institute,
        // which is what the account guards treat as "may see this institute's learner logins".
        userAccountAccessGuard.requireStaffOf(customUserDetails, addRolesToUserDTO.getInstituteId());
        adminRoleGrantGuard.requireAdminToGrantAdmin(customUserDetails, addRolesToUserDTO.getInstituteId(),
                addRolesToUserDTO.getRoles());
        String response = roleService.addRolesToUser(addRolesToUserDTO, Optional.of(UserRoleStatus.ACTIVE.name()), customUserDetails);
        return ResponseEntity.ok(response);
    }

    @DeleteMapping("/remove-user-roles")
    public ResponseEntity<String> removeUserRoles(
            @RequestBody ModifyUserRolesDTO removeUserRolesDTO,
            @RequestAttribute("user") CustomUserDetails customUserDetails) {

        // Same bar as adding roles: staff of the institute, and an admin there to take ADMIN
        // away. Without it any signed-in user could strip anyone's roles.
        userAccountAccessGuard.requireStaffOf(customUserDetails, removeUserRolesDTO.getInstituteId());
        adminRoleGrantGuard.requireAdminToRemoveAdmin(customUserDetails, removeUserRolesDTO.getInstituteId(),
                removeUserRolesDTO.getRoles());
        String response = roleService.removeRolesFromUser(removeUserRolesDTO, customUserDetails);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/user-roles-count")
    public ResponseEntity<List<RoleCountProjection>> getRolesCountByInstituteId(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails userDetails) {

        List<RoleCountProjection> roleCounts = roleService.geRolesCountByInstituteId(instituteId, userDetails);
        return ResponseEntity.ok(roleCounts);
    }

    @PostMapping("/users-of-status")
    public ResponseEntity<PagedUserWithRolesResponse> getUsersOfStatus(@RequestBody UserRoleFilterDTO filterDTO,
            @RequestParam String instituteId,
            @RequestParam(required = false) Integer pageNumber,
            @RequestParam(required = false) Integer pageSize,
            @RequestAttribute("user") CustomUserDetails customUserDetails) {

        // Override DTO values if query params are provided
        if (pageNumber != null) {
            filterDTO.setPageNumber(pageNumber);
        }
        if (pageSize != null) {
            filterDTO.setPageSize(pageSize);
        }

        PagedUserWithRolesResponse response = roleService.getUsersByInstituteIdAndStatusPaged(instituteId, filterDTO,
                customUserDetails);
        hidePasswordsCallerMayNotSee(response, customUserDetails);
        return ResponseEntity.ok(response);
    }

    /**
     * The listing carries each member's plaintext password for the Teams login column. Keep
     * it only where the caller could read it through user-credentials/{userId} (so never a
     * colleague's unless the caller is ADMIN wherever that colleague is staff); the rows
     * themselves are unchanged, and the UI hides the column for a row without a password.
     */
    private void hidePasswordsCallerMayNotSee(PagedUserWithRolesResponse response, CustomUserDetails caller) {
        if (response == null || response.getContent() == null || response.getContent().isEmpty()) {
            return;
        }
        List<String> ids = response.getContent().stream().map(UserWithRolesDTO::getId).filter(Objects::nonNull).toList();
        Set<String> visible = userAccountAccessGuard.loginsCallerMayView(caller, ids);
        for (UserWithRolesDTO row : response.getContent()) {
            if (row.getId() == null || !visible.contains(row.getId())) {
                row.setPassword(null);
            }
        }
    }

    @PutMapping("/update-role-status")
    public ResponseEntity<String> updateUserRoleStatus(@RequestParam String instituteId,
                                                       @RequestBody List<String> userIds,
                                                       @RequestParam String status,
                                                       @RequestAttribute("user") CustomUserDetails customUserDetails) {
        // A member may delete their own rows (the learner app's "delete my account");
        // anyone else's need staff of the institute, and an admin there for an admin.
        userAccountAccessGuard.requireCanChangeRoleStatus(customUserDetails, instituteId, userIds, status);
        String response = roleService.updateUserRoleStatusByInstituteIdAndUserId(status, instituteId, userIds, customUserDetails);
        return ResponseEntity.ok(response);
    }
}
