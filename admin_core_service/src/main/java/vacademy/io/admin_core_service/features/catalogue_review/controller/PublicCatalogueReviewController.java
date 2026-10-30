package vacademy.io.admin_core_service.features.catalogue_review.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.config.cache.CacheScope;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewPageResponse;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewResponse;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewSubmitRequest;
import vacademy.io.admin_core_service.features.catalogue_review.service.CatalogueReviewService;

/**
 * What the public site calls: submit a review (always lands PENDING) and read
 * APPROVED reviews for a testimonials section. Pending and rejected reviews
 * are unreachable here.
 */
@RestController
@RequestMapping("/admin-core-service/public/catalogue-review/v1")
public class PublicCatalogueReviewController {

    @Autowired
    private CatalogueReviewService service;

    @PostMapping("/submit")
    public ResponseEntity<ReviewResponse> submit(@RequestBody ReviewSubmitRequest request) {
        return ResponseEntity.ok(service.submit(request));
    }

    @GetMapping("/approved")
    @ClientCacheable(maxAgeSeconds = 300, scope = CacheScope.PUBLIC)
    public ResponseEntity<ReviewPageResponse> approved(@RequestParam String instituteId,
                                                       @RequestParam(required = false) Integer minRating,
                                                       @RequestParam(defaultValue = "0") int page,
                                                       @RequestParam(defaultValue = "12") int size) {
        return ResponseEntity.ok(service.publicApproved(instituteId, minRating, page, size));
    }
}
