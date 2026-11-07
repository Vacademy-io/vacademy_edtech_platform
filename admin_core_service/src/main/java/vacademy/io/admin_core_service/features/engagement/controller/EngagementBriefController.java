package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.engagement.dto.BriefDraftRequest;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.admin_core_service.features.engagement.templates.EngagementBriefDrafter;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * The brief a new engine starts from: the description of the Lead Agent behind its lead lists, or
 * a draft the AI writes from the objective, product and website. Institute-ADMIN gated.
 */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/brief")
@RequiredArgsConstructor
public class EngagementBriefController {

    private static final int MAX_LISTS = 50;

    private final EngagementBriefDrafter drafter;
    private final EngagementAccessGuard accessGuard;

    /** The Lead Agents of the picked lead lists (comma separated ids) that describe what they sell. */
    @GetMapping("/lead-agents")
    public ResponseEntity<List<EngagementBriefDrafter.LeadAgentBrief>> leadAgents(
            @RequestParam String instituteId,
            @RequestParam String audienceIds,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        List<String> ids = Arrays.stream(audienceIds.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                .distinct().limit(MAX_LISTS).toList();
        return ResponseEntity.ok(drafter.fromLeadAgents(instituteId, ids));
    }

    /** Write a draft brief with the AI from what the admin gave (see {@link BriefDraftRequest}). */
    @PostMapping("/generate")
    public ResponseEntity<Map<String, String>> generate(
            @RequestParam String instituteId,
            @RequestBody BriefDraftRequest req,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        return ResponseEntity.ok(Map.of("brief", drafter.generate(instituteId, req)));
    }
}
