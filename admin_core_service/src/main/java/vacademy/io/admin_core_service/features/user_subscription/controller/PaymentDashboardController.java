package vacademy.io.admin_core_service.features.user_subscription.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentDashboardRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentDashboardResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentDashboardService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * The Payment Dashboard's single read-only endpoint. Kept apart from UserPlanController so that
 * controller's wiring stays exactly as it is.
 */
@RestController
@RequestMapping("/admin-core-service/v1/user-plan")
public class PaymentDashboardController {

    @Autowired
    private PaymentDashboardService paymentDashboardService;

    @Autowired
    private InstituteAccessValidator instituteAccessValidator;

    /**
     * Collections for a period (compared with the same period a year earlier), balances as of
     * today, and the month / year / day / course / batch / source / method breakdowns — see
     * {@link PaymentDashboardResponseDTO}. Omit start for all time.
     */
    @PostMapping("/payment-logs/dashboard")
    public ResponseEntity<PaymentDashboardResponseDTO> getDashboard(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody PaymentDashboardRequestDTO request) {
        // The whole institute's money in one response, so the caller must belong to the institute.
        instituteAccessValidator.validateUserAccess(userDetails, request != null ? request.getInstituteId() : null);
        return ResponseEntity.ok(paymentDashboardService.getDashboard(request));
    }
}
