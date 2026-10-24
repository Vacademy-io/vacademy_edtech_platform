package vacademy.io.admin_core_service.features.product_page.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.product_page.dto.*;
import vacademy.io.admin_core_service.features.product_page.service.ProductPageCatalogueSyncService;
import vacademy.io.admin_core_service.features.product_page.service.ProductPageService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@Slf4j
@RestController
@RequestMapping("/admin-core-service/v1/product-page")
public class ProductPageController {

    @Autowired
    private ProductPageService coursePageService;

    @Autowired
    private ProductPageCatalogueSyncService catalogueSyncService;

    @PostMapping("/create")
    public ResponseEntity<ProductPageResponse> create(
            @RequestParam("instituteId") String instituteId,
            @RequestBody ProductPageRequest request) {
        return ResponseEntity.ok(coursePageService.createProductPage(instituteId, request));
    }

    @PutMapping("/update")
    public ResponseEntity<ProductPageResponse> update(
            @RequestParam("coursePageId") String coursePageId,
            @RequestBody ProductPageRequest request) {
        return ResponseEntity.ok(coursePageService.updateProductPage(coursePageId, request));
    }

    @GetMapping("/get-all")
    public ResponseEntity<List<ProductPageResponse>> getAll(
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(coursePageService.getAllProductPages(instituteId));
    }

    /**
     * The admin list, one page at a time and without page JSON or mappings.
     * status: ACTIVE, DRAFT or blank for both. sort: LATEST, OLDEST,
     * NAME_ASC or NAME_DESC. size is capped at 100.
     */
    @GetMapping("/list")
    public ResponseEntity<ProductPageListResponse> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "sort", defaultValue = "LATEST") String sort,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "12") int size) {
        return ResponseEntity.ok(coursePageService.listProductPages(instituteId, search, status, sort, page, size));
    }

    @GetMapping("/{coursePageId}")
    public ResponseEntity<ProductPageResponse> getById(
            @PathVariable("coursePageId") String coursePageId) {
        return ResponseEntity.ok(coursePageService.getProductPageById(coursePageId));
    }

    @DeleteMapping("/delete")
    public ResponseEntity<String> delete(
            @RequestParam("coursePageId") String coursePageId) {
        return ResponseEntity.ok(coursePageService.deleteProductPage(coursePageId));
    }

    @PostMapping("/coupon/create")
    public ResponseEntity<String> createCoupon(
            @RequestParam("coursePageId") String coursePageId,
            @RequestBody ProductPageCouponRequest request) {
        return ResponseEntity.ok(coursePageService.createCoupon(coursePageId, request));
    }

    @DeleteMapping("/coupon/{couponCodeId}")
    public ResponseEntity<String> deleteCoupon(
            @PathVariable("couponCodeId") String couponCodeId) {
        return ResponseEntity.ok(coursePageService.deleteCoupon(couponCodeId));
    }

    @PostMapping("/{productPageId}/custom-fields/add")
    public ResponseEntity<ProductPageResponse> addCustomField(
            @PathVariable("productPageId") String productPageId,
            @RequestParam("customFieldId") String customFieldId,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(coursePageService.addCustomFieldToPage(productPageId, customFieldId, instituteId));
    }

    @PostMapping("/{productPageId}/custom-fields/create")
    public ResponseEntity<ProductPageResponse> createCustomField(
            @PathVariable("productPageId") String productPageId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody ProductPageCustomFieldCreateRequest request) {
        return ResponseEntity.ok(coursePageService.createAndLinkCustomFieldToPage(productPageId, request, instituteId));
    }

    @DeleteMapping("/{productPageId}/custom-fields/{customFieldId}")
    public ResponseEntity<ProductPageResponse> removeCustomField(
            @PathVariable("productPageId") String productPageId,
            @PathVariable("customFieldId") String customFieldId,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(coursePageService.removeCustomFieldFromPage(productPageId, customFieldId, instituteId));
    }

    /**
     * Edits a field on this page's form. The properties edited live on the
     * shared custom field, so the change reaches every form using it.
     */
    @PutMapping("/{productPageId}/custom-fields/{customFieldId}")
    public ResponseEntity<ProductPageResponse> updateCustomField(
            @PathVariable("productPageId") String productPageId,
            @PathVariable("customFieldId") String customFieldId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody ProductPageCustomFieldUpdateRequest request) {
        return ResponseEntity.ok(
                coursePageService.updateCustomFieldOnPage(productPageId, customFieldId, request, instituteId));
    }

    /**
     * Adds a mapping for every catalogue course version the page does not sell
     * yet, on the bridge row and plan the public Courses page prices it with,
     * appended after the existing ones. With deactivateMissing (default true)
     * also switches off mappings whose course left the catalogue or can no
     * longer be sold. Institute ADMIN only. Existing mappings are never
     * replaced wholesale, unlike PUT /update. Returns the page as GET /{id}
     * does, plus {added, deactivated, skipped, warnings}.
     */
    @PostMapping("/{productPageId}/sync-catalogue")
    public ResponseEntity<ProductPageCatalogueSyncResponse> syncCatalogue(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("productPageId") String productPageId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "deactivateMissing", defaultValue = "true") boolean deactivateMissing) {
        return ResponseEntity.ok(
                catalogueSyncService.syncCatalogue(user, productPageId, instituteId, deactivateMissing));
    }

    /** Body is the custom field ids in the order the checkout form should ask for them. */
    @PutMapping("/{productPageId}/custom-fields/order")
    public ResponseEntity<ProductPageResponse> reorderCustomFields(
            @PathVariable("productPageId") String productPageId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody List<String> orderedCustomFieldIds) {
        return ResponseEntity
                .ok(coursePageService.reorderCustomFieldsOnPage(productPageId, orderedCustomFieldIds, instituteId));
    }
}
