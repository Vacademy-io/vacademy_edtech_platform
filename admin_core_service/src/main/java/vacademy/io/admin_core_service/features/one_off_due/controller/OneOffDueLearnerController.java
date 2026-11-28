package vacademy.io.admin_core_service.features.one_off_due.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.one_off_due.dto.LearnerOneOffDuesDTO;
import vacademy.io.admin_core_service.features.one_off_due.service.OneOffDueService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * The calling learner's own one-off charges. Each due charge is paid on the existing
 * /pay/invoice/{invoice_id} page of the learner app.
 */
@RestController
@RequestMapping("/admin-core-service/learner/v1/one-off-dues")
@RequiredArgsConstructor
public class OneOffDueLearnerController {

    private final OneOffDueService service;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping
    public ResponseEntity<LearnerOneOffDuesDTO> mine(@RequestParam String instituteId,
                                                     @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteMemberOrSuperAdmin(user, instituteId);
        return ResponseEntity.ok(service.forLearner(user.getUserId(), instituteId));
    }
}
