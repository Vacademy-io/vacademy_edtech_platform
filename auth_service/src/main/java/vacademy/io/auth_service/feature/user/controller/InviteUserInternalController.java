package vacademy.io.auth_service.feature.user.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.user.service.AdminRoleGrantGuard;
import vacademy.io.auth_service.feature.user.service.InviteUserService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;


@RestController
@RequestMapping("auth-service/internal/v1/user-invitation")
@RequiredArgsConstructor
public class InviteUserInternalController {

    private final InviteUserService inviteUserService;

    @PostMapping("/invite")
    public ResponseEntity<UserDTO> inviteUser(@RequestBody UserDTO userDTO,
                                             @RequestParam String instituteId) {
        AdminRoleGrantGuard.refuseCommerceRolesWithoutCaller(userDTO == null ? null : userDTO.getRoles());
        UserDTO response = inviteUserService.inviteUser(userDTO, instituteId);
        return ResponseEntity.ok(response);
    }
}
