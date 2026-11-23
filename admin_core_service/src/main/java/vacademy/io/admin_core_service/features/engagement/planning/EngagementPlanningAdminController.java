package vacademy.io.admin_core_service.features.engagement.planning;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementPlanService;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Planning coverage on the dashboard, and the weekly planning email for admins. */
@RestController
@RequestMapping("/admin-core-service/engagement/admin/v1/planning")
@RequiredArgsConstructor
public class EngagementPlanningAdminController {

    private final EngagementPlanningService planningService;
    private final EngagementTeacherScope teacherScope;
    private final EngagementPlanService planService;
    private final InstituteAccessValidator instituteAccessValidator;
    private final InstituteTimezoneService timezoneService;
    private final AuthService authService;

    /**
     * Batches with learners and no published tasks in the next seven days. {@code mine=true}
     * limits it to the batches the caller teaches.
     */
    @GetMapping("/coverage")
    public ResponseEntity<EngagementPlanningService.Coverage> coverage(
            @RequestParam String instituteId,
            @RequestParam(defaultValue = "false") boolean mine,
            @RequestParam(defaultValue = "5") int limit,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        Set<String> only = mine ? teacherScope.cohortsOf(user.getUserId(), instituteId) : null;
        return ResponseEntity.ok(planningService.coverage(instituteId, only, Math.max(0, Math.min(50, limit))));
    }

    /** One row of the "this week's emails" table. */
    public record RequestRow(String id, String packageSessionId, String batchLabel, String teacherName,
                             String subjects, String status, String topic, String error, String planId,
                             String sentAt, String remindedAt, String submittedAt) {}

    public record WeekRequests(String weekStart, List<RequestRow> rows) {}

    /** The planning emails for the week the next email asks about (or {@code weekStart}). */
    @GetMapping("/requests")
    public ResponseEntity<WeekRequests> requests(
            @RequestParam String instituteId,
            @RequestParam(required = false) String weekStart,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireAdminAccess(user, instituteId);
        LocalDate week = weekStart == null || weekStart.isBlank()
                ? currentWeek(instituteId) : LocalDate.parse(weekStart);
        List<EngagementPlanningRequest> rows = planningService.requestsFor(instituteId, week);
        Map<String, String> labels = planService.batchLabels(
                rows.stream().map(EngagementPlanningRequest::getPackageSessionId).distinct().toList());
        Map<String, String> names = new HashMap<>();
        List<String> teacherIds = rows.stream().map(EngagementPlanningRequest::getTeacherUserId).distinct().toList();
        if (!teacherIds.isEmpty()) {
            try {
                for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(teacherIds)) {
                    if (u != null && u.getId() != null) names.put(u.getId(), u.getFullName());
                }
            } catch (Exception ignored) {
                // names are a nicety; the table still shows the rows
            }
        }
        List<RequestRow> out = new ArrayList<>();
        for (EngagementPlanningRequest r : rows) {
            out.add(new RequestRow(r.getId(), r.getPackageSessionId(), labels.get(r.getPackageSessionId()),
                    names.get(r.getTeacherUserId()), r.getSubjects(), r.getStatus(), r.getTopic(), r.getError(),
                    r.getPlanId(), str(r.getSentAt()), str(r.getRemindedAt()), str(r.getSubmittedAt())));
        }
        return ResponseEntity.ok(new WeekRequests(week.toString(), out));
    }

    /**
     * Send the planning email now, for the week the next email would ask about. Teachers
     * already asked for that week are skipped. {@code packageSessionId} limits it to one batch.
     */
    @PostMapping("/send-now")
    public ResponseEntity<EngagementPlanningService.SendSummary> sendNow(
            @RequestParam String instituteId,
            @RequestParam(required = false) String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireAdminAccess(user, instituteId);
        Set<String> only = packageSessionId == null || packageSessionId.isBlank()
                ? null : Set.of(packageSessionId);
        return ResponseEntity.ok(planningService.sendWeek(instituteId, currentWeek(instituteId), only));
    }

    private LocalDate currentWeek(String instituteId) {
        return PlanningNudgeSettings.weekToPlan(LocalDate.now(timezoneService.getZone(instituteId)));
    }

    private static String str(java.sql.Timestamp t) {
        return t == null ? null : t.toInstant().toString();
    }
}
