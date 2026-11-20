package vacademy.io.admin_core_service.features.commerce.accounts.period;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PeriodLockRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PeriodLockView;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewView;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;

/**
 * The period lock ({@code /commerce/v1/period-lock}). Any manager or accountant reads it; the
 * preview and a change need one who acts for every location, and reopening closed books needs a
 * manager with their own PIN. The access checks are in {@link PeriodLockService}.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/period-lock")
public class PeriodLockController {

    private final PeriodLockService periodLockService;

    public PeriodLockController(PeriodLockService periodLockService) {
        this.periodLockService = periodLockService;
    }

    @GetMapping
    public ResponseEntity<PeriodLockView> read(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(periodLockService.read(user, instituteId));
    }

    @GetMapping("/preview")
    public ResponseEntity<PreviewView> preview(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "date", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return ResponseEntity.ok(periodLockService.preview(user, instituteId, date));
    }

    @PutMapping
    public ResponseEntity<PeriodLockView> change(@RequestAttribute("user") CustomUserDetails user,
                                                 @RequestParam("instituteId") String instituteId,
                                                 @RequestBody PeriodLockRequest request) {
        return ResponseEntity.ok(periodLockService.change(user, instituteId, request));
    }
}
