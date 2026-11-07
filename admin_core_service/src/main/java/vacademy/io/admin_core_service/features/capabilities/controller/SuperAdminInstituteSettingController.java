package vacademy.io.admin_core_service.features.capabilities.controller;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.capabilities.service.InstituteSettingAdminService;
import vacademy.io.admin_core_service.features.capabilities.service.VersionConflictException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Platform-staff reads and writes of an institute's settings (INSTITUTE_MODULES_AND_CONFIG_SPEC.md
 * §12.3): role display settings with conflict detection, and the setting history with restore.
 *
 * <p>Every route calls {@code SuperAdminAuthUtil.requireSuperAdmin} first: the
 * SUPER_ADMIN_USER_IDS allowlist only, no root-user bypass.
 */
@RestController
@RequestMapping("/admin-core-service/super-admin/v1")
@RequiredArgsConstructor
public class SuperAdminInstituteSettingController {

    private final InstituteSettingAdminService settingAdminService;

    /** {@code ?role_key=ADMIN|TEACHER|CUSTOM:<roleId>} → {role_key, data, version}. */
    @GetMapping("/institutes/{instituteId}/display-settings")
    public ResponseEntity<Map<String, Object>> getDisplaySettings(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @RequestParam(value = "role_key", required = false) String roleKey) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(settingAdminService.getDisplaySettings(instituteId, roleKey));
    }

    /** Body {data, expected_version, reason}; 409 {code: "VERSION_CONFLICT"} on a stale version. */
    @PutMapping("/institutes/{instituteId}/display-settings")
    public ResponseEntity<Map<String, Object>> putDisplaySettings(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @RequestParam(value = "role_key", required = false) String roleKey,
            @RequestBody(required = false) JsonNode body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(settingAdminService.putDisplaySettings(instituteId, roleKey, body,
                user.getUserId()));
    }

    @GetMapping("/institutes/{instituteId}/settings/history")
    public ResponseEntity<Map<String, Object>> settingHistory(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @RequestParam(value = "setting_key", required = false) String settingKey,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(settingAdminService.history(instituteId, settingKey, page, size));
    }

    @GetMapping("/institutes/{instituteId}/settings/history/{historyId}")
    public ResponseEntity<Map<String, Object>> settingHistoryEntry(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @PathVariable("historyId") String historyId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(settingAdminService.historyEntry(instituteId, historyId));
    }

    /** Body {reason}: restores the entry's old_value as the key's current value. */
    @PostMapping("/institutes/{instituteId}/settings/history/{historyId}/restore")
    public ResponseEntity<Map<String, Object>> restoreSetting(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @PathVariable("historyId") String historyId,
            @RequestBody(required = false) JsonNode body) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(settingAdminService.restore(instituteId, historyId, body, user.getUserId()));
    }

    @ExceptionHandler(VersionConflictException.class)
    public ResponseEntity<Map<String, Object>> versionConflict(VersionConflictException e) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", VersionConflictException.CODE);
        body.put("message", e.getMessage());
        body.put("current_version", e.getCurrentVersion());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }
}
