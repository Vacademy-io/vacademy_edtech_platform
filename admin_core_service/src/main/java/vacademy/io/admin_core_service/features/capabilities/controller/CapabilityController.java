package vacademy.io.admin_core_service.features.capabilities.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityQueryService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

/**
 * Tenant capability reads for the admin app (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §12.2).
 * {@code /catalog}: any signed-in user. {@code /me}: staff of that institute (clientId header
 * must name it; no root bypass — learners are root users).
 */
@RestController
@RequestMapping("/admin-core-service/capabilities/v1")
@RequiredArgsConstructor
public class CapabilityController {

    private final CapabilityQueryService queryService;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/catalog")
    public ResponseEntity<Map<String, Object>> catalog(@RequestAttribute("user") CustomUserDetails user) {
        if (user == null) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "User authentication required");
        }
        return ResponseEntity.ok(queryService.catalog());
    }

    @GetMapping("/me")
    public ResponseEntity<Map<String, Object>> me(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestParam("instituteId") String instituteId) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(queryService.me(instituteId));
    }
}
