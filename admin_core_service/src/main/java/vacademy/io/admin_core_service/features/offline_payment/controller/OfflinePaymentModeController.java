package vacademy.io.admin_core_service.features.offline_payment.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentModesDTO;
import vacademy.io.admin_core_service.features.offline_payment.service.OfflinePaymentModeService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * The offline payment modes an institute offers in its record-payment dialogs.
 * Read: institute staff (anyone who can record a payment). Write: institute admin.
 */
@RestController
@RequestMapping("/admin-core-service/v1/institute/offline-payment-modes")
@RequiredArgsConstructor
public class OfflinePaymentModeController {

    private final OfflinePaymentModeService modeService;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping
    public ResponseEntity<OfflinePaymentModesDTO> get(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(modeService.getEffective(instituteId));
    }

    @PutMapping
    public ResponseEntity<OfflinePaymentModesDTO> save(
            @RequestParam("instituteId") String instituteId,
            @RequestBody OfflinePaymentModesDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(modeService.save(instituteId, request, user.getUserId()));
    }
}
