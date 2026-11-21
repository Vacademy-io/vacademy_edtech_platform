package vacademy.io.admin_core_service.features.telephony.controller;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.telephony.core.AiCallCampaignService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

/**
 * Bulk "AI calls first" for an audience list. Authenticated admin/counsellor
 * action. Returns immediately after validating + counting; the per-lead calls are
 * placed on a paced background pool, and each lead's outcome → counsellor
 * assignment is handled asynchronously by the end-of-call webhook +
 * AiCallOutcomeProcessor.
 *
 *   POST /admin-core-service/v1/telephony/ai-call/campaign/{audienceId}?instituteId=
 *   → { total, eligible, dispatched, message }
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/ai-call/campaign")
@RequiredArgsConstructor
public class AiCallCampaignController {

    private final AiCallCampaignService campaignService;
    private final InstituteAccessValidator instituteAccessValidator;

    @Data
    public static class StartBody {
        /** Optional: call ONLY these audience responses (the checked rows). */
        private List<String> responseIds;
        /** Calls in parallel, 1..MAX_PARALLEL; null/absent = 1 (sequential-by-completion). */
        private Integer parallel;
    }

    @PostMapping("/{audienceId}")
    public ResponseEntity<AiCallCampaignService.StartResult> start(
            @PathVariable String audienceId,
            @RequestParam String instituteId,
            @RequestParam(value = "dryRun", defaultValue = "false") boolean dryRun,
            @RequestParam(value = "campaignId", required = false) String campaignId,
            @RequestParam(value = "preferredNumberId", required = false) String preferredNumberId,
            @RequestBody(required = false) StartBody body,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(campaignService.startForAudience(
                instituteId, audienceId, dryRun, campaignId, preferredNumberId,
                body == null ? null : body.getResponseIds(),
                body == null ? null : body.getParallel(),
                user == null ? null : user.getUserId()));
    }

    /** Live per-lead call statuses for the progress dialog (polled every few seconds). */
    @GetMapping("/{audienceId}/status")
    public ResponseEntity<List<Map<String, Object>>> status(
            @PathVariable String audienceId,
            @RequestParam String instituteId,
            @RequestParam("sinceEpochMs") long sinceEpochMs,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(campaignService.campaignCallStatuses(
                instituteId, audienceId, sinceEpochMs));
    }
}
