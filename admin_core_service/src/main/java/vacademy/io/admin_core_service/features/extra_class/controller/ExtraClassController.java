package vacademy.io.admin_core_service.features.extra_class.controller;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakSettings;
import vacademy.io.admin_core_service.features.extra_class.service.ExtraClassService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Extra classes for a learner: a link to another batch for a few days, no fee, no message. Staff
 * of the institute (admins and teachers). Part of Settings → Breaks and holds
 * (ENROLMENT_BREAK_SETTING.enabled): off there = no new extra classes, but existing ones can still
 * be seen and ended.
 */
@RestController
@RequestMapping("/admin-core-service/v1/extra-classes")
@RequiredArgsConstructor
public class ExtraClassController {

    private final ExtraClassService service;
    private final EnrolmentBreakSettings settings;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/learner/{userId}")
    public ResponseEntity<Map<String, Object>> forLearner(@PathVariable String userId,
                                                          @RequestParam String instituteId,
                                                          @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("enabled", settings.isEnabled(instituteId));
        out.put("extra_classes", service.forLearner(instituteId, userId));
        return ResponseEntity.ok(out);
    }

    /** The institute's active batches, for the picker. */
    @GetMapping("/batches")
    public ResponseEntity<List<Map<String, Object>>> batches(@RequestParam String instituteId,
                                                             @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        return ResponseEntity.ok(service.batches(instituteId));
    }

    @PostMapping
    @Auditable(entityType = "LEARNER", action = "ACCESS_CHANGE", entityIdExpr = "#request?.userId",
            descriptionExpr = "'added an extra class for learner ' + #request?.userId")
    public ResponseEntity<Map<String, Object>> add(@RequestParam String instituteId,
                                                   @RequestBody AddRequest request,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        if (!settings.isEnabled(instituteId)) {
            throw new VacademyException("Extra classes are part of Breaks and holds, which is switched off for this "
                    + "institute. An admin can switch it on in Settings → Breaks and holds.");
        }
        if (request == null) throw new VacademyException("Choose the learner and the batch");
        String id = service.add(instituteId, request.getUserId(), request.getPackageSessionId(),
                request.getFromDate(), request.getToDate(), request.getNote(), user.getUserId(), user.getFullName());
        return ResponseEntity.ok(Map.of("id", id));
    }

    /** Ends it now, or removes it when it has not started yet. */
    @PostMapping("/{id}/end")
    @Auditable(entityType = "LEARNER", action = "ACCESS_CHANGE", entityIdExpr = "#id",
            descriptionExpr = "'ended extra class ' + #id")
    public ResponseEntity<Map<String, Object>> end(@PathVariable String id,
                                                   @RequestParam String instituteId,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        String result = service.end(instituteId, id, user.getUserId(), user.getFullName());
        return ResponseEntity.ok(Map.of("id", id, "result", result));
    }

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AddRequest {
        private String userId;
        private String packageSessionId;
        private LocalDate fromDate;
        private LocalDate toDate;
        private String note;
    }
}
