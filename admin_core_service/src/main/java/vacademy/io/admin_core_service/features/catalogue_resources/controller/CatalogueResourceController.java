package vacademy.io.admin_core_service.features.catalogue_resources.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.catalogue_resources.dto.LeadResourceDownload;
import vacademy.io.admin_core_service.features.catalogue_resources.dto.ResourceDownloadReport;
import vacademy.io.admin_core_service.features.catalogue_resources.service.CatalogueResourceDownloadService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/** Admin read side of freebie downloads. */
@RestController
@RequestMapping("/admin-core-service/v1/catalogue-resources")
public class CatalogueResourceController {

    @Autowired
    private CatalogueResourceDownloadService service;

    /**
     * Who took which freebies over the last `days` days. With audienceId, only
     * leads of that list (the list page); without it, the whole institute.
     */
    @GetMapping("/downloads")
    public ResponseEntity<ResourceDownloadReport> downloads(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam(required = false) String audienceId,
            @RequestParam(defaultValue = "90") int days) {
        return ResponseEntity.ok(service.report(user, instituteId, audienceId, days));
    }

    /** Every freebie one lead (auth user id) opened, newest first. */
    @GetMapping("/downloads/lead")
    public ResponseEntity<List<LeadResourceDownload>> forLead(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestParam String instituteId,
            @RequestParam String userId) {
        return ResponseEntity.ok(service.forLead(user, instituteId, userId));
    }
}
