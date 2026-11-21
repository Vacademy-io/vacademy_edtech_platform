package vacademy.io.assessment_service.features.assessment.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.assessment.dto.reattempt.ReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.reattempt.ReviewReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentReattemptRequestManager;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/** The admin inbox for learner reattempt / time-extension requests. */
@RestController
@RequestMapping("/assessment-service/admin/reattempt-request/v1")
public class AdminReattemptRequestController {

    @Autowired
    private AssessmentReattemptRequestManager reattemptRequestManager;

    /**
     * @param assessmentId optional — omit for the institute-wide inbox
     * @param status       optional, repeatable; defaults to every status
     */
    @GetMapping("/list")
    public ResponseEntity<Page<ReattemptRequestDto>> list(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestParam("instituteId") String instituteId,
                                                          @RequestParam(value = "assessmentId", required = false) String assessmentId,
                                                          @RequestParam(value = "status", required = false) List<String> status,
                                                          @RequestParam(value = "page", defaultValue = "0") int page,
                                                          @RequestParam(value = "size", defaultValue = "25") int size) {
        return ResponseEntity.ok(reattemptRequestManager.listForAdmin(instituteId, assessmentId, status, page, size));
    }

    /**
     * Badge count for the admin nav — the "system alert" that requests are waiting.
     *
     * @param assessmentId optional — omit for the institute-wide badge, pass it for a badge that
     *                     sits on one assessment's tab
     */
    @GetMapping("/pending-count")
    public ResponseEntity<Long> pendingCount(@RequestAttribute("user") CustomUserDetails user,
                                              @RequestParam("instituteId") String instituteId,
                                              @RequestParam(value = "assessmentId", required = false) String assessmentId) {
        return ResponseEntity.ok(reattemptRequestManager.pendingCount(instituteId, assessmentId));
    }

    /** Approve (granting {@code granted_count} attempts) or reject one request. */
    @PostMapping("/{requestId}/review")
    public ResponseEntity<ReattemptRequestDto> review(@RequestAttribute("user") CustomUserDetails user,
                                                       @PathVariable("requestId") String requestId,
                                                       @RequestParam("instituteId") String instituteId,
                                                       @RequestBody ReviewReattemptRequestDto request) {
        return ResponseEntity.ok(reattemptRequestManager.review(user, requestId, instituteId, request));
    }
}
