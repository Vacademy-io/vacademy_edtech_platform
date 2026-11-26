package vacademy.io.admin_core_service.features.journey_status.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakGuard;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakService;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakSettings;
import vacademy.io.admin_core_service.features.extra_class.service.ExtraClassService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Re-entry: a learner coming back after a long break. In one transaction the batch they return to
 * moves to the institute's Re-entry status (the first status of kind REENTRY), with the return date
 * as its next action date, and up to two temporary batch links are added through
 * {@link ExtraClassService#add}: an extra class (sit in another batch for a while to catch up)
 * and a bridge course (a short catch-up batch). The JOURNEY_CASE timeline entry lists the links.
 *
 * <p>A running pause on that batch blocks it ("Resume the pause first"), unless the caller asks
 * for {@code resumePause}: then the pause is resumed in the same transaction through the same
 * method the Resume button uses ({@link EnrolmentBreakService#end}, the institute's default resume
 * choice), so access comes back and the membership dates move exactly as a normal resume would.
 *
 * <p>No fee, no message: extra-class rows carry no plan, and nothing here fires a workflow. The
 * daily job ({@link JourneyRiskService#returnReentries}) moves the learner back to the default
 * status after the return date when {@code reentry_auto_return} is on.
 */
@Slf4j
@Service
public class ReentryService {

    public static final String NOTE_EXTRA = "Re-entry: extra class";
    public static final String NOTE_BRIDGE = "Re-entry: bridge course";

    @Autowired private JdbcTemplate jdbc;
    @Autowired private JourneyStatusService statusService;
    @Autowired private ExtraClassService extraClassService;
    @Autowired private EnrolmentBreakService breakService;
    @Autowired private EnrolmentBreakSettings breakSettings;
    @Autowired private EnrolmentBreakGuard guard;
    @Autowired private PlatformTransactionManager transactionManager;

    /** A temporary link to another batch, first and last day inclusive. */
    public record Link(String packageSessionId, LocalDate from, LocalDate to) {}

    public record Request(String userId, String packageSessionId, String reason, Link extraClass, Link bridgeCourse,
                          LocalDate returnOn, boolean resumePause) {}

    /** What validation settled: the status to set, the trimmed reason and the return date. */
    record Plan(String statusKey, String reason, LocalDate returnOn) {}

    /**
     * Checks a request against the setting before anything is read or written. The return date
     * defaults to the later last day of the two links (none when there are no links).
     */
    static Plan validate(JourneyStatusConfig cfg, Request r, LocalDate today) {
        if (!cfg.enabled()) throw new VacademyException("Journey status is switched off for this institute");
        String key = cfg.reentryStatus();
        if (key == null) {
            throw new VacademyException("No Re-entry status is set up. Add a status of kind Re-entry in Settings → Journey status.");
        }
        if (r == null || blank(r.userId())) throw new VacademyException("Choose the learner");
        if (blank(r.packageSessionId())) throw new VacademyException("Choose the batch the learner is coming back to");
        String reason = JourneyStatusService.trimTo(r.reason(), 500);
        if (reason == null) throw new VacademyException("Add a reason for the re-entry");
        checkLink(r.extraClass(), "extra class", r.packageSessionId());
        checkLink(r.bridgeCourse(), "bridge course", r.packageSessionId());
        if (r.extraClass() != null && r.bridgeCourse() != null
                && r.extraClass().packageSessionId().equals(r.bridgeCourse().packageSessionId())
                && !r.extraClass().from().isAfter(r.bridgeCourse().to())
                && !r.bridgeCourse().from().isAfter(r.extraClass().to())) {
            throw new VacademyException("The extra class and the bridge course are the same batch on overlapping dates");
        }
        LocalDate returnOn = r.returnOn();
        if (returnOn == null) {
            for (Link l : new Link[]{r.extraClass(), r.bridgeCourse()}) {
                if (l != null && (returnOn == null || l.to().isAfter(returnOn))) returnOn = l.to();
            }
        } else if (returnOn.isBefore(today)) {
            throw new VacademyException("The return date cannot be in the past");
        }
        return new Plan(key, reason, returnOn);
    }

    private static void checkLink(Link l, String what, String enrolment) {
        if (l == null) return;
        if (blank(l.packageSessionId())) throw new VacademyException("Choose the batch for the " + what);
        if (l.from() == null || l.to() == null) throw new VacademyException("Choose the first and the last day of the " + what);
        if (l.packageSessionId().equals(enrolment)) {
            throw new VacademyException("The " + what + " must be a different batch from the one the learner is coming back to");
        }
    }

    /**
     * Starts the re-entry. Returns {status_key, return_on, links:[{kind, access_id, ...}],
     * resumed_pauses}. Everything or nothing: a failing link undoes the status change too.
     */
    public Map<String, Object> start(String instituteId, Request req, CustomUserDetails actor) {
        statusService.forget(instituteId);
        JourneyStatusConfig cfg = statusService.config(instituteId);
        LocalDate today = guard.today(instituteId);
        Plan plan = validate(cfg, req, today);
        if ((req.extraClass() != null || req.bridgeCourse() != null) && !breakSettings.isEnabled(instituteId)) {
            throw new VacademyException("Extra classes are part of Breaks and holds, which is switched off for this "
                    + "institute. Switch it on in Settings → Breaks and holds, or start the re-entry without them.");
        }
        String actorId = actor == null ? null : actor.getUserId();
        String actorName = actor == null ? null : actor.getFullName();

        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        return tx.execute(s -> {
            if (statusService.expand(instituteId, List.of(new JourneyStatusService.Target(req.userId(), req.packageSessionId())))
                    .isEmpty()) {
                throw new VacademyException("This learner is not in that batch in this institute");
            }
            List<String> pauses = runningPauses(instituteId, req.userId(), req.packageSessionId());
            if (!pauses.isEmpty() && !req.resumePause()) {
                throw new VacademyException("This learner has a running pause on this batch. Resume the pause first "
                        + "(or tick \"Resume the pause\" to do it in the same step).");
            }
            for (String id : pauses) breakService.end(id, null, instituteId, actor);

            List<Map<String, Object>> links = new ArrayList<>();
            List<String> lines = new ArrayList<>();
            addLink(instituteId, req.userId(), "EXTRA_CLASS", req.extraClass(), NOTE_EXTRA, actorId, actorName, links, lines);
            addLink(instituteId, req.userId(), "BRIDGE_COURSE", req.bridgeCourse(), NOTE_BRIDGE, actorId, actorName, links, lines);

            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("reentry", true);
            meta.put("links", links);
            if (!pauses.isEmpty()) meta.put("resumed_break_ids", pauses);
            statusService.apply(instituteId, cfg, req.userId(), req.packageSessionId(), plan.statusKey(), plan.reason(),
                    plan.returnOn(), JourneyStatusService.SOURCE_REENTRY, actorId, actorName, null, true, meta, lines);

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("status_key", plan.statusKey());
            out.put("return_on", plan.returnOn() == null ? null : plan.returnOn().toString());
            out.put("links", links);
            out.put("resumed_pauses", pauses.size());
            return out;
        });
    }

    private void addLink(String instituteId, String userId, String kind, Link l, String note, String actorId, String actorName,
                         List<Map<String, Object>> links, List<String> lines) {
        if (l == null) return;
        String accessId = extraClassService.add(instituteId, userId, l.packageSessionId(), l.from(), l.to(), note, actorId, actorName);
        String batch = statusService.courseLabel(l.packageSessionId());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", kind);
        m.put("access_id", accessId);
        m.put("package_session_id", l.packageSessionId());
        m.put("batch", batch);
        m.put("from", l.from().toString());
        m.put("to", l.to().toString());
        links.add(m);
        lines.add(("EXTRA_CLASS".equals(kind) ? "Extra class: " : "Bridge course: ")
                + (batch != null ? batch : l.packageSessionId()) + ", " + l.from() + " to " + l.to());
    }

    /** Running pauses that cover this batch (on the batch itself or on the whole learner). */
    List<String> runningPauses(String instituteId, String userId, String packageSessionId) {
        return jdbc.queryForList("""
                SELECT id FROM enrolment_break
                 WHERE institute_id = ? AND user_id = ? AND kind = 'PAUSE' AND status = 'ACTIVE'
                   AND (package_session_id IS NULL OR package_session_id = ?)
                """, String.class, instituteId, userId, packageSessionId);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
