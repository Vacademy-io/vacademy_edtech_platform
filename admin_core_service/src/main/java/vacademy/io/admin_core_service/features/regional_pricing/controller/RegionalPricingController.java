package vacademy.io.admin_core_service.features.regional_pricing.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalPriceDTO;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalPriceUpsertRequest;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalPricingConfigDTO;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalPricingSettingsRequest;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceService;
import vacademy.io.common.auth.model.CustomUserDetails;

/** Admin panel for country-based pricing on one payment option. */
@RestController
@RequestMapping("/admin-core-service/v1/regional-pricing")
@RequiredArgsConstructor
public class RegionalPricingController {

    private final RegionalPriceService regionalPriceService;

    @GetMapping("/payment-option/{paymentOptionId}")
    public ResponseEntity<RegionalPricingConfigDTO> getConfig(@PathVariable String paymentOptionId,
                                                              @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(regionalPriceService.getConfig(paymentOptionId));
    }

    /** Turn the switch on/off and set the currencies to auto-price in. Creates/retires AUTO rows. */
    @PutMapping("/payment-option/{paymentOptionId}/settings")
    @Auditable(entityType = "PAYMENT_PLAN", action = "UPDATE", entityIdExpr = "#paymentOptionId",
            descriptionExpr = "'updated regional pricing settings'")
    public ResponseEntity<RegionalPricingConfigDTO> updateSettings(@PathVariable String paymentOptionId,
                                                                   @RequestBody RegionalPricingSettingsRequest request,
                                                                   @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(regionalPriceService.updateSettings(paymentOptionId, request));
    }

    /** Fetch today's exchange rates and reprice every AUTO row of the option now. */
    @PostMapping("/payment-option/{paymentOptionId}/refresh")
    @Auditable(entityType = "PAYMENT_PLAN", action = "UPDATE", entityIdExpr = "#paymentOptionId",
            descriptionExpr = "'refreshed regional prices from exchange rates'")
    public ResponseEntity<RegionalPricingConfigDTO> refresh(@PathVariable String paymentOptionId,
                                                            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(regionalPriceService.refreshOption(paymentOptionId));
    }

    /** Set a price by hand (MANUAL), or add a country priced automatically ({@code auto: true}). */
    @PutMapping("/price")
    @Auditable(entityType = "PAYMENT_PLAN", action = "UPDATE", entityIdExpr = "#request?.paymentPlanId",
            descriptionExpr = "'set regional price ' + #request?.currency + ' ' + #request?.actualPrice"
                    + " + (#request?.countryCode != null ? ' for ' + #request?.countryCode : '')")
    public ResponseEntity<RegionalPriceDTO> upsert(@RequestBody RegionalPriceUpsertRequest request,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(regionalPriceService.upsert(request));
    }

    @PostMapping("/price/{regionalPriceId}/reset-to-auto")
    @Auditable(entityType = "PAYMENT_PLAN", action = "UPDATE", entityIdExpr = "#regionalPriceId",
            descriptionExpr = "'reset regional price to automatic'")
    public ResponseEntity<RegionalPriceDTO> resetToAuto(@PathVariable String regionalPriceId,
                                                        @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(regionalPriceService.resetToAuto(regionalPriceId));
    }

    @PostMapping("/price/{regionalPriceId}/mark-reviewed")
    public ResponseEntity<RegionalPriceDTO> markReviewed(@PathVariable String regionalPriceId,
                                                         @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(regionalPriceService.markReviewed(regionalPriceId));
    }

    @DeleteMapping("/price/{regionalPriceId}")
    @Auditable(entityType = "PAYMENT_PLAN", action = "DELETE", entityIdExpr = "#regionalPriceId",
            descriptionExpr = "'deleted a regional price'")
    public ResponseEntity<String> delete(@PathVariable String regionalPriceId,
                                         @RequestAttribute("user") CustomUserDetails user) {
        regionalPriceService.delete(regionalPriceId);
        return ResponseEntity.ok("deleted");
    }
}
