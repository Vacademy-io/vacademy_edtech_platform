package vacademy.io.admin_core_service.features.commerce.catalogue.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.MediaOrderRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductMediaDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductMediaService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Admin product gallery: attach files that are already uploaded, order them, tag them, set alt text. */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/media")
@RequiredArgsConstructor
public class CommerceProductMediaController {

    private final CommerceProductMediaService mediaService;
    private final CommerceAccessGuard commerceAccessGuard;
    private final CommerceStorefrontSettings storefrontSettings;

    /** The catalogue is for the store manager (an institute ADMIN always passes). */
    private static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER);

    @GetMapping
    public ResponseEntity<Page<ProductMediaDTO>> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("packageId") String packageId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(mediaService.list(instituteId, packageId, page, size));
    }

    /**
     * The tags a photo can carry in this institute: the institute's own
     * list from the commerce setting with the lead tag in it, or the built-in three. The lead
     * tag is the one the storefront puts first on a card and in a gallery.
     */
    @GetMapping("/tags")
    public ResponseEntity<Map<String, Object>> tags(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        StorefrontSettings settings = storefrontSettings.read(instituteId);
        Map<String, Object> answer = new LinkedHashMap<>();
        answer.put("tags", settings.offeredMediaTags());
        answer.put("lead_tag", settings.leadMediaTag() == null ? null
                : settings.leadMediaTag().toUpperCase(java.util.Locale.ROOT));
        return ResponseEntity.ok(answer);
    }

    @PostMapping
    public ResponseEntity<ProductMediaDTO> attach(
            @RequestBody ProductMediaDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(mediaService.attach(instituteId, user.getUserId(), request));
    }

    @PutMapping("/order")
    public ResponseEntity<List<ProductMediaDTO>> reorder(
            @RequestBody MediaOrderRequest request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(mediaService.reorder(instituteId, user.getUserId(),
                request == null ? null : request.getPackageId(),
                request == null ? null : request.getMediaRowIds()));
    }

    @PutMapping("/{mediaRowId}")
    public ResponseEntity<ProductMediaDTO> update(
            @PathVariable("mediaRowId") String mediaRowId,
            @RequestBody ProductMediaDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        return ResponseEntity.ok(mediaService.update(instituteId, user.getUserId(), mediaRowId, request));
    }

    @DeleteMapping("/{mediaRowId}")
    public ResponseEntity<Void> remove(
            @PathVariable("mediaRowId") String mediaRowId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.CATALOGUE, ROLES);
        mediaService.remove(instituteId, user.getUserId(), mediaRowId);
        return ResponseEntity.noContent().build();
    }
}
