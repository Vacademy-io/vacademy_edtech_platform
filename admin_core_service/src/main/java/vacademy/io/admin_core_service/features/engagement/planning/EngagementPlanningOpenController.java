package vacademy.io.admin_core_service.features.engagement.planning;

import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The weekly planning email's link, no sign-in. The token travels in the body (never the
 * URL path or query) so it stays out of access logs. It reads only its own request's
 * context and can only submit this week's topic.
 */
@RestController
@RequestMapping("/admin-core-service/open/engagement/planning/v1")
@RequiredArgsConstructor
public class EngagementPlanningOpenController {

    private final EngagementPlanningService planningService;

    public record TokenBody(String token) {}

    public record SubmitBody(String token, String topic) {}

    @PostMapping("/view")
    public ResponseEntity<EngagementPlanningService.PlanningView> view(@RequestBody TokenBody body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(planningService.view(body == null ? null : body.token()));
    }

    @PostMapping("/submit")
    public ResponseEntity<EngagementPlanningService.PlanningView> submit(@RequestBody SubmitBody body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(planningService.submit(body == null ? null : body.token(),
                        body == null ? null : body.topic()));
    }
}
