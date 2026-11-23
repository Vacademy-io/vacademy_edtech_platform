package vacademy.io.admin_core_service.features.commerce.parallelrun;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.DayView;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.DaysAnswer;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.SaveDayRequest;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Locale;

/**
 * The parallel run of a store ({@code /admin-core-service/commerce/v1/parallel-run}, WP-53):
 * <ul>
 *   <li>{@code GET /days?locationId=&from=&to=}: each day (at most 62) with the platform's
 *       figures, the saved old-system figures, the difference, the verdict, and the clean-day
 *       streak.</li>
 *   <li>{@code PUT /days/{date}?locationId=}: save the old system's day totals; the platform's
 *       figures are read again and stored with the verdict.</li>
 *   <li>{@code GET /export?locationId=&from=&to=&format=xlsx|csv}: the day list as a file.</li>
 * </ul>
 * Access and rules: {@link ParallelRunService}. Errors: 400 {@code VALIDATION},
 * {@code NOTE_REQUIRED}; 403 {@code FEATURE_DISABLED}, {@code ROLE_NOT_ALLOWED},
 * {@code LOCATION_NOT_ALLOWED}; 409 {@code SESSION_OPEN}, {@code DAY_CHANGED}; 429
 * {@code REPORTS_BUSY} / {@code REPORT_BUSY}; 503 {@code REPORT_TIMEOUT}.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/parallel-run")
public class ParallelRunController {

    static final MediaType CSV = new MediaType("text", "csv", StandardCharsets.UTF_8);
    static final MediaType XLSX = MediaType.parseMediaType(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    private final ParallelRunService service;

    public ParallelRunController(ParallelRunService service) {
        this.service = service;
    }

    @GetMapping("/days")
    public ResponseEntity<DaysAnswer> days(@RequestAttribute("user") CustomUserDetails user,
                                           @RequestParam("instituteId") String instituteId,
                                           @RequestParam(value = "locationId", required = false) String locationId,
                                           @RequestParam(value = "from", required = false)
                                           @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                           @RequestParam(value = "to", required = false)
                                           @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.days(user, instituteId, locationId, from, to));
    }

    @PutMapping("/days/{date}")
    public ResponseEntity<DayView> save(@RequestAttribute("user") CustomUserDetails user,
                                        @RequestParam("instituteId") String instituteId,
                                        @RequestParam(value = "locationId", required = false) String locationId,
                                        @PathVariable("date") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                                        LocalDate date,
                                        @RequestBody(required = false) SaveDayRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.save(user, instituteId, locationId, date, request));
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(@RequestAttribute("user") CustomUserDetails user,
                                         @RequestParam("instituteId") String instituteId,
                                         @RequestParam(value = "locationId", required = false) String locationId,
                                         @RequestParam(value = "from", required = false)
                                         @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                         @RequestParam(value = "to", required = false)
                                         @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                         @RequestParam(value = "format", required = false) String format,
                                         @RequestParam(value = "lang", required = false) String lang,
                                         @RequestHeader(value = HttpHeaders.ACCEPT_LANGUAGE, required = false)
                                         String acceptLanguage) {
        ParallelRunService.ExportFile file = service.export(user, instituteId, locationId, from, to, format,
                hindi(lang, acceptLanguage));
        return ResponseEntity.ok()
                .contentType("csv".equals(file.format()) ? CSV : XLSX)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + file.fileName() + "\"")
                .cacheControl(CacheControl.noStore())
                .body(file.bytes());
    }

    static boolean hindi(String lang, String acceptLanguage) {
        if (lang != null && !lang.isBlank()) {
            return lang.trim().toLowerCase(Locale.ROOT).startsWith("hi");
        }
        return acceptLanguage != null && acceptLanguage.trim().toLowerCase(Locale.ROOT).startsWith("hi");
    }
}
