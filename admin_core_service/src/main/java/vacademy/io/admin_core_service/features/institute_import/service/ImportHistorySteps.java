package vacademy.io.admin_core_service.features.institute_import.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static vacademy.io.admin_core_service.features.institute_import.service.ImportContext.*;

/**
 * History that has no billing or messaging behaviour of its own: class recordings, journey cases
 * and the old system's open dues. Cases and dues go on the learner's staff timeline (what staff
 * see on the learner's profile); nothing here bills, reminds or sends.
 */
@Component
@RequiredArgsConstructor
public class ImportHistorySteps {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final ImportMembershipSteps membership;

    /**
     * Body: [ { batch_external_id, date, title, url, duration_min } ]
     * Each recording is attached to that batch's class on that date (the learner's past-class view
     * shows it once the school turns recordings on in Display Settings).
     */
    public void recordings(ImportContext c, JsonNode body) {
        for (JsonNode r : body) {
            c.item(text(r, "batch_external_id") + "|" + text(r, "date") + "|" + text(r, "url"), () -> {
                String batch = text(r, "batch_external_id");
                LocalDate date = date(r, "date");
                String url = text(r, "url");
                String key = batch + "|" + date;
                if (url == null || date == null) {
                    c.fail(key, "date and link are required");
                    return;
                }
                if (c.ref("RECORDING", url).isPresent()) {
                    c.updated();
                    return;
                }
                Optional<String> sessionId = c.ref("LIVE_CLASS", batch);
                if (sessionId.isEmpty()) {
                    c.fail(key, "class not imported yet (run live_classes first)");
                    return;
                }
                String scheduleId = c.ref("SCHEDULE", key).orElse(null);
                if (scheduleId == null) {
                    // A recorded class with no attendance row: add the dated class it belongs to.
                    Map<String, Object> times = c.getJdbc().queryForMap(
                            "SELECT start_time, last_entry_time FROM live_session WHERE id = ?", sessionId.get());
                    LocalTime start = ((Timestamp) times.get("start_time")).toLocalDateTime().toLocalTime();
                    LocalTime end = ((Timestamp) times.get("last_entry_time")).toLocalDateTime().toLocalTime();
                    scheduleId = newId();
                    c.getJdbc().update("""
                            INSERT INTO session_schedules (id, session_id, recurrence_type, recurrence_key, meeting_date, start_time,
                                                           last_entry_time, link_type, status, daily_attendance)
                            VALUES (?, ?, 'weekly', ?, ?, ?, ?, 'bbb', 'LIVE', true)
                            """, scheduleId, sessionId.get(), date.getDayOfWeek().name().toLowerCase(), sqlDate(date),
                            java.sql.Time.valueOf(start), java.sql.Time.valueOf(end));
                    c.putRef("SCHEDULE", key, scheduleId);
                }
                String current = c.getJdbc().queryForObject(
                        "SELECT provider_recordings_json FROM session_schedules WHERE id = ?", String.class, scheduleId);
                List<Map<String, Object>> list = new ArrayList<>();
                try {
                    if (current != null && !current.isBlank()) {
                        for (JsonNode n : MAPPER.readTree(current)) list.add(MAPPER.convertValue(n, Map.class));
                    }
                    Map<String, Object> rec = new LinkedHashMap<>();
                    rec.put("recordingId", "import-" + Integer.toHexString(url.hashCode()));
                    rec.put("youtubeVideoUrl", url);
                    rec.put("durationSeconds", (long) (r.path("duration_min").asInt(0)) * 60);
                    rec.put("type", text(r, "title"));
                    rec.put("recordingStorage", "YOUTUBE");
                    list.add(rec);
                    c.getJdbc().update("UPDATE session_schedules SET provider_recordings_json = ?, updated_at = now() WHERE id = ?",
                            MAPPER.writeValueAsString(list), scheduleId);
                } catch (Exception e) {
                    throw new IllegalStateException("could not attach recording: " + e.getMessage(), e);
                }
                c.putRef("RECORDING", url, scheduleId);
                c.created();
            });
        }
    }

    /**
     * Body: [ { case_id, student_id, enrollment_id, from_status, to_status, case_status, opened_on,
     *           closed_on, break_start, break_return, reason, fee_path, jpc_amount, next_action_date,
     *           owner, notes } ]  (the Journey cases sheet as-is)
     * One timeline entry per case, dated when it was opened.
     */
    public void journeyCases(ImportContext c, JsonNode body) {
        for (JsonNode j : body) {
            c.item(text(j, "case_id"), () -> {
                String caseId = text(j, "case_id");
                Optional<String> userId = c.ref("LEARNER", text(j, "student_id"));
                if (caseId == null || userId.isEmpty()) {
                    c.fail(caseId, "learner not imported yet");
                    return;
                }
                if (c.ref("CASE", caseId).isPresent()) {
                    c.updated();
                    return;
                }
                String from = text(j, "from_status"), to = text(j, "to_status"), status = text(j, "case_status");
                String title = "Journey case " + caseId + ": " + (from != null && !from.equals(to) ? from + " → " : "")
                        + to + " (" + (status == null ? "Open" : status) + ")";
                List<String> lines = new ArrayList<>();
                addLine(lines, "Reason", text(j, "reason"));
                addLine(lines, "Break", join(text(j, "break_start"), text(j, "break_return")));
                addLine(lines, "Fee path", text(j, "fee_path"));
                addLine(lines, "Journey protection credit", text(j, "jpc_amount"));
                addLine(lines, "Next action", text(j, "next_action_date"));
                addLine(lines, "Closed on", text(j, "closed_on"));
                addLine(lines, "Notes", text(j, "notes"));
                Map<String, Object> meta = new LinkedHashMap<>();
                j.fields().forEachRemaining(f -> meta.put(f.getKey(), f.getValue().isNull() ? null : f.getValue().asText()));
                meta.put("source", "import");
                String id = timeline(c, "JOURNEY_CASE", userId.get(), "Open".equalsIgnoreCase(status) ? "CASE_OPEN" : "CASE_CLOSED",
                        title, String.join("\n", lines), meta, date(j, "opened_on"));
                c.putRef("CASE", caseId, id);
                c.created();
            });
        }
    }

    /**
     * Body: [ { invoice_number, zoho_id, enrollment_external_id, invoice_date, due_date, total,
     *           balance, currency, status, red_list, payment_link } ]
     * The old system's unpaid invoices, recorded on the learner's timeline (not billed again, not
     * reminded): the school keeps collecting them where they were raised. Red-list learners are
     * tagged "Red list".
     */
    public void openDues(ImportContext c, JsonNode body) {
        for (JsonNode d : body) {
            c.item(text(d, "invoice_number"), () -> {
                String inv = text(d, "invoice_number");
                Optional<String> userPlanId = c.ref("ENROLMENT", text(d, "enrollment_external_id"));
                if (inv == null || userPlanId.isEmpty()) {
                    c.fail(inv, "enrolment not imported yet");
                    return;
                }
                if (c.ref("DUE", inv).isPresent()) {
                    c.updated();
                    return;
                }
                String userId = c.getJdbc().queryForObject("SELECT user_id FROM user_plan WHERE id = ?", String.class, userPlanId.get());
                String currency = Optional.ofNullable(text(d, "currency")).orElse("INR");
                String title = "Open due " + inv + ": " + currency + " " + amount(number(d, "balance"))
                        + " of " + amount(number(d, "total")) + ", due " + text(d, "due_date")
                        + (bool(d, "red_list") ? " (red list)" : "");
                List<String> lines = new ArrayList<>();
                addLine(lines, "Status in old system", text(d, "status"));
                addLine(lines, "Invoice date", text(d, "invoice_date"));
                addLine(lines, "Pay link", text(d, "payment_link"));
                Map<String, Object> meta = new LinkedHashMap<>();
                d.fields().forEachRemaining(f -> meta.put(f.getKey(), f.getValue().isNull() ? null : f.getValue().asText()));
                meta.put("user_plan_id", userPlanId.get());
                meta.put("source", "import");
                String id = timeline(c, "OPEN_DUE", userId, "DUE_IMPORTED", title, String.join("\n", lines), meta,
                        date(d, "invoice_date"));
                if (bool(d, "red_list")) membership.tagUser(c, userId, "Red list");
                c.putRef("DUE", inv, id);
                c.created();
            });
        }
    }

    private String timeline(ImportContext c, String type, String userId, String action, String title, String description,
                            Map<String, Object> meta, LocalDate when) {
        String id = newId();
        String json;
        try {
            json = MAPPER.writeValueAsString(meta);
        } catch (Exception e) {
            json = null;
        }
        c.getJdbc().update("""
                INSERT INTO timeline_event (id, type, type_id, action_type, actor_type, actor_id, actor_name, title, description,
                                            metadata_json, created_at, is_pinned, student_user_id, category, institute_id)
                VALUES (?, ?, ?, ?, 'SYSTEM', ?, 'Import from old system', ?, ?, CAST(? AS jsonb), ?, false, ?, 'ACTIVITY', ?)
                """, id, type, userId, action, c.getRunByUserId(), title, description, json,
                when == null ? new Timestamp(System.currentTimeMillis()) : startOfDay(when), userId, c.getInstituteId());
        return id;
    }

    private static void addLine(List<String> lines, String label, String value) {
        if (value != null && !value.isBlank()) lines.add(label + ": " + value);
    }

    private static String join(String a, String b) {
        if (a == null && b == null) return null;
        return (a == null ? "?" : a) + " to " + (b == null ? "open" : b);
    }

    private static String amount(Double v) {
        if (v == null) return "?";
        return v == Math.rint(v) ? String.valueOf(v.longValue()) : String.format(java.util.Locale.ROOT, "%.2f", v);
    }
}
