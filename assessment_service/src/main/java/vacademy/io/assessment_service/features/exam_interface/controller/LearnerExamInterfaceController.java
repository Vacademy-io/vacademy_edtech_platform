package vacademy.io.assessment_service.features.exam_interface.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.exam_interface.dto.ExamInterfaceResponse;
import vacademy.io.assessment_service.features.exam_interface.service.ExamInterfaceService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Learner-side read of an assessment's exam interface, for the instruction page that
 * runs before an attempt exists. Authenticated (falls through to
 * anyRequest().authenticated()), like the learner proctoring config read. An unknown
 * assessment id returns exam_interface null, never an error.
 */
@RestController
@RequestMapping("/assessment-service/assessment/learner")
public class LearnerExamInterfaceController {

    private final ExamInterfaceService examInterfaceService;

    public LearnerExamInterfaceController(ExamInterfaceService examInterfaceService) {
        this.examInterfaceService = examInterfaceService;
    }

    @GetMapping("/exam-interface")
    public ResponseEntity<ExamInterfaceResponse> examInterface(@RequestAttribute("user") CustomUserDetails user,
                                                               @RequestParam(name = "assessmentId", required = false) String assessmentId) {
        return ResponseEntity.ok(new ExamInterfaceResponse(assessmentId, examInterfaceService.forLearner(assessmentId)));
    }
}
