package vacademy.io.admin_core_service.features.suborg.registration.controller;

import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.live_session.client.InstituteRoleUserClient;
import vacademy.io.admin_core_service.features.suborg.registration.dto.CreateRegistrationTemplateDTO;
import vacademy.io.admin_core_service.features.suborg.registration.dto.SubOrgRegistrationFlowDTOs.RegistrationFacetsDTO;
import vacademy.io.admin_core_service.features.suborg.registration.dto.SubOrgRegistrationFlowDTOs.RegistrationListItemDTO;
import vacademy.io.admin_core_service.features.suborg.registration.dto.SubOrgRegistrationFlowDTOs.TemplateListItemDTO;
import vacademy.io.admin_core_service.features.suborg.registration.dto.TemplateDetailDTO;
import vacademy.io.admin_core_service.features.suborg.registration.service.SubOrgRegistrationTemplateService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Admin-side management of open sub-org registration templates. */
@RestController
@RequestMapping("/admin-core-service/institute/v1/sub-org-registration")
@RequiredArgsConstructor
@Tag(name = "Sub-Org Registration Templates", description = "Create/list open self-registration links")
public class SubOrgRegistrationAdminController {

    private static final String ROLE_NAME_ADMIN = "ADMIN";

    private final SubOrgRegistrationTemplateService templateService;
    private final InstituteRoleUserClient instituteRoleUserClient;
    private final InstituteRepository instituteRepository;

    @PostMapping("/template/create")
    public ResponseEntity<Map<String, Object>> createTemplate(
            @RequestBody CreateRegistrationTemplateDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        assertInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(templateService.createTemplate(request, instituteId));
    }

    @GetMapping("/template/list")
    public ResponseEntity<List<TemplateListItemDTO>> listTemplates(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        assertInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(templateService.listTemplates(instituteId));
    }

    @GetMapping("/template/{templateId}/detail")
    public ResponseEntity<TemplateDetailDTO> getTemplateDetail(
            @PathVariable("templateId") String templateId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        assertInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(templateService.getTemplateDetail(templateId, instituteId));
    }

    @PutMapping("/template/{templateId}")
    public ResponseEntity<Map<String, Object>> updateTemplate(
            @PathVariable("templateId") String templateId,
            @RequestBody CreateRegistrationTemplateDTO request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        assertInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(templateService.updateTemplate(templateId, instituteId, request));
    }

    @PatchMapping("/template/{templateId}/status")
    public ResponseEntity<Map<String, Object>> updateStatus(
            @PathVariable("templateId") String templateId,
            @RequestParam("status") String status,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        assertInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(templateService.updateStatus(templateId, status, instituteId));
    }

    @GetMapping("/registrations")
    public ResponseEntity<Page<RegistrationListItemDTO>> listRegistrations(
            @RequestParam("templateInviteId") String templateInviteId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "cities", required = false) List<String> cities,
            @RequestParam(value = "states", required = false) List<String> states,
            @RequestParam(value = "pincodes", required = false) List<String> pincodes,
            // Rollout-safety shim: older admin bundles send singular free-text params with
            // "contains" semantics — honour them so a stale bundle's filter keeps filtering.
            @RequestParam(value = "city", required = false) String legacyCity,
            @RequestParam(value = "state", required = false) String legacyState,
            @RequestParam(value = "pincode", required = false) String legacyPincode,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "search", required = false) String search,
            // Per-custom-field filters as repeated "fieldId:value" params (colon-delimited;
            // the field id is a UUID so it never contains a colon — split on the first one).
            @RequestParam(value = "customField", required = false) List<String> customField,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "10") int size,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        assertInstituteAdmin(user, instituteId);
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        return ResponseEntity.ok(templateService.listRegistrations(
                templateInviteId, instituteId, cities, states, pincodes,
                legacyCity, legacyState, legacyPincode, status, search,
                parseCustomFieldFilters(customField), pageable));
    }

    /** Groups repeated "fieldId:value" params into {fieldId -> [values]}. */
    private Map<String, List<String>> parseCustomFieldFilters(List<String> customField) {
        Map<String, List<String>> filters = new LinkedHashMap<>();
        if (customField == null) {
            return filters;
        }
        for (String entry : customField) {
            if (entry == null) {
                continue;
            }
            int idx = entry.indexOf(':');
            if (idx <= 0 || idx == entry.length() - 1) {
                continue; // need a non-empty fieldId and value
            }
            String fieldId = entry.substring(0, idx).trim();
            String value = entry.substring(idx + 1).trim();
            if (fieldId.isEmpty() || value.isEmpty()) {
                continue;
            }
            filters.computeIfAbsent(fieldId, k -> new ArrayList<>()).add(value);
        }
        return filters;
    }

    /** Distinct City/State/Pincode values across this link's registrations — populates the listing filters. */
    @GetMapping("/registrations/facets")
    public ResponseEntity<RegistrationFacetsDTO> registrationFacets(
            @RequestParam("templateInviteId") String templateInviteId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        assertInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(templateService.getRegistrationFacets(templateInviteId, instituteId));
    }

    // ── Authorization guard ──────────────────────────────────────────────────

    /**
     * Asserts the caller is allowed to manage sub-org registration templates for
     * the given institute. Mirrors WhiteLabelService#assertInstituteAccess — the
     * check is bound to THIS instituteId (never to a client-supplied header or a
     * global authority list, which would allow cross-institute access):
     * 1) root users (platform superadmins) bypass;
     * 2) an ACTIVE ADMIN role for this institute, resolved via auth_service;
     * 3) fallback: legacy staff-table membership in this institute.
     */
    private void assertInstituteAdmin(CustomUserDetails user, String instituteId) {
        if (user == null) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "User authentication required");
        }
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Institute ID is required");
        }

        if (user.isRootUser()) {
            return;
        }

        // Roles live in auth_service's DB (admin_core has no user_role table); a failed
        // lookup falls through to the staff-membership check below.
        if (instituteRoleUserClient.findRolesOfUser(instituteId, user.getUserId())
                .map(roles -> roles.contains(ROLE_NAME_ADMIN)).orElse(false)) {
            return;
        }

        boolean isStaff = instituteRepository.findInstitutesByUserId(user.getUserId())
                .stream()
                .anyMatch(institute -> instituteId.equals(institute.getId()));
        if (!isStaff) {
            throw new VacademyException(HttpStatus.FORBIDDEN,
                    "Access denied: you do not have admin access to institute " + instituteId);
        }
    }
}
