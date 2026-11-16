package vacademy.io.admin_core_service.features.commerce.document.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

/**
 * Document series and bill books ({@code /document-series}). The
 * store manager writes; the accountant reads.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/document-series")
@RequiredArgsConstructor
public class CommerceDocumentSeriesController {

    private static final Set<CommerceRole> WRITE = Set.of(CommerceRole.STORE_MANAGER);
    private static final Set<CommerceRole> READ = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);

    private final CommerceDocumentSeriesService seriesService;
    private final CommerceAccessGuard commerceAccessGuard;

    @GetMapping
    public ResponseEntity<Page<DocumentSeriesDTO>> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "50") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        return ResponseEntity.ok(seriesService.list(instituteId, page, size));
    }

    @GetMapping("/{seriesId}")
    public ResponseEntity<DocumentSeriesDTO> get(
            @PathVariable("seriesId") String seriesId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        return ResponseEntity.ok(seriesService.get(instituteId, seriesId));
    }

    @PostMapping
    public ResponseEntity<DocumentSeriesDTO> create(
            @RequestBody DocumentSeriesDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.ORDERS, WRITE);
        return ResponseEntity.ok(seriesService.create(instituteId, user.getUserId(), request));
    }

    /** Close or reopen a series: {@code status=ACTIVE|CLOSED}. */
    @PostMapping("/{seriesId}/status")
    public ResponseEntity<DocumentSeriesDTO> setStatus(
            @PathVariable("seriesId") String seriesId,
            @RequestParam("status") String status,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        commerceAccessGuard.require(user, instituteId, CommerceFeature.ORDERS, WRITE);
        return ResponseEntity.ok(seriesService.setStatus(instituteId, user.getUserId(), seriesId, status));
    }
}
