package vacademy.io.admin_core_service.features.learner.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.learner.dto.SecurityDepositStatusDTO;
import vacademy.io.admin_core_service.features.learner.service.AdditionalChargeValidator;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Rent checkout, signed-in learner: is the catalogue's once-per-user charge (the refundable
 * security deposit) due from them? The answer is the rule the checkout enforces
 * (AdditionalChargeValidator.validateRentMode), so a cart built from it is not refused. The user
 * comes from the learner JWT, never the request. Never cached: it changes the moment they pay.
 */
@RestController
@RequestMapping("/admin-core-service/learner/v1/security-deposit")
public class LearnerSecurityDepositController {

    @Autowired
    private AdditionalChargeValidator additionalChargeValidator;

    @GetMapping("/status")
    public ResponseEntity<SecurityDepositStatusDTO> status(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam(required = false) String catalogueTag) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(additionalChargeValidator.securityDepositStatus(instituteId, catalogueTag, user.getUserId()));
    }
}
