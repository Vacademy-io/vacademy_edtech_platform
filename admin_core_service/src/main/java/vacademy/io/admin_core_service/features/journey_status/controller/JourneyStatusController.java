package vacademy.io.admin_core_service.features.journey_status.controller;

import com.fasterxml.jackson.annotation.JsonProperty;
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
import net.javacrumbs.shedlock.core.LockConfiguration;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.core.SimpleLock;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.journey_status.service.JourneyRiskService;
import vacademy.io.admin_core_service.features.journey_status.service.JourneyStatusService;
import vacademy.io.admin_core_service.features.journey_status.service.ReentryService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Journey status per learner per batch. Staff of the institute (or a platform super admin) only, no root-user bypass; every query is scoped to
 * the institute. Off per institute (JOURNEY_STATUS_SETTING); reads answer {enabled:false} while
 * off, changes are refused.
 */
@RestController
@RequestMapping("/admin-core-service/journey-status/v1")
@RequiredArgsConstructor
public class JourneyStatusController {

    private final JourneyStatusService service;
    private final JourneyRiskService riskService;
    private final ReentryService reentryService;
    private final InstituteAccessValidator instituteAccessValidator;
    private final LockProvider lockProvider;

    /** The status list and rules, defaults filled in. */
    @GetMapping("/settings")
    public ResponseEntity<Map<String, Object>> settings(@RequestParam("instituteId") String instituteId,
                                                        @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaffOrSuperAdmin(user, instituteId);
        service.forget(instituteId);
        return ResponseEntity.ok(service.config(instituteId).toJson());
    }

    /** One learner's status in each current batch, and their journey history. */
    @GetMapping("/learner/{userId}")
    public ResponseEntity<Map<String, Object>> learner(@PathVariable String userId,
                                                       @RequestParam("instituteId") String instituteId,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaffOrSuperAdmin(user, instituteId);
        return ResponseEntity.ok(service.learner(instituteId, userId));
    }

    /** Statuses for a page of the student list (one query by the page's user ids). */
    @PostMapping("/for-users")
    public ResponseEntity<Map<String, Object>> forUsers(@RequestParam("instituteId") String instituteId,
                                                        @RequestBody UsersRequest req,
                                                        @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaffOrSuperAdmin(user, instituteId);
        if (!service.isEnabled(instituteId)) return ResponseEntity.ok(Map.of("enabled", false, "statuses", Map.of()));
        return ResponseEntity.ok(Map.of("enabled", true, "statuses", service.forUsers(instituteId, req.getUserIds())));
    }

    /** Current enrolments per status, for the list filter. */
    @GetMapping("/counts")
    public ResponseEntity<Map<String, Object>> counts(@RequestParam("instituteId") String instituteId,
                                                      @RequestParam(value = "packageSessionIds", required = false) List<String> packageSessionIds,
                                                      @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaffOrSuperAdmin(user, instituteId);
        if (!service.isEnabled(instituteId)) return ResponseEntity.ok(Map.of("enabled", false));
        return ResponseEntity.ok(service.counts(instituteId, packageSessionIds));
    }

    /**
     * Change the status of one or many learners. Each item names a learner and a batch; an item
     * without a batch (or a user in user_ids) changes every current batch of that learner, within
     * package_session_ids when given.
     */
    @PostMapping("/set")
    @Auditable(entityType = "LEARNER", action = "UPDATE",
            entityIdExpr = "#req?.userIds != null && !#req.userIds.isEmpty() ? #req.userIds[0] : (#req?.items != null && !#req.items.isEmpty() ? #req.items[0].userId : null)",
            descriptionExpr = "'set journey status ' + #req?.statusKey")
    public ResponseEntity<Map<String, Object>> set(@RequestParam("instituteId") String instituteId,
                                                   @RequestBody SetRequest req,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaffOrSuperAdmin(user, instituteId);
        List<JourneyStatusService.Target> targets = new ArrayList<>();
        if (req.getItems() != null) {
            req.getItems().forEach(i -> targets.add(new JourneyStatusService.Target(i.getUserId(), i.getPackageSessionId())));
        }
        if (req.getUserIds() != null) {
            for (String u : req.getUserIds()) {
                if (req.getPackageSessionIds() == null || req.getPackageSessionIds().isEmpty()) {
                    targets.add(new JourneyStatusService.Target(u, null));
                } else {
                    req.getPackageSessionIds().forEach(ps -> targets.add(new JourneyStatusService.Target(u, ps)));
                }
            }
        }
        LocalDate next;
        try {
            next = req.getNextActionDate() == null || req.getNextActionDate().isBlank() ? null
                    : LocalDate.parse(req.getNextActionDate().trim().substring(0, Math.min(10, req.getNextActionDate().trim().length())));
        } catch (Exception e) {
            throw new VacademyException("Next action date must be a date (YYYY-MM-DD)");
        }
        int changed = service.setManual(instituteId, targets, req.getStatusKey(), req.getReason(), next,
                user.getUserId(), user.getFullName());
        return ResponseEntity.ok(Map.of("updated", changed));
    }

    /**
     * Starts a re-entry for one learner-in-batch: Re-entry status (next action = the return date),
     * plus an optional extra class and bridge course, in one transaction. No fee, no message. A
     * running pause on the batch is refused unless resume_pause is true (then it is resumed first,
     * with the institute's default resume choice).
     */
    @PostMapping("/reentry")
    @Auditable(entityType = "LEARNER", action = "UPDATE", entityIdExpr = "#req?.userId",
            descriptionExpr = "'started re-entry for learner ' + #req?.userId")
    public ResponseEntity<Map<String, Object>> reentry(@RequestParam("instituteId") String instituteId,
                                                       @RequestBody ReentryRequest req,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaffOrSuperAdmin(user, instituteId);
        if (req == null) throw new VacademyException("Choose the learner and the batch");
        ReentryService.Request r = new ReentryService.Request(req.getUserId(), req.getPackageSessionId(), req.getReason(),
                link(req.getExtraClass(), "extra class"), link(req.getBridgeCourse(), "bridge course"),
                date(req.getReturnOn(), "Return date"), Boolean.TRUE.equals(req.getResumePause()));
        return ResponseEntity.ok(reentryService.start(instituteId, r, user));
    }

    private static ReentryService.Link link(LinkRequest l, String what) {
        if (l == null || ((l.getPackageSessionId() == null || l.getPackageSessionId().isBlank())
                && l.getFrom() == null && l.getTo() == null)) return null;
        return new ReentryService.Link(l.getPackageSessionId(), date(l.getFrom(), "The " + what + "'s first day"),
                date(l.getTo(), "The " + what + "'s last day"));
    }

    /** "2026-12-01" (or a longer ISO string starting with a date) → LocalDate; blank → null. */
    static LocalDate date(String v, String what) {
        if (v == null || v.isBlank()) return null;
        String t = v.trim();
        try {
            return LocalDate.parse(t.substring(0, Math.min(10, t.length())));
        } catch (Exception e) {
            throw new VacademyException(what + " must be a date (YYYY-MM-DD)");
        }
    }

    /**
     * Runs the At Risk check for this institute now (the daily job does the same). Sends nothing.
     * Institute admins (or a platform super admin) only. Takes the daily job's ShedLock, so it
     * never runs alongside the job or another manual run.
     */
    @PostMapping("/run-risk-check")
    @Auditable(entityType = "INSTITUTE", action = "UPDATE", entityIdExpr = "#instituteId",
            descriptionExpr = "'ran the journey At Risk check'")
    public ResponseEntity<Map<String, Object>> runRiskCheck(@RequestParam("instituteId") String instituteId,
                                                            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdminOrSuperAdmin(user, instituteId);
        if (!service.isEnabled(instituteId)) throw new VacademyException("Journey status is switched off for this institute");
        Optional<SimpleLock> lock = lockProvider.lock(new LockConfiguration(Instant.now(),
                vacademy.io.admin_core_service.features.journey_status.job.JourneyRiskJob.LOCK_NAME,
                Duration.ofMinutes(50), Duration.ZERO));
        if (lock.isEmpty()) throw new VacademyException("The At Risk check is already running. Try again in a few minutes.");
        try {
            service.forget(instituteId);
            int[] r = riskService.runInstitute(instituteId);
            return ResponseEntity.ok(Map.of("marked_at_risk", r[0], "returned", r[1]));
        } finally {
            lock.get().unlock();
        }
    }

    @Data
    public static class LinkRequest {
        @JsonProperty("package_session_id") private String packageSessionId;
        @JsonProperty("from") private String from;
        @JsonProperty("to") private String to;
    }

    @Data
    public static class ReentryRequest {
        @JsonProperty("user_id") private String userId;
        @JsonProperty("package_session_id") private String packageSessionId;
        @JsonProperty("reason") private String reason;
        @JsonProperty("extra_class") private LinkRequest extraClass;
        @JsonProperty("bridge_course") private LinkRequest bridgeCourse;
        @JsonProperty("return_on") private String returnOn;
        @JsonProperty("resume_pause") private Boolean resumePause;
    }

    @Data
    public static class UsersRequest {
        @JsonProperty("user_ids") private List<String> userIds;
    }

    @Data
    public static class Item {
        @JsonProperty("user_id") private String userId;
        @JsonProperty("package_session_id") private String packageSessionId;
    }

    @Data
    public static class SetRequest {
        @JsonProperty("items") private List<Item> items;
        @JsonProperty("user_ids") private List<String> userIds;
        @JsonProperty("package_session_ids") private List<String> packageSessionIds;
        @JsonProperty("status_key") private String statusKey;
        @JsonProperty("reason") private String reason;
        @JsonProperty("next_action_date") private String nextActionDate;
    }
}
