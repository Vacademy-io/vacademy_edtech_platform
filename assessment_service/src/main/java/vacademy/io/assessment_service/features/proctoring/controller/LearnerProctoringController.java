package vacademy.io.assessment_service.features.proctoring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.proctoring.dto.ProctorEventBatchRequest;
import vacademy.io.assessment_service.features.proctoring.dto.ProctorEventBatchResponse;
import vacademy.io.assessment_service.features.proctoring.dto.ProctoringConfigDTO;
import vacademy.io.assessment_service.features.proctoring.service.ProctorEventService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Learner-side proctoring: read the assessment's config, report device signals.
 * Authenticated (falls through to anyRequest().authenticated()); ownership of the
 * attempt is enforced in the service.
 */
@RestController
@RequestMapping("/assessment-service/assessment/learner/proctoring")
public class LearnerProctoringController {

    private final ProctorEventService proctorEventService;

    public LearnerProctoringController(ProctorEventService proctorEventService) {
        this.proctorEventService = proctorEventService;
    }

    /** Effective config, defaults filled. {@code tier: "NONE"} for every unproctored assessment. */
    @GetMapping("/config")
    public ResponseEntity<ProctoringConfigDTO> config(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam("assessmentId") String assessmentId) {
        return ResponseEntity.ok(proctorEventService.configForLearner(assessmentId));
    }

    @PostMapping("/events")
    public ResponseEntity<ProctorEventBatchResponse> events(@RequestAttribute("user") CustomUserDetails user,
                                                            @RequestParam("attemptId") String attemptId,
                                                            @RequestBody ProctorEventBatchRequest request) {
        return ResponseEntity.ok(proctorEventService.record(user, attemptId, request));
    }
}
