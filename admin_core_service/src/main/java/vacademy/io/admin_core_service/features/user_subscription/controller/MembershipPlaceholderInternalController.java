package vacademy.io.admin_core_service.features.user_subscription.controller;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.user_subscription.service.MembershipPlaceholderService;

import java.util.List;
import java.util.Map;

/**
 * Membership merge tags for the notification service, which fills {{practice_name}} /
 * {{expiry_date_long}} / {{subscription_link}} (and friends) per recipient in unified sends
 * from the student side view and bulk email, and in announcements.
 */
@RestController
@RequestMapping("/admin-core-service/internal/membership")
@RequiredArgsConstructor
public class MembershipPlaceholderInternalController {

    private final MembershipPlaceholderService membershipPlaceholderService;

    @PostMapping("/placeholders")
    public ResponseEntity<Map<String, Map<String, String>>> placeholders(
            @RequestBody MembershipPlaceholdersRequest request) {
        return ResponseEntity.ok(membershipPlaceholderService.forUsers(
                request.getInstituteId(), request.getUserIds()));
    }

    @Data
    public static class MembershipPlaceholdersRequest {
        private String instituteId;
        private List<String> userIds;
    }
}
