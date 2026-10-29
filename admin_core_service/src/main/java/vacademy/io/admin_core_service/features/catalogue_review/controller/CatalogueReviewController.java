package vacademy.io.admin_core_service.features.catalogue_review.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewPageResponse;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewResponse;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewUpdateRequest;
import vacademy.io.admin_core_service.features.catalogue_review.service.CatalogueReviewService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Dashboard side of site reviews: list by status, approve / reject, edit,
 * delete. Every call is checked against the caller's institute membership.
 */
@RestController
@RequestMapping("/admin-core-service/v1/catalogue-review")
public class CatalogueReviewController {

    @Autowired
    private CatalogueReviewService service;

    @GetMapping("/reviews")
    public ResponseEntity<ReviewPageResponse> list(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam String instituteId,
                                                   @RequestParam(required = false) String status,
                                                   @RequestParam(required = false) String q,
                                                   @RequestParam(defaultValue = "0") int page,
                                                   @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(service.list(user, instituteId, status, q, page, size));
    }

    @PutMapping("/review")
    public ResponseEntity<ReviewResponse> update(@RequestAttribute("user") CustomUserDetails user,
                                                 @RequestParam String instituteId,
                                                 @RequestParam String reviewId,
                                                 @RequestBody ReviewUpdateRequest request) {
        return ResponseEntity.ok(service.update(user, instituteId, reviewId, request));
    }

    @PostMapping("/review/status")
    public ResponseEntity<ReviewResponse> setStatus(@RequestAttribute("user") CustomUserDetails user,
                                                    @RequestParam String instituteId,
                                                    @RequestParam String reviewId,
                                                    @RequestParam String status) {
        return ResponseEntity.ok(service.setStatus(user, instituteId, reviewId, status));
    }

    @DeleteMapping("/review")
    public ResponseEntity<Void> delete(@RequestAttribute("user") CustomUserDetails user,
                                       @RequestParam String instituteId,
                                       @RequestParam String reviewId) {
        service.delete(user, instituteId, reviewId);
        return ResponseEntity.noContent().build();
    }
}
