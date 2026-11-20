package vacademy.io.admin_core_service.features.mentorship.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.mentorship.entity.Mentor;
import vacademy.io.admin_core_service.features.mentorship.enums.MentorStatus;
import vacademy.io.admin_core_service.features.mentorship.repository.MentorRepository;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.admin_core_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.util.PhoneCountryUtil;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ThemeColorResolver;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Sends mentorship notifications across FOUR channels — EMAIL, in-app SYSTEM_ALERT,
 * FCM PUSH, and WHATSAPP — each gated independently by the institute's
 * {@code MENTORSHIP_SETTING} blob. The learner-facing text of each channel is
 * template-driven: admins edit inline templates (subject/title/body with
 * {@code {{placeholder}}} tokens) per trigger, and WhatsApp uses an approved Meta
 * template (by name) + an optional variable mapping. When a template field or the
 * whole setting is absent, code-default text is used, so notifications work
 * out-of-the-box.
 *
 * <p>Everything is best-effort — a failed notification never breaks the
 * assignment/booking that triggered it.
 *
 * <p>Blob shape (institute setting key MENTORSHIP_SETTING):
 * <pre>
 * { "assignment": {
 *     "notify_student": true, "notify_mentor": true,
 *     "email":        { "enabled": true,  "subject": "...", "body": "..." },
 *     "system_alert": { "enabled": true,  "title": "...",   "body": "..." },
 *     "push":         { "enabled": true,  "title": "...",   "body": "..." },
 *     "whatsapp":     { "enabled": false, "template_name": "", "language_code": "en",
 *                       "variable_mapping": { "mentor_name": "mentor_name" } } },
 *   "booking":      { ...same channels; email defaults OFF (booking page already emails) },
 *   "cancellation": { ...same channels } }
 * </pre>
 * Available placeholders: {@code name}, {@code student_name}, {@code mentor_name},
 * {@code session_title}, {@code session_datetime}.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MentorshipNotificationService {

    public static final String SETTING_KEY = "MENTORSHIP_SETTING";

    /** Global-default templates live under this pseudo institute (see V424 seed). */
    private static final String DEFAULT_INSTITUTE_ID = "DEFAULT";
    private static final String FALLBACK_THEME_COLOR = "#333333";
    private static final String FALLBACK_SUPPORT_EMAIL = "support@vacademy.io";
    private static final String FALLBACK_LEARNER_URL = "https://learner.vacademy.io";

    private final NotificationService notificationService;
    private final InstituteSettingService instituteSettingService;
    private final MentorRepository mentorRepository;
    private final AuthService authService;
    private final InstituteRepository instituteRepository;
    private final TemplateRepository templateRepository;
    private final InstituteDomainRoutingRepository domainRoutingRepository;

    /**
     * Immutable code-default text for a trigger. {@code templateName} is the name of the DB
     * email template (in the {@code templates} table) preferred over this inline body — resolved
     * per-institute with a DEFAULT fallback (V424 seed); the inline body is only used when no
     * template row exists at all.
     */
    private record Defaults(String type, boolean emailDefault, String emailSubject, String emailBody,
                            String alertTitle, String alertBody, String pushTitle, String pushBody,
                            String templateName) {}

    private static final Defaults ASSIGNMENT_STUDENT = new Defaults(
            "MENTOR_ASSIGNED", true,
            "You have a new mentor",
            "<p>Hi {{name}},</p><p><b>{{mentor_name}}</b> is now your mentor. "
                    + "Open <b>My Mentors</b> in your dashboard sidebar to message them directly "
                    + "or book a 1:1 session.</p>",
            "You have a new mentor",
            "{{mentor_name}} is now your mentor. Open My Mentors in the sidebar to message them or book a session.",
            "You have a new mentor",
            "{{mentor_name}} is now your mentor. Open My Mentors to message them or book a session.",
            "Mentor Assigned - Student");

    private static final Defaults BOOKING = new Defaults(
            "MENTOR_BOOKING", false, // booking-page confirmation email already covers email
            "Mentor session booked",
            "<p>Hi {{name}},</p><p>Your session <b>{{session_title}}</b> is confirmed for "
                    + "<b>{{session_datetime}}</b>.</p>",
            "Mentor session booked",
            "Your session \"{{session_title}}\" is confirmed for {{session_datetime}}.",
            "Mentor session booked",
            "Your session \"{{session_title}}\" is confirmed for {{session_datetime}}.",
            "Mentor Session Booked");

    private static final Defaults CANCELLATION = new Defaults(
            "MENTOR_BOOKING", true,
            "Mentor session cancelled",
            "<p>Hi {{name}},</p><p>Your session <b>{{session_title}}</b> for {{session_datetime}} "
                    + "was cancelled.</p>",
            "Mentor session cancelled",
            "Your session \"{{session_title}}\" was cancelled.",
            "Mentor session cancelled",
            "Your session \"{{session_title}}\" was cancelled.",
            "Mentor Session Cancelled");

    private static final Defaults SESSION_REMINDER = new Defaults(
            "MENTOR_REMINDER", true,
            "Reminder: your mentor session is coming up",
            "<p>Hi {{name}},</p><p>Your session <b>{{session_title}}</b> with <b>{{mentor_name}}</b> "
                    + "starts at <b>{{session_datetime}}</b>. Open <b>My Mentors</b> if you need the "
                    + "joining link.</p>",
            "Upcoming mentor session",
            "\"{{session_title}}\" with {{mentor_name}} starts at {{session_datetime}}.",
            "Upcoming mentor session",
            "\"{{session_title}}\" with {{mentor_name}} starts at {{session_datetime}}.",
            "Mentor Session Reminder");

    private static final Defaults CHECKIN_REMINDER = new Defaults(
            "MENTOR_CHECKIN", true,
            "Time to catch up with your mentor?",
            "<p>Hi {{name}},</p><p>It's been a while since your last session with "
                    + "<b>{{mentor_name}}</b>. Open <b>My Mentors</b> to book a 1:1 or send them "
                    + "a message.</p>",
            "Catch up with your mentor",
            "It's been a while since you connected with {{mentor_name}}. Book a session or send them a message.",
            "Catch up with your mentor",
            "It's been a while since you connected with {{mentor_name}}. Book a session or message them.",
            "Mentor Check-in Reminder");

    private static final Defaults REQUEST_DECLINED = new Defaults(
            "MENTOR_REQUEST", true,
            "About your mentor request",
            "<p>Hi {{name}},</p><p>Your request for a mentor wasn't taken forward this time."
                    + "{{decision_note_html}}</p><p>You can browse other mentors and request again "
                    + "from <b>Find a mentor</b> in your dashboard.</p>",
            "Mentor request update",
            "Your mentor request wasn't approved this time. Browse other mentors in Find a mentor.",
            "Mentor request update",
            "Your mentor request wasn't approved this time. Browse other mentors in Find a mentor.",
            "Mentor Request Declined");

    // ---------------------------------------------------------------- triggers

    /** New mentor↔student assignment. */
    public void notifyAssignment(String instituteId, String studentUserId, String mentorUserId,
                                 String mentorDisplayName) {
        try {
            Map<String, Object> trigger = section(instituteId, "assignment");
            boolean notifyStudent = flag(trigger, "notify_student", true);
            boolean notifyMentor = flag(trigger, "notify_mentor", true);
            if (!notifyStudent && !notifyMentor) return;

            Map<String, UserDTO> users = hydrate(List.of(
                    studentUserId == null ? "" : studentUserId,
                    mentorUserId == null ? "" : mentorUserId));
            UserDTO student = users.get(studentUserId);
            UserDTO mentor = users.get(mentorUserId);
            String mentorName = (mentorDisplayName != null && !mentorDisplayName.isBlank())
                    ? mentorDisplayName : nameOf(mentor, "your mentor");

            if (notifyStudent && studentUserId != null) {
                Map<String, String> vars = baseVars(nameOf(student, "there"),
                        nameOf(student, "the student"), mentorName, "", "");
                deliverToLearner(instituteId, studentUserId, student,
                        student != null ? student.getMobileNumber() : null,
                        trigger, vars, ASSIGNMENT_STUDENT);
            }
            if (notifyMentor && mentorUserId != null) {
                Map<String, String> vars = baseVars(nameOf(mentor, "there"),
                        nameOf(student, "a student"), mentorName, "", "");
                deliverToMentor(instituteId, mentorUserId, mentor, trigger, vars);
            }
        } catch (Exception e) {
            log.warn("mentorship assignment notification failed (institute {}): {}", instituteId, e.getMessage());
            MentorshipErrorReporter.report(e, "notify-assignment", instituteId);
        }
    }

    /**
     * A mentorship booking was created or cancelled. No-op when the host isn't a mentor
     * (so non-mentorship bookings are unaffected). For CREATED bookings the email channel
     * defaults OFF (the booking page already sends a confirmation email); for CANCELLED it
     * defaults ON.
     */
    public void notifyBooking(String instituteId, String hostUserId, String inviteeUserId, String inviteeEmail,
                              String inviteePhone, String inviteeName, String title, String whenText,
                              boolean cancelled) {
        try {
            Optional<Mentor> host = hostUserId == null ? Optional.empty()
                    : mentorRepository.findByInstituteIdAndUserIdAndStatusNot(
                            instituteId, hostUserId, MentorStatus.DELETED.name());
            if (host.isEmpty()) return; // not a mentor booking

            Map<String, Object> trigger = section(instituteId, cancelled ? "cancellation" : "booking");
            UserDTO invitee = (inviteeUserId != null && !inviteeUserId.isBlank())
                    ? hydrate(List.of(inviteeUserId)).get(inviteeUserId) : null;
            String name = firstNonBlank(inviteeName, invitee != null ? invitee.getFullName() : null, "there");
            String email = firstNonBlank(inviteeEmail, invitee != null ? invitee.getEmail() : null, null);
            String phone = firstNonBlank(inviteePhone, invitee != null ? invitee.getMobileNumber() : null, null);

            Map<String, String> vars = baseVars(name, name, host.get().getDisplayName(),
                    firstNonBlank(title, "Mentor session", "Mentor session"),
                    whenText == null ? "" : whenText);
            deliverToLearner(instituteId, inviteeUserId, invitee, email, phone,
                    trigger, vars, cancelled ? CANCELLATION : BOOKING);
        } catch (Exception e) {
            log.warn("mentorship booking notification failed (institute {}): {}", instituteId, e.getMessage());
            MentorshipErrorReporter.report(e, "notify-booking", instituteId);
        }
    }

    /**
     * Reminder ahead of an upcoming mentorship session. Fired by
     * {@code MentorshipReminderScheduler}, which owns due-time computation and
     * once-per-booking dedup; this method only resolves config + delivers.
     */
    public void notifySessionReminder(String instituteId, String mentorDisplayName, String inviteeUserId,
                                      String inviteeEmail, String inviteePhone, String inviteeName,
                                      String title, String whenText) {
        try {
            Map<String, Object> trigger = section(instituteId, "session_reminder");
            if (!flag(trigger, "enabled", true)) return;
            UserDTO invitee = (inviteeUserId != null && !inviteeUserId.isBlank())
                    ? hydrate(List.of(inviteeUserId)).get(inviteeUserId) : null;
            String name = firstNonBlank(inviteeName, invitee != null ? invitee.getFullName() : null, "there");
            String email = firstNonBlank(inviteeEmail, invitee != null ? invitee.getEmail() : null, null);
            String phone = firstNonBlank(inviteePhone, invitee != null ? invitee.getMobileNumber() : null, null);
            Map<String, String> vars = baseVars(name, name,
                    firstNonBlank(mentorDisplayName, "your mentor", "your mentor"),
                    firstNonBlank(title, "Mentor session", "Mentor session"),
                    whenText == null ? "" : whenText);
            deliverToLearner(instituteId, inviteeUserId, invitee, email, phone, trigger, vars, SESSION_REMINDER);
        } catch (Exception e) {
            log.warn("mentorship session reminder failed (institute {}): {}", instituteId, e.getMessage());
            MentorshipErrorReporter.report(e, "notify-session-reminder", instituteId);
        }
    }

    /**
     * Nudge a student who hasn't had a session with their mentor for the configured
     * inactivity window (also fired by the scheduler). Master flag defaults OFF —
     * unlike the other triggers this one emails out of the blue, so institutes opt in.
     */
    public void notifyCheckinReminder(String instituteId, String studentUserId, String mentorDisplayName) {
        try {
            Map<String, Object> trigger = section(instituteId, "checkin_reminder");
            if (!flag(trigger, "enabled", false)) return;
            UserDTO student = hydrate(List.of(studentUserId)).get(studentUserId);
            String name = nameOf(student, "there");
            Map<String, String> vars = baseVars(name, name,
                    firstNonBlank(mentorDisplayName, "your mentor", "your mentor"), "", "");
            deliverToLearner(instituteId, studentUserId, student,
                    student != null ? student.getMobileNumber() : null, trigger, vars, CHECKIN_REMINDER);
        } catch (Exception e) {
            log.warn("mentorship check-in reminder failed (institute {}): {}", instituteId, e.getMessage());
            MentorshipErrorReporter.report(e, "notify-checkin-reminder", instituteId);
        }
    }

    /**
     * A learner asked to be mentored — tell the requested mentor so they can back the
     * admin's decision. Mentor-side only: the learner already saw the confirmation in-app,
     * and the approval path re-uses the ordinary "new mentor" assignment notice.
     */
    public void notifyRequestSubmitted(String instituteId, String mentorUserId, String studentUserId,
                                       String mentorDisplayName) {
        try {
            Map<String, Object> trigger = section(instituteId, "request");
            if (!flag(trigger, "notify_mentor", true) || mentorUserId == null) return;

            Map<String, UserDTO> users = hydrate(List.of(
                    studentUserId == null ? "" : studentUserId, mentorUserId));
            UserDTO student = users.get(studentUserId);
            UserDTO mentor = users.get(mentorUserId);
            String title = "New mentorship request";
            String body = "%s has requested you as their mentor. Your admin will confirm the pairing."
                    .formatted(nameOf(student, "A student"));
            if (channelEnabled(channel(trigger, "system_alert"), true)) {
                systemAlert(instituteId, mentorUserId, title, body);
            }
            if (channelEnabled(channel(trigger, "push"), true)) {
                push(instituteId, mentorUserId, title, body);
            }
            if (channelEnabled(channel(trigger, "email"), true)
                    && mentor != null && mentor.getEmail() != null && !mentor.getEmail().isBlank()) {
                Map<String, String> vars = baseVars(nameOf(mentor, "there"),
                        nameOf(student, "a student"),
                        firstNonBlank(mentorDisplayName, nameOf(mentor, "you"), "you"), "", "");
                if (!sendTemplatedEmail(instituteId, mentor.getEmail(), nameOf(mentor, "there"),
                        "Mentor Request Received - Mentor", vars)) {
                    sendEmail(instituteId, mentor.getEmail(), mentorUserId, title,
                            "<p>Hi " + nameOf(mentor, "there") + ",</p><p>" + body + "</p>", "MENTOR_REQUEST");
                }
            }
        } catch (Exception e) {
            log.warn("mentorship request notification failed (institute {}): {}", instituteId, e.getMessage());
            MentorshipErrorReporter.report(e, "notify-request-submitted", instituteId);
        }
    }

    /**
     * A learner's mentor request was declined. Approvals deliberately send nothing here —
     * the assignment that approval creates already fires the "you have a new mentor" notice,
     * so a second message would double up.
     */
    public void notifyRequestDeclined(String instituteId, String studentUserId, String decisionNote) {
        try {
            Map<String, Object> trigger = section(instituteId, "request");
            if (!flag(trigger, "notify_student", true)) return;
            UserDTO student = hydrate(List.of(studentUserId)).get(studentUserId);
            Map<String, String> vars = baseVars(nameOf(student, "there"),
                    nameOf(student, "the student"), "your mentor", "", "");
            // Rendered inline so a blank note leaves no dangling punctuation in the email.
            vars.put("decision_note_html",
                    decisionNote == null || decisionNote.isBlank()
                            ? "" : " <i>" + escapeHtml(decisionNote.trim()) + "</i>");
            // Escaped as well: {{decision_note}} is offered to admins as an editable
            // placeholder, and an edited email body would otherwise render raw markup.
            vars.put("decision_note",
                    decisionNote == null ? "" : escapeHtml(decisionNote.trim()));
            deliverToLearner(instituteId, studentUserId, student,
                    student != null ? student.getMobileNumber() : null, trigger, vars, REQUEST_DECLINED);
        } catch (Exception e) {
            log.warn("mentorship request decline notification failed (institute {}): {}", instituteId, e.getMessage());
            MentorshipErrorReporter.report(e, "notify-request-declined", instituteId);
        }
    }

    /** Minimal escaping for admin-authored decline notes rendered into the email body. */
    private static String escapeHtml(String raw) {
        return raw.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    // ---------------------------------------------------- scheduler-facing config

    /**
     * Master on/off of a trigger section. {@code def} mirrors each trigger's default:
     * {@code session_reminder} true, {@code checkin_reminder} false (opt-in).
     */
    public boolean triggerEnabled(String instituteId, String key, boolean def) {
        return flag(section(instituteId, key), "enabled", def);
    }

    /** Lead time (hours before start) for the session reminder. Default 24h, clamped 1..168. */
    public int sessionReminderHoursBefore(String instituteId) {
        return intCfg(section(instituteId, "session_reminder"), "hours_before", 24, 1, 168);
    }

    /** Inactivity window (days) for the check-in nudge; also its re-nudge cadence. Default 14, clamped 1..365. */
    public int checkinInactivityDays(String instituteId) {
        return intCfg(section(instituteId, "checkin_reminder"), "inactivity_days", 14, 1, 365);
    }

    private static int intCfg(Map<String, Object> cfg, String key, int def, int min, int max) {
        if (cfg == null) return def;
        try {
            Object v = cfg.get(key);
            int n = v instanceof Number num ? num.intValue() : Integer.parseInt(String.valueOf(v));
            return Math.max(min, Math.min(max, n));
        } catch (Exception e) {
            return def;
        }
    }

    // ------------------------------------------------------------ delivery core

    /** Deliver a learner-facing message across all four channels per the trigger config. */
    private void deliverToLearner(String instituteId, String userId, UserDTO user,
                                  String phone, Map<String, Object> trigger,
                                  Map<String, String> vars, Defaults d) {
        deliverToLearner(instituteId, userId, user, user != null ? user.getEmail() : null, phone, trigger, vars, d);
    }

    private void deliverToLearner(String instituteId, String userId, UserDTO user, String email,
                                  String phone, Map<String, Object> trigger,
                                  Map<String, String> vars, Defaults d) {
        Map<String, Object> em = channel(trigger, "email");
        if (channelEnabled(em, d.emailDefault()) && email != null && !email.isBlank()) {
            // Order: the institute's own DB template -> the admin's customised inline
            // subject/body -> the shared DEFAULT template -> the code default.
            String recipientName = vars.getOrDefault("name", "there");
            String inlineSubject = customised(str(em, "subject"), d.emailSubject());
            String inlineBody = customised(str(em, "body"), d.emailBody());
            Template own = findTemplate(instituteId, d.templateName());
            boolean sent = sendTemplatedEmail(instituteId, email, recipientName, d.templateName(), own, vars);
            if (!sent && (inlineSubject != null || inlineBody != null)) {
                sendEmail(instituteId, email, userId,
                        applyPlaceholders(orDefault(inlineSubject, d.emailSubject()), vars),
                        applyPlaceholders(orDefault(inlineBody, d.emailBody()), vars), d.type());
                sent = true;
            }
            // DEFAULT only when the institute has no template of its own: if theirs was tried and
            // the send failed, go straight to the code default (two tries at most, as before).
            if (!sent && own == null) {
                sent = sendTemplatedEmail(instituteId, email, recipientName, d.templateName(),
                        findTemplate(DEFAULT_INSTITUTE_ID, d.templateName()), vars);
            }
            if (!sent) {
                sendEmail(instituteId, email, userId, applyPlaceholders(d.emailSubject(), vars),
                        applyPlaceholders(d.emailBody(), vars), d.type());
            }
        }
        Map<String, Object> al = channel(trigger, "system_alert");
        if (channelEnabled(al, true) && userId != null) {
            systemAlert(instituteId, userId,
                    applyPlaceholders(orDefault(str(al, "title"), d.alertTitle()), vars),
                    applyPlaceholders(orDefault(str(al, "body"), d.alertBody()), vars));
        }
        Map<String, Object> pu = channel(trigger, "push");
        if (channelEnabled(pu, true) && userId != null) {
            push(instituteId, userId,
                    applyPlaceholders(orDefault(str(pu, "title"), d.pushTitle()), vars),
                    applyPlaceholders(orDefault(str(pu, "body"), d.pushBody()), vars));
        }
        Map<String, Object> wa = channel(trigger, "whatsapp");
        if (channelEnabled(wa, false) && phone != null && !phone.isBlank()) {
            String template = str(wa, "template_name");
            if (template != null && !template.isBlank()) {
                sendWhatsapp(instituteId, phone, userId, vars.get("name"), template,
                        str(wa, "language_code"), asMap(wa.get("variable_mapping")), vars);
            }
        }
    }

    /**
     * Mentor-side "new mentee" notification. Reuses the trigger's channel enable flags but
     * fixed text (the editable templates target the learner). No WhatsApp to mentors in v1.
     */
    private void deliverToMentor(String instituteId, String userId, UserDTO user,
                                 Map<String, Object> trigger, Map<String, String> vars) {
        String title = "New mentee assigned";
        String body = applyPlaceholders(
                "A new student ({{student_name}}) has been assigned to you for mentorship. "
                        + "Open My Mentorship to view them.", vars);
        if (channelEnabled(channel(trigger, "email"), true)
                && user != null && user.getEmail() != null && !user.getEmail().isBlank()) {
            if (!sendTemplatedEmail(instituteId, user.getEmail(),
                    vars.getOrDefault("name", nameOf(user, "there")), "New Mentee - Mentor", vars)) {
                sendEmail(instituteId, user.getEmail(), userId, title,
                        "<p>Hi " + applyPlaceholders("{{name}}", vars) + ",</p><p>" + body + "</p>", "MENTEE_ASSIGNED");
            }
        }
        if (channelEnabled(channel(trigger, "system_alert"), true)) systemAlert(instituteId, userId, title, body);
        if (channelEnabled(channel(trigger, "push"), true)) push(instituteId, userId, title, body);
    }

    // ----------------------------------------------------------- DB templates

    /**
     * Send a branded HTML email from the DB template store. Resolves by
     * (institute, name, EMAIL) with a DEFAULT fallback (V424 seed) and renders the
     * subject/content with the mentorship vars + institute branding. Returns false when
     * no template row exists so the caller can fall back to the inline body.
     */
    private boolean sendTemplatedEmail(String instituteId, String email, String recipientName,
                                       String templateName, Map<String, String> vars) {
        if (templateName == null || templateName.isBlank() || email == null || email.isBlank()) return false;
        return sendTemplatedEmail(instituteId, email, recipientName, templateName,
                resolveTemplate(instituteId, templateName), vars);
    }

    /** Render and send an already-resolved template row; false when there is none or the send fails. */
    private boolean sendTemplatedEmail(String instituteId, String email, String recipientName,
                                       String templateName, Template template, Map<String, String> vars) {
        if (template == null || email == null || email.isBlank()) return false;
        try {
            InstituteContext ctx = loadInstituteContext(instituteId);
            Map<String, String> v = new HashMap<>(vars);
            v.put("recipient_name", recipientName != null && !recipientName.isBlank() ? recipientName : "there");
            v.put("institute_name", ctx.name());
            v.put("institute_theme_color", ctx.themeColor());
            v.put("support_email", ctx.supportEmail());
            v.put("cta_url", ctx.ctaUrl());
            String subject = applyPlaceholders(template.getSubject(), v);
            String body = applyPlaceholders(template.getContent(), v);
            notificationService.sendHtmlEmailViaUnified(email, subject, body, instituteId,
                    null, ctx.fromName(), "TRANSACTIONAL");
            return true;
        } catch (Exception e) {
            log.warn("mentorship templated email failed ({}): {}", templateName, e.getMessage());
            return false;
        }
    }

    /** Institute's own EMAIL template row for this name, else the shared DEFAULT seed. */
    private Template resolveTemplate(String instituteId, String templateName) {
        try {
            Optional<Template> institute =
                    templateRepository.findByInstituteIdAndNameAndType(instituteId, templateName, "EMAIL");
            if (institute.isPresent()) return institute.get();
            return templateRepository.findByInstituteIdAndNameAndType(
                    DEFAULT_INSTITUTE_ID, templateName, "EMAIL").orElse(null);
        } catch (Exception e) {
            log.warn("mentorship template lookup failed ({}): {}", templateName, e.getMessage());
            return null;
        }
    }

    /** The EMAIL template row owned by exactly {@code ownerId} (an institute or DEFAULT), else null. */
    private Template findTemplate(String ownerId, String templateName) {
        if (ownerId == null || templateName == null || templateName.isBlank()) return null;
        try {
            return templateRepository.findByInstituteIdAndNameAndType(ownerId, templateName, "EMAIL")
                    .orElse(null);
        } catch (Exception e) {
            log.warn("mentorship template lookup failed ({}): {}", templateName, e.getMessage());
            return null;
        }
    }

    private record InstituteContext(String name, String themeColor, String supportEmail,
                                    String ctaUrl, String fromName) {}

    /** Institute branding for email rendering: name, theme colour, learner CTA link. */
    private InstituteContext loadInstituteContext(String instituteId) {
        String name = "";
        String themeColor = FALLBACK_THEME_COLOR;
        String cta = FALLBACK_LEARNER_URL;
        String supportEmail = FALLBACK_SUPPORT_EMAIL;
        try {
            Institute inst = instituteRepository.findById(instituteId).orElse(null);
            if (inst != null) {
                if (inst.getInstituteName() != null && !inst.getInstituteName().isBlank()) {
                    name = inst.getInstituteName();
                }
                themeColor = normalizeThemeColor(inst.getInstituteThemeCode());
                // Institute's own contact address for {{support_email}}, not the platform inbox.
                if (inst.getEmail() != null && !inst.getEmail().isBlank()) {
                    supportEmail = inst.getEmail().trim();
                }
            }
        } catch (Exception ignore) {
            // fall back to defaults
        }
        try {
            cta = domainRoutingRepository.findByInstituteIdAndRole(instituteId, "LEARNER")
                    .map(r -> r.getSubdomain())
                    .filter(s -> s != null && s.contains("."))
                    .map(s -> "https://" + s)
                    .orElse(FALLBACK_LEARNER_URL);
        } catch (Exception ignore) {
            // fall back to the default learner URL
        }
        return new InstituteContext(name, themeColor, supportEmail, cta,
                name.isBlank() ? null : name);
    }

    /** Accept a raw hex (with/without '#') or CSS keyword; blank -> fallback. Mirrors doubt emails. */
    private static String normalizeThemeColor(String themeCode) {
        // Hex or a theme preset ("primary", "blue", ...) -> hex; anything else -> neutral.
        String resolved = ThemeColorResolver.resolve(themeCode);
        return resolved != null ? resolved : FALLBACK_THEME_COLOR;
    }

    // --------------------------------------------------------------- channels

    private void sendEmail(String instituteId, String email, String userId, String subject, String body, String type) {
        try {
            NotificationDTO dto = new NotificationDTO();
            dto.setSubject(subject);
            dto.setBody(body); // already rendered — no unresolved placeholders
            dto.setNotificationType(type);
            dto.setSource("MENTORSHIP");
            dto.setSourceId(userId);
            NotificationToUserDTO r = new NotificationToUserDTO();
            r.setChannelId(email);
            r.setUserId(userId);
            r.setPlaceholders(new HashMap<>());
            dto.setUsers(List.of(r));
            notificationService.sendEmailViaUnified(dto, instituteId);
        } catch (Exception e) {
            log.warn("mentorship email failed: {}", e.getMessage());
        }
    }

    private void systemAlert(String instituteId, String userId, String title, String body) {
        try {
            notificationService.createSystemAlertAnnouncement(instituteId, List.of(userId), title, body,
                    "SYSTEM", "Mentorship", "ADMIN", null);
        } catch (Exception e) {
            log.warn("mentorship system alert failed: {}", e.getMessage());
        }
    }

    private void push(String instituteId, String userId, String title, String body) {
        try {
            notificationService.sendPushViaUnified(instituteId, List.of(userId), title, body, null);
        } catch (Exception e) {
            log.warn("mentorship push failed: {}", e.getMessage());
        }
    }

    /**
     * Sends a WhatsApp message through the unified path using an approved template. When
     * {@code mapping} is empty, the full variable map is passed keyed by name — notification
     * service matches the approved template's named variables automatically, so well-named
     * templates need no mapping. An explicit mapping resolves each template variable to a
     * source key (or {@code static:<literal>}).
     */
    private void sendWhatsapp(String instituteId, String phone, String userId, String name, String templateName,
                              String languageCode, Map<String, Object> mapping, Map<String, String> vars) {
        try {
            String normalized = PhoneCountryUtil.normalizePhone(phone, true);
            Map<String, String> variables = new HashMap<>();
            if (mapping == null || mapping.isEmpty()) {
                variables.putAll(vars); // name-match against the template's variables
            } else {
                for (Map.Entry<String, Object> e : mapping.entrySet()) {
                    String src = e.getValue() == null ? "" : String.valueOf(e.getValue());
                    String val = src.startsWith("static:") ? src.substring("static:".length())
                            : vars.getOrDefault(src, "");
                    variables.put(e.getKey(), val == null ? "" : val);
                }
            }
            UnifiedSendRequest req = UnifiedSendRequest.builder()
                    .instituteId(instituteId)
                    .channel("WHATSAPP")
                    .templateName(templateName)
                    .languageCode(firstNonBlank(languageCode, "en", "en"))
                    .recipients(List.of(UnifiedSendRequest.Recipient.builder()
                            .phone(normalized)
                            .userId(userId)
                            .name(name)
                            .variables(variables)
                            .build()))
                    .build();
            notificationService.sendUnified(req);
        } catch (Exception e) {
            log.warn("mentorship whatsapp failed: {}", e.getMessage());
        }
    }

    // ---------------------------------------------------------------- helpers

    private static Map<String, String> baseVars(String name, String studentName, String mentorName,
                                                String sessionTitle, String sessionDatetime) {
        Map<String, String> v = new HashMap<>();
        v.put("name", name == null ? "" : name);
        v.put("student_name", studentName == null ? "" : studentName);
        v.put("mentor_name", mentorName == null ? "" : mentorName);
        v.put("session_title", sessionTitle == null ? "" : sessionTitle);
        v.put("session_datetime", sessionDatetime == null ? "" : sessionDatetime);
        return v;
    }

    private static String applyPlaceholders(String template, Map<String, String> vars) {
        if (template == null) return "";
        String out = template;
        for (Map.Entry<String, String> e : vars.entrySet()) {
            out = out.replace("{{" + e.getKey() + "}}", e.getValue() == null ? "" : e.getValue());
        }
        return out;
    }

    /** The trigger's config map (e.g. "assignment"); null when the setting is absent → code defaults. */
    @SuppressWarnings("unchecked")
    private Map<String, Object> section(String instituteId, String key) {
        try {
            Object blob = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, SETTING_KEY);
            if (blob instanceof Map<?, ?> m) {
                Object sec = ((Map<String, Object>) m).get(key);
                if (sec instanceof Map<?, ?> sm) return (Map<String, Object>) sm;
            }
        } catch (Exception ignore) {
            // absent/unreadable → code defaults
        }
        return null;
    }

    /** A channel's config map. Handles the legacy boolean form ({@code "email": true}). */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> channel(Map<String, Object> trigger, String channel) {
        if (trigger == null) return null;
        Object v = trigger.get(channel);
        if (v instanceof Map<?, ?> m) return (Map<String, Object>) m;
        if (v instanceof Boolean b) {
            Map<String, Object> legacy = new HashMap<>();
            legacy.put("enabled", b);
            return legacy;
        }
        return null;
    }

    private static boolean channelEnabled(Map<String, Object> channel, boolean def) {
        if (channel == null) return def;
        Object v = channel.get("enabled");
        if (v instanceof Boolean b) return b;
        if (v instanceof String s) return Boolean.parseBoolean(s);
        return def;
    }

    private static boolean flag(Map<String, Object> cfg, String key, boolean def) {
        if (cfg == null) return def;
        Object v = cfg.get(key);
        if (v instanceof Boolean b) return b;
        if (v instanceof String s) return Boolean.parseBoolean(s);
        return def;
    }

    private static String str(Map<String, Object> map, String key) {
        if (map == null) return null;
        Object v = map.get(key);
        return v == null ? null : String.valueOf(v);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object v) {
        return v instanceof Map<?, ?> m ? (Map<String, Object>) m : null;
    }

    private Map<String, UserDTO> hydrate(List<String> ids) {
        List<String> distinct = ids.stream().filter(i -> i != null && !i.isBlank()).distinct().toList();
        if (distinct.isEmpty()) return Map.of();
        try {
            Map<String, UserDTO> map = new HashMap<>();
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(distinct)) {
                if (u != null && u.getId() != null) map.put(u.getId(), u);
            }
            return map;
        } catch (Exception e) {
            return Map.of();
        }
    }

    private static String nameOf(UserDTO u, String fallback) {
        if (u != null && u.getFullName() != null && !u.getFullName().isBlank()) return u.getFullName();
        return fallback;
    }

    private static String orDefault(String v, String def) {
        return (v != null && !v.isBlank()) ? v : def;
    }

    /**
     * The admin's inline text only when they actually changed it. The settings screen saves
     * the stock text (same as the code default) for untouched triggers, and that must not
     * override the branded DEFAULT template.
     */
    private static String customised(String v, String stock) {
        if (v == null || v.isBlank()) return null;
        return stock != null && v.trim().equals(stock.trim()) ? null : v;
    }

    private static String firstNonBlank(String a, String b, String c) {
        if (a != null && !a.isBlank()) return a;
        if (b != null && !b.isBlank()) return b;
        return c;
    }
}
