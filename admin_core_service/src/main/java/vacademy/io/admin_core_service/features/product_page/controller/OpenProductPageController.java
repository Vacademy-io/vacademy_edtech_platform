package vacademy.io.admin_core_service.features.product_page.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.product_page.dto.*;
import vacademy.io.admin_core_service.features.product_page.service.ProductPageAutoLoginService;
import vacademy.io.admin_core_service.features.product_page.service.ProductPageEnrollmentService;
import vacademy.io.admin_core_service.features.product_page.service.ProductPageService;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceResolver;

@Slf4j
@RestController
@RequestMapping("/admin-core-service/open/v1/product-page")
public class OpenProductPageController {

    @Autowired
    private ProductPageService coursePageService;

    @Autowired
    private ProductPageEnrollmentService enrollmentService;

    @Autowired
    private RegionalPriceResolver regionalPriceResolver;

    @Autowired
    private ProductPageAutoLoginService autoLoginService;

    /** Learner landing: fetch page layout + aggregated custom fields, priced for the viewer's region. */
    @GetMapping("/by-code")
    public ResponseEntity<ProductPageResponse> getByCode(
            @RequestParam("code") String code,
            @RequestParam("instituteId") String instituteId) {
        ProductPageResponse page = coursePageService.getProductPageByCode(code, instituteId);
        regionalPriceResolver.localize(page);
        return ResponseEntity.ok(page);
    }

    /**
     * Cart step: validate coupon and return discount details.
     *
     * <p>{@code baseTotalAmount} is sent when the cart is regionally priced: the same cart at
     * the plans' base prices. Coupon amounts and thresholds are in the base currency, so the
     * coupon is validated on that total and the discount scaled back to the regional total.
     */
    @PostMapping("/validate-coupon")
    public ResponseEntity<ProductPageCouponValidateResponse> validateCoupon(
            @RequestParam("coursePageCode") String coursePageCode,
            @RequestParam("couponCode") String couponCode,
            @RequestParam("totalAmount") double totalAmount,
            @RequestParam(value = "itemCount", required = false) Integer itemCount,
            @RequestParam(value = "baseTotalAmount", required = false) Double baseTotalAmount) {
        boolean regional = baseTotalAmount != null && baseTotalAmount > 0;
        ProductPageCouponValidateResponse resp = coursePageService.validateCoupon(
                coursePageCode, couponCode, regional ? baseTotalAmount : totalAmount, itemCount);
        if (regional) {
            double scale = totalAmount / baseTotalAmount;
            if (resp.getDiscountValue() != null) {
                resp.setDiscountValue(Math.round(resp.getDiscountValue() * scale * 100.0) / 100.0);
            }
            if (resp.getMaxDiscountValue() != null) {
                resp.setMaxDiscountValue(Math.round(resp.getMaxDiscountValue() * scale * 100.0) / 100.0);
            }
        }
        return ResponseEntity.ok(resp);
    }

    /** Step 1: create user + ABANDONED_CART entries per selected invite. */
    @PostMapping("/form-submit")
    public ResponseEntity<ProductPageFormSubmitResponse> formSubmit(
            @RequestBody ProductPageFormSubmitRequest request) {
        log.info("Course page form-submit received for code={}", request.getProductPageCode());
        return ResponseEntity.ok(enrollmentService.submitProductPageForm(request));
    }

    /** Step 2: combined payment + split fulfillment per invite. */
    @PostMapping("/enroll")
    public ResponseEntity<ProductPageEnrollResponse> enroll(
            @RequestBody ProductPageEnrollRequest request) {
        log.info("Course page enroll received for code={}", request.getProductPageCode());
        return ResponseEntity.ok(enrollmentService.enrollForProductPage(request));
    }

    /**
     * CPO-specific enrollment without payment: creates UserPlan + StudentFeePayment rows.
     * The learner then selects installments and pays via /open/v1/fee/cpo-pay-installments.
     */
    @PostMapping("/cpo-enroll")
    public ResponseEntity<ProductPageEnrollResponse> cpoEnroll(
            @RequestBody ProductPageCpoEnrollRequest request) {
        log.info("CPO product page enroll received for code={}", request.getProductPageCode());
        return ResponseEntity.ok(enrollmentService.enrollCpoForProductPage(request));
    }

    /** Auto-login after purchase: swaps the one-time login_code from /enroll for the buyer's tokens. */
    @PostMapping("/login-code/exchange")
    public ResponseEntity<ProductPageLoginCodeExchangeResponse> exchangeLoginCode(
            @RequestBody ProductPageLoginCodeExchangeRequest request) {
        return ResponseEntity.ok(autoLoginService.exchange(request.getLoginCode(), request.getInstituteId()));
    }
}
