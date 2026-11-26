package vacademy.io.assessment_service.features.open_registration.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.open_registration.dto.GetAssessmentPublicResponseDto;
import vacademy.io.assessment_service.features.open_registration.dto.ParticipantPublicResponseDto;
import vacademy.io.assessment_service.features.open_registration.manager.AssessmentPublicPageManager;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

@RestController
@RequestMapping("/assessment-service/open-registrations/v1")
public class GetPageDetailsController {

    @Autowired
    AssessmentPublicPageManager assessmentPublicPageManager;


    @GetMapping("/assessment-page")
    public ResponseEntity<GetAssessmentPublicResponseDto> getAssessmentPage(@RequestParam("code") String code) {
        return assessmentPublicPageManager.getAssessmentPage(code);
    }

    @GetMapping("/participant-status")
    public ResponseEntity<ParticipantPublicResponseDto> getParticipantStatus(@RequestParam("assessmentId") String assessmentId, @RequestParam("instituteId") String instituteId, @RequestParam("userId") String userId, @RequestParam(value = "psIds", required = false) String psIds) {
        return assessmentPublicPageManager.getParticipantStatus(assessmentId, instituteId, userId, psIds);
    }

    /**
     * The signed-in learner's answers from their earlier registrations in this
     * institute (field key to answer), used to fill the same fields on the next
     * registration form. Authenticated; never returns another user's answers.
     */
    @GetMapping("/my-earlier-answers")
    public ResponseEntity<Map<String, String>> getMyEarlierAnswers(@RequestAttribute("user") CustomUserDetails user,
                                                                   @RequestParam("instituteId") String instituteId) {
        return assessmentPublicPageManager.getMyEarlierAnswers(user.getUserId(), instituteId);
    }

    /**
     * The learner verified their email (OTP) after registering: send the "You're registered"
     * email now. Authenticated — the registration is looked up for the signed-in user only.
     */
    @PostMapping("/registration-verified")
    public ResponseEntity<String> registrationVerified(@RequestAttribute("user") CustomUserDetails user,
                                                       @RequestParam("assessmentId") String assessmentId) {
        return assessmentPublicPageManager.confirmVerifiedRegistration(user.getUserId(), assessmentId);
    }
}
