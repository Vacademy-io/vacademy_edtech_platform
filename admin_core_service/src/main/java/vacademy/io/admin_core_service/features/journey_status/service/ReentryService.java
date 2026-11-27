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
import vacademy.io.admin_core_service.features.live_session.client.LiveSessionUserDirectoryClient;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionStep1RequestDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionStep2RequestDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.service.Step1Service;
import vacademy.io.admin_core_service.features.live_session.service.Step2Service;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Re-entry: a learner coming back after a long break. In one transaction (everything or nothing):
 * <ul>
 *   <li>the batch they return to moves to the institute's Re-entry status (the first status of kind
 *       REENTRY), with the return date as its next action date;</li>
 *   <li>a running pause on that batch is resumed when the caller asks for {@code resumePause}
 *       ("Restart fees and access now"), through the same method the Resume button uses
 *       ({@link EnrolmentBreakService#end}, the institute's default resume choice): access, billing
 *       and fee reminders come back and the dates move exactly as a normal resume would. Without
 *       it a running pause blocks the re-entry;</li>
 *   <li>up to {@value #MAX_EXTRA_CLASSES} extra classes (sit in other ongoing batches for a while)
 *       through {@link ExtraClassService#add}; the old single bridge-course batch link is still
 *       accepted for older clients;</li>
 *   <li>an optional one-on-one bridge class: one or more private live sessions between the learner
 *       and a teacher;</li>
 *   <li>an optional assessment session (default 10 minutes) with a teacher.</li>
 * </ul>
 *
 * <p>Sessions are in-app classes ({@code bbb}, created lazily when someone joins, so no provider
 * is called here), private to the learner, with the teacher as instructor, tagged
 * {@code source = REENTRY} and {@code source_id} = this re-entry's id. Nothing is sent: no
 * LIVE_SESSION_CREATE workflow, no notification rows, and the start/end workflow dispatch skips
 * REENTRY sessions. The JOURNEY_CASE timeline entry lists every piece. The daily job
 * ({@link JourneyRiskService#returnReentries}) moves the learner back to the default status after
 * the return date when {@code reentry_auto_return} is on.
 */
@Slf4j
@Service
public class ReentryService {

    public static final String NOTE_EXTRA = "Re-entry: extra class";
    public static final String NOTE_BRIDGE = "Re-entry: bridge course";
    /** live_session.source of every session created here. */
    public static final String SESSION_SOURCE = "REENTRY";
    public static final int MAX_EXTRA_CLASSES = 5;
    public static final int MAX_ONE_ON_ONE_SESSIONS = 10;
    public static final int DEFAULT_ASSESSMENT_MINUTES = 10;
    static final String DEFAULT_ONE_ON_ONE_TITLE = "One-on-one class";
    static final String ASSESSMENT_TITLE = "Re-entry assessment";
    /** In-app class (BBB), the platform default; the room is made when someone joins. */
    static final String LINK_TYPE = "bbb";

    @Autowired private JdbcTemplate jdbc;
    @Autowired private JourneyStatusService statusService;
    @Autowired private ExtraClassService extraClassService;
    @Autowired private EnrolmentBreakService breakService;
    @Autowired private EnrolmentBreakSettings breakSettings;
    @Autowired private EnrolmentBreakGuard guard;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private Step1Service step1Service;
    @Autowired private Step2Service step2Service;
    @Autowired private LiveSessionUserDirectoryClient userDirectory;

    /** A temporary link to another batch, first and last day inclusive. */
    public record Link(String packageSessionId, LocalDate from, LocalDate to) {}

    /** One live session: date and start time in the institute's time zone, length in minutes. */
    public record Slot(LocalDate date, LocalTime start, Integer durationMinutes) {}

    /** An extra payment for the one-on-one bridge class. */
    public record Payment(BigDecimal amount, LocalDate dueDate, String note) {}

    /** One-on-one bridge class: private sessions between the learner and one teacher. */
    public record OneOnOne(String teacherUserId, String title, List<Slot> sessions, Payment payment) {}

    /** A short assessment session with a teacher. Null on the request = skipped. */
    public record Assessment(String teacherUserId, Slot slot) {}

    public record Request(String userId, String packageSessionId, String reason, List<Link> extraClasses,
                          Link bridgeCourse, OneOnOne oneOnOne, Assessment assessment, LocalDate returnOn,
                          boolean resumePause) {}

    /** What validation settled: the status to set, the trimmed reason, the return date and titles. */
    record Plan(String statusKey, String reason, LocalDate returnOn, String oneOnOneTitle, int assessmentMinutes) {}

    /**
     * Checks a request against the setting before anything is read or written. The return date
     * defaults to the latest of the links' last days and the one-on-one session dates (none when
     * there are neither).
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

        List<Link> extras = r.extraClasses() == null ? List.of() : r.extraClasses();
        if (extras.size() > MAX_EXTRA_CLASSES) {
            throw new VacademyException("Add at most " + MAX_EXTRA_CLASSES + " extra classes in one re-entry");
        }
        List<Link> all = new ArrayList<>();
        for (Link l : extras) {
            if (l == null) throw new VacademyException("Choose the batch for the extra class");
            checkLink(l, "extra class", r.packageSessionId());
            all.add(l);
        }
        checkLink(r.bridgeCourse(), "bridge course", r.packageSessionId());
        if (r.bridgeCourse() != null) all.add(r.bridgeCourse());
        for (int i = 0; i < all.size(); i++) {
            for (int j = i + 1; j < all.size(); j++) {
                Link a = all.get(i), b = all.get(j);
                if (a.packageSessionId().equals(b.packageSessionId())
                        && !a.from().isAfter(b.to()) && !b.from().isAfter(a.to())) {
                    throw new VacademyException(r.bridgeCourse() != null && j == all.size() - 1
                            ? "The extra class and the bridge course are the same batch on overlapping dates"
                            : "Two extra classes are the same batch on overlapping dates");
                }
            }
        }

        String title = null;
        List<Slot> busy = new ArrayList<>();
        OneOnOne o = r.oneOnOne();
        if (o != null) {
            if (blank(o.teacherUserId())) throw new VacademyException("Choose the teacher for the one-on-one class");
            if (o.sessions() == null || o.sessions().isEmpty()) {
                throw new VacademyException("Add at least one session for the one-on-one class");
            }
            if (o.sessions().size() > MAX_ONE_ON_ONE_SESSIONS) {
                throw new VacademyException("Add at most " + MAX_ONE_ON_ONE_SESSIONS + " one-on-one sessions in one re-entry");
            }
            for (Slot s : o.sessions()) {
                checkSlot(s, "one-on-one session", today, 15, 240);
                checkNoClash(busy, s, "Two one-on-one sessions overlap");
                busy.add(s);
            }
            title = JourneyStatusService.trimTo(o.title(), 120);
            if (title == null) title = DEFAULT_ONE_ON_ONE_TITLE;
            Payment p = o.payment();
            if (p != null) {
                if (p.amount() == null || p.amount().signum() <= 0) {
                    throw new VacademyException("The extra payment must be more than zero");
                }
                if (p.amount().compareTo(new BigDecimal("10000000")) >= 0) {
                    throw new VacademyException("The extra payment is too large");
                }
                if (p.dueDate() == null) throw new VacademyException("Choose the due date of the extra payment");
                if (p.dueDate().isBefore(today)) throw new VacademyException("The extra payment cannot be due in the past");
            }
        }

        int assessmentMinutes = DEFAULT_ASSESSMENT_MINUTES;
        Assessment a = r.assessment();
        if (a != null) {
            if (blank(a.teacherUserId())) throw new VacademyException("Choose the teacher for the assessment session");
            if (a.slot() != null && a.slot().durationMinutes() == null) {
                a = new Assessment(a.teacherUserId(), new Slot(a.slot().date(), a.slot().start(), DEFAULT_ASSESSMENT_MINUTES));
            }
            checkSlot(a.slot(), "assessment session", today, 5, 120);
            assessmentMinutes = a.slot().durationMinutes();
            if (o != null && a.teacherUserId().equals(o.teacherUserId())) {
                checkNoClash(busy, a.slot(), "The assessment overlaps a one-on-one session");
            }
        }

        LocalDate returnOn = r.returnOn();
        if (returnOn == null) {
            for (Link l : all) {
                if (returnOn == null || l.to().isAfter(returnOn)) returnOn = l.to();
            }
            if (o != null) {
                for (Slot s : o.sessions()) {
                    if (returnOn == null || s.date().isAfter(returnOn)) returnOn = s.date();
                }
            }
        } else if (returnOn.isBefore(today)) {
            throw new VacademyException("The return date cannot be in the past");
        }
        return new Plan(key, reason, returnOn, title, assessmentMinutes);
    }

    private static void checkLink(Link l, String what, String enrolment) {
        if (l == null) return;
        if (blank(l.packageSessionId())) throw new VacademyException("Choose the batch for the " + what);
        if (l.from() == null || l.to() == null) throw new VacademyException("Choose the first and the last day of the " + what);
        if (l.packageSessionId().equals(enrolment)) {
            throw new VacademyException("The " + what + " must be a different batch from the one the learner is coming back to");
        }
    }

    private static void checkSlot(Slot s, String what, LocalDate today, int minMinutes, int maxMinutes) {
        if (s == null || s.date() == null) throw new VacademyException("Choose the date of the " + what);
        if (s.start() == null) throw new VacademyException("Choose the start time of the " + what);
        if (s.date().isBefore(today)) throw new VacademyException("The " + what + " cannot be in the past");
        if (s.date().isAfter(today.plusDays(366))) throw new VacademyException("The " + what + " must be within a year");
        Integer d = s.durationMinutes();
        if (d == null || d < minMinutes || d > maxMinutes) {
            throw new VacademyException("The " + what + " must last " + minMinutes + " to " + maxMinutes + " minutes");
        }
        if (s.start().plusMinutes(d).isBefore(s.start())) {
            throw new VacademyException("The " + what + " must end on the same day");
        }
    }

    private static void checkNoClash(List<Slot> busy, Slot s, String message) {
        LocalTime end = s.start().plusMinutes(s.durationMinutes());
        for (Slot b : busy) {
            if (b.date().equals(s.date()) && s.start().isBefore(b.start().plusMinutes(b.durationMinutes()))
                    && b.start().isBefore(end)) {
                throw new VacademyException(message);
            }
        }
    }

    /**
     * Starts the re-entry. Returns {status_key, return_on, reentry_id, links:[{kind, access_id, ...}],
     * sessions:[{kind, session_id, date, start_time, ...}], access_ids, session_ids, due_id,
     * resumed_pauses}. Everything or nothing: a failing piece undoes the status change too.
     */
    public Map<String, Object> start(String instituteId, Request req, CustomUserDetails actor) {
        statusService.forget(instituteId);
        JourneyStatusConfig cfg = statusService.config(instituteId);
        LocalDate today = guard.today(instituteId);
        Plan plan = validate(cfg, req, today);
        boolean hasLinks = (req.extraClasses() != null && !req.extraClasses().isEmpty()) || req.bridgeCourse() != null;
        if (hasLinks && !breakSettings.isEnabled(instituteId)) {
            throw new VacademyException("Extra classes are part of Breaks and holds, which is switched off for this "
                    + "institute. Switch it on in Settings → Breaks and holds, or start the re-entry without them.");
        }
        if (req.oneOnOne() != null && req.oneOnOne().payment() != null) {
            throw new VacademyException("Extra payment for the one-on-one class is not available yet. Remove the "
                    + "amount and add the fee from the learner's Fees section for now.");
        }
        ZoneId zone = guard.zone(instituteId);
        LocalDateTime now = LocalDateTime.now(zone);
        if (req.oneOnOne() != null) {
            for (Slot sl : req.oneOnOne().sessions()) requireFuture(sl, now, "one-on-one session");
        }
        if (req.assessment() != null) requireFuture(req.assessment().slot(), now, "assessment session");

        // Teachers are checked with auth_service before the transaction: a read, never a message.
        Map<String, String> teacherNames = new LinkedHashMap<>();
        if (req.oneOnOne() != null) teacherNames.put(req.oneOnOne().teacherUserId(), teacherName(instituteId, req.oneOnOne().teacherUserId()));
        if (req.assessment() != null && !teacherNames.containsKey(req.assessment().teacherUserId())) {
            teacherNames.put(req.assessment().teacherUserId(), teacherName(instituteId, req.assessment().teacherUserId()));
        }

        String actorId = actor == null ? null : actor.getUserId();
        String actorName = actor == null ? null : actor.getFullName();
        String reentryId = UUID.randomUUID().toString();

        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        return tx.execute(s -> {
            if (statusService.expand(instituteId, List.of(new JourneyStatusService.Target(req.userId(), req.packageSessionId())))
                    .isEmpty()) {
                throw new VacademyException("This learner is not in that batch in this institute");
            }
            List<String> pauses = runningPauses(instituteId, req.userId(), req.packageSessionId());
            if (!pauses.isEmpty() && !req.resumePause()) {
                throw new VacademyException("This learner has a running pause on this batch. Tick \"Restart fees and "
                        + "access now\" to resume it in the same step, or resume the pause first.");
            }
            for (String id : pauses) breakService.end(id, null, instituteId, actor);

            List<Map<String, Object>> links = new ArrayList<>();
            List<String> lines = new ArrayList<>();
            if (!pauses.isEmpty()) lines.add("Fees and access: restarted (pause resumed)");
            if (req.extraClasses() != null) {
                for (Link l : req.extraClasses()) {
                    addLink(instituteId, req.userId(), "EXTRA_CLASS", l, NOTE_EXTRA, actorId, actorName, links, lines);
                }
            }
            addLink(instituteId, req.userId(), "BRIDGE_COURSE", req.bridgeCourse(), NOTE_BRIDGE, actorId, actorName, links, lines);

            List<Map<String, Object>> sessions = new ArrayList<>();
            OneOnOne o = req.oneOnOne();
            if (o != null) {
                List<Slot> slots = new ArrayList<>(o.sessions());
                slots.sort((x, y) -> x.date().atTime(x.start()).compareTo(y.date().atTime(y.start())));
                for (Slot sl : slots) {
                    sessions.add(createSession(instituteId, "ONE_ON_ONE", plan.oneOnOneTitle(), o.teacherUserId(),
                            req.userId(), sl, zone, reentryId, actor));
                }
                String teacher = label(teacherNames.get(o.teacherUserId()), o.teacherUserId());
                lines.add("One-on-one: " + slots.size() + (slots.size() == 1 ? " session" : " sessions") + " with "
                        + teacher + " from " + day(slots.get(0).date()) + " (" + plan.oneOnOneTitle() + ")");
            }
            Assessment a = req.assessment();
            if (a != null) {
                Slot sl = new Slot(a.slot().date(), a.slot().start(), plan.assessmentMinutes());
                sessions.add(createSession(instituteId, "ASSESSMENT", ASSESSMENT_TITLE, a.teacherUserId(), req.userId(),
                        sl, zone, reentryId, actor));
                lines.add("Assessment: " + day(sl.date()) + " " + time(sl.start()) + " with "
                        + label(teacherNames.get(a.teacherUserId()), a.teacherUserId()) + " (" + sl.durationMinutes() + " min)");
            } else {
                lines.add("Assessment: skipped");
            }

            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("reentry", true);
            meta.put("reentry_id", reentryId);
            meta.put("links", links);
            meta.put("sessions", sessions);
            if (!pauses.isEmpty()) meta.put("resumed_break_ids", pauses);
            statusService.apply(instituteId, cfg, req.userId(), req.packageSessionId(), plan.statusKey(), plan.reason(),
                    plan.returnOn(), JourneyStatusService.SOURCE_REENTRY, actorId, actorName, null, true, meta, lines);

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("status_key", plan.statusKey());
            out.put("return_on", plan.returnOn() == null ? null : plan.returnOn().toString());
            out.put("reentry_id", reentryId);
            out.put("links", links);
            out.put("sessions", sessions);
            out.put("access_ids", links.stream().map(m -> m.get("access_id")).toList());
            out.put("session_ids", sessions.stream().map(m -> m.get("session_id")).toList());
            out.put("due_id", null);
            out.put("resumed_pauses", pauses.size());
            return out;
        });
    }

    private static void requireFuture(Slot sl, LocalDateTime now, String what) {
        if (sl.date().atTime(sl.start()).isBefore(now.minusMinutes(1))) {
            throw new VacademyException("The " + what + " on " + day(sl.date()) + " at " + time(sl.start())
                    + " has already started. Pick a later time.");
        }
    }

    /** The teacher's name, after checking they are active staff (not a learner) of this institute. */
    private String teacherName(String instituteId, String userId) {
        LiveSessionUserDirectoryClient.DirectoryUser u = userDirectory.findActiveStaffMember(instituteId, userId);
        if (u == null) throw new VacademyException("The chosen teacher is not an active staff member of this institute");
        return u.fullName() != null ? u.fullName() : u.username();
    }

    /**
     * One private in-app session for the learner, the teacher as its instructor. Goes through the
     * same Step 1 / Step 2 services as the class scheduler, with the LIVE_SESSION_CREATE workflow
     * off and no notification actions, so nothing is sent; joins this transaction.
     */
    private Map<String, Object> createSession(String instituteId, String kind, String title, String teacherUserId,
                                              String learnerUserId, Slot sl, ZoneId zone, String reentryId,
                                              CustomUserDetails actor) {
        // Live-session convention (see MeetingBookingService.persistBooking): start_time holds the
        // WALL-CLOCK value in the session's time zone.
        LocalDateTime start = sl.date().atTime(sl.start());
        LiveSessionStep1RequestDTO s1 = new LiveSessionStep1RequestDTO();
        s1.setInstituteId(instituteId);
        s1.setTitle(title);
        s1.setSubject(title);
        s1.setStartTime(Timestamp.valueOf(start));
        s1.setLastEntryTime(Timestamp.valueOf(start.plusMinutes(sl.durationMinutes())));
        s1.setSessionEndDate(sl.date().toString());
        s1.setTimeZone(zone.getId());
        s1.setLinkType(LINK_TYPE);
        s1.setSessionStreamingServiceType("embed");
        s1.setShowToLearners(Boolean.TRUE);
        s1.setSource(SESSION_SOURCE);
        s1.setSourceId(reentryId);
        LiveSession session = step1Service.step1AddService(s1, actor, false);

        LiveSessionStep2RequestDTO s2 = new LiveSessionStep2RequestDTO();
        s2.setSessionId(session.getId());
        s2.setAccessType("private");
        s2.setIndividualUserIds(List.of(learnerUserId));
        s2.setInstructorUserIds(List.of(teacherUserId));
        step2Service.step2AddService(s2, actor);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", kind);
        m.put("session_id", session.getId());
        m.put("title", title);
        m.put("teacher_user_id", teacherUserId);
        m.put("date", sl.date().toString());
        m.put("start_time", time(sl.start()));
        m.put("duration_minutes", sl.durationMinutes());
        return m;
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

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH);

    private static String day(LocalDate d) {
        return DAY.format(d);
    }

    private static String time(LocalTime t) {
        return TIME.format(t);
    }

    private static String label(String name, String fallback) {
        return name == null || name.isBlank() ? fallback : name;
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
