package vacademy.io.admin_core_service.features.super_admin.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.super_admin.dto.ExternalApiLogDTOs.LogDetail;
import vacademy.io.admin_core_service.features.super_admin.dto.ExternalApiLogDTOs.LogRow;
import vacademy.io.admin_core_service.features.super_admin.dto.SuperAdminPageResponse;
import vacademy.io.admin_core_service.features.super_admin.service.SuperAdminExternalApiLogService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

/**
 * Cross-institute vendor call logs for the health-check portal.
 *
 * <p>SUPER-ADMIN ONLY, checked on every method. These do not scope to the caller's institute,
 * and the bodies hold payment and call data, so the guard is all that protects them. Each read
 * of a body is logged.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/super-admin/v1/external-apis/logs")
public class SuperAdminExternalApiLogController {

    private static final int MAX_HOURS = 720;

    @Autowired
    private SuperAdminExternalApiLogService service;

    @GetMapping("/{source}")
    public ResponseEntity<SuperAdminPageResponse<LogRow>> list(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String source,
            @RequestParam(required = false) String vendor,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "24") int hours,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(service.list(source, vendor, status,
                Math.min(Math.max(hours, 1), MAX_HOURS), Math.max(page, 0), Math.min(Math.max(size, 1), 100)));
    }

    @GetMapping("/{source}/{id}")
    public ResponseEntity<LogDetail> detail(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable String source,
            @PathVariable String id) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        log.info("Super-admin {} read external API log {}/{}", user.getUserId(), source, id);
        return ResponseEntity.ok(service.detail(source, id));
    }
}
