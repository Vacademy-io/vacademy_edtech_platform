package vacademy.io.admin_core_service.features.doubts.manager;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.doubts.entity.Doubts;
import vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management.DoubtManagementSettingDataDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management.DoubtManagementSettingDataDto.DoubtNotificationChannelPrefs;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.enums.SettingKeyEnums;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ThemeColorResolver;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Dispatches doubt-related notifications (push + email) driven by the institute's
 * {@code DOUBT_MANAGEMENT_SETTING.notifications} block.
 *
 * <p>Branding + sender resolution (applied to every email this service sends):
 * <ul>
 *   <li>{@code from_email}: institute's configured {@code EMAIL_SETTING.UTILITY_EMAIL.from} →
 *       fallback to {@link #FALLBACK_SUPPORT_EMAIL}. Passed explicitly so notification-service's
 *       env-var global default can't accidentally leak a different address.</li>
 *   <li>{@code from_name}: institute's name.</li>
 *   <li>{@code {{institute_name}}}, {@code {{institute_theme_color}}}, {@code {{support_email}}}
 *       placeholders are injected into the template alongside the per-doubt variables so the same
 *       template can render under each institute's brand.</li>
 * </ul>
 *
 * <p>Notification failures never propagate back to the doubt-create/resolve flow — logged and dropped.
 */
@Slf4j
@Service
public class DoubtNotificationService {

    private static final String PUSH_TITLE_RAISED = "New doubt raised";
    private static final String PUSH_TITLE_RESOLVED = "Your doubt was resolved";
    private static final String EMAIL_TYPE = "UTILITY_EMAIL";

    /** Priority used for the bell-icon system alert. 2 = medium (matches live-session alerts). */
    private static final int ALERT_PRIORITY_DEFAULT = 2;

    /** Last-resort sender when an institute has no utility email configured. */
    private static final String FALLBACK_SUPPORT_EMAIL = "support@vacademy.io";
    /** Neutral colour when the institute has no usable theme (never a platform brand colour). */
    private static final String FALLBACK_THEME_COLOR = "#333333";

    /**
     * Sentinel {@code institute_id} for the single global default template row. V215 inserts
     * one row per doubt event under this id; every institute without a custom override resolves
     * to it at send time. Never appears in an admin's Templates UI (which lists by real
     * institute_id). Matches the existing convention in this codebase (e.g.
     * {@code default-otp-template-001}).
     */
    private static final String DEFAULT_INSTITUTE_ID = "DEFAULT";

    @Autowired
    private InstituteSettingService instituteSettingService;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private TemplateRepository templateRepository;

    @Autowired
    private AuthService authService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private InstituteDomainRoutingRepository domainRoutingRepository;

    /** Sub-path on the admin dashboard that lists doubts; we append ?doubtId=X so the
     *  recipient lands directly on the right entry. The frontend currently routes to the
     *  doubt list when doubtId is present and falls back to the list view otherwise. */
    private static final String ADMIN_DOUBT_PATH = "/study-library/doubt-management";

    /** Sub-path on the learner portal where the doubt thread surfaces. The learner app may
     *  redirect from here to the originating slide; if it doesn't, the user still lands on a
     *  recognisable page rather than the website root. */
    private static final String LEARNER_DOUBT_PATH = "/study-library";

    /** Conventional admin subdomain we synthesize when the institute has no ADMIN routing
     *  row but does have a LEARNER one — most multi-tenant setups follow the
     *  {@code admin.<domain>} / {@code learner.<domain>} naming convention. */
    private static final String FALLBACK_ADMIN_SUBDOMAIN = "admin";

    /**
     * Lenient on purpose — see DoubtsManager. An unknown key written by a newer frontend must not
     * cost this institute its notification preferences.
     */
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    /**
     * @param assigneeUserIds recipients for push/email. For "raised" event these are the auto- or
     *                        explicitly-assigned faculty from {@code doubt_assignee} (status=ACTIVE).
     *                        Empty list → skipped entirely (no one to notify).
     */
    public void notifyDoubtRaised(Doubts doubt, List<String> assigneeUserIds, String instituteId) {
        if (doubt == null || assigneeUserIds == null || assigneeUserIds.isEmpty()) return;
        if (instituteId == null || instituteId.isEmpty()) return;

        DoubtNotificationChannelPrefs prefs = resolvePrefs(instituteId, /*raised*/ true);
        if (prefs == null) return;

        boolean pushOn = prefs.getPushEnabled() == null || Boolean.TRUE.equals(prefs.getPushEnabled());
        // Match push/system-alert: a null (unconfigured) channel flag defaults to ON, per the
        // documented DoubtNotificationChannelPrefs default and resolvePrefs' all-true fallback.
        // Only an explicit `false` silences email. (Previously null was treated as OFF, which
        // silently suppressed doubt emails for any partial/legacy notification prefs object.)
        boolean emailOn = !Boolean.FALSE.equals(prefs.getEmailEnabled());
        boolean systemAlertOn = prefs.getSystemAlertEnabled() == null
                || Boolean.TRUE.equals(prefs.getSystemAlertEnabled());

        InstituteContext ctx = loadInstituteContext(instituteId);
        Map<String, String> pushData = buildPushData(doubt, "DOUBT_RAISED");
        String pushBody = summarizeDoubt(doubt);

        if (pushOn) {
            safePush(instituteId, assigneeUserIds, PUSH_TITLE_RAISED, pushBody, pushData);
        }

        if (emailOn) {
            String templateId = resolveTemplateId(prefs.getEmailTemplateId(), instituteId,
                    DoubtNotificationTemplateDefaults.RAISED_TEMPLATE_NAME);
            if (templateId != null) {
                safeEmail(instituteId, assigneeUserIds, templateId,
                        buildPlaceholders(doubt, null, ctx, Audience.ADMIN), ctx);
            }
        }

        if (systemAlertOn) {
            // createdByRole="ADMIN" bypasses the institute's optional announcement_approval_required
            // gate (see AnnouncementService.createAnnouncement:94) — system-generated doubt alerts
            // must never wait for a human to approve them. We keep createdBy=learnerId for audit
            // traceability on the teacher-facing bell entry.
            dispatchSystemAlert(instituteId, assigneeUserIds, PUSH_TITLE_RAISED,
                    pushBody == null || pushBody.isEmpty() ? "A learner is waiting for your reply." : pushBody,
                    doubt.getUserId(), ctx, "ADMIN");
        }
    }

    public void notifyDoubtResolved(Doubts doubt, String instituteId) {
        if (doubt == null) return;
        if (instituteId == null || instituteId.isEmpty()) return;
        if (doubt.getUserId() == null || doubt.getUserId().isEmpty()) {
            // Guest doubt (no auth user). Push/bell are impossible; email the raw guest address
            // with the same resolved template instead.
            notifyGuestResolved(doubt, instituteId);
            return;
        }

        DoubtNotificationChannelPrefs prefs = resolvePrefs(instituteId, /*raised*/ false);
        if (prefs == null) return;

        boolean pushOn = prefs.getPushEnabled() == null || Boolean.TRUE.equals(prefs.getPushEnabled());
        // Match push/system-alert: a null (unconfigured) channel flag defaults to ON, per the
        // documented DoubtNotificationChannelPrefs default and resolvePrefs' all-true fallback.
        // Only an explicit `false` silences email. (Previously null was treated as OFF, which
        // silently suppressed doubt emails for any partial/legacy notification prefs object.)
        boolean emailOn = !Boolean.FALSE.equals(prefs.getEmailEnabled());
        boolean systemAlertOn = prefs.getSystemAlertEnabled() == null
                || Boolean.TRUE.equals(prefs.getSystemAlertEnabled());

        InstituteContext ctx = loadInstituteContext(instituteId);
        List<String> recipient = List.of(doubt.getUserId());
        Map<String, String> pushData = buildPushData(doubt, "DOUBT_RESOLVED");
        String pushBody = "Your doubt has been resolved. Tap to view the reply.";

        if (pushOn) {
            safePush(instituteId, recipient, PUSH_TITLE_RESOLVED, pushBody, pushData);
        }

        if (emailOn) {
            String templateId = resolveTemplateId(prefs.getEmailTemplateId(), instituteId,
                    DoubtNotificationTemplateDefaults.RESOLVED_TEMPLATE_NAME);
            if (templateId != null) {
                safeEmail(instituteId, recipient, templateId,
                        buildPlaceholders(doubt, null, ctx, Audience.LEARNER), ctx);
            }
        }

        if (systemAlertOn) {
            dispatchSystemAlert(instituteId, recipient, PUSH_TITLE_RESOLVED, pushBody,
                    /* createdBy = doubt system */ null, ctx, "ADMIN");
        }
    }

    /** Resolved notification for a guest (logged-out) doubt — email only, to the raw address. */
    private void notifyGuestResolved(Doubts doubt, String instituteId) {
        if (doubt.getGuestEmail() == null || doubt.getGuestEmail().isBlank()) return;
        DoubtNotificationChannelPrefs prefs = resolvePrefs(instituteId, /*raised*/ false);
        if (prefs == null || Boolean.FALSE.equals(prefs.getEmailEnabled())) return;

        InstituteContext ctx = loadInstituteContext(instituteId);
        String templateId = resolveTemplateId(prefs.getEmailTemplateId(), instituteId,
                DoubtNotificationTemplateDefaults.RESOLVED_TEMPLATE_NAME);
        if (templateId == null) return;
        sendGuestEmail(doubt, templateId, /*replyHtml*/ null, instituteId, ctx);
    }

    /**
     * Emails a staff reply to the guest who raised the doubt (guests can't log in to read the
     * thread, so the email IS the delivery channel). Uses the V332-seeded
     * "Doubt Reply - Guest Notification" default template (institute-overridable by name, same
     * three-layer resolution as the other doubt emails). Failures are logged and dropped.
     */
    public void notifyGuestReply(Doubts parentDoubt, String replyHtml, String instituteId) {
        if (parentDoubt == null || instituteId == null || instituteId.isEmpty()) return;
        if (parentDoubt.getUserId() != null && !parentDoubt.getUserId().isEmpty()) return; // not a guest
        if (parentDoubt.getGuestEmail() == null || parentDoubt.getGuestEmail().isBlank()) return;

        // Reuse the resolved-event channel prefs as the gate — a per-event guest-reply pref isn't
        // worth a settings schema bump; institutes silencing learner emails silence these too.
        DoubtNotificationChannelPrefs prefs = resolvePrefs(instituteId, /*raised*/ false);
        if (prefs == null || Boolean.FALSE.equals(prefs.getEmailEnabled())) return;

        InstituteContext ctx = loadInstituteContext(instituteId);
        String templateId = resolveTemplateId(null, instituteId,
                DoubtNotificationTemplateDefaults.GUEST_REPLY_TEMPLATE_NAME);
        if (templateId == null) return;
        sendGuestEmail(parentDoubt, templateId, replyHtml, instituteId, ctx);
    }

    /** Renders the template with guest-aware placeholders and sends to the raw guest address. */
    private void sendGuestEmail(Doubts doubt, String templateId, String replyHtml,
                                String instituteId, InstituteContext ctx) {
        Optional<Template> templateOpt = templateRepository.findById(templateId);
        if (templateOpt.isEmpty()) {
            log.warn("Guest email template {} disappeared between resolution and load; skipping", templateId);
            return;
        }
        Template template = templateOpt.get();
        Map<String, String> placeholders =
                buildPlaceholders(doubt, doubt.getGuestName(), ctx, Audience.LEARNER);
        placeholders.put("reply_text", replyHtml == null ? "" : replyHtml);
        String subject = applyPlaceholders(template.getSubject(), placeholders);
        String body = applyPlaceholders(template.getContent(), placeholders);
        try {
            notificationService.sendHtmlEmailViaUnified(
                    doubt.getGuestEmail(), subject, body, instituteId,
                    ctx.fromEmail, ctx.fromName, EMAIL_TYPE);
        } catch (Exception e) {
            log.warn("Failed to send guest doubt email to {}: {}", doubt.getGuestEmail(), e.getMessage());
        }
    }

    /**
     * Creates an Announcement with modeType=SYSTEM_ALERT in notification-service so the
     * recipients' bell lights up. {@code createdByRole="ADMIN"} bypasses the institute's
     * optional approval gate (see AnnouncementService.createAnnouncement:94).
     *
     * <p>{@code createdBy} is a best-effort author tag: for the "raised" event it's the learner's
     * userId so an admin viewing the alert knows who triggered it; for the "resolved" event we
     * fall back to "system" since the operator is often an admin and we don't want to leak their id
     * into the learner's alert metadata.
     */
    private void dispatchSystemAlert(String instituteId, List<String> userIds, String title,
                                     String body, String createdBy, InstituteContext ctx,
                                     String createdByRole) {
        if (userIds == null || userIds.isEmpty()) return;
        try {
            Map<String, Object> settings = new HashMap<>();
            settings.put("priority", ALERT_PRIORITY_DEFAULT);
            settings.put("isDismissible", true);
            settings.put("showBadge", true);
            settings.put("isActive", true);
            notificationService.createSystemAlertAnnouncement(
                    instituteId, userIds, title, body,
                    createdBy != null && !createdBy.isEmpty() ? createdBy : "system",
                    ctx != null && ctx.instituteName != null && !ctx.instituteName.isEmpty()
                            ? ctx.instituteName : "System",
                    createdByRole,
                    settings);
        } catch (Exception e) {
            log.warn("Doubt system alert dispatch failed (institute={}): {}", instituteId, e.getMessage());
        }
    }

    /**
     * Three-layer resolution. The second and third layers share the same name lookup pattern and
     * differ only in the {@code institute_id} they query:
     *   1. Admin-configured template id from DOUBT_MANAGEMENT_SETTING → use it.
     *   2. Institute-specific custom row
     *      {@code (institute_id = <real>, name = defaultName, type = 'EMAIL')}.
     *      Only exists when an admin has explicitly customized the default by creating a same-
     *      named row in their institute.
     *   3. Global default row
     *      {@code (institute_id = 'DEFAULT', name = defaultName, type = 'EMAIL')}.
     *      Seeded by V215. Every institute shares this one row.
     *
     * Returns null only when all three layers miss — caller skips email dispatch. Push is
     * unaffected. A missing global default means someone deleted the V215 row on purpose, so we
     * respect the opt-out instead of forcing a send.
     */
    private String resolveTemplateId(String configuredId, String instituteId, String defaultName) {
        if (configuredId != null && !configuredId.isBlank()) {
            if (templateRepository.existsById(configuredId)) return configuredId;
            log.warn("Configured doubt email template {} missing from DB; trying institute override next",
                    configuredId);
        }
        Optional<Template> instituteOverride =
                templateRepository.findByInstituteIdAndNameAndType(instituteId, defaultName, "EMAIL");
        if (instituteOverride.isPresent()) return instituteOverride.get().getId();

        Optional<Template> globalDefault =
                templateRepository.findByInstituteIdAndNameAndType(DEFAULT_INSTITUTE_ID, defaultName, "EMAIL");
        if (globalDefault.isPresent()) return globalDefault.get().getId();

        log.warn("No doubt email template '{}' found (institute={} nor {}); skipping email dispatch.",
                defaultName, instituteId, DEFAULT_INSTITUTE_ID);
        return null;
    }

    private DoubtNotificationChannelPrefs resolvePrefs(String instituteId, boolean raised) {
        try {
            Object raw = instituteSettingService.getSettingByInstituteIdAndKey(
                    instituteId, SettingKeyEnums.DOUBT_MANAGEMENT_SETTING.name());
            if (raw == null) {
                // No setting at all → apply defaults: push ON, email ON.
                // Email default flipped to true so freshly-onboarded institutes get the
                // notifications out-of-the-box; admins who want to silence them can toggle off
                // from the Doubt Management settings page. The seeded global default templates
                // (V215) guarantee a working email template even without explicit institute config.
                return DoubtNotificationChannelPrefs.builder().pushEnabled(true).emailEnabled(true).systemAlertEnabled(true).build();
            }
            DoubtManagementSettingDataDto setting = objectMapper.convertValue(raw, DoubtManagementSettingDataDto.class);
            if (setting.getNotifications() == null) {
                return DoubtNotificationChannelPrefs.builder().pushEnabled(true).emailEnabled(true).systemAlertEnabled(true).build();
            }
            DoubtNotificationChannelPrefs event = raised
                    ? setting.getNotifications().getOnDoubtRaised()
                    : setting.getNotifications().getOnDoubtResolved();
            if (event == null) {
                return DoubtNotificationChannelPrefs.builder().pushEnabled(true).emailEnabled(true).systemAlertEnabled(true).build();
            }
            return event;
        } catch (Exception e) {
            log.warn("Failed to read doubt notification prefs for institute {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    private void safePush(String instituteId, List<String> userIds, String title, String body,
                          Map<String, String> data) {
        try {
            notificationService.sendPushViaUnified(instituteId, userIds, title, body, data);
        } catch (Exception e) {
            log.warn("Doubt push notification dispatch failed (doubtId={}): {}",
                    data.get("doubt_id"), e.getMessage());
        }
    }

    private void safeEmail(String instituteId, List<String> userIds, String templateId,
                           Map<String, String> placeholders, InstituteContext ctx) {
        Optional<Template> templateOpt = templateRepository.findById(templateId);
        if (templateOpt.isEmpty()) {
            // Defence-in-depth: resolveTemplateId already checked existsById, but a race with an
            // admin deleting the row between calls is theoretically possible.
            log.warn("Email template {} disappeared between resolution and load; skipping dispatch", templateId);
            return;
        }
        Template template = templateOpt.get();

        List<UserDTO> users;
        try {
            users = authService.getUsersFromAuthServiceByUserIds(userIds);
        } catch (Exception e) {
            log.warn("Failed to resolve users for email dispatch (ids={}): {}", userIds, e.getMessage());
            return;
        }

        for (UserDTO user : users) {
            if (user == null || user.getEmail() == null || user.getEmail().isBlank()) continue;
            Map<String, String> perUser = new HashMap<>(placeholders);
            perUser.put("recipient_name", safeName(user.getFullName()));
            String subject = applyPlaceholders(template.getSubject(), perUser);
            String body = applyPlaceholders(template.getContent(), perUser);
            try {
                notificationService.sendHtmlEmailViaUnified(
                        user.getEmail(), subject, body, instituteId,
                        ctx.fromEmail, ctx.fromName, EMAIL_TYPE);
            } catch (Exception e) {
                log.warn("Failed to send doubt email to {}: {}", user.getEmail(), e.getMessage());
            }
        }
    }

    private Map<String, String> buildPushData(Doubts doubt, String event) {
        Map<String, String> data = new HashMap<>();
        data.put("event", event);
        data.put("doubt_id", safe(doubt.getId()));
        data.put("batch_id", safe(doubt.getPackageSessionId()));
        data.put("source", safe(doubt.getSource()));
        data.put("source_id", safe(doubt.getSourceId()));
        return data;
    }

    /** Audience the email is going to. Drives which institute domain we point the deep link at. */
    private enum Audience { ADMIN, LEARNER }

    private Map<String, String> buildPlaceholders(Doubts doubt, String recipientName,
                                                  InstituteContext ctx, Audience audience) {
        Map<String, String> m = new HashMap<>();
        m.put("doubt_id", safe(doubt.getId()));
        m.put("batch_id", safe(doubt.getPackageSessionId()));
        // Human-readable batch label ("Class 9 2026-27") for the email body. Falls back to the
        // raw package_session_id so existing templates that still reference {{batch_id}} keep
        // rendering without producing an empty string.
        String batchName = lookupBatchName(doubt.getPackageSessionId());
        m.put("batch_name", batchName.isEmpty() ? safe(doubt.getPackageSessionId()) : batchName);
        m.put("doubt_text", summarizeDoubt(doubt));
        m.put("student_id", safe(doubt.getUserId()));
        m.put("recipient_name", safe(recipientName));
        m.put("institute_name", ctx.instituteName);
        m.put("institute_theme_color", ctx.themeColor);
        // Clickable deep link. For ADMIN audience (raised event → teachers/admins) this routes
        // to the admin doubt-management page; for LEARNER (resolved event) it routes into the
        // learner portal. Falls back to "#" when the institute has no domain routing configured —
        // the link will still render but won't navigate, which is no worse than the original
        // hardcoded "#" template href.
        m.put("doubt_url", lookupDoubtUrl(doubt, ctx, audience));
        // Aliases so a template author can use whichever placeholder name matches the rest of the
        // platform's templates: live-class emails ship with {{THEME_COLOR}} (uppercase), invitation
        // emails use {{themeColor}} (camelCase). Same resolved hex regardless of casing.
        m.put("THEME_COLOR", ctx.themeColor);
        m.put("themeColor", ctx.themeColor);
        m.put("INSTITUTE_NAME", ctx.instituteName);
        m.put("support_email", ctx.supportEmail);
        return m;
    }

    /**
     * Builds the clickable deep link injected into the email's CTA button.
     *
     * <p>Resolution order, mirroring the live-class email pattern:
     * <ol>
     *   <li>For {@code ADMIN} audience: try {@code institute_domain_routing} role=ADMIN. If that's
     *       not configured (most institutes only set up LEARNER routing), fall through to the
     *       LEARNER row's domain and synthesize {@code admin.<domain>} as the subdomain — this
     *       matches the convention used by Vacademy's white-labeled deployments
     *       (e.g. learner.shikshanation.com / admin.shikshanation.com).</li>
     *   <li>For {@code LEARNER} audience: read role=LEARNER from {@code institute_domain_routing}.</li>
     *   <li>If neither lookup succeeds → {@code "#"} (no navigation, but the email still renders).</li>
     * </ol>
     */
    private String lookupDoubtUrl(Doubts doubt, InstituteContext ctx, Audience audience) {
        if (doubt == null || doubt.getId() == null || doubt.getId().isEmpty()) return "#";
        if (ctx == null || ctx.instituteId == null || ctx.instituteId.isEmpty()) return "#";
        try {
            if (audience == Audience.ADMIN) {
                Optional<InstituteDomainRouting> adminRouting =
                        domainRoutingRepository.findAdminPortalRow(ctx.instituteId);
                if (adminRouting.isPresent()) {
                    return formatDoubtUrl(adminRouting.get().getSubdomain(),
                            adminRouting.get().getDomain(), ADMIN_DOUBT_PATH, doubt.getId());
                }
                // Synthesize admin URL from the LEARNER routing's domain.
                Optional<InstituteDomainRouting> learnerRouting =
                        domainRoutingRepository.findByInstituteIdAndRole(ctx.instituteId, "LEARNER");
                if (learnerRouting.isPresent()) {
                    return formatDoubtUrl(FALLBACK_ADMIN_SUBDOMAIN,
                            learnerRouting.get().getDomain(), ADMIN_DOUBT_PATH, doubt.getId());
                }
                return "#";
            }
            // LEARNER audience
            Optional<InstituteDomainRouting> learnerRouting =
                    domainRoutingRepository.findByInstituteIdAndRole(ctx.instituteId, "LEARNER");
            if (learnerRouting.isPresent()) {
                return formatDoubtUrl(learnerRouting.get().getSubdomain(),
                        learnerRouting.get().getDomain(), LEARNER_DOUBT_PATH, doubt.getId());
            }
            return "#";
        } catch (Exception e) {
            log.warn("Failed to resolve doubt URL (institute={}, audience={}, doubt={}): {}",
                    ctx.instituteId, audience, doubt.getId(), e.getMessage());
            return "#";
        }
    }

    /** Assembles {@code https://subdomain.domain/path?doubtId=id}. Trims trailing slashes from
     *  the domain so we don't end up with double slashes when the routing row has them. Returns
     *  {@code "#"} (no navigation) for hosts that can't be reached from a recipient's inbox —
     *  {@code localhost}, loopback IPs, or a bare hostname with no dot — so a stray/dev
     *  {@code institute_domain_routing} row can never produce a dead {@code https://student.localhost/...}
     *  CTA in a real email. */
    private String formatDoubtUrl(String subdomain, String domain, String path, String doubtId) {
        if (domain == null || domain.isBlank()) return "#";
        String cleanDomain = domain.trim().replaceAll("^https?://", "").replaceAll("/$", "");
        String cleanSubdomain = subdomain == null ? "" : subdomain.trim();
        String host = cleanSubdomain.isEmpty() || "*".equals(cleanSubdomain)
                ? cleanDomain
                : cleanSubdomain + "." + cleanDomain;
        if (isUnreachableHost(host)) {
            log.warn("Skipping doubt CTA link — routing resolved to a non-routable host '{}' "
                    + "(check institute_domain_routing for a localhost/dev row). doubt={}", host, doubtId);
            return "#";
        }
        return "https://" + host + path + "?doubtId=" + doubtId;
    }

    /**
     * A host is unreachable from an emailed link when it points at the local machine or isn't a
     * real public hostname: {@code localhost}/{@code *.localhost}, loopback IPs, or a bare label
     * with no dot (e.g. {@code student}). Public FQDNs and IPv4 addresses pass.
     */
    private boolean isUnreachableHost(String host) {
        if (host == null || host.isBlank()) return true;
        String h = host.toLowerCase().trim();
        if (h.equals("localhost") || h.endsWith(".localhost")) return true;
        if (h.equals("127.0.0.1") || h.equals("0.0.0.0") || h.equals("::1")) return true;
        // No dot at all → single-label host like "student"/"admin" that won't resolve publicly.
        // (IPv4 addresses contain dots and are left alone.)
        return !h.contains(".");
    }

    /**
     * Composes a human-readable batch label from the package + session-name fields, mirroring
     * the format used in the admin doubt-list UI (e.g. "Class 9 2026-27"). Returns an empty
     * string on any lookup failure — callers fall back to the raw id so the email never renders
     * a literal {@code "null"} placeholder.
     */
    private String lookupBatchName(String packageSessionId) {
        if (packageSessionId == null || packageSessionId.isEmpty()) return "";
        try {
            return packageSessionRepository.findById(packageSessionId)
                    .map(ps -> {
                        String pkg = ps.getPackageEntity() != null ? ps.getPackageEntity().getPackageName() : null;
                        String session = ps.getName();
                        if (pkg == null || pkg.isBlank()) {
                            return session == null ? "" : session.trim();
                        }
                        return session == null || session.isBlank() ? pkg.trim() : (pkg.trim() + " " + session.trim());
                    })
                    .orElse("");
        } catch (Exception e) {
            log.warn("Failed to lookup batch name for packageSessionId={}: {}", packageSessionId, e.getMessage());
            return "";
        }
    }

    /**
     * Loads the institute row and derives (a) the "from" identity for outgoing emails and (b) the
     * branding placeholders. Any lookup failure degrades to safe defaults so dispatch still works.
     */
    private InstituteContext loadInstituteContext(String instituteId) {
        String instituteName = "";
        String themeColor = FALLBACK_THEME_COLOR;
        String fromEmail = FALLBACK_SUPPORT_EMAIL;
        String fromName = null;
        String supportEmail = null;

        try {
            Optional<Institute> opt = instituteRepository.findById(instituteId);
            if (opt.isPresent()) {
                Institute institute = opt.get();
                if (institute.getInstituteName() != null) {
                    instituteName = institute.getInstituteName();
                    fromName = instituteName;
                }
                themeColor = normalizeThemeColor(institute.getInstituteThemeCode());
                fromEmail = resolveUtilityFromEmail(institute).orElse(FALLBACK_SUPPORT_EMAIL);
                if (institute.getEmail() != null && !institute.getEmail().isBlank()) {
                    supportEmail = institute.getEmail().trim();
                }
            }
        } catch (Exception e) {
            log.warn("Failed to load institute context for {}: {}", instituteId, e.getMessage());
        }
        return new InstituteContext(instituteId, instituteName, themeColor, fromEmail, fromName,
                supportEmail);
    }

    /**
     * Parses {@code institute.setting → EMAIL_SETTING.data.UTILITY_EMAIL.from} and returns the
     * address portion (strips a {@code "Display Name <email>"} wrapper if present). Returns empty
     * when not configured — caller should use {@link #FALLBACK_SUPPORT_EMAIL}.
     */
    private Optional<String> resolveUtilityFromEmail(Institute institute) {
        if (institute == null || institute.getSetting() == null || institute.getSetting().isBlank()) {
            return Optional.empty();
        }
        try {
            JsonNode root = objectMapper.readTree(institute.getSetting());
            JsonNode fromNode = root.path("setting")
                    .path("EMAIL_SETTING")
                    .path("data")
                    .path("UTILITY_EMAIL")
                    .path("from");
            if (fromNode.isMissingNode() || !fromNode.isTextual()) return Optional.empty();

            String fromRaw = fromNode.asText("").trim();
            if (fromRaw.isEmpty()) return Optional.empty();

            // Accept either "address@x" or "Display Name <address@x>".
            if (fromRaw.contains("<") && fromRaw.contains(">")) {
                int lt = fromRaw.indexOf('<');
                int gt = fromRaw.indexOf('>');
                if (gt > lt + 1) {
                    return Optional.of(fromRaw.substring(lt + 1, gt).trim());
                }
            }
            return Optional.of(fromRaw);
        } catch (Exception e) {
            log.warn("Failed to parse EMAIL_SETTING for institute {}: {}", institute.getId(), e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Accepts whatever value the admin dashboard's theme picker writes into
     * {@code institute_theme_code}. The frontend stores either a raw hex (e.g. {@code "#ED7424"})
     * or a CSS color keyword (e.g. {@code "green"}, {@code "blue"}). Both are valid CSS values
     * that email clients render — live-class emails work because they pass the raw value through.
     * The previous version rejected anything that wasn't a 6/7-char hex and fell back to orange,
     * which is why doubt emails showed orange even when the institute had {@code green} set.
     * Only when the column is null/blank do we use the fallback.
     */
    private String normalizeThemeColor(String themeCode) {
        // Hex (with/without '#') or a theme preset such as "primary"/"blue" -> hex. A preset
        // name is not a CSS colour ("primary" rendered as no colour at all), so map it first.
        String resolved = ThemeColorResolver.resolve(themeCode);
        if (resolved != null) return resolved;
        if (themeCode == null || themeCode.trim().isEmpty()) return FALLBACK_THEME_COLOR;
        return themeCode.trim();                             // other CSS keyword → pass through
    }

    /** Strip HTML and truncate for push body / placeholder use. */
    private String summarizeDoubt(Doubts doubt) {
        String html = doubt.getHtmlText();
        if (html == null) return "";
        String text = html.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();
        return text.length() > 200 ? text.substring(0, 200) + "…" : text;
    }

    /** Trivial {{var}} substitution. No escaping — templates are trusted admin content. */
    private String applyPlaceholders(String template, Map<String, String> values) {
        if (template == null || template.isEmpty()) return "";
        String out = template;
        for (Map.Entry<String, String> e : values.entrySet()) {
            out = out.replace("{{" + e.getKey() + "}}", e.getValue() == null ? "" : e.getValue());
        }
        return out;
    }

    private String safe(String s) { return s == null ? "" : s; }
    private String safeName(String s) { return (s == null || s.isBlank()) ? "there" : s; }

    /** Immutable per-institute context bundle resolved once per dispatch. */
    private static final class InstituteContext {
        final String instituteId;
        final String instituteName;
        final String themeColor;
        final String fromEmail;
        final String fromName;
        /** {{support_email}}: the institute's contact address, else the sender address. */
        final String supportEmail;

        InstituteContext(String instituteId, String instituteName, String themeColor,
                         String fromEmail, String fromName, String supportEmail) {
            this.instituteId = instituteId == null ? "" : instituteId;
            this.instituteName = instituteName == null ? "" : instituteName;
            this.themeColor = themeColor == null ? FALLBACK_THEME_COLOR : themeColor;
            this.fromEmail = fromEmail == null ? FALLBACK_SUPPORT_EMAIL : fromEmail;
            this.fromName = fromName;
            this.supportEmail = supportEmail == null || supportEmail.isBlank() ? this.fromEmail : supportEmail;
        }
    }

}
