package vacademy.io.admin_core_service.features.commerce.pos.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosCatalogueService;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleLookupService;
import vacademy.io.common.auth.model.CustomUserDetails;

/** The till's reads: catalogue, scan, a phone's name, the managers who can approve, a bill to return. */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/pos")
public class PosLookupController {

    private final PosCatalogueService catalogueService;
    private final PosSaleLookupService saleLookupService;

    public PosLookupController(PosCatalogueService catalogueService, PosSaleLookupService saleLookupService) {
        this.catalogueService = catalogueService;
        this.saleLookupService = saleLookupService;
    }

    @GetMapping("/registers/{registerId}/catalogue")
    public ResponseEntity<PosDtos.CatalogueAnswer> catalogue(
            @PathVariable("registerId") String registerId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "q", required = false) String q,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(catalogueService.catalogue(user, instituteId, registerId, q));
    }

    @GetMapping("/registers/{registerId}/scan/{code}")
    public ResponseEntity<PosDtos.ScanAnswer> scan(
            @PathVariable("registerId") String registerId,
            @PathVariable("code") String code,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(catalogueService.scan(user, instituteId, registerId, code));
    }

    @GetMapping("/customers/lookup")
    public ResponseEntity<PosDtos.CustomerLookupAnswer> lookupCustomer(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("sessionId") String sessionId,
            @RequestParam("phone") String phone,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(catalogueService.lookupCustomer(user, instituteId, sessionId, phone));
    }

    @GetMapping("/registers/{registerId}/approvers")
    public ResponseEntity<PosDtos.ApproversAnswer> approvers(
            @PathVariable("registerId") String registerId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(catalogueService.approvers(user, instituteId, registerId));
    }

    @GetMapping("/sales/lookup")
    public ResponseEntity<PosDtos.SalesLookup> lookupSales(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("sessionId") String sessionId,
            @RequestParam(value = "q", required = false) String q,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(saleLookupService.lookup(user, instituteId, sessionId, q));
    }
}
