package vacademy.io.admin_core_service.features.slide_engagement;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * "Count as engagement" on course slides. Staff set it per slide; the learner (always the
 * token holder) claims the points after completing the slide. See {@link SlideEngagementService}.
 */
@RestController
@RequiredArgsConstructor
public class SlideEngagementController {

    private static final String ADMIN = "/admin-core-service/slide-activity/admin/v1/engagement";
    private static final String LEARNER = "/admin-core-service/slide-activity/learner/v1/engagement";

    private final SlideEngagementService service;

    public record SetBody(String slideId, Boolean enabled, Integer points) {}

    public record ClaimBody(String slideId, String packageSessionId) {}

    @GetMapping(ADMIN)
    public ResponseEntity<SlideEngagementService.AdminView> get(@RequestParam String slideId,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.adminGet(user, instituteId, slideId));
    }

    @PutMapping(ADMIN)
    public ResponseEntity<SlideEngagementService.AdminView> set(@RequestParam String instituteId,
            @RequestBody SetBody body,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.adminSet(user, instituteId, body.slideId(), body.enabled(), body.points()));
    }

    /** Idempotent: pays at most once per learner and slide, and only for a completion the server sees. */
    @PostMapping(LEARNER + "/claim")
    public ResponseEntity<SlideEngagementService.LearnerView> claim(@RequestBody ClaimBody body,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.claim(user, body.slideId(), body.packageSessionId()));
    }
}
