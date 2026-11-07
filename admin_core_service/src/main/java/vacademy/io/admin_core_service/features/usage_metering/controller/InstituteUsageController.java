package vacademy.io.admin_core_service.features.usage_metering.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.InstituteUsageResponse;
import vacademy.io.admin_core_service.features.usage_metering.service.UsageReportService;
import vacademy.io.common.auth.model.CustomUserDetails;

/** An institute's own storage and bandwidth, for its admins (Settings → Storage & bandwidth). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/admin-core-service/institute/v1/usage")
public class InstituteUsageController {

    private final UsageReportService reportService;
    private final InstituteAccessValidator accessValidator;

    @GetMapping("/storage-bandwidth")
    public ResponseEntity<InstituteUsageResponse> storageAndBandwidth(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(reportService.instituteUsage(instituteId));
    }
}
