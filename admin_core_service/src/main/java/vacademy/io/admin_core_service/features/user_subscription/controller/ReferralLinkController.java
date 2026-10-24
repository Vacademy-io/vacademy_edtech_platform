package vacademy.io.admin_core_service.features.user_subscription.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.user_subscription.service.ReferralLinkService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

@RestController
@RequestMapping("/admin-core-service/v1/referral-link")
@RequiredArgsConstructor
public class ReferralLinkController {

    private final ReferralLinkService referralLinkService;
    private final InstituteAccessValidator instituteAccessValidator;

    /**
     * Gives every ACTIVE member of the institute a referral code, up to {@code limit} new
     * codes per call. Repeat until {@code remaining} is 0. {@code enrollInviteId} is the
     * invite the members' stored links should open (the trial invite).
     */
    @PostMapping("/backfill")
    public ResponseEntity<Map<String, Integer>> backfill(@RequestParam String instituteId,
                                                         @RequestParam(required = false) String enrollInviteId,
                                                         @RequestParam(required = false) Integer limit,
                                                         @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(referralLinkService.backfill(instituteId, enrollInviteId, limit));
    }
}
