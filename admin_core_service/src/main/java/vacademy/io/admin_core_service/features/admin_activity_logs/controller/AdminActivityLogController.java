package vacademy.io.admin_core_service.features.admin_activity_logs.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.admin_activity_logs.dto.AdminActivityLogFilterDTO;
import vacademy.io.admin_core_service.features.admin_activity_logs.dto.AdminActivityLogResponseDTO;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.service.AdminActivityLogReadService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;

@RestController
@RequestMapping("/admin-core-service/audit/v1")
public class AdminActivityLogController {

    @Autowired
    private AdminActivityLogReadService readService;

    @Autowired
    private InstituteAccessValidator instituteAccessValidator;

    /**
     * Page of audit rows for the calling institute.
     *
     * <p>{@code actorId}, {@code entityType} and {@code action} each accept a
     * comma-separated list ({@code actorId=a,b,c}) and have plural aliases, so
     * the UI's multi-selects need no new params and every existing single-value
     * link keeps working. Commas, not repeated {@code param[]=} keys — bracketed
     * array params are rejected by the ingress before they reach this service.
     */
    @GetMapping("/logs")
    public ResponseEntity<Page<AdminActivityLogResponseDTO>> list(
            HttpServletRequest request,
            @RequestParam(required = false) Long startDate,
            @RequestParam(required = false) Long endDate,
            @RequestParam(required = false) String actorId,
            @RequestParam(required = false) String actorIds,
            @RequestParam(required = false) String entityType,
            @RequestParam(required = false) String entityTypes,
            @RequestParam(required = false) String entityId,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String actions,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        String instituteId = requireInstituteId(request);

        AdminActivityLogFilterDTO filter = buildFilter(
                startDate, endDate, actorId, actorIds, entityType, entityTypes, entityId, action, actions);

        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        return ResponseEntity.ok(readService.list(instituteId, filter, pageable));
    }

    @GetMapping("/logs/{id}")
    public ResponseEntity<AdminActivityLogResponseDTO> getById(
            HttpServletRequest request,
            @PathVariable String id) {
        String instituteId = requireInstituteId(request);
        return ResponseEntity.ok(readService.findById(instituteId, id));
    }

    /**
     * Stream a CSV export of the rows matching the same filter set used by
     * the list endpoint. Honors the active date range, resource, activity,
     * and actor filters. Capped server-side at 50,000 rows.
     */
    @GetMapping(value = "/logs/export.csv", produces = "text/csv")
    public ResponseEntity<byte[]> exportCsv(
            HttpServletRequest request,
            @RequestParam(required = false) Long startDate,
            @RequestParam(required = false) Long endDate,
            @RequestParam(required = false) String actorId,
            @RequestParam(required = false) String actorIds,
            @RequestParam(required = false) String entityType,
            @RequestParam(required = false) String entityTypes,
            @RequestParam(required = false) String entityId,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String actions) {

        String instituteId = requireInstituteId(request);

        AdminActivityLogFilterDTO filter = buildFilter(
                startDate, endDate, actorId, actorIds, entityType, entityTypes, entityId, action, actions);

        byte[] csv = readService.exportCsv(instituteId, filter);

        String filename = "admin-activity-logs-"
                + LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE) + ".csv";

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("text/csv"))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + filename + "\"")
                .body(csv);
    }

    /** Shared by the list and the CSV export so both honour the same filters. */
    private AdminActivityLogFilterDTO buildFilter(Long startDate,
            Long endDate,
            String actorId,
            String actorIds,
            String entityType,
            String entityTypes,
            String entityId,
            String action,
            String actions) {
        return AdminActivityLogFilterDTO.builder()
                .startDate(startDate != null ? new Timestamp(startDate) : null)
                .endDate(endDate != null ? new Timestamp(endDate) : null)
                .actorIds(csvValues(actorId, actorIds))
                .entityTypes(csvValues(entityType, entityTypes))
                .entityId(entityId)
                .actions(csvValues(action, actions))
                .build();
    }

    /**
     * Splits one or more comma-separated params into a de-duplicated list.
     * Null when nothing usable was passed, so the spec skips the predicate
     * entirely rather than emitting an {@code IN ()} that matches no rows.
     */
    private List<String> csvValues(String... params) {
        LinkedHashSet<String> values = new LinkedHashSet<>();
        for (String param : params) {
            if (param == null || param.isBlank()) {
                continue;
            }
            Arrays.stream(param.split(","))
                    .map(String::trim)
                    .filter(value -> !value.isEmpty())
                    .forEach(values::add);
        }
        return values.isEmpty() ? null : new ArrayList<>(values);
    }

    /**
     * The calling institute (clientId header), once the caller is known to be its ADMIN. The
     * log is admin-only; no root bypass, since learners and invited staff are root users.
     */
    private String requireInstituteId(HttpServletRequest request) {
        String instituteId = request.getHeader("clientId");
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("Missing clientId header");
        }
        instituteAccessValidator.requireInstituteAdmin((CustomUserDetails) request.getAttribute("user"), instituteId);
        return instituteId;
    }
}
