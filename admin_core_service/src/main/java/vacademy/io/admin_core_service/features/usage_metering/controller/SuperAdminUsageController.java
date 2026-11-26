package vacademy.io.admin_core_service.features.usage_metering.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
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
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.AllowanceListItem;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.AllowanceStatus;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.PlatformUsageResponse;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.UsageAllowance;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.UsageAllowanceRequest;
import vacademy.io.admin_core_service.features.usage_metering.dto.UsageDTOs.UsageCharge;
import vacademy.io.admin_core_service.features.usage_metering.service.UsageAllowanceService;
import vacademy.io.admin_core_service.features.usage_metering.service.UsageMeteringService;
import vacademy.io.admin_core_service.features.usage_metering.service.UsageReportService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
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
    private final UsageAllowanceService allowanceService;
    private final AtomicBoolean manualRunInProgress = new AtomicBoolean();

    /** @param month YYYY-MM for the bandwidth columns; defaults to the current UTC month */
    @GetMapping("/storage-bandwidth")
    public ResponseEntity<PlatformUsageResponse> storageAndBandwidth(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(value = "month", required = false) String month) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(reportService.platformUsage(month(month)));
    }

    /** Every institute on a storage and bandwidth allowance, with the month's extra charge. */
    @GetMapping("/allowances")
    public ResponseEntity<List<AllowanceListItem>> allowances(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(value = "month", required = false) String month) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        YearMonth ym = month(month);
        Map<String, UsageAllowance> all = allowanceService.findAll();
        Map<String, AllowanceStatus> statuses = allowanceService.statuses(all, ym);
        Map<String, String> names = reportService.instituteNames(all.keySet());
        List<AllowanceListItem> items = new ArrayList<>();
        all.forEach((id, a) -> items.add(new AllowanceListItem(names.get(id), a, statuses.get(id))));
        items.sort(Comparator.comparingDouble((AllowanceListItem i) -> i.getStatus().getTotalCharge()).reversed());
        return ResponseEntity.ok(items);
    }

    /** One institute's allowance with this month and last month; allowance null when it has none. */
    @GetMapping("/institutes/{instituteId}/allowance")
    public ResponseEntity<Map<String, Object>> allowance(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(allowanceView(instituteId));
    }

    /** Puts the institute on an allowance, or changes its terms. Takes effect for the whole current month. */
    @PutMapping("/institutes/{instituteId}/allowance")
    public ResponseEntity<Map<String, Object>> saveAllowance(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId,
            @RequestBody UsageAllowanceRequest request) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        allowanceService.save(instituteId, request, user.getUserId());
        log.info("[usage-allowance] {} set allowance for institute {}", user.getUserId(), instituteId);
        return ResponseEntity.ok(allowanceView(instituteId));
    }

    /** Takes the institute off its allowance; its admins see plain usage again. */
    @DeleteMapping("/institutes/{instituteId}/allowance")
    public ResponseEntity<Map<String, Object>> removeAllowance(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        boolean removed = allowanceService.remove(instituteId);
        log.info("[usage-allowance] {} removed allowance for institute {} (existed: {})", user.getUserId(), instituteId, removed);
        return ResponseEntity.ok(Map.of("removed", removed));
    }

    /** The institute's monthly wallet charges, newest first. */
    @GetMapping("/institutes/{instituteId}/charges")
    public ResponseEntity<List<UsageCharge>> charges(
            @RequestAttribute("user") CustomUserDetails user,
            @PathVariable("instituteId") String instituteId) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        return ResponseEntity.ok(allowanceService.charges(instituteId));
    }

    /**
     * Charges a finished month now (default: the month the nightly job would charge), for
     * a re-run after a failure. Already-charged months are skipped.
     */
    @PostMapping("/charge")
    public ResponseEntity<Map<String, Object>> chargeNow(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(value = "month", required = false) String month) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        YearMonth ym = month == null || month.isBlank()
                ? UsageAllowanceService.monthToCharge(LocalDate.now(ZoneOffset.UTC)) : YearMonth.parse(month);
        if (ym == null || !ym.isBefore(YearMonth.now(ZoneOffset.UTC))) {
            return ResponseEntity.badRequest().body(Map.of("charged", 0,
                    "reason", "only a finished month can be charged, from the 3rd of the next month"));
        }
        if (ym.equals(YearMonth.now(ZoneOffset.UTC).minusMonths(1)) && LocalDate.now(ZoneOffset.UTC).getDayOfMonth() < 3) {
            return ResponseEntity.badRequest().body(Map.of("charged", 0,
                    "reason", "last month's bandwidth is final from the 3rd"));
        }
        log.info("[usage-charge] {} ran a manual charge for {}", user.getUserId(), ym);
        return ResponseEntity.ok(Map.of("month", ym.toString(), "charged", allowanceService.chargeMonth(ym)));
    }

    private Map<String, Object> allowanceView(String instituteId) {
        UsageAllowance a = allowanceService.find(instituteId);
        Map<String, Object> out = new HashMap<>();
        out.put("allowance", a);
        out.put("charges", allowanceService.charges(instituteId));
        if (a != null) {
            YearMonth now = YearMonth.now(ZoneOffset.UTC);
            out.put("current_month", allowanceService.status(a, now));
            out.put("previous_month", allowanceService.status(a, now.minusMonths(1)));
        }
        return out;
    }

    private static YearMonth month(String month) {
        return month == null || month.isBlank() ? YearMonth.now(ZoneOffset.UTC) : YearMonth.parse(month);
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
