package vacademy.io.admin_core_service.features.engagement.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.admin_core_service.features.engagement.service.EngagementCoordinationDao;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * B5: the per-lead "do not automate" flag. With it set, engagement engines still read the lead
 * and draft for the inbox, but never send to it on their own. The toggle on the lead side panel
 * (B8) calls this.
 */
@RestController
@RequestMapping("/admin-core-service/v1/engagement/leads")
@RequiredArgsConstructor
public class EngagementLeadFlagController {

    private final EngagementAccessGuard accessGuard;
    private final EngagementCoordinationDao dao;

    @GetMapping("/{leadId}/automation")
    public ResponseEntity<Map<String, Object>> get(@PathVariable String leadId,
                                                   @RequestParam String instituteId,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        if (!dao.leadInInstitute(instituteId, leadId)) return ResponseEntity.notFound().build();
        boolean flagged = dao.doNotAutomate(instituteId, List.of(leadId)).contains(leadId);
        return ResponseEntity.ok(Map.of("leadId", leadId, "doNotAutomate", flagged));
    }

    /** Body: {@code {"doNotAutomate": true|false}}. */
    @PutMapping("/{leadId}/automation")
    public ResponseEntity<Map<String, Object>> set(@PathVariable String leadId,
                                                   @RequestParam String instituteId,
                                                   @RequestBody Map<String, Object> body,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.requireAdmin(user, instituteId);
        if (!(body.get("doNotAutomate") instanceof Boolean value)) {
            return ResponseEntity.badRequest().body(Map.of("error", "doNotAutomate must be true or false"));
        }
        if (!dao.leadInInstitute(instituteId, leadId)) return ResponseEntity.notFound().build();
        dao.setDoNotAutomate(instituteId, leadId, value, user.getUserId(), Instant.now());
        return ResponseEntity.ok(Map.of("leadId", leadId, "doNotAutomate", value));
    }
}
