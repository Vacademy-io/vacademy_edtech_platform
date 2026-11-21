package vacademy.io.admin_core_service.features.user_subscription.controller;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.user_subscription.service.ReferralLinkService;

import java.util.List;
import java.util.Map;

/**
 * Members' referral links for the notification service, which fills
 * {{short_referral_link}} / {{referral_link}} / {{referral_code}} per recipient in
 * announcements.
 */
@RestController
@RequestMapping("/admin-core-service/internal/referral")
@RequiredArgsConstructor
public class ReferralLinkInternalController {

    private final ReferralLinkService referralLinkService;

    @PostMapping("/links")
    public ResponseEntity<Map<String, Map<String, String>>> links(@RequestBody ReferralLinksRequest request) {
        return ResponseEntity.ok(referralLinkService.linksFor(
                request.getInstituteId(), request.getUserIds(), request.getEnrollInviteId()));
    }

    @Data
    public static class ReferralLinksRequest {
        private String instituteId;
        private List<String> userIds;
        private String enrollInviteId;
    }
}
