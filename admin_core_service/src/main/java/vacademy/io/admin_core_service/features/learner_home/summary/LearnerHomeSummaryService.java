package vacademy.io.admin_core_service.features.learner_home.summary;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerPastSessionDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerPastSessionsResponseDTO;
import vacademy.io.admin_core_service.features.live_session.service.LearnerPastSessionService;

import java.sql.Date;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The learner home summary: whether this learner's home should lead with their classes
 * ("class first") and the few facts that layout shows.
 *
 * <p>Class first is automatic and has no per-institute setting: the learner has a live class in
 * one of their own batches within the last or next 14 days, and none of their batches has
 * published learning content (a published slide in a chapter of the batch). Every other learner
 * gets {@code class_first = false} and the dashboard they had before.
 *
 * <p>Everything is read for the token's user only, from their ACTIVE enrolments in the given
 * institute. Read-only; nothing here sends a message.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LearnerHomeSummaryService {

    /** Institutes set their classes in IST; the calendar month is counted in IST. */
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    /** How far back and ahead a class makes the learner "a class learner". */
    private static final int CLASS_WINDOW_DAYS = 14;
    /** Recordings newer than this count as new. */
    private static final int NEW_RECORDING_DAYS = 14;
    /** Past classes read per batch when looking for the last recording. */
    private static final int PAST_PAGE_SIZE = 20;
    /** A learner in more batches than this is not asked about past classes batch by batch. */
    private static final int MAX_BATCHES_FOR_PAST = 5;

    private final JdbcTemplate jdbc;
    private final LearnerPastSessionService learnerPastSessionService;

    public Map<String, Object> summary(String instituteId, String userId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("class_first", false);

        List<String> batchIds = jdbc.queryForList("""
                SELECT DISTINCT package_session_id
                  FROM student_session_institute_group_mapping
                 WHERE user_id = ? AND institute_id = ? AND status = 'ACTIVE' AND package_session_id IS NOT NULL
                """, String.class, userId, instituteId);
        if (batchIds.isEmpty()) return out;

        LocalDate today = LocalDate.now(IST);
        LocalDate monthStart = today.withDayOfMonth(1);
        LocalDate windowFrom = monthStart.isBefore(today.minusDays(CLASS_WINDOW_DAYS))
                ? monthStart : today.minusDays(CLASS_WINDOW_DAYS);
        LocalDate windowTo = today.plusDays(CLASS_WINDOW_DAYS);

        List<Map<String, Object>> schedules = schedules(instituteId, userId, windowFrom, windowTo);
        LocalDate classFrom = today.minusDays(CLASS_WINDOW_DAYS);
        boolean hasClass = schedules.stream()
                .anyMatch(s -> !toLocalDate(s.get("meeting_date")).isBefore(classFrom));
        if (!hasClass) return out;
        if (hasPublishedContent(batchIds)) return out;

        out.put("class_first", true);
        out.put("next_class", nextClass(schedules));
        out.put("attendance_month", attendanceThisMonth(schedules, monthStart));
        putRecordings(out, instituteId, userId, batchIds, today);
        return out;
    }

    /**
     * The learner's class occurrences in the window, from their own ACTIVE batches in this
     * institute only (published classes, not deleted occurrences, not before they joined the
     * batch), each with whether it has started / ended and their latest attendance mark.
     */
    private List<Map<String, Object>> schedules(String instituteId, String userId, LocalDate from, LocalDate to) {
        return jdbc.queryForList("""
                SELECT DISTINCT ON (ss.id)
                       ss.id AS schedule_id,
                       ls.id AS session_id,
                       m.package_session_id,
                       ss.meeting_date,
                       ss.start_time,
                       ss.last_entry_time,
                       COALESCE(NULLIF(ls.timezone, ''), 'Asia/Kolkata') AS timezone,
                       ((ss.meeting_date + ss.start_time) AT TIME ZONE COALESCE(NULLIF(ls.timezone, ''), 'Asia/Kolkata')) <= now() AS started,
                       ((ss.meeting_date + COALESCE(ss.last_entry_time, ss.start_time))
                            AT TIME ZONE COALESCE(NULLIF(ls.timezone, ''), 'Asia/Kolkata')) <= now() AS ended,
                       lsl.status AS attendance_status
                  FROM student_session_institute_group_mapping m
                  JOIN live_session_participants lsp
                    ON lsp.source_type = 'BATCH' AND lsp.source_id = m.package_session_id
                  JOIN live_session ls ON ls.id = lsp.session_id
                  JOIN session_schedules ss ON ss.session_id = ls.id
                  LEFT JOIN LATERAL (
                       SELECT status
                         FROM live_session_logs
                        WHERE session_id = ls.id
                          AND schedule_id = ss.id
                          AND user_source_type = 'USER'
                          AND user_source_id = ?
                          AND log_type = 'ATTENDANCE_RECORDED'
                        ORDER BY created_at DESC
                        LIMIT 1
                  ) lsl ON TRUE
                 WHERE m.user_id = ?
                   AND m.institute_id = ?
                   AND m.status = 'ACTIVE'
                   AND ls.institute_id = ?
                   AND ls.status = 'LIVE'
                   AND ss.status <> 'DELETED'
                   AND ss.meeting_date BETWEEN ? AND ?
                   AND (m.enrolled_date IS NULL OR ss.meeting_date >= m.enrolled_date)
                 ORDER BY ss.id
                """, userId, userId, instituteId, instituteId, Date.valueOf(from), Date.valueOf(to));
    }

    /** True when any of these batches has a published (or published-then-edited) slide. */
    private boolean hasPublishedContent(List<String> batchIds) {
        String in = String.join(",", Collections.nCopies(batchIds.size(), "?"));
        Boolean exists = jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1
                      FROM chapter_package_session_mapping cpsm
                      JOIN chapter_to_slides cts ON cts.chapter_id = cpsm.chapter_id AND cts.status <> 'DELETED'
                      JOIN slide s ON s.id = cts.slide_id AND s.status IN ('PUBLISHED', 'UNSYNC')
                     WHERE cpsm.package_session_id IN (%s)
                       AND cpsm.status <> 'DELETED'
                )
                """.formatted(in), Boolean.class, batchIds.toArray());
        return Boolean.TRUE.equals(exists);
    }

    /** The soonest occurrence that has not ended (the one in progress counts). */
    private Map<String, Object> nextClass(List<Map<String, Object>> schedules) {
        return schedules.stream()
                .filter(s -> !Boolean.TRUE.equals(s.get("ended")))
                .min(Comparator.comparing((Map<String, Object> s) -> toLocalDate(s.get("meeting_date")))
                        .thenComparing(s -> String.valueOf(s.get("start_time"))))
                .map(s -> {
                    Map<String, Object> c = new LinkedHashMap<>();
                    c.put("session_id", s.get("session_id"));
                    c.put("schedule_id", s.get("schedule_id"));
                    c.put("package_session_id", s.get("package_session_id"));
                    c.put("meeting_date", toLocalDate(s.get("meeting_date")).toString());
                    c.put("start_time", String.valueOf(s.get("start_time")));
                    c.put("last_entry_time", s.get("last_entry_time") == null ? null : String.valueOf(s.get("last_entry_time")));
                    c.put("timezone", s.get("timezone"));
                    return c;
                })
                .orElse(null);
    }

    /**
     * Classes held this calendar month (IST) up to now, and how many the learner attended. A class
     * counts as held once it has ended, or earlier when the learner is already marked present.
     */
    private Map<String, Object> attendanceThisMonth(List<Map<String, Object>> schedules, LocalDate monthStart) {
        int held = 0;
        int attended = 0;
        for (Map<String, Object> s : schedules) {
            if (toLocalDate(s.get("meeting_date")).isBefore(monthStart)) continue;
            boolean present = "PRESENT".equals(s.get("attendance_status"));
            if (!Boolean.TRUE.equals(s.get("ended")) && !present) continue;
            held++;
            if (present) attended++;
        }
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("attended", attended);
        a.put("held", held);
        return a;
    }

    /**
     * Recordings, through the learner past-classes service so the institute's learner display
     * settings (past classes, recordings) apply exactly as on the Live Class page.
     */
    private void putRecordings(Map<String, Object> out, String instituteId, String userId, List<String> batchIds,
                               LocalDate today) {
        boolean shown = false;
        List<LearnerPastSessionDTO> past = new ArrayList<>();
        try {
            for (String batchId : batchIds.stream().sorted().limit(MAX_BATCHES_FOR_PAST).toList()) {
                LearnerPastSessionsResponseDTO page = learnerPastSessionService.getPastSessions(
                        batchId, userId, instituteId, 0, PAST_PAGE_SIZE, null, null);
                if (page == null) continue;
                if (page.getDisplayFlags() != null && page.getDisplayFlags().isShowPastSessions()
                        && page.getDisplayFlags().isShowRecordings()) {
                    shown = true;
                }
                if (page.getContent() != null) past.addAll(page.getContent());
            }
        } catch (Exception e) {
            // The summary must not fail over recordings; the cards then show nothing new.
            log.warn("learner home summary: past classes not read for user {}: {}", userId, e.getMessage());
        }
        out.put("recordings_shown", shown);
        if (!shown) {
            out.put("new_recordings", 0);
            out.put("last_recorded_class", null);
            return;
        }
        Map<String, LearnerPastSessionDTO> unique = new LinkedHashMap<>();
        for (LearnerPastSessionDTO p : past) {
            if (p.getScheduleId() != null) unique.putIfAbsent(p.getScheduleId(), p);
        }
        List<LearnerPastSessionDTO> recorded = unique.values().stream()
                .filter(p -> p.getRecordings() != null && !p.getRecordings().isEmpty())
                .sorted(Comparator.comparing((LearnerPastSessionDTO p) -> sortKey(p)).reversed())
                .toList();
        LocalDate since = today.minusDays(NEW_RECORDING_DAYS);
        long fresh = recorded.stream()
                .filter(p -> p.getMeetingDate() != null && !toLocalDate(p.getMeetingDate()).isBefore(since))
                .count();
        out.put("new_recordings", fresh);
        out.put("last_recorded_class", recorded.isEmpty() ? null : recorded.get(0));
    }

    private static String sortKey(LearnerPastSessionDTO p) {
        String date = p.getMeetingDate() == null ? "" : toLocalDate(p.getMeetingDate()).toString();
        String time = p.getStartTime() == null ? "" : p.getStartTime().toString();
        return date + "T" + time;
    }

    private static LocalDate toLocalDate(Object value) {
        if (value instanceof Date d) return d.toLocalDate();
        if (value instanceof java.util.Date d) return new Date(d.getTime()).toLocalDate();
        if (value instanceof LocalDate d) return d;
        return LocalDate.parse(String.valueOf(value).substring(0, 10));
    }
}
