package vacademy.io.assessment_service.features.proctoring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.proctoring.dto.AttemptProctorReviewDTO;
import vacademy.io.assessment_service.features.proctoring.dto.AttemptProctorSummaryDTO;
import vacademy.io.assessment_service.features.proctoring.service.ProctorEventService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/** Reviewer-side proctoring: the timeline for one attempt, flag counts for a page of attempts. */
@RestController
@RequestMapping("/assessment-service/assessment/admin/proctoring")
public class AdminProctoringController {

    private final ProctorEventService proctorEventService;

    public AdminProctoringController(ProctorEventService proctorEventService) {
        this.proctorEventService = proctorEventService;
    }

    @GetMapping("/attempt/{attemptId}")
    public ResponseEntity<AttemptProctorReviewDTO> review(@RequestAttribute("user") CustomUserDetails user,
                                                          @PathVariable("attemptId") String attemptId,
                                                          @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(proctorEventService.review(attemptId, instituteId));
    }

    @PostMapping("/summaries")
    public ResponseEntity<List<AttemptProctorSummaryDTO>> summaries(@RequestAttribute("user") CustomUserDetails user,
                                                                    @RequestParam("assessmentId") String assessmentId,
                                                                    @RequestParam("instituteId") String instituteId,
                                                                    @RequestBody List<String> attemptIds) {
        return ResponseEntity.ok(proctorEventService.summaries(assessmentId, instituteId, attemptIds));
    }
}
