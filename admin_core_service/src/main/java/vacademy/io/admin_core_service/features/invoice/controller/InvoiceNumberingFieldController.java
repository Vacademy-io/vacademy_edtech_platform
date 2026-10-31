package vacademy.io.admin_core_service.features.invoice.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.invoice.service.NumberingFieldService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Whether a record-payment dialog asks for the institute's numbering-series field (e.g.
 * branch) for this enrolment, with its options and the learner's current value. Read by any
 * institute staff member who can record a payment.
 */
@RestController
@RequestMapping("/admin-core-service/v1/invoice/numbering-field")
@RequiredArgsConstructor
public class InvoiceNumberingFieldController {

    private final NumberingFieldService numberingFieldService;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping
    public ResponseEntity<NumberingFieldService.Info> get(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "userPlanId", required = false) String userPlanId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(numberingFieldService.describe(instituteId, userPlanId, userId));
    }
}
