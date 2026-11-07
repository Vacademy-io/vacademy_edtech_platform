package vacademy.io.admin_core_service.features.learner.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.learner.dto.LearnerLmsLandingResponse;
import vacademy.io.admin_core_service.features.learner.service.LearnerLmsLandingService;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/admin-core-service/learner/lms/v1")
@RequiredArgsConstructor
public class LearnerLmsLandingController {

    private final LearnerLmsLandingService learnerLmsLandingService;

    /**
     * Where this learner should be sent when their coursework lives on a connected
     * WordPress/LearnDash site. Called by the learner portal right after a successful
     * password change, while the caller still holds a token.
     *
     * <p>Takes no userId: it is read from the JWT, so this can only ever answer for the
     * caller. A userId parameter here would let any learner ask for any other learner's
     * auto-login URL.
     */
    @GetMapping("/landing")
    public ResponseEntity<LearnerLmsLandingResponse> getLandingForCurrentLearner(
            @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(learnerLmsLandingService.resolveLanding(userDetails.getUserId()));
    }
}
