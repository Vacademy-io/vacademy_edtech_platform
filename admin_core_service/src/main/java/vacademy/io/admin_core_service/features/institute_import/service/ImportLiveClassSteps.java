package vacademy.io.admin_core_service.features.institute_import.service;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.sql.Time;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

import static vacademy.io.admin_core_service.features.institute_import.service.ImportContext.*;

/**
 * Each batch's weekly class on Vacademy Meet (BBB), and the attendance history of its past classes.
 *
 * <p>Silent by construction: no schedule_notifications rows are written (those are the only source
 * of class reminders), the creation workflow is not fired, and no class is created for today or
 * within the start/end dispatch look-back, so nothing announces an imported class. The meeting
 * room itself is created on first join, as for any Vacademy Meet class.
 */
@Component
public class ImportLiveClassSteps {

    /** Cameras on for everyone (a dance teacher has to see the class), recorded as before. */
    static final String BBB_CONFIG = "{\"record\":true,\"auto_start_recording\":true,\"mute_on_start\":true,"
            + "\"webcams_only_for_moderator\":false,\"disable_cam\":false}";

    private static final int DEFAULT_WEEKS_AHEAD = 26;

    /**
     * Body: [ { external_id, name, teacher_external_id, days[Mon..Sun], start_time_ist "HH:mm",
     *           duration_min, start_date, active, cancelled_dates[], weeks_ahead } ]
     * One class per batch; future weekly dates from tomorrow for weeks_ahead weeks (default 26),
     * except dates the school has cancelled. Inactive batches get the class (for their history)
     * but no future dates.
     */
    public void liveClasses(ImportContext c, JsonNode body) {
        for (JsonNode b : body) {
            c.item(keyOf(b), () -> {
                String ext = text(b, "external_id");
                Optional<String> psId = c.ref("BATCH", ext);
                if (psId.isEmpty()) {
                    c.fail(ext, "batch not imported yet");
                    return;
                }
                LocalTime start = time(text(b, "start_time_ist"));
                int minutes = b.hasNonNull("duration_min") ? b.get("duration_min").asInt() : 60;
                List<DayOfWeek> days = new ArrayList<>();
                for (String d : ImportStructureSteps.list(b.get("days"))) {
                    DayOfWeek dow = day(d);
                    if (dow != null) days.add(dow);
                }
                boolean active = b.path("active").asBoolean(true);
                if (active && (start == null || days.isEmpty())) {
                    c.skip(ext, "no class days or start time in the batch sheet");
                    return;
                }
                boolean existed = c.ref("LIVE_CLASS", ext).isPresent();
                String sessionId = ensureSession(c, ext, text(b, "name"), psId.get(), text(b, "teacher_external_id"),
                        start == null ? LocalTime.of(9, 0) : start, minutes);
                if (active) {
                    Set<LocalDate> cancelled = new HashSet<>();
                    for (String d : ImportStructureSteps.list(b.get("cancelled_dates"))) cancelled.add(LocalDate.parse(d));
                    int weeks = b.hasNonNull("weeks_ahead") ? b.get("weeks_ahead").asInt() : DEFAULT_WEEKS_AHEAD;
                    LocalDate from = c.getToday().plusDays(1);
                    LocalDate startDate = date(b, "start_date");
                    if (startDate != null && startDate.isAfter(from)) from = startDate;
                    LocalDate until = c.getToday().plusWeeks(weeks);
                    for (LocalDate d = from; !d.isAfter(until); d = d.plusDays(1)) {
                        if (days.contains(d.getDayOfWeek()) && !cancelled.contains(d)) {
                            ensureSchedule(c, ext, sessionId, d, start, minutes);
                        }
                    }
                }
                if (existed) c.updated(); else c.created();
            });
        }
    }

    /**
     * Body: [ { batch_external_id, date, cancelled, start_time_ist, duration_min,
     *           records: [ { student_external_id, status Present|Absent|Leave|Cancelled, minutes,
     *                        class_type, informed_leave, source Zoom|Manual } ] } ]
     * Past classes only (before today). A class the school cancelled is not recorded.
     */
    public void attendance(ImportContext c, JsonNode body) {
        for (JsonNode a : body) {
            c.item(text(a, "batch_external_id") + "|" + text(a, "date"), () -> {
                String batch = text(a, "batch_external_id");
                LocalDate date = date(a, "date");
                String key = batch + "|" + date;
                if (date == null || !date.isBefore(c.getToday())) {
                    c.skip(key, "today or later: handled by the class schedule, not history");
                    return;
                }
                if (a.path("cancelled").asBoolean(false)) {
                    c.skip(key, "class cancelled by the school");
                    return;
                }
                if (c.ref("BATCH", batch).isEmpty()) {
                    c.fail(key, "batch not imported yet");
                    return;
                }
                LocalTime start = Optional.ofNullable(time(text(a, "start_time_ist"))).orElse(LocalTime.of(9, 0));
                int minutes = a.hasNonNull("duration_min") ? a.get("duration_min").asInt() : 60;
                String sessionId = c.ref("LIVE_CLASS", batch).orElse(null);
                if (sessionId == null) {
                    c.fail(key, "class not imported yet (run live_classes first)");
                    return;
                }
                boolean existed = c.ref("SCHEDULE", key).isPresent();
                String scheduleId = ensureSchedule(c, batch, sessionId, date, start, minutes);
                List<Object[]> rows = new ArrayList<>();
                for (JsonNode r : a.path("records")) {
                    String status = text(r, "status");
                    if (status == null || "Cancelled".equalsIgnoreCase(status)) continue;
                    Optional<String> userId = c.ref("LEARNER", text(r, "student_external_id"));
                    if (userId.isEmpty()) continue;
                    boolean present = "Present".equalsIgnoreCase(status) || "Late".equalsIgnoreCase(status);
                    String details = "{\"source\":\"import\",\"status\":\"" + status + "\",\"minutes\":" + r.path("minutes").asInt(0)
                            + ",\"class_type\":\"" + Optional.ofNullable(text(r, "class_type")).orElse("") + "\",\"informed_leave\":"
                            + r.path("informed_leave").asBoolean(false) + "}";
                    rows.add(new Object[]{newId(), sessionId, scheduleId, userId.get(), present ? "PRESENT" : "ABSENT",
                            "Zoom".equalsIgnoreCase(text(r, "source")) ? "ONLINE" : "OFFLINE", details,
                            present ? r.path("minutes").asInt(0) : null});
                }
                if (!rows.isEmpty()) {
                    c.getJdbc().batchUpdate("""
                            INSERT INTO live_session_logs (id, session_id, schedule_id, user_source_type, user_source_id, log_type,
                                                           status, status_type, details, provider_total_duration_minutes)
                            VALUES (?, ?, ?, 'USER', ?, 'ATTENDANCE_RECORDED', ?, ?, ?, ?)
                            ON CONFLICT (schedule_id, user_source_id) WHERE log_type = 'ATTENDANCE_RECORDED' DO NOTHING
                            """, rows);
                }
                if (existed) c.updated(); else c.created();
            });
        }
    }

    private String ensureSession(ImportContext c, String batch, String name, String psId, String teacherExt,
                                 LocalTime start, int minutes) {
        Optional<String> id = c.ref("LIVE_CLASS", batch);
        if (id.isPresent()) return id.get();
        String sessionId = newId();
        LocalDateTime first = c.getToday().plusDays(1).atTime(start);
        c.getJdbc().update("""
                INSERT INTO live_session (id, created_by_user_id, institute_id, title, status, access_level, link_type,
                                          session_streaming_service_type, timezone, start_time, last_entry_time, bbb_config_json,
                                          allow_rewind, allow_play_pause)
                VALUES (?, ?, ?, ?, 'LIVE', 'private', 'bbb', 'embed', 'Asia/Kolkata', ?, ?, ?, false, false)
                """, sessionId, c.getRunByUserId(), c.getInstituteId(), name,
                Timestamp.valueOf(first), Timestamp.valueOf(first.plusMinutes(minutes)), BBB_CONFIG);
        c.getJdbc().update("INSERT INTO live_session_participants (id, session_id, source_type, source_id) VALUES (?, ?, 'BATCH', ?)",
                newId(), sessionId, psId);
        if (teacherExt != null) {
            c.ref("STAFF", teacherExt).ifPresent(teacher -> c.getJdbc().update("""
                    INSERT INTO live_session_instructors (id, session_id, user_id, status, created_at, updated_at)
                    VALUES (?, ?, ?, 'ACTIVE', now(), now()) ON CONFLICT DO NOTHING
                    """, newId(), sessionId, teacher));
        }
        c.putRef("LIVE_CLASS", batch, sessionId);
        return sessionId;
    }

    private String ensureSchedule(ImportContext c, String batch, String sessionId, LocalDate date, LocalTime start, int minutes) {
        String key = batch + "|" + date;
        Optional<String> id = c.ref("SCHEDULE", key);
        if (id.isPresent()) return id.get();
        String scheduleId = newId();
        c.getJdbc().update("""
                INSERT INTO session_schedules (id, session_id, recurrence_type, recurrence_key, meeting_date, start_time, last_entry_time,
                                               link_type, status, daily_attendance)
                VALUES (?, ?, 'weekly', ?, ?, ?, ?, 'bbb', 'LIVE', true)
                """, scheduleId, sessionId, date.getDayOfWeek().name().toLowerCase(Locale.ROOT), sqlDate(date),
                Time.valueOf(start), Time.valueOf(start.plusMinutes(minutes)));
        c.putRef("SCHEDULE", key, scheduleId);
        return scheduleId;
    }

    static LocalTime time(String s) {
        if (s == null) return null;
        try {
            return LocalTime.parse(s.length() == 5 ? s : s.substring(0, 5));
        } catch (Exception e) {
            return null;
        }
    }

    static DayOfWeek day(String d) {
        if (d == null || d.length() < 3) return null;
        return switch (d.substring(0, 3).toLowerCase(Locale.ROOT)) {
            case "mon" -> DayOfWeek.MONDAY;
            case "tue" -> DayOfWeek.TUESDAY;
            case "wed" -> DayOfWeek.WEDNESDAY;
            case "thu" -> DayOfWeek.THURSDAY;
            case "fri" -> DayOfWeek.FRIDAY;
            case "sat" -> DayOfWeek.SATURDAY;
            case "sun" -> DayOfWeek.SUNDAY;
            default -> null;
        };
    }
}
