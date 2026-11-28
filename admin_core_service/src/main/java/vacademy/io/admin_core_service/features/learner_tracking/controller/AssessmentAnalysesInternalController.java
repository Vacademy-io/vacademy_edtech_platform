package vacademy.io.admin_core_service.features.learner_tracking.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.service.CopyCheckAnalysisService;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Service-to-service: the AI analyses of a bulk AI check's copies, made when a report asks
 * for them. Guarded by the HMAC {@code /admin-core-service/internal/**} matcher. Only the
 * learners assessment_service names are ever processed here.
 */
@RestController
@RequestMapping("/admin-core-service/internal/llm-analytics/copy-check")
@RequiredArgsConstructor
public class AssessmentAnalysesInternalController {

    private final CopyCheckAnalysisService copyCheckAnalysisService;

    /** Each learner's newest live analysis-row status (a learner missing here has no row). */
    @GetMapping("/state")
    public ResponseEntity<Map<String, Object>> state(@RequestParam("sourceId") String sourceId) {
        return ResponseEntity.ok(Map.of("newest_status_by_user", copyCheckAnalysisService.newestStatusByUser(sourceId)));
    }

    /** One learner's newest live analysis-row status; absent when the learner has no row. */
    @GetMapping("/state/user")
    public ResponseEntity<Map<String, Object>> userState(@RequestParam("userId") String userId,
                                                         @RequestParam("sourceId") String sourceId) {
        Map<String, Object> out = new LinkedHashMap<>();
        String status = copyCheckAnalysisService.newestStatus(userId, sourceId);
        if (status != null) {
            out.put("newest_status", status);
        }
        return ResponseEntity.ok(out);
    }

    /** Starts making the named learners' analyses (spends AI credits, each at most once). */
    @PostMapping("/process")
    public ResponseEntity<Map<String, Object>> process(@RequestParam("sourceId") String sourceId,
                                                       @RequestBody Map<String, List<String>> body) {
        List<String> userIds = body != null && body.get("user_ids") != null ? body.get("user_ids") : List.of();
        return ResponseEntity.ok(Map.of("queued", copyCheckAnalysisService.processAsync(sourceId, userIds)));
    }

    /**
     * Makes one learner's analysis now (spends AI credits). Same reply shape as
     * process-on-demand: {@code status} and, once made, {@code processed_json}.
     */
    @PostMapping("/process/user")
    public ResponseEntity<Map<String, Object>> processUser(@RequestParam("userId") String userId,
                                                           @RequestParam("sourceId") String sourceId) {
        Optional<ActivityLog> row = copyCheckAnalysisService.processNow(userId, sourceId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", row.map(ActivityLog::getStatus).orElse("not_found"));
        row.map(ActivityLog::getProcessedJson).ifPresent(json -> out.put("processed_json", json));
        return ResponseEntity.ok(out);
    }
}
