package vacademy.io.admin_core_service.features.syllabus_progress.controller;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.engagement.planning.EngagementTeacherScope;
import vacademy.io.admin_core_service.features.syllabus_progress.service.SyllabusProgressService;
import vacademy.io.admin_core_service.features.syllabus_progress.service.SyllabusScope;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;

/**
 * Syllabus progress. Staff of the institute read a batch's grid and mark weeks for learners; a
 * learner reads only their own progress (taken from the token). Off per institute.
 *
 * <p>Staff scope: an institute ADMIN sees every batch; any other staff member (a TEACHER) sees
 * and marks only the batches assigned to them in faculty_subject_package_session_mapping.
 */
@RestController
@RequestMapping("/admin-core-service/syllabus-progress")
@RequiredArgsConstructor
public class SyllabusProgressController {

    private final SyllabusProgressService service;
    private final InstituteAccessValidator instituteAccessValidator;
    private final EngagementTeacherScope teacherScope;

    @GetMapping("/v1/batches")
    public ResponseEntity<Map<String, Object>> batches(@RequestParam("instituteId") String instituteId,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        boolean enabled = service.isEnabled(instituteId);
        if (!enabled) return ResponseEntity.ok(Map.of("enabled", false, "batches", List.of()));
        SyllabusScope scope = scopeOf(user, instituteId);
        return ResponseEntity.ok(Map.of("enabled", true, "scope", scope.name(), "batches", service.batches(instituteId, scope)));
    }

    @GetMapping("/v1/batch")
    public ResponseEntity<Map<String, Object>> batch(@RequestParam("instituteId") String instituteId,
                                                     @RequestParam("packageSessionId") String packageSessionId,
                                                     @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        requireEnabled(instituteId);
        SyllabusProgressService.requireInScope(scopeOf(user, instituteId), packageSessionId);
        return ResponseEntity.ok(service.batch(instituteId, packageSessionId));
    }

    @PostMapping("/v1/mark")
    public ResponseEntity<Map<String, Object>> mark(@RequestParam("instituteId") String instituteId,
                                                    @RequestBody MarkRequest req,
                                                    @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        requireEnabled(instituteId);
        SyllabusProgressService.requireInScope(scopeOf(user, instituteId), req.getPackageSessionId());
        int n = service.mark(instituteId, req.getPackageSessionId(), req.getBlockIds(), req.getUserIds(), req.getStatus(),
                req.getPointsDone(), req.getNote(), user.getUserId(), user.getFullName());
        return ResponseEntity.ok(Map.of("updated", n));
    }

    /** Learners matching {@code q} (name, username or enrolment number), within the caller's batches. */
    @GetMapping("/v1/learners")
    public ResponseEntity<Map<String, Object>> learners(@RequestParam("instituteId") String instituteId,
                                                        @RequestParam("q") String q,
                                                        @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        requireEnabled(instituteId);
        return ResponseEntity.ok(Map.of("learners", service.searchLearners(instituteId, q, scopeOf(user, instituteId), 20)));
    }

    /** One learner's progress across their batches (only the caller's batches for a teacher). */
    @GetMapping("/v1/learner")
    public ResponseEntity<Map<String, Object>> learner(@RequestParam("instituteId") String instituteId,
                                                       @RequestParam("userId") String userId,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        requireEnabled(instituteId);
        return ResponseEntity.ok(service.learner(instituteId, userId, scopeOf(user, instituteId)));
    }

    @GetMapping("/learner/v1/mine")
    public ResponseEntity<Map<String, Object>> mine(@RequestParam("instituteId") String instituteId,
                                                    @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.mine(instituteId, user.getUserId()));
    }

    /** ADMIN (or root) → every batch; any other staff → the batches they teach. */
    private SyllabusScope scopeOf(CustomUserDetails user, String instituteId) {
        return SyllabusScope.of(instituteAccessValidator.isInstituteAdmin(user),
                () -> teacherScope.cohortsOf(user.getUserId(), instituteId));
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
