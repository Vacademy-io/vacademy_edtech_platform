package vacademy.io.admin_core_service.features.user_subscription.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.AdminDiscountPreviewDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.AdminDiscountPreviewRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountPermissionService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

/**
 * Price preview for the admin discount field on the manual-enroll, bulk-assign and
 * invoice forms, plus the "may I?" check the dashboard uses to show that field. Allowed
 * for roles whose Display Settings card enables learnerManagement.canApplyDiscounts.
 */
@RestController
@RequestMapping("/admin-core-service/v1/admin-discounts")
@RequiredArgsConstructor
public class AdminDiscountController {

    private final AdminDiscountService adminDiscountService;
    private final AdminDiscountPermissionService adminDiscountPermissionService;

    @GetMapping("/can-apply")
    public ResponseEntity<Map<String, Boolean>> canApply(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(Map.of("can_apply",
                adminDiscountPermissionService.canApplyDiscounts(user, instituteId)));
    }

    @PostMapping("/preview")
    public ResponseEntity<AdminDiscountPreviewDTO> preview(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestBody AdminDiscountPreviewRequestDTO request) {
        adminDiscountPermissionService.requireCanApplyDiscounts(user, instituteId);
        return ResponseEntity.ok(adminDiscountService.preview(
                request.getDiscount(), instituteId, request.getPaymentPlanId(), request.getGrossAmount(),
                request.getPackageSessionId(), request.getEnrollInviteId(), request.getLearnerEmail()));
    }
}
