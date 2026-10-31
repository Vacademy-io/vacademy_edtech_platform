package vacademy.io.auth_service.feature.user.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.auth_service.feature.user.dto.CredentialShareResult;
import vacademy.io.auth_service.feature.user.service.UserAccountAccessGuard;
import vacademy.io.auth_service.feature.user.service.UserOperationService;
import vacademy.io.common.auth.dto.UserCredentials;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/auth-service/v1/user-operation")
public class UserOperationController {

    @Autowired
    private UserOperationService userOperationService;

    @Autowired
    private UserAccountAccessGuard userAccountAccessGuard;

    /**
     * Shares login credentials with the given learners.
     *
     * <p>Answers with counts, not a sentence. Every failure mode here still returns 200 — no
     * such user, no email/username/password on file, the mail rejected downstream — so a caller
     * that reads the status code alone cannot tell a full send from one that mailed nobody, and
     * the dashboard reported success either way. The internal route keeps its plain-string reply
     * for callers that only fire-and-forget.
     */
    @PostMapping("/send-passwords")
    public ResponseEntity<CredentialShareResult> sendUserPasswords(
            @RequestBody List<String> userIds,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(userOperationService.shareUserPasswords(userIds, userDetails));
    }

    @PostMapping("/update-password")
    public ResponseEntity<String> updatePassword(
            @RequestBody UserCredentials userCredentials,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        // The target is from the body: the user, a super-admin, or staff of their institute
        // (ADMIN when the target is staff anywhere) — not any signed-in user.
        userAccountAccessGuard.requireCanChangeCredentials(userDetails, userCredentials.getUserId());
        return ResponseEntity.ok(userOperationService.updateUserPassword(userCredentials, userDetails));
    }
}
