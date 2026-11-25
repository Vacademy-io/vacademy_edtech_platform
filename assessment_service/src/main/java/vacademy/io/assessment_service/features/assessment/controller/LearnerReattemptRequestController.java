package vacademy.io.assessment_service.features.assessment.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.assessment.dto.reattempt.CreateReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.reattempt.ReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentReattemptRequestManager;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/** The learner side of "Request Reattempt", "Request Time Increase" and "Report a problem" in the live exam shell. */
@RestController
@RequestMapping("/assessment-service/learner/reattempt-request/v1")
public class LearnerReattemptRequestController {

    @Autowired
    private AssessmentReattemptRequestManager reattemptRequestManager;

    @PostMapping
    public ResponseEntity<ReattemptRequestDto> create(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestBody CreateReattemptRequestDto request) {
        return ResponseEntity.ok(reattemptRequestManager.createRequest(user, request));
    }

    /** Lets the dialog show "already requested — waiting on your institute" instead of a fresh form. */
    @GetMapping("/mine")
    public ResponseEntity<List<ReattemptRequestDto>> mine(@RequestAttribute("user") CustomUserDetails user,
                                                          @RequestParam("assessmentId") String assessmentId) {
        return ResponseEntity.ok(reattemptRequestManager.myRequests(user, assessmentId));
    }
}
