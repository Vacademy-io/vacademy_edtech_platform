package vacademy.io.admin_core_service.features.student_analysis.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.doubts.entity.Doubts;
import vacademy.io.admin_core_service.features.doubts.repository.DoubtsRepository;
import vacademy.io.admin_core_service.features.learner_tracking.dto.AssignmentSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.AssignmentSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.AssignmentSlideTrackedRepository;
import vacademy.io.admin_core_service.features.live_session.dto.ScheduleAttendanceProjection;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionParticipantRepository;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.AssignmentSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.*;

/**
 * The learner data the comprehensive report collects and then throws away — per-session
 * attendance, per-module progress against the batch, what was studied slide by slide,
 * assignment submissions with titles, the doubts' own text and the per-attempt analysis rows.
 *
 * <p>Serves the internal raw-detail endpoint behind the MCP {@code learner_report} tool, where the
 * admin's own AI app writes the report. Read-only and deterministic: no model is called here, so
 * no AI credits are spent. Each part fails on its own ({@code {"unavailable": reason}}) without
 * sinking the others.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StudentRawDetailService {

    /** Parts sent when the caller names none. */
    public static final List<String> DEFAULT_PARTS = List.of(
            "attendance_sessions", "module_progress", "content_activity",
            "assignments", "doubts", "attempt_insights");

    /** Opt-in only: the per-question input of each analysed attempt (large). */
    public static final String ATTEMPT_DETAILS = "attempt_details";

    public static final Set<String> ALL_PARTS;
    static {
        Set<String> all = new LinkedHashSet<>(DEFAULT_PARTS);
        all.add(ATTEMPT_DETAILS);
        ALL_PARTS = Collections.unmodifiableSet(all);
    }

    private static final int MAX_SESSIONS = 300;
    private static final int MAX_SLIDES = 100;
    private static final int MAX_DOUBTS = 50;
    private static final int MAX_DOUBT_TEXT = 1500;
    private static final int DEFAULT_ATTEMPTS = 20;
    private static final int MAX_ATTEMPTS = 50;
    private static final int DEFAULT_ATTEMPT_DETAILS = 5;
    private static final int MAX_ATTEMPT_DETAILS = 15;

    // Same status lists ProgressCollector passes to the module-completion query.
    private static final List<String> STANDARD_STATUSES = List.of("ACTIVE", "PUBLISHED");
    private static final List<String> VISIBLE_SLIDE_STATUSES = List.of("PUBLISHED", "UNSYNC");
    private static final List<String> ACTIVE_STATUS = List.of("ACTIVE");

    private final LiveSessionParticipantRepository participantRepository;
    private final ActivityLogRepository activityLogRepository;
    private final AssignmentSlideTrackedRepository assignmentSlideTrackedRepository;
    private final AssignmentSlideRepository assignmentSlideRepository;
    private final SlideRepository slideRepository;
    private final DoubtsRepository doubtsRepository;
    private final ObjectMapper objectMapper;

    /** Normalises requested part names; null/empty or nothing valid → the default parts. */
    public static Set<String> resolveParts(Collection<String> requested) {
        Set<String> parts = new LinkedHashSet<>();
        if (requested != null) {
            for (String p : requested) {
                if (p != null && ALL_PARTS.contains(p.trim().toLowerCase())) parts.add(p.trim().toLowerCase());
            }
        }
        return parts.isEmpty() ? new LinkedHashSet<>(DEFAULT_PARTS) : parts;
    }

    public Map<String, Object> collect(String userId, String instituteId, String batchId,
                                       LocalDate start, LocalDate end, Set<String> parts, Integer attemptLimit) {
        Timestamp startTs = Timestamp.valueOf(start.atStartOfDay());
        Timestamp endTs = Timestamp.valueOf(end.atTime(23, 59, 59, 999_000_000));
        Map<String, String> slideTitles = new HashMap<>();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("window", Map.of("start_date", start.toString(), "end_date", end.toString()));
        for (String part : parts) {
            try {
                Object value = switch (part) {
                    case "attendance_sessions" -> attendanceSessions(userId, batchId, start, end);
                    case "module_progress" -> moduleProgress(userId, batchId);
                    case "content_activity" -> contentActivity(userId, startTs, endTs);
                    case "assignments" -> assignments(userId, startTs, endTs, slideTitles);
                    case "doubts" -> doubts(userId, instituteId, startTs, endTs, slideTitles);
                    case "attempt_insights" -> attempts(userId, startTs, endTs, slideTitles,
                            clamp(attemptLimit, DEFAULT_ATTEMPTS, MAX_ATTEMPTS), false);
                    case ATTEMPT_DETAILS -> attempts(userId, startTs, endTs, slideTitles,
                            clamp(attemptLimit, DEFAULT_ATTEMPT_DETAILS, MAX_ATTEMPT_DETAILS), true);
                    default -> null;
                };
                if (value != null) out.put(part, value);
            } catch (Exception e) {
                log.warn("[StudentRawDetail] part {} failed for userId={}: {}", part, userId, e.getMessage());
                out.put(part, Map.of("unavailable", "Could not read this part."));
            }
        }
        return out;
    }

    // ── parts ────────────────────────────────────────────────────────────────

    /** Every scheduled live class in the window with its status and real attended minutes. */
    private Object attendanceSessions(String userId, String batchId, LocalDate start, LocalDate end) {
        List<ScheduleAttendanceProjection> rows =
                participantRepository.findAttendanceForUserAcrossBatches(userId, batchId, start, end);
        boolean widened = false;
        // Same widening as AttendanceCollector: classes often hang off another batch of the learner.
        if ((rows == null || rows.isEmpty()) && batchId != null) {
            rows = participantRepository.findAttendanceForUserAcrossBatches(userId, null, start, end);
            widened = rows != null && !rows.isEmpty();
        }
        List<Map<String, Object>> sessions = new ArrayList<>();
        for (ScheduleAttendanceProjection r : rows == null ? List.<ScheduleAttendanceProjection>of() : rows) {
            if (sessions.size() >= MAX_SESSIONS) break;
            Map<String, Object> s = new LinkedHashMap<>();
            put(s, "date", r.getMeetingDate());
            put(s, "start_time", r.getStartTime());
            put(s, "last_entry_time", r.getLastEntryTime());
            put(s, "title", r.getSessionTitle());
            put(s, "subject", r.getSubject());
            put(s, "status", r.getAttendanceStatus());
            put(s, "attended_minutes", r.getDurationMinutes());
            put(s, "session_status", r.getSessionStatus());
            put(s, "access_level", r.getAccessLevel());
            sessions.add(s);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sessions", sessions);
        out.put("total", rows == null ? 0 : rows.size());
        if (widened) out.put("note", "No classes under the given batch; these are from all of the learner's batches.");
        out.put("status_meaning", "PRESENT = joined; ABSENT or UNMARKED = did not join (the report counts both as absent).");
        return out;
    }

    /** Per-module completion and time for the learner next to the batch average (all-time, not windowed). */
    private Object moduleProgress(String userId, String batchId) throws Exception {
        if (batchId == null) {
            return Map.of("unavailable", "Needs a batch: the learner has no enrolment to scope it to.");
        }
        List<Object[]> rows = activityLogRepository.getModuleCompletionByUserAndBatch(
                batchId, userId, STANDARD_STATUSES, STANDARD_STATUSES, STANDARD_STATUSES,
                VISIBLE_SLIDE_STATUSES, VISIBLE_SLIDE_STATUSES, ACTIVE_STATUS);
        List<Map<String, Object>> subjects = new ArrayList<>();
        for (Object[] row : rows == null ? List.<Object[]>of() : rows) {
            Map<String, Object> subject = new LinkedHashMap<>();
            subject.put("subject", row[1] != null ? row[1].toString() : null);
            List<Map<String, Object>> modules = new ArrayList<>();
            if (row[2] != null) {
                for (JsonNode m : objectMapper.readTree(row[2].toString())) {
                    Map<String, Object> mod = new LinkedHashMap<>();
                    mod.put("module", m.path("module_name").asText(null));
                    mod.put("completion_percentage", round1(m.path("module_completion_percentage").asDouble(0)));
                    mod.put("batch_avg_completion_percentage",
                            round1(m.path("module_completion_percentage_by_batch").asDouble(0)));
                    mod.put("time_spent_minutes", round1(m.path("avg_time_spent_minutes").asDouble(0)));
                    mod.put("batch_avg_time_spent_minutes", round1(m.path("avg_time_spent_minutes_by_batch").asDouble(0)));
                    modules.add(mod);
                }
            }
            subject.put("modules", modules);
            subjects.add(subject);
        }
        return Map.of("subjects", subjects,
                "note", "All-time values for the batch (not limited to the window). A subject named DEFAULT is a "
                        + "course without subjects.");
    }

    /** What the learner opened in the window, one row per slide, most time first. */
    private Object contentActivity(String userId, Timestamp startTs, Timestamp endTs) {
        List<Object[]> rows = activityLogRepository.findSlideActivityForUserInRange(userId, startTs, endTs, MAX_SLIDES);
        List<Map<String, Object>> slides = new ArrayList<>();
        for (Object[] r : rows) {
            Map<String, Object> s = new LinkedHashMap<>();
            put(s, "title", r[1]);
            put(s, "type", r[2]);
            put(s, "visits", r[3] instanceof Number n ? n.intValue() : null);
            put(s, "engaged_minutes", r[4] instanceof Number n ? round1(n.doubleValue()) : null);
            put(s, "max_percentage_watched", r[5] instanceof Number n ? round1(n.doubleValue()) : null);
            put(s, "first_seen", r[6]);
            put(s, "last_seen", r[7]);
            slides.add(s);
        }
        return Map.of("slides", slides, "truncated", rows.size() >= MAX_SLIDES);
    }

    /** Assignment submissions with their titles, dates, marks out of the total and teacher feedback. */
    private Object assignments(String userId, Timestamp startTs, Timestamp endTs, Map<String, String> titles) {
        List<AssignmentSlideTracked> rows =
                assignmentSlideTrackedRepository.findSubmissionsForUserInRange(userId, startTs, endTs);
        Map<String, Double> totals = new HashMap<>();
        List<Map<String, Object>> items = new ArrayList<>();
        for (AssignmentSlideTracked a : rows) {
            if (a == null) continue;
            String slideId = a.getActivityLog() != null ? a.getActivityLog().getSlideId() : null;
            AssignmentSlideActivityLogDTO dto = a.toAssignmentSlideActivityLog();
            Map<String, Object> item = new LinkedHashMap<>();
            put(item, "title", slideTitle(slideId, titles));
            put(item, "submitted_at", a.getCreatedAt());
            put(item, "late", Boolean.TRUE.equals(dto.getLateSubmission()));
            put(item, "marks", dto.getMarks());
            put(item, "total_marks", totalMarks(slideId, totals));
            put(item, "feedback", dto.getFeedback());
            put(item, "files_submitted", countCsv(dto.getCommaSeparatedFileIds()));
            item.put("reviewed", dto.getMarks() != null || dto.getFeedback() != null || dto.getCheckedFileId() != null);
            items.add(item);
        }
        items.sort(Comparator.comparing(m -> String.valueOf(m.get("submitted_at"))));
        return Map.of("submissions", items);
    }

    /** The learner's doubts in the window — the question itself, where it was asked, and the replies. */
    private Object doubts(String userId, String instituteId, Timestamp startTs, Timestamp endTs,
                          Map<String, String> titles) {
        Page<Doubts> page = doubtsRepository.findDoubtsWithFilter(
                null, null, null, null, null,
                List.of(userId), null, instituteId,
                List.of(), false,
                List.of(""), false, false,
                List.of(""), false,
                startTs, endTs,
                PageRequest.of(0, MAX_DOUBTS));
        List<Map<String, Object>> doubts = new ArrayList<>();
        for (Doubts d : page.getContent()) {
            Map<String, Object> item = new LinkedHashMap<>();
            put(item, "raised_at", d.getRaisedTime());
            put(item, "status", d.getStatus());
            put(item, "resolved_at", d.getResolvedTime());
            put(item, "question", plainText(d.getHtmlText()));
            put(item, "on", "SLIDE".equalsIgnoreCase(d.getSource()) ? slideTitle(d.getSourceId(), titles) : d.getSource());
            put(item, "content_type", d.getContentType());
            put(item, "position", d.getContentPosition());
            List<Map<String, Object>> replies = new ArrayList<>();
            for (Doubts r : doubtsRepository.findByParentIdAndStatusNotIn(d.getId(), List.of("DELETED"))) {
                Map<String, Object> reply = new LinkedHashMap<>();
                reply.put("by", userId.equals(r.getUserId()) ? "learner" : "staff");
                put(reply, "at", r.getRaisedTime());
                put(reply, "text", plainText(r.getHtmlText()));
                replies.add(reply);
            }
            replies.sort(Comparator.comparing(m -> String.valueOf(m.get("at"))));
            if (!replies.isEmpty()) item.put("replies", replies);
            doubts.add(item);
        }
        doubts.sort(Comparator.comparing(m -> String.valueOf(m.get("raised_at"))));
        return Map.of("doubts", doubts, "total", page.getTotalElements(),
                "truncated", page.getTotalElements() > doubts.size());
    }

    /**
     * The per-attempt analysis rows (quizzes, questions, assignments, assessments), newest first.
     * {@code processed_json} was written by the hourly analytics job when the attempt happened (its
     * credits were spent then); reading it costs nothing. {@code withInput} also returns raw_json,
     * the per-question input that analysis was made from.
     */
    private Object attempts(String userId, Timestamp startTs, Timestamp endTs, Map<String, String> titles,
                            int limit, boolean withInput) {
        List<ActivityLog> rows = activityLogRepository.findAllProcessedLogsForInsights(userId, startTs, endTs);
        List<Map<String, Object>> attempts = new ArrayList<>();
        for (ActivityLog a : rows) {
            if (attempts.size() >= limit) break;
            JsonNode analysis = parse(a.getProcessedJson());
            if (analysis == null || (analysis.isObject() && analysis.size() == 1 && analysis.has("error"))) continue;
            if (analysis instanceof ObjectNode obj) obj.remove("flashcards"); // study aids, not evidence
            Map<String, Object> item = new LinkedHashMap<>();
            put(item, "kind", a.getSourceType());
            put(item, "title", slideTitle(a.getSlideId(), titles));
            put(item, "at", a.getCreatedAt());
            if (withInput) {
                put(item, "input", parse(a.getRawJson()));
            } else {
                item.put("analysis", analysis);
            }
            attempts.add(item);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("attempts", attempts);
        out.put("more_available", rows.size() > attempts.size());
        return out;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private String slideTitle(String slideId, Map<String, String> cache) {
        if (slideId == null) return null;
        return cache.computeIfAbsent(slideId, id -> {
            try {
                return slideRepository.findById(id).map(Slide::getTitle).orElse(null);
            } catch (Exception e) {
                return null;
            }
        });
    }

    private Double totalMarks(String slideId, Map<String, Double> cache) {
        if (slideId == null) return null;
        if (cache.containsKey(slideId)) return cache.get(slideId);
        Double total = null;
        try {
            Slide slide = slideRepository.findById(slideId).orElse(null);
            if (slide != null && slide.getSourceId() != null) {
                total = assignmentSlideRepository.findById(slide.getSourceId())
                        .map(a -> a.getTotalMarks()).orElse(null);
            }
        } catch (Exception e) {
            log.debug("[StudentRawDetail] total marks for slide {}: {}", slideId, e.getMessage());
        }
        cache.put(slideId, total);
        return total;
    }

    private JsonNode parse(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private static String plainText(String html) {
        if (html == null) return null;
        String text = html.replaceAll("(?i)<br\\s*/?>|</p>", "\n").replaceAll("<[^>]+>", " ")
                .replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                .replaceAll("[ \\t]+", " ").replaceAll("\\s*\\n\\s*", "\n").trim();
        return text.length() > MAX_DOUBT_TEXT ? text.substring(0, MAX_DOUBT_TEXT) + "…" : text;
    }

    private static Integer countCsv(String csv) {
        if (csv == null || csv.isBlank()) return 0;
        return (int) Arrays.stream(csv.split(",")).filter(s -> !s.isBlank()).count();
    }

    private static int clamp(Integer requested, int fallback, int max) {
        if (requested == null || requested < 1) return fallback;
        return Math.min(requested, max);
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    private static void put(Map<String, Object> map, String key, Object value) {
        if (value != null) map.put(key, value instanceof Date || value instanceof java.time.temporal.Temporal
                ? value.toString() : value);
    }
}
