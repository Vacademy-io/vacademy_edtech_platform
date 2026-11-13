package vacademy.io.admin_core_service.features.audience.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.audience.dto.OpenAssessmentLeadEventDTO;
import vacademy.io.admin_core_service.features.audience.service.OpenAssessmentLeadService;

/**
 * assessment_service → admin_core: keeps each open assessment's own lead list in step with
 * the test (see {@link OpenAssessmentLeadService}). Internal path, so HMAC-authenticated.
 */
@RestController
@RequestMapping("/admin-core-service/internal/open-assessment-leads")
public class OpenAssessmentLeadInternalController {

    @Autowired
    private OpenAssessmentLeadService openAssessmentLeadService;

    /** Someone registered through the test's public link (the first one creates the list). Processed in the background. */
    @PostMapping("/registration")
    public ResponseEntity<Void> registration(@RequestBody OpenAssessmentLeadEventDTO event) {
        openAssessmentLeadService.captureRegistrationAsync(event);
        return ResponseEntity.accepted().build();
    }

    /** A registrant's result was released. Processed in the background. */
    @PostMapping("/result")
    public ResponseEntity<Void> result(@RequestBody OpenAssessmentLeadEventDTO event) {
        openAssessmentLeadService.recordResultAsync(event);
        return ResponseEntity.accepted().build();
    }
}
