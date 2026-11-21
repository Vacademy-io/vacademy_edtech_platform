package vacademy.io.admin_core_service.features.live_session.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.live_session.dto.AttendanceCriteriaConfigDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionLogs;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionLogsRepository;
import vacademy.io.admin_core_service.features.live_session.scheduler.LiveSessionNotificationProcessor;

import java.sql.Time;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Applies a session's minimum-attendance rule once the provider has told us who
 * was really in the class and for how long.
 *
 * <p>Provider-neutral on purpose: BBB supplies the roster from its end-of-meeting
 * analytics callback, Zoom from its past-meeting participants report. Google Meet
 * cannot be supported — its API returns participants with no email
 * ({@code GoogleConferenceService} sets {@code email(null)}), so a Meet
 * participant cannot be tied back to a learner.
 *
 * <p>A learner missing from the roster counts as zero minutes, so "clicked Join
 * and never arrived" is caught by the same comparison as "left after ten
 * minutes" — no separate rule.
 *
 * <p>Two things it never does: it never touches a row an admin marked by hand
 * ({@code statusType = OFFLINE}), because a teacher's judgement outranks the
 * roster; and it never marks a moderator absent, because teachers run the class
 * rather than attend it.
 *
 * <p>Every evaluation is written to {@code attendance_evaluation_json} — attendance
 * is disputed data, so an absence must always be explainable after the fact.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AttendanceCriteriaEvaluator {

    private static final String STATUS_PRESENT = "PRESENT";
    private static final String STATUS_ABSENT = "ABSENT";
    private static final String STATUS_TYPE_ADMIN = "OFFLINE";

    private final LiveSessionLogsRepository liveSessionLogsRepository;
    private final AttendanceCriteriaService attendanceCriteriaService;
    private final vacademy.io.admin_core_service.features.live_session.repository.LiveSessionParticipantRepository participantRepository;
    private final ObjectMapper objectMapper;

    /**
     * Reaches back into session/institute services; @Lazy keeps that out of this
     * bean's construction graph so an edge there cannot fail context startup.
     */
    @Autowired
    @Lazy
    private LiveSessionNotificationProcessor notificationProcessor;

    /**
     * Cheap gate so a session that never opted in pays nothing: reading the rule
     * is a small JSON parse of a column we already hold, while the snapshot and
     * evaluation below load every attendance row for the schedule.
     */
    public boolean isActiveFor(LiveSession session) {
        return session != null && attendanceCriteriaService.resolve(session).isActive();
    }

    /**
     * User ids an admin marked by hand, captured <i>before</i> the provider sync
     * runs. Both the BBB and Zoom paths upgrade a non-PRESENT row to PRESENT and
     * reset statusType to ONLINE, so by evaluation time the OFFLINE flag is
     * already gone. Snapshotting first is what makes "a teacher's manual mark
     * outranks the roster" actually true.
     *
     * @return null if the snapshot failed — the caller must then skip evaluation
     *         rather than risk overwriting a mark it can no longer see.
     */
    public Set<String> snapshotAdminMarked(String scheduleId) {
        try {
            return liveSessionLogsRepository.findAllAttendanceByScheduleId(scheduleId).stream()
                    .filter(l -> STATUS_TYPE_ADMIN.equalsIgnoreCase(l.getStatusType()))
                    .map(LiveSessionLogs::getUserSourceId)
                    .filter(StringUtils::hasText)
                    .collect(Collectors.toSet());
        } catch (Exception e) {
            log.warn("attendance_criteria.admin_snapshot_failed scheduleId={}: {}", scheduleId, e.getMessage());
            return null;
        }
    }

    /**
     * @param roster      every user id the provider reported as present, mapped to
     *                    whether they were a moderator. Must be the complete
     *                    roster: anyone absent from it is judged to have attended
     *                    zero minutes.
     * @param adminMarked from {@link #snapshotAdminMarked}; null means the
     *                    snapshot failed and nothing is changed.
     */
    public void evaluate(LiveSession session, SessionSchedule schedule,
                         Map<String, Boolean> roster, Set<String> adminMarked) {
        evaluate(session, schedule, roster, adminMarked, null);
    }

    /**
     * @param providerMeetingSeconds how long the meeting actually ran, when the
     *        provider reports it (BBB does). The threshold is measured against
     *        whichever is SHORTER, this or the scheduled slot — a teacher who
     *        ends a 60-minute class after 30 must not make every learner who
     *        stayed the whole time fall short of a 36-minute bar.
     */
    public void evaluate(LiveSession session, SessionSchedule schedule,
                         Map<String, Boolean> roster, Set<String> adminMarked,
                         Long providerMeetingSeconds) {
        String scheduleId = schedule != null ? schedule.getId() : null;
        try {
            AttendanceCriteriaConfigDTO config = attendanceCriteriaService.resolve(session);
            if (!config.isActive() || scheduleId == null) {
                return;
            }
            if (adminMarked == null) {
                log.warn("attendance_criteria.no_admin_snapshot scheduleId={} - skipping", scheduleId);
                return;
            }
            if (roster == null || roster.isEmpty()) {
                // An empty roster is indistinguishable from "the provider lost the
                // attendee list". Marking a whole class absent off that is exactly
                // the failure this must never cause.
                log.warn("attendance_criteria.empty_roster scheduleId={} - skipping", scheduleId);
                return;
            }

            roster = withEmailsResolved(session.getId(), roster);

            Integer scheduledMinutes = scheduledMinutes(schedule);
            if (scheduledMinutes == null || scheduledMinutes <= 0) {
                log.warn("attendance_criteria.no_scheduled_duration scheduleId={} - skipping", scheduleId);
                return;
            }
            // Compare in seconds. Minutes are a floor of the real figure, so a
            // learner present for 4m50s of a 7-minute class (69%) was truncated to
            // 4 and failed a 4.2-minute bar — an absence for a class they attended.
            int scheduledSeconds = scheduledMinutes * 60;
            // Measure against the class that actually happened. A 60-minute slot
            // finished in 30 would otherwise demand 36 minutes of a 30-minute
            // class, failing every learner who stayed to the end. Only ever
            // shortens the bar, never lengthens it — a class that overruns is
            // still judged against the slot the learners were promised.
            int effectiveSeconds = scheduledSeconds;
            boolean cappedToActual = false;
            if (providerMeetingSeconds != null && providerMeetingSeconds > 0
                    && providerMeetingSeconds < scheduledSeconds) {
                effectiveSeconds = providerMeetingSeconds.intValue();
                cappedToActual = true;
            }
            double requiredSeconds = effectiveSeconds * (config.getMinDurationPercent() / 100.0);
            double requiredMinutes = requiredSeconds / 60.0;

            List<LiveSessionLogs> rows =
                    liveSessionLogsRepository.findAllAttendanceByScheduleId(scheduleId);

            int changed = 0;
            for (LiveSessionLogs row : rows) {
                // Learners and guests both correlate: an authenticated learner
                // joins with our userId as BBB's userID, and GuestController
                // uses the registration id (EXTERNAL_USER) — or a one-off
                // guest-<uuid> for an unregistered visitor — as both the BBB
                // userID and the attendance row's userSourceId. PROVIDER_EMAIL rows are skipped —
                // those are created by the Zoom sync itself for attendees who
                // matched no learner, so there is nobody to mark absent.
                if (!"USER".equalsIgnoreCase(row.getUserSourceType())
                        && !"EXTERNAL_USER".equalsIgnoreCase(row.getUserSourceType())) {
                    continue;
                }
                if (STATUS_TYPE_ADMIN.equalsIgnoreCase(row.getStatusType())
                        || adminMarked.contains(row.getUserSourceId())) {
                    continue;
                }
                if (Boolean.TRUE.equals(roster.get(row.getUserSourceId()))) {
                    continue; // moderator — running the class, not attending it
                }

                boolean inRoster = roster.containsKey(row.getUserSourceId());
                Integer reported = row.getProviderTotalDurationMinutes();
                if (inRoster && reported == null) {
                    // The provider says they were here but gave no minutes; we
                    // cannot judge how long, and they demonstrably attended.
                    writeAudit(row, config, STATUS_PRESENT, "NO_DURATION_DATA",
                            null, scheduledMinutes, requiredMinutes, null, requiredSeconds, false,
                            effectiveSeconds, cappedToActual);
                    liveSessionLogsRepository.save(row);
                    continue;
                }

                int attendedMinutes = inRoster ? reported : 0;
                // Exact seconds when the provider gave them (BBB); otherwise fall
                // back to the floored minutes (Zoom reports whole minutes only).
                Integer exactSeconds = row.getProviderTotalDurationSeconds();
                int attendedSeconds = !inRoster ? 0
                        : (exactSeconds != null ? exactSeconds : attendedMinutes * 60);
                boolean meets = attendedSeconds >= requiredSeconds;
                String verdict = meets ? STATUS_PRESENT : STATUS_ABSENT;
                String reason = meets ? "MET_THRESHOLD" : (inRoster ? "BELOW_THRESHOLD" : "NO_SHOW");

                // Read BEFORE writing the new audit, which overwrites it.
                //
                // Notify off the previous *verdict*, not the row's current status.
                // Both provider paths reset status to PRESENT on every sync, and
                // Zoom re-syncs an ended schedule every 15 minutes for two days —
                // so "status changed" is true on every single run and would mail
                // a below-threshold learner ~190 times. The verdict only moves
                // when the underlying numbers do.
                String previousVerdict = previousVerdict(row);
                String previousStatus = row.getStatus();
                // The first evaluation always notifies: while a rule is in force the
                // join-time mail is suppressed, so this is the learner's only word on
                // the class — including a PRESENT confirmation.
                //
                // After that, only a real change of verdict notifies. Keying off the
                // stored verdict rather than the row's status matters because both
                // provider paths reset status to PRESENT on every sync, and Zoom
                // re-syncs an ended schedule every 15 minutes for two days — status
                // would look "changed" every time and mail ~190 times.
                boolean verdictMoved = previousVerdict == null
                        || !verdict.equalsIgnoreCase(previousVerdict);

                writeAudit(row, config, verdict, reason, attendedMinutes, scheduledMinutes,
                        requiredMinutes, attendedSeconds, requiredSeconds, exactSeconds != null,
                        effectiveSeconds, cappedToActual);

                if (!verdict.equalsIgnoreCase(previousStatus)) {
                    row.setStatus(verdict);
                    changed++;
                }
                row.setUpdatedAt(new Timestamp(System.currentTimeMillis()));
                liveSessionLogsRepository.save(row);

                if (verdictMoved) {
                    notify(session, row, verdict,
                            explain(verdict, reason, attendedSeconds, effectiveSeconds,
                                    requiredSeconds, config.getMinDurationPercent()));
                }
            }

            log.info("attendance_criteria.evaluated scheduleId={} pct={} scheduledMins={} requiredMins={} "
                            + "roster={} rows={} statusChanged={}",
                    scheduleId, config.getMinDurationPercent(), scheduledMinutes,
                    Math.round(requiredMinutes), roster.size(), rows.size(), changed);

        } catch (Exception e) {
            log.error("attendance_criteria.failed scheduleId={}: {}", scheduleId, e.getMessage(), e);
        }
    }

    /**
     * Scheduled class length, start to last-entry — the denominator the admin
     * enters their percentage against. Note this is the booked slot, not how
     * long the class actually ran: a class that finishes early still measures
     * everyone against the full slot.
     */
    private Integer scheduledMinutes(SessionSchedule schedule) {
        Time start = schedule.getStartTime();
        Time end = schedule.getLastEntryTime();
        if (start == null || end == null) {
            return null;
        }
        long minutes = (end.getTime() - start.getTime()) / 60000L;
        return minutes > 0 ? (int) minutes : null;
    }

    private void writeAudit(LiveSessionLogs row, AttendanceCriteriaConfigDTO config, String verdict,
                            String reason, Integer attendedMinutes, Integer scheduledMinutes,
                            double requiredMinutes, Integer attendedSeconds, Double requiredSeconds,
                            boolean exact, int effectiveSeconds, boolean cappedToActual) {
        Map<String, Object> audit = new LinkedHashMap<>();
        audit.put("verdict", verdict);
        audit.put("reason", reason);
        audit.put("attendedMinutes", attendedMinutes);
        audit.put("scheduledMinutes", scheduledMinutes);
        audit.put("thresholdPercent", config.getMinDurationPercent());
        audit.put("requiredMinutes", Math.round(requiredMinutes));
        if (attendedSeconds != null && effectiveSeconds > 0) {
            audit.put("attendedPercent",
                    Math.round(attendedSeconds * 1000.0 / effectiveSeconds) / 10.0);
        }
        audit.put("attendedSeconds", attendedSeconds);
        audit.put("requiredSeconds", requiredSeconds == null ? null : Math.round(requiredSeconds));
        audit.put("attendedDisplay", attendedSeconds == null ? null : hms(attendedSeconds));
        // false = provider gave only whole minutes, so the figures are floored.
        audit.put("exactSeconds", exact);
        audit.put("effectiveSeconds", effectiveSeconds);
        audit.put("cappedToActualMeeting", cappedToActual);
        audit.put("previousStatus", row.getStatus());
        audit.put("evaluatedAt", Instant.now().toString());
        try {
            row.setAttendanceEvaluationJson(objectMapper.writeValueAsString(audit));
        } catch (Exception e) {
            log.warn("attendance_criteria.audit_serialize_failed: {}", e.getMessage());
        }
    }

    /**
     * Some join paths identify a learner to the provider by email rather than by
     * our user id — BBB's {@code getParticipantJoinLink} passes the email as the
     * userID, and Zoom's report is email-keyed throughout. Left unresolved, such
     * a learner is missing from the roster under their real id and would be
     * marked absent for a class they sat through.
     *
     * <p>Adds the resolved user id alongside the email key, keeping both. Only
     * email-shaped keys are looked up, so a normal roster costs no queries.
     */
    private Map<String, Boolean> withEmailsResolved(String sessionId, Map<String, Boolean> roster) {
        Map<String, Boolean> resolved = new LinkedHashMap<>(roster);
        for (Map.Entry<String, Boolean> e : roster.entrySet()) {
            String key = e.getKey();
            if (key == null || !key.contains("@")) {
                continue;
            }
            try {
                for (String userId : participantRepository
                        .findEnrolledUserIdByEmail(sessionId, key.trim().toLowerCase())) {
                    resolved.merge(userId, e.getValue(), (x, y) -> x || y);
                }
            } catch (Exception ex) {
                log.warn("attendance_criteria.email_resolve_failed email={}: {}", key, ex.getMessage());
            }
        }
        return resolved;
    }

    /** Verdict recorded by the last evaluation, or null if this row has never been evaluated. */
    private String previousVerdict(LiveSessionLogs row) {
        if (!StringUtils.hasText(row.getAttendanceEvaluationJson())) {
            return null;
        }
        try {
            var node = objectMapper.readTree(row.getAttendanceEvaluationJson()).path("verdict");
            return node.isTextual() ? node.asText() : null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Plain-language arithmetic for the learner. Being told you are absent for a
     * class you sat through most of is only defensible if the message says how
     * many minutes were counted and how many were needed.
     */
    private String explain(String verdict, String reason, int attendedSeconds,
                           int scheduledSeconds, double requiredSeconds, Integer pct) {
        if (STATUS_PRESENT.equals(verdict)) {
            // The confirmation carries the time too: a learner who is told they
            // passed should be able to see by how much, not just that they did.
            return "You were in the class for " + hms(attendedSeconds)
                    + " of its " + hms(scheduledSeconds) + ".";
        }
        // The threshold itself is deliberately not disclosed to learners — telling
        // them the exact bar invites gaming it. The audit JSON keeps the full
        // numbers so an admin can always justify the verdict.
        if ("NO_SHOW".equals(reason)) {
            return "Our records show you did not join the class.";
        }
        return "You were in the class for " + hms(attendedSeconds) + " of its "
                + hms(scheduledSeconds) + ", which is below the minimum attendance"
                + " required for this class.";
    }

    /** "4m 50s", or "50s" under a minute — the learner-facing form of a duration. */
    private static String hms(int totalSeconds) {
        int m = totalSeconds / 60, sec = totalSeconds % 60;
        if (m == 0) return sec + "s";
        return sec == 0 ? m + "m" : m + "m " + sec + "s";
    }

    private void notify(LiveSession session, LiveSessionLogs row, String newStatus, String reasonDetail) {
        try {
            notificationProcessor.sendAttendanceNotification(
                    session.getId(), row.getUserSourceId(), newStatus, reasonDetail);
        } catch (Exception e) {
            log.warn("attendance_criteria.notify_failed userId={}: {}",
                    row.getUserSourceId(), e.getMessage());
        }
    }
}
