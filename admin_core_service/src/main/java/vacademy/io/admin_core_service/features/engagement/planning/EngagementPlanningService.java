package vacademy.io.admin_core_service.features.engagement.planning;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementItemRequest;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementPlanDTO;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementPlanRequest;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementSlotRequest;
import vacademy.io.admin_core_service.features.engagement.service.EngagementPlanService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementSettingsService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The weekly planning email: "What are you teaching next week?"
 *
 * <ol>
 *   <li>On the institute's send day and hour, every teacher mapped to a batch gets one email
 *       per batch, unless they already have a plan running on that batch next week.</li>
 *   <li>The email's link opens a one-box page (no sign-in). The token can read only this
 *       request's context and submit this week's topic. It never publishes, reads learners,
 *       or signs anyone in.</li>
 *   <li>A submitted topic is drafted by the AI planner (billed to the institute, attributed
 *       to the teacher) and saved as a DRAFT plan the teacher reviews, or published straight
 *       away when the institute turned auto-publish on.</li>
 * </ol>
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementPlanningService {

    static final int TOPIC_MIN = 3;
    static final int TOPIC_MAX = 2000;
    private static final int MAX_DRAFT_ATTEMPTS = 2;
    private static final long DRAFT_STALE_MINUTES = 30;
    private static final Pattern IMG_PLACEHOLDER = Pattern.compile("<img[^>]*data-img-prompt[^>]*>",
            Pattern.CASE_INSENSITIVE);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String SOURCE = "engagement-planning";

    private final EngagementPlanningRequestRepository repository;
    private final EngagementSettingsService settingsService;
    private final EngagementPlanService planService;
    private final EngagementPlanningDraftClient draftClient;
    private final InstituteRepository instituteRepository;
    private final InstituteTimezoneService timezoneService;
    private final AuthService authService;
    private final NotificationService notificationService;
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    // ── who gets the email ───────────────────────────────────────────────────

    /** One teacher of one batch, with their subjects there (display text). */
    public record Target(String packageSessionId, String teacherUserId, String subjects) {}

    private static final String TARGETS_SQL = """
            SELECT f.package_session_id, f.user_id,
                   string_agg(DISTINCT s.subject_name, ', ') AS subjects
            FROM faculty_subject_package_session_mapping f
            JOIN package_session ps ON ps.id = f.package_session_id AND ps.status = 'ACTIVE'
            JOIN package_institute pi ON pi.package_id = ps.package_id AND pi.institute_id = ?
            LEFT JOIN subject s ON s.id = f.subject_id
            WHERE f.status <> 'DELETED'
              AND f.suborg_id IS NULL
              AND f.user_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM student_session_institute_group_mapping m
                          WHERE m.package_session_id = f.package_session_id AND m.status = 'ACTIVE')
            GROUP BY f.package_session_id, f.user_id
            """;

    /** Teachers of the institute's active batches that have learners; optionally only some batches. */
    public List<Target> targets(String instituteId, Set<String> onlyBatches) {
        List<Target> out = new ArrayList<>();
        jdbcTemplate.query(TARGETS_SQL, rs -> {
            String ps = rs.getString(1);
            if (onlyBatches != null && !onlyBatches.isEmpty() && !onlyBatches.contains(ps)) return;
            out.add(new Target(ps, rs.getString(2), rs.getString(3)));
        }, instituteId);
        return out;
    }

    // ── sending ──────────────────────────────────────────────────────────────

    public record SendSummary(LocalDate weekStart, int sent, int alreadyAsked, int alreadyPlanned,
                              int noEmail, int failed) {}

    /**
     * Emails every target teacher about the week starting {@code weekStart}. Idempotent per
     * (batch, teacher, week): a second call skips anyone already asked.
     */
    public SendSummary sendWeek(String instituteId, LocalDate weekStart, Set<String> onlyBatches) {
        ZoneId zone = timezoneService.getZone(instituteId);
        LocalDate today = LocalDate.now(zone);
        LocalDate weekEnd = weekStart.plusDays(6);
        LocalDate from = today.isAfter(weekStart) ? today : weekStart;

        Set<String> planned = new HashSet<>();
        for (EngagementPlanService.WindowPlan p : planService.plansRunningIn(instituteId, from, weekEnd)) {
            planned.add(p.packageSessionId() + "|" + p.createdByUserId());
        }
        List<Target> targets = targets(instituteId, onlyBatches);
        if (targets.isEmpty()) return new SendSummary(weekStart, 0, 0, 0, 0, 0);

        Set<String> asked = new HashSet<>();
        for (EngagementPlanningRequest r : repository.findByInstituteIdAndWeekStart(instituteId, weekStart)) {
            asked.add(r.getPackageSessionId() + "|" + r.getTeacherUserId());
        }

        List<Target> todo = new ArrayList<>();
        int alreadyAsked = 0;
        int alreadyPlanned = 0;
        for (Target t : targets) {
            String key = t.packageSessionId() + "|" + t.teacherUserId();
            if (asked.contains(key)) alreadyAsked++;
            else if (planned.contains(key)) alreadyPlanned++;
            else todo.add(t);
        }
        if (todo.isEmpty()) return new SendSummary(weekStart, 0, alreadyAsked, alreadyPlanned, 0, 0);

        Map<String, UserDTO> users = users(todo.stream().map(Target::teacherUserId).distinct().toList());
        Map<String, String> labels = planService.batchLabels(
                todo.stream().map(Target::packageSessionId).distinct().toList());
        Institute institute = instituteRepository.findById(instituteId).orElse(null);
        String instituteName = institute == null || institute.getInstituteName() == null
                ? "Vacademy" : institute.getInstituteName();
        String portal = portal(institute);
        Timestamp expires = endOfDay(weekEnd, zone);

        int sent = 0;
        int noEmail = 0;
        int failed = 0;
        for (Target t : todo) {
            UserDTO user = users.get(t.teacherUserId());
            if (user == null || user.getEmail() == null || user.getEmail().isBlank()) {
                noEmail++;
                continue;
            }
            String token = newToken();
            EngagementPlanningRequest row = new EngagementPlanningRequest();
            row.setId(UUID.randomUUID().toString());
            row.setInstituteId(instituteId);
            row.setPackageSessionId(t.packageSessionId());
            row.setTeacherUserId(t.teacherUserId());
            row.setWeekStart(weekStart);
            row.setStatus(EngagementPlanningRequest.Status.SENT.name());
            row.setTokenHash(hash(token));
            row.setSubjects(t.subjects());
            row.setExpiresAt(expires);
            row.setSentAt(now());
            row.setUpdatedAt(now());
            try {
                repository.saveAndFlush(row);
            } catch (DataIntegrityViolationException e) {
                // Another pod or an earlier run asked this teacher already.
                alreadyAsked++;
                continue;
            }
            String batch = labels.getOrDefault(t.packageSessionId(), "your batch");
            EngagementPlanningEmails.Mail mail = EngagementPlanningEmails.ask(instituteName, user.getFullName(),
                    batch, t.subjects(), weekStart, link(portal, token), weekEnd, false);
            if (send(user.getEmail(), mail, instituteId)) {
                sent++;
            } else {
                failed++;
                row.setStatus(EngagementPlanningRequest.Status.FAILED.name());
                row.setError("The email could not be sent.");
                row.setUpdatedAt(now());
                repository.save(row);
            }
        }
        log.info("[engagement-planning] institute {} week {}: sent {}, already asked {}, already planned {}, "
                + "no email {}, failed {}", instituteId, weekStart, sent, alreadyAsked, alreadyPlanned, noEmail, failed);
        return new SendSummary(weekStart, sent, alreadyAsked, alreadyPlanned, noEmail, failed);
    }

    /** One reminder per request, {@code reminderHours} after the first email, with a fresh link. */
    public int sendReminders() {
        Timestamp now = now();
        List<EngagementPlanningRequest> due = repository.findDueForReminder(
                Timestamp.from(Instant.now().minusSeconds(3600)), now, PageRequest.of(0, 200));
        Map<String, PlanningNudgeSettings> settings = new HashMap<>();
        int sent = 0;
        for (EngagementPlanningRequest r : due) {
            PlanningNudgeSettings s = settings.computeIfAbsent(r.getInstituteId(), settingsService::planningNudge);
            if (!s.enabled() || s.reminderHours() <= 0) continue;
            if (r.getSentAt().toInstant().plusSeconds(s.reminderHours() * 3600L).isAfter(Instant.now())) continue;
            try {
                if (remind(r)) sent++;
            } catch (Exception e) {
                log.warn("[engagement-planning] reminder failed for request {}", r.getId(), e);
            }
        }
        return sent;
    }

    private boolean remind(EngagementPlanningRequest r) {
        UserDTO user = users(List.of(r.getTeacherUserId())).get(r.getTeacherUserId());
        // Mark it reminded first: a missing address must not be retried every hour.
        String token = newToken();
        r.setReminderTokenHash(hash(token));
        r.setRemindedAt(now());
        r.setUpdatedAt(now());
        repository.save(r);
        if (user == null || user.getEmail() == null || user.getEmail().isBlank()) return false;
        Institute institute = instituteRepository.findById(r.getInstituteId()).orElse(null);
        String batch = planService.batchLabels(List.of(r.getPackageSessionId()))
                .getOrDefault(r.getPackageSessionId(), "your batch");
        EngagementPlanningEmails.Mail mail = EngagementPlanningEmails.ask(
                institute == null ? "Vacademy" : institute.getInstituteName(), user.getFullName(), batch,
                r.getSubjects(), r.getWeekStart(), link(portal(institute), token), r.getWeekStart().plusDays(6), true);
        return send(user.getEmail(), mail, r.getInstituteId());
    }

    // ── the link ─────────────────────────────────────────────────────────────

    /** What the one-box page shows. Nothing here names a learner. */
    public record PlanningView(String instituteName, String teacherFirstName, String batchLabel,
                               String subjects, String weekStart, String weekEnd, String status,
                               String topic, String error, boolean canSubmit, boolean autoPublish,
                               int tasksPerDay, List<String> runDates) {}

    public PlanningView view(String token) {
        return toView(byToken(token));
    }

    public PlanningView submit(String token, String rawTopic) {
        EngagementPlanningRequest r = byToken(token);
        String topic = rawTopic == null ? "" : rawTopic.strip();
        if (topic.length() < TOPIC_MIN) throw new VacademyException("Write a few words about what you will teach.");
        if (topic.length() > TOPIC_MAX) topic = topic.substring(0, TOPIC_MAX);
        if (!canSubmit(r)) throw new VacademyException(closedMessage(r));
        r.setTopic(topic);
        r.setStatus(EngagementPlanningRequest.Status.SUBMITTED.name());
        r.setError(null);
        r.setAttempts(0);
        r.setSubmittedAt(now());
        r.setUpdatedAt(now());
        repository.save(r);
        return toView(r);
    }

    private EngagementPlanningRequest byToken(String token) {
        if (token == null || token.length() < 20 || token.length() > 100) throw notFound();
        List<EngagementPlanningRequest> rows = repository.findByAnyTokenHash(hash(token));
        if (rows.isEmpty()) throw notFound();
        return rows.get(0);
    }

    private static VacademyException notFound() {
        return new VacademyException(org.springframework.http.HttpStatus.NOT_FOUND,
                "This link is not valid. Use the latest email, or plan from the app.");
    }

    private boolean canSubmit(EngagementPlanningRequest r) {
        if (r.getExpiresAt().toInstant().isBefore(Instant.now())) return false;
        if (!(r.is(EngagementPlanningRequest.Status.SENT) || r.is(EngagementPlanningRequest.Status.FAILED))) {
            return false;
        }
        PlanningNudgeSettings s = settingsService.planningNudge(r.getInstituteId());
        LocalDate today = LocalDate.now(timezoneService.getZone(r.getInstituteId()));
        return !s.remainingDates(r.getWeekStart(), today).isEmpty();
    }

    private String closedMessage(EngagementPlanningRequest r) {
        if (r.is(EngagementPlanningRequest.Status.SUBMITTED) || r.is(EngagementPlanningRequest.Status.DRAFTING)) {
            return "We already have your topics and are drafting the tasks.";
        }
        if (r.is(EngagementPlanningRequest.Status.DRAFTED) || r.is(EngagementPlanningRequest.Status.PUBLISHED)) {
            return "Your tasks for this week are already drafted. Open the app to change them.";
        }
        return "This week is over. Watch for next week's email, or plan from the app.";
    }

    private PlanningView toView(EngagementPlanningRequest r) {
        PlanningNudgeSettings s = settingsService.planningNudge(r.getInstituteId());
        LocalDate today = LocalDate.now(timezoneService.getZone(r.getInstituteId()));
        Institute institute = instituteRepository.findById(r.getInstituteId()).orElse(null);
        UserDTO teacher = users(List.of(r.getTeacherUserId())).get(r.getTeacherUserId());
        String batch = planService.batchLabels(List.of(r.getPackageSessionId())).get(r.getPackageSessionId());
        List<String> dates = s.remainingDates(r.getWeekStart(), today).stream().map(LocalDate::toString).toList();
        boolean expired = r.getExpiresAt().toInstant().isBefore(Instant.now()) || dates.isEmpty();
        String status = r.getStatus();
        if (expired && (r.is(EngagementPlanningRequest.Status.SENT) || r.is(EngagementPlanningRequest.Status.FAILED))) {
            status = EngagementPlanningRequest.Status.EXPIRED.name();
        }
        return new PlanningView(
                institute == null ? null : institute.getInstituteName(),
                EngagementPlanningEmails.firstName(teacher == null ? null : teacher.getFullName()),
                batch, r.getSubjects(), r.getWeekStart().toString(), r.getWeekStart().plusDays(6).toString(),
                status, r.getTopic(), r.getError(), canSubmit(r), s.autoPublish(), s.tasksPerDay(), dates);
    }

    // ── drafting ─────────────────────────────────────────────────────────────

    /** Moves submitted topics forward: start the AI draft, poll it, save the plan. */
    public void advanceDrafts() {
        List<EngagementPlanningRequest> rows = repository.findByStatusesUpdatedBefore(
                List.of(EngagementPlanningRequest.Status.SUBMITTED.name(),
                        EngagementPlanningRequest.Status.DRAFTING.name()),
                Timestamp.from(Instant.now().minusSeconds(15)), PageRequest.of(0, 50));
        for (EngagementPlanningRequest r : rows) {
            try {
                if (r.is(EngagementPlanningRequest.Status.SUBMITTED)) startDraft(r);
                else pollDraft(r);
            } catch (Exception e) {
                log.warn("[engagement-planning] draft step failed for request {}", r.getId(), e);
                retryOrFail(r, "The draft could not be made. Try again in a few minutes.");
            }
        }
    }

    void startDraft(EngagementPlanningRequest r) {
        PlanningNudgeSettings s = settingsService.planningNudge(r.getInstituteId());
        LocalDate today = LocalDate.now(timezoneService.getZone(r.getInstituteId()));
        List<LocalDate> dates = s.remainingDates(r.getWeekStart(), today);
        if (dates.isEmpty()) {
            fail(r, EngagementPlanningRequest.Status.EXPIRED, "This week is over.");
            return;
        }
        String batch = planService.batchLabels(List.of(r.getPackageSessionId())).get(r.getPackageSessionId());
        Map<String, Object> brief = new LinkedHashMap<>();
        brief.put("institute_id", r.getInstituteId());
        brief.put("acting_user_id", r.getTeacherUserId());
        brief.put("acting_role", "TEACHER");
        brief.put("title", planTitle(r));
        brief.put("topic", r.getTopic());
        if (batch != null) brief.put("audience", "Students of " + batch);
        brief.put("start_date", dates.get(0).toString());
        brief.put("dates", dates.stream().map(LocalDate::toString).toList());
        brief.put("days", dates.size());
        brief.put("per_day_items", s.tasksPerDay());
        brief.put("mix", Map.of("question_of_day", true, "reading", true, "flashcards", true,
                "poll", false, "text_question", false));
        brief.put("idempotency_key", "planning-week:" + r.getId() + ":" + r.getAttempts());
        r.setAttempts(r.getAttempts() + 1);
        try {
            JsonNode job = draftClient.start(brief);
            r.setAiTaskId(job.path("task_id").asText(null));
            r.setStatus(EngagementPlanningRequest.Status.DRAFTING.name());
            r.setUpdatedAt(now());
            repository.save(r);
        } catch (EngagementPlanningDraftClient.DraftRefused e) {
            fail(r, EngagementPlanningRequest.Status.FAILED, e.status() == 402
                    ? "Your institute is out of AI credits, so the tasks could not be drafted."
                    : "The topics could not be drafted: " + e.getMessage());
        }
    }

    void pollDraft(EngagementPlanningRequest r) {
        if (r.getAiTaskId() == null) {
            retryOrFail(r, "The draft could not be made.");
            return;
        }
        JsonNode job = draftClient.get(r.getAiTaskId(), r.getInstituteId());
        String status = job.path("status").asText("");
        if ("COMPLETED".equals(status) && job.hasNonNull("result")) {
            savePlan(r, job.get("result"));
        } else if ("PROGRESS".equals(status)) {
            boolean stale = r.getSubmittedAt() != null && r.getSubmittedAt().toInstant()
                    .plusSeconds(DRAFT_STALE_MINUTES * 60).isBefore(Instant.now());
            if (stale) retryOrFail(r, "The draft took too long.");
            else {
                r.setUpdatedAt(now());
                repository.save(r);
            }
        } else {
            String error = job.path("error").asText("");
            retryOrFail(r, error.isBlank() ? "The draft could not be made." : error);
        }
    }

    private void savePlan(EngagementPlanningRequest r, JsonNode draft) {
        PlanningNudgeSettings s = settingsService.planningNudge(r.getInstituteId());
        ObjectMapper lenient = objectMapper.copy()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        List<EngagementSlotRequest> slots = new ArrayList<>();
        int tasks = 0;
        for (JsonNode node : draft.path("slots")) {
            EngagementSlotRequest slot = lenient.convertValue(node, EngagementSlotRequest.class);
            if (slot.getItems() == null || slot.getItems().isEmpty()) continue;
            for (EngagementItemRequest item : slot.getItems()) {
                // Picture placeholders are filled only by the wizard's illustrate step.
                if (item.getContentHtml() != null) {
                    item.setContentHtml(IMG_PLACEHOLDER.matcher(item.getContentHtml()).replaceAll(""));
                }
            }
            tasks += slot.getItems().size();
            slots.add(slot);
        }
        if (slots.isEmpty()) {
            retryOrFail(r, "The AI returned no usable tasks.");
            return;
        }
        EngagementPlanRequest request = new EngagementPlanRequest();
        request.setTitle(planTitle(r));
        request.setDescription("Drafted from: " + r.getTopic());
        request.setPackageSessionId(r.getPackageSessionId());
        request.setStatus(s.autoPublish() ? "PUBLISHED" : "DRAFT");
        request.setSlots(slots);
        List<EngagementPlanDTO> created = planService.createPlans(request, r.getInstituteId(), r.getTeacherUserId());
        r.setPlanId(created.isEmpty() ? null : created.get(0).getId());
        r.setStatus((s.autoPublish() ? EngagementPlanningRequest.Status.PUBLISHED
                : EngagementPlanningRequest.Status.DRAFTED).name());
        r.setError(null);
        r.setDraftedAt(now());
        r.setUpdatedAt(now());
        repository.save(r);

        UserDTO user = users(List.of(r.getTeacherUserId())).get(r.getTeacherUserId());
        if (user != null && user.getEmail() != null && !user.getEmail().isBlank()) {
            Institute institute = instituteRepository.findById(r.getInstituteId()).orElse(null);
            String batch = planService.batchLabels(List.of(r.getPackageSessionId()))
                    .getOrDefault(r.getPackageSessionId(), "your batch");
            String link = portal(institute) + "/engagement?packageSessionId=" + r.getPackageSessionId();
            send(user.getEmail(), EngagementPlanningEmails.ready(
                    institute == null ? "Vacademy" : institute.getInstituteName(), user.getFullName(), batch,
                    r.getWeekStart(), slots.size(), tasks, s.autoPublish(), link), r.getInstituteId());
        }
    }

    private void retryOrFail(EngagementPlanningRequest r, String error) {
        if (r.getAttempts() < MAX_DRAFT_ATTEMPTS) {
            r.setStatus(EngagementPlanningRequest.Status.SUBMITTED.name());
            r.setAiTaskId(null);
            r.setError(error);
            r.setUpdatedAt(now());
            repository.save(r);
        } else {
            fail(r, EngagementPlanningRequest.Status.FAILED, error + " You can send your topics again.");
        }
    }

    private void fail(EngagementPlanningRequest r, EngagementPlanningRequest.Status status, String error) {
        r.setStatus(status.name());
        r.setError(error);
        r.setUpdatedAt(now());
        repository.save(r);
    }

    private static String planTitle(EngagementPlanningRequest r) {
        String week = "Week of " + DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH).format(r.getWeekStart());
        String subjects = r.getSubjects();
        if (subjects == null || subjects.isBlank()) return week;
        String title = subjects.strip() + " · " + week;
        return title.length() > 200 ? title.substring(0, 200) : title;
    }

    // ── dashboard: batches with nothing planned ──────────────────────────────

    public record UnplannedBatch(String packageSessionId, String label, long learnerCount) {}

    public record Coverage(String from, String to, int batchCount, int unplannedCount,
                           List<UnplannedBatch> unplanned) {}

    private static final String ACTIVE_BATCHES_SQL = """
            SELECT m.package_session_id, COUNT(DISTINCT m.user_id)
            FROM student_session_institute_group_mapping m
            JOIN package_session ps ON ps.id = m.package_session_id AND ps.status = 'ACTIVE'
            WHERE m.institute_id = ? AND m.status = 'ACTIVE' AND m.user_id IS NOT NULL
            GROUP BY m.package_session_id
            """;

    /**
     * Active batches with learners that have no PUBLISHED plan running on any of the next
     * seven days (today included). {@code onlyBatches} limits it to a teacher's own batches;
     * null = the whole institute. The list is capped at {@code limit}, largest batches first.
     */
    public Coverage coverage(String instituteId, Set<String> onlyBatches, int limit) {
        LocalDate today = LocalDate.now(timezoneService.getZone(instituteId));
        LocalDate to = today.plusDays(6);
        Map<String, Long> batches = new HashMap<>();
        jdbcTemplate.query(ACTIVE_BATCHES_SQL, rs -> {
            String ps = rs.getString(1);
            if (onlyBatches == null || onlyBatches.contains(ps)) batches.put(ps, rs.getLong(2));
        }, instituteId);
        Set<String> planned = new HashSet<>();
        for (EngagementPlanService.WindowPlan p : planService.plansRunningIn(instituteId, today, to)) {
            if ("PUBLISHED".equals(p.status())) planned.add(p.packageSessionId());
        }
        List<Map.Entry<String, Long>> missing = new ArrayList<>();
        for (Map.Entry<String, Long> e : batches.entrySet()) {
            if (!planned.contains(e.getKey())) missing.add(e);
        }
        missing.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
        List<Map.Entry<String, Long>> shown = missing.subList(0, Math.min(Math.max(0, limit), missing.size()));
        Map<String, String> labels = planService.batchLabels(shown.stream().map(Map.Entry::getKey).toList());
        List<UnplannedBatch> out = new ArrayList<>();
        for (Map.Entry<String, Long> e : shown) {
            out.add(new UnplannedBatch(e.getKey(), labels.get(e.getKey()), e.getValue()));
        }
        return new Coverage(today.toString(), to.toString(), batches.size(), missing.size(), out);
    }

    // ── admin view ───────────────────────────────────────────────────────────

    /** This week's requests of the institute, for the settings screen. Newest first. */
    public List<EngagementPlanningRequest> requestsFor(String instituteId, LocalDate weekStart) {
        List<EngagementPlanningRequest> rows = new ArrayList<>(
                repository.findByInstituteIdAndWeekStart(instituteId, weekStart));
        rows.sort(java.util.Comparator.comparing(EngagementPlanningRequest::getSentAt,
                java.util.Comparator.nullsLast(java.util.Comparator.reverseOrder())));
        return rows;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private Map<String, UserDTO> users(List<String> ids) {
        Map<String, UserDTO> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        try {
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(ids)) {
                if (u != null && u.getId() != null) out.put(u.getId(), u);
            }
        } catch (Exception e) {
            log.warn("[engagement-planning] teacher lookup failed for {} users", ids.size(), e);
        }
        return out;
    }

    private boolean send(String to, EngagementPlanningEmails.Mail mail, String instituteId) {
        try {
            notificationService.sendHtmlEmailViaUnified(to, mail.subject(), mail.html(), instituteId,
                    null, null, "UTILITY_EMAIL", SOURCE);
            return true;
        } catch (Exception e) {
            log.warn("[engagement-planning] email failed for institute {}", instituteId, e);
            return false;
        }
    }

    static String portal(Institute institute) {
        String base = institute == null ? null : institute.getAdminPortalBaseUrl();
        if (base == null || base.isBlank()) base = "dash.vacademy.io";
        base = base.strip();
        if (!base.startsWith("http://") && !base.startsWith("https://")) base = "https://" + base;
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        return base;
    }

    static String link(String portal, String token) {
        return portal + "/plan-week?t=" + token;
    }

    static String newToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Timestamp endOfDay(LocalDate day, ZoneId zone) {
        return Timestamp.from(LocalDateTime.of(day, java.time.LocalTime.of(23, 59)).atZone(zone).toInstant());
    }

    private static Timestamp now() {
        return Timestamp.from(Instant.now());
    }
}
