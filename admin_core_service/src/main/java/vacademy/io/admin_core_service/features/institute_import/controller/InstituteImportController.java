package vacademy.io.admin_core_service.features.institute_import.controller;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.institute_import.service.InstituteImportService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

/**
 * Institute import (moving a school in from its old system). A Vacademy super admin, or an admin
 * of the institute once the import is switched on for it (INSTITUTE_IMPORT_SETTING, off for every
 * institute by default). Dry run unless dryRun=false is sent.
 */
@RestController
@RequestMapping("/admin-core-service/institute-import/v1")
@RequiredArgsConstructor
public class InstituteImportController {

    private final InstituteImportService importService;
    private final InstituteAccessValidator instituteAccessValidator;

    @PostMapping("/{step}")
    public ResponseEntity<Map<String, Object>> run(@PathVariable("step") String step,
                                                   @RequestParam("instituteId") String instituteId,
                                                   @RequestParam(value = "dryRun", defaultValue = "true") boolean dryRun,
                                                   @RequestBody JsonNode body,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        if (!instituteAccessValidator.isPlatformSuperAdmin(user)) {
            // An admin of the institute, and only once Vacademy has switched the import on for it.
            instituteAccessValidator.requireInstituteAdmin(user, instituteId);
            if (!importService.isEnabledFor(instituteId)) {
                throw new VacademyException("Institute import is not switched on for this institute");
            }
        }
        return ResponseEntity.ok(importService.run(instituteId, step, body, dryRun, user.getUserId()));
    }
}
