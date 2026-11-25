package vacademy.io.admin_core_service.features.syllabus_progress.controller;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.syllabus_progress.service.SyllabusProgressService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;

/**
 * Syllabus progress. Staff of the institute read a batch's grid and mark weeks for learners; a
 * learner reads only their own progress (taken from the token). Off per institute.
 */
@RestController
@RequestMapping("/admin-core-service/syllabus-progress")
@RequiredArgsConstructor
public class SyllabusProgressController {

    private final SyllabusProgressService service;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/v1/batches")
    public ResponseEntity<Map<String, Object>> batches(@RequestParam("instituteId") String instituteId,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        boolean enabled = service.isEnabled(instituteId);
        return ResponseEntity.ok(Map.of("enabled", enabled, "batches", enabled ? service.batches(instituteId) : List.of()));
    }

    @GetMapping("/v1/batch")
    public ResponseEntity<Map<String, Object>> batch(@RequestParam("instituteId") String instituteId,
                                                     @RequestParam("packageSessionId") String packageSessionId,
                                                     @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        requireEnabled(instituteId);
        return ResponseEntity.ok(service.batch(instituteId, packageSessionId));
    }

    @PostMapping("/v1/mark")
    public ResponseEntity<Map<String, Object>> mark(@RequestParam("instituteId") String instituteId,
                                                    @RequestBody MarkRequest req,
                                                    @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        requireEnabled(instituteId);
        int n = service.mark(instituteId, req.getPackageSessionId(), req.getBlockIds(), req.getUserIds(), req.getStatus(),
                req.getPointsDone(), req.getNote(), user.getUserId(), user.getFullName());
        return ResponseEntity.ok(Map.of("updated", n));
    }

    @GetMapping("/learner/v1/mine")
    public ResponseEntity<Map<String, Object>> mine(@RequestParam("instituteId") String instituteId,
                                                    @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.mine(instituteId, user.getUserId()));
    }

    private void requireEnabled(String instituteId) {
        if (!service.isEnabled(instituteId)) throw new VacademyException("Syllabus progress is not switched on for this institute");
    }

    @Data
    public static class MarkRequest {
        @JsonProperty("package_session_id") private String packageSessionId;
        @JsonProperty("block_ids") private List<String> blockIds;
        @JsonProperty("user_ids") private List<String> userIds;
        @JsonProperty("status") private String status;
        @JsonProperty("points_done") private List<Integer> pointsDone;
        @JsonProperty("note") private String note;
    }
}
