package vacademy.io.admin_core_service.features.enroll_invite.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollmentFormSubmitDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollmentFormSubmitResponseDTO;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollmentFormService;
import vacademy.io.admin_core_service.features.learner.service.PublicEnrollRoleGuard;

@Slf4j
@RestController
@RequestMapping("/admin-core-service/open/v1/enrollment")
public class OpenEnrollmentFormController {

    @Autowired
    private EnrollmentFormService enrollmentFormService;

    @Autowired
    private PublicEnrollRoleGuard publicEnrollRoleGuard;

    /**
     * Submit enrollment form - Step 1 of enrollment process.
     * Creates user, student, and ABANDONED_CART entries.
     * Called when learner fills the form (before payment initiation).
     *
     * @param request The form submission data
     * @return Response with userId and abandoned cart entry IDs
     */
    @PostMapping("/form-submit")
    public ResponseEntity<EnrollmentFormSubmitResponseDTO> submitEnrollmentForm(
            @RequestBody EnrollmentFormSubmitDTO request) {
        log.info("Received enrollment form submission for institute: {}", request.getInstituteId());
        
        // No login on this route: the body's role names never reach auth-service as written.
        publicEnrollRoleGuard.restrictToLearnerRoles(request.getUserDetails(), request.getInstituteId());
        EnrollmentFormSubmitResponseDTO response = enrollmentFormService.submitEnrollmentForm(request);
        
        return ResponseEntity.ok(response);
    }
}
