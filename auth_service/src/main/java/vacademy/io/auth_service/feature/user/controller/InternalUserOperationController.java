package vacademy.io.auth_service.feature.user.controller;


import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.user.dto.CredentialShareResult;
import vacademy.io.auth_service.feature.user.service.UserOperationService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/auth-service/internal/v1/user-operation")
public class InternalUserOperationController {

    @Autowired
    private UserOperationService userOperationService;

    @PostMapping("/send-passwords")
    public ResponseEntity<String> sendUserPasswords(
        @RequestBody List<String> userIds) {
        return ResponseEntity.ok(userOperationService.sendUserPasswords(userIds));
    }

    /**
     * Re-sends one user's current login details, branded for {@code instituteId}, with the
     * sign-in button pointing at {@code loginUrl} (defaults to the institute's admin portal).
     * Reads only — nothing about the user changes. Used by admin-core's Manage VLEs
     * "Share credentials" action.
     */
    @PostMapping("/resend-login-details")
    public ResponseEntity<CredentialShareResult> resendLoginDetails(
            @RequestParam String userId,
            @RequestParam(required = false) String instituteId,
            @RequestParam(required = false) String loginUrl) {
        return ResponseEntity.ok(userOperationService.resendLoginDetails(userId, instituteId, loginUrl));
    }
}
