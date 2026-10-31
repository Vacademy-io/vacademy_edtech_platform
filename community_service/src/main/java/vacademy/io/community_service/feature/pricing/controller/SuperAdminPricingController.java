package vacademy.io.community_service.feature.pricing.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.community_service.feature.pricing.dto.QuoteRequestDto;
import vacademy.io.community_service.feature.pricing.dto.QuoteResponseDto;
import vacademy.io.community_service.feature.pricing.entity.PricingPlan;
import vacademy.io.community_service.feature.pricing.entity.PricingPlanFeature;
import vacademy.io.community_service.feature.pricing.entity.PricingProduct;
import vacademy.io.community_service.feature.pricing.entity.PricingQuote;
import vacademy.io.community_service.feature.pricing.entity.PricingSetting;
import vacademy.io.community_service.feature.pricing.repository.*;
import vacademy.io.community_service.feature.pricing.service.PricingQuoteService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.List;

/**
 * Internal plan-builder endpoints. Authenticated (these paths are deliberately NOT in the
 * security allow-list), and platform staff only: every handler calls
 * {@link SuperAdminAuthUtil#requireSuperAdmin}, so only an allowlisted rep can override rates
 * or move a quote's status.
 */
@RestController
@RequestMapping("/community-service/super-admin/v1/pricing")
public class SuperAdminPricingController {

    @Autowired
    private PricingQuoteService quoteService;

    /** Save with internal privileges: rate overrides and custom development lines are honoured. */
    @PostMapping("/quote/save")
    public ResponseEntity<QuoteResponseDto> save(@RequestAttribute("user") CustomUserDetails user,
                                                 @RequestBody QuoteRequestDto request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(quoteService.save(request, user.getUserId(), true));
    }

    @GetMapping("/quotes")
    public ResponseEntity<Page<PricingQuote>> list(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam(required = false) String status,
                                                   @RequestParam(required = false) String source,
                                                   @RequestParam(defaultValue = "0") int page,
                                                   @RequestParam(defaultValue = "20") int size) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(quoteService.search(status, source, page, size));
    }

    /** Every quote built for a given onboarding lead, newest first. */
    @GetMapping("/quotes/by-submission/{submissionId}")
    public ResponseEntity<List<PricingQuote>> bySubmission(@RequestAttribute("user") CustomUserDetails user,
                                                           @PathVariable String submissionId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(quoteService.forSubmission(submissionId));
    }

    /** Called after a demo workspace is provisioned, so the quote shows what it produced. */
    @PutMapping("/quotes/{id}/provisioned")
    public ResponseEntity<PricingQuote> markProvisioned(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestParam(required = false) Long demoExpiresAt) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(quoteService.markProvisioned(id, instituteId,
                demoExpiresAt == null ? null : new java.util.Date(demoExpiresAt)));
    }

    @PutMapping("/quotes/{id}/status")
    public ResponseEntity<PricingQuote> updateStatus(@RequestAttribute("user") CustomUserDetails user,
                                                     @PathVariable String id,
                                                     @RequestParam String status) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(quoteService.updateStatus(id, status));
    }

    // ---- rate-card administration ------------------------------------------------
    // Editing pricing is a database write, not a deploy. Everything below is authenticated.

    @Autowired
    private PricingProductRepository productRepository;
    @Autowired
    private PricingPlanRepository planRepository;
    @Autowired
    private PricingPlanFeatureRepository featureRepository;
    @Autowired
    private PricingSettingRepository settingRepository;

    /** Every product, including deactivated ones (the public catalogue hides those). */
    @GetMapping("/products")
    public ResponseEntity<List<PricingProduct>> products(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(productRepository.findAllByOrderBySortOrderAsc());
    }

    @PostMapping("/products")
    public ResponseEntity<PricingProduct> upsertProduct(@RequestAttribute("user") CustomUserDetails user,
                                                        @RequestBody PricingProduct product) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(productRepository.save(product));
    }

    @DeleteMapping("/products/{id}")
    public ResponseEntity<Void> deleteProduct(@RequestAttribute("user") CustomUserDetails user,
                                              @PathVariable String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        productRepository.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/products/{productCode}/plans")
    public ResponseEntity<List<PricingPlan>> plans(@RequestAttribute("user") CustomUserDetails user,
                                                   @PathVariable String productCode) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(planRepository.findByProductCodeOrderBySortOrderAsc(productCode));
    }

    @PostMapping("/plans")
    public ResponseEntity<PricingPlan> upsertPlan(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestBody PricingPlan plan) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(planRepository.save(plan));
    }

    @DeleteMapping("/plans/{id}")
    public ResponseEntity<Void> deletePlan(@RequestAttribute("user") CustomUserDetails user,
                                           @PathVariable String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        planRepository.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/plans/{planId}/features")
    public ResponseEntity<List<PricingPlanFeature>> features(@RequestAttribute("user") CustomUserDetails user,
                                                             @PathVariable String planId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(featureRepository.findByPlanIdOrderBySortOrderAsc(planId));
    }

    @PostMapping("/features")
    public ResponseEntity<PricingPlanFeature> upsertFeature(@RequestAttribute("user") CustomUserDetails user,
                                                            @RequestBody PricingPlanFeature feature) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(featureRepository.save(feature));
    }

    @DeleteMapping("/features/{id}")
    public ResponseEntity<Void> deleteFeature(@RequestAttribute("user") CustomUserDetails user,
                                              @PathVariable String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        featureRepository.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    /** GST, FX and the billing-cycle multipliers. */
    @GetMapping("/settings")
    public ResponseEntity<List<PricingSetting>> settings(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(settingRepository.findAll());
    }

    @PostMapping("/settings")
    public ResponseEntity<PricingSetting> upsertSetting(@RequestAttribute("user") CustomUserDetails user,
                                                        @RequestBody PricingSetting setting) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(settingRepository.save(setting));
    }
}
