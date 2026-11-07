package vacademy.io.admin_core_service.features.capabilities.controller;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
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
import vacademy.io.admin_core_service.features.capabilities.service.InstituteModuleService;
import vacademy.io.admin_core_service.features.capabilities.service.ModulePresetService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Platform-staff module entitlements and presets (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §12.3).
 *
 * <p>Every route calls {@code SuperAdminAuthUtil.requireSuperAdmin} first: the
 * SUPER_ADMIN_USER_IDS allowlist only, no root-user bypass.
 */
@RestController
@RequestMapping("/admin-core-service/super-admin/v1")
@RequiredArgsConstructor
public class SuperAdminModuleController {

    private final InstituteModuleService moduleService;
    private final ModulePresetService presetService;

    @GetMapping("/institutes/{instituteId}/modules")
    public ResponseEntity<Map<String, Object>> getModules(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(moduleService.view(instituteId));
    }

    @PutMapping("/institutes/{instituteId}/modules")
    public ResponseEntity<Map<String, Object>> updateModules(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @RequestBody(required = false) JsonNode body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(moduleService.update(instituteId, body, user.getUserId()));
    }

    @GetMapping("/institutes/{instituteId}/modules/history")
    public ResponseEntity<Map<String, Object>> moduleHistory(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(moduleService.history(instituteId, page, size));
    }

    /** {@code ?institute_ids=a,b,c} → {"a": {mode, enabled_modules}, ...}. */
    @GetMapping("/modules/overview")
    public ResponseEntity<Map<String, Object>> overview(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(value = "institute_ids", required = false) String instituteIds) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        List<String> ids = instituteIds == null ? List.of() : Arrays.asList(instituteIds.split(","));
        return ResponseEntity.ok(moduleService.overview(ids));
    }

    @GetMapping("/module-presets")
    public ResponseEntity<List<Map<String, Object>>> listPresets(
            @RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(presetService.list());
    }

    @PutMapping("/module-presets/{key}")
    public ResponseEntity<Map<String, Object>> upsertPreset(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("key") String key,
            @RequestBody(required = false) JsonNode body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(presetService.upsert(key, body, user.getUserId()));
    }

    @DeleteMapping("/module-presets/{key}")
    public ResponseEntity<Void> deletePreset(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("key") String key) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        presetService.delete(key);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/module-presets/{key}/apply")
    public ResponseEntity<Map<String, Object>> applyPreset(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("key") String key,
            @RequestBody(required = false) JsonNode body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(presetService.apply(key, body, user.getUserId()));
    }
}
