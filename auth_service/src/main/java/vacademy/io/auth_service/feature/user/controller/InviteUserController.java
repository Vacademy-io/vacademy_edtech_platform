package vacademy.io.auth_service.feature.user.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.user.service.AdminRoleGrantGuard;
import vacademy.io.auth_service.feature.user.service.InviteUserService;
import vacademy.io.auth_service.feature.user.service.UserAccountAccessGuard;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.UserService;

@RestController
@RequestMapping("auth-service/v1/user-invitation")
@RequiredArgsConstructor
public class InviteUserController {

    private final InviteUserService inviteUserService;
    private final AdminRoleGrantGuard adminRoleGrantGuard;
    private final UserAccountAccessGuard userAccountAccessGuard;
    private final UserService userService;

    @PostMapping("/invite")
    public ResponseEntity<UserDTO> inviteUser(@RequestBody UserDTO userDTO,
                                             @RequestParam String instituteId,
                                             @RequestAttribute("user") CustomUserDetails customUserDetails) {
        // Without this anyone could invite themselves into any institute as staff.
        userAccountAccessGuard.requireStaffOf(customUserDetails, instituteId);
        adminRoleGrantGuard.requireAdminToGrantAdmin(customUserDetails, instituteId, userDTO.getRoles());
        UserDTO response = inviteUserService.inviteUser(userDTO, instituteId);
        return ResponseEntity.ok(response);
    }


    /**
     * "Resend login details". The institute is the one the email is branded as and whose roles
     * it lists; the caller must be its staff and the member must belong to it. Dashboards
     * built before the instituteId param send only the clientId header the axios client always
     * attaches, so that is the fallback.
     */
    @PostMapping("/resend-invitation")
    public ResponseEntity<String> resendInvitation(@RequestParam String userId,
                                                   @RequestParam(required = false) String instituteId,
                                                   @RequestHeader(value = "clientId", required = false) String clientId,
                                                   @RequestAttribute("user") CustomUserDetails customUserDetails) {
        String institute = StringUtils.hasText(instituteId) ? instituteId : clientId;
        userAccountAccessGuard.requireCanResendLogin(customUserDetails, institute, userId);
        String response = inviteUserService.resendInvitation(userId, institute, customUserDetails);
        return ResponseEntity.ok(response);
    }

    @PutMapping("/update")
    public ResponseEntity<String> updateInvitationUser(@RequestBody UserDTO user,
                                                       @RequestParam String instituteId,
                                                       @RequestAttribute("user") CustomUserDetails customUserDetails) {
        // The user id is from the body and the reminder sent afterwards mails that user's
        // username and password to the (possibly new) email: staff of this institute only, and
        // no moving the email of someone who also belongs to an institute the caller can't administer.
        userAccountAccessGuard.requireCanUpdateInvitation(customUserDetails, instituteId, user.getId(),
                () -> emailChanges(user));
        adminRoleGrantGuard.requireAdminToGrantAdmin(customUserDetails, instituteId, user.getRoles());
        String response = inviteUserService.updateInvitationUser(user, instituteId, customUserDetails);
        return ResponseEntity.ok(response);
    }

    /** Mirrors InviteUserService.updateUserDetails, which writes any non-empty email. */
    private boolean emailChanges(UserDTO user) {
        String newEmail = user.getEmail();
        if (newEmail == null || newEmail.isEmpty() || user.getId() == null || user.getId().isBlank()) {
            return false;
        }
        String current = userService.getUserById(user.getId()).getEmail();
        return current == null || !newEmail.trim().equalsIgnoreCase(current.trim());
    }
}
