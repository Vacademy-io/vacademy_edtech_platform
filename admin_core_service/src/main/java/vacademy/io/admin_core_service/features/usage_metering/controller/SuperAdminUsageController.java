package vacademy.io.admin_core_service.features.usage_metering.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.PlatformUsageResponse;
import vacademy.io.admin_core_service.features.usage_metering.service.UsageMeteringService;
import vacademy.io.admin_core_service.features.usage_metering.service.UsageReportService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/** Every institute's storage and bandwidth with our approximate cost, for platform super admins. */
@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("/admin-core-service/super-admin/v1/usage")
public class SuperAdminUsageController {

    private final UsageReportService reportService;
    private final UsageMeteringService meteringService;
    private final AtomicBoolean manualRunInProgress = new AtomicBoolean();

    /** @param month YYYY-MM for the bandwidth columns; defaults to the current UTC month */
    @GetMapping("/storage-bandwidth")
    public ResponseEntity<PlatformUsageResponse> storageAndBandwidth(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(value = "month", required = false) String month) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        YearMonth ym = month == null || month.isBlank() ? YearMonth.now(ZoneOffset.UTC) : YearMonth.parse(month);
        return ResponseEntity.ok(reportService.platformUsage(ym));
    }

    /**
     * Re-meters now, in the background: storage from the newest inventory report and
     * bandwidth for {@code date} (UTC; default yesterday). For a first fill or a re-run
     * after a fix; the nightly job does this on its own.
     */
    @PostMapping("/meter")
    public ResponseEntity<Map<String, Object>> meterNow(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(value = "date", required = false) String date) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        if (!meteringService.configured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("started", false, "reason", "usage S3 key not configured"));
        }
        LocalDate day = date == null || date.isBlank() ? LocalDate.now(ZoneOffset.UTC).minusDays(1) : LocalDate.parse(date);
        if (!manualRunInProgress.compareAndSet(false, true)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("started", false, "reason", "a run is in progress"));
        }
        CompletableFuture.runAsync(() -> {
            try {
                meteringService.meterStorage();
                meteringService.meterBandwidth(day);
            } catch (Exception e) {
                log.error("[usage-metering] manual run for {} failed", day, e);
            } finally {
                manualRunInProgress.set(false);
            }
        });
        return ResponseEntity.accepted().body(Map.of("started", true, "bandwidth_date", day.toString()));
    }
}
