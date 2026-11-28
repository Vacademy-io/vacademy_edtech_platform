package vacademy.io.admin_core_service.features.access_pass.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.access_pass.dto.AccessPassDTOs.AccessPassResponse;
import vacademy.io.admin_core_service.features.access_pass.service.AccessPassService;

import java.util.List;

/**
 * Public (no login) reads for the learner catalogue: ACTIVE passes only, without admin
 * fields (payment option id, removal policy, holder counts). Checkout uses the returned
 * invite_code on the existing enroll-by-invite page.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/access-pass")
public class OpenAccessPassController {

    @Autowired
    private AccessPassService service;

    @GetMapping("/list")
    public ResponseEntity<List<AccessPassResponse>> list(@RequestParam String instituteId,
                                                         @RequestParam(required = false) String tag) {
        return ResponseEntity.ok(service.publicList(instituteId, tag));
    }

    @GetMapping("/by-slug")
    public ResponseEntity<AccessPassResponse> bySlug(@RequestParam String instituteId,
                                                     @RequestParam String slug) {
        return ResponseEntity.ok(service.publicBySlug(instituteId, slug));
    }
}
