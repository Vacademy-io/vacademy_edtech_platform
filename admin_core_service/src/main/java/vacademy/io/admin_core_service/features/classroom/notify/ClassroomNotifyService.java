package vacademy.io.admin_core_service.features.classroom.notify;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.notification.util.PhoneCountryUtil;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.reporting.client.ClassroomPanelReportClient;
import vacademy.io.common.auth.dto.UserDTO;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The work behind {@link ClassroomNotifyJob}: decides which institutes are due,
 * claims new panel incidents, and sends the daily alert digest and the weekly
 * WhatsApp summary.
 *
 * <h3>When an institute is due</h3>
 * From its configured local hour until {@link #CATCH_UP_HOURS} hours later, on
 * the same local day. The daily digest is sent once per local day (a per-day row
 * in the ledger) and the weekly summary once per week (a per-week row), so a
 * tick that was skipped (a restart, a held lock, a DST gap) or that could not
 * reach auth is made up by the next hourly tick, while later ticks that day
 * send nothing more. An incident first seen after the day's digest waits for the
 * next day's run.
 *
 * <h3>Order of operations, and why</h3>
 * For each due institute: fetch its alerts, resolve its recipients, check that
 * at least one channel can reach someone, and only then claim (the day row first,
 * then the incidents). A failed fetch or recipient lookup therefore claims
 * nothing and the next tick in the window tries again. When every send was
 * impossible because the channel is switched off or not set up, the incident
 * claims are released so a later run can offer them. Once a send has been
 * attempted and failed, a notice is never retried: the rows are marked
 * {@code sent_ok=false}, because a retry loop on a broken mailbox is how alert
 * mail turns into spam.
 *
 * <h3>Phone numbers</h3>
 * Numbers are sent with their country code. A bare national number gets India's
 * code when the institute's country is blank or India, the same rule as other
 * WhatsApp sends from this service; otherwise it is passed on as stored.
 *
 * <h3>Who receives it</h3>
 * Users of the institute holding the configured roles, limited to an allowlist
 * of roles ({@code classroom.notify.recipient-roles}, default ADMIN). When the
 * setting names specific users, only those who are ADMINs of the institute are
 * kept, so a setting can never route notices to someone outside it.
 *
 * <h3>Time zones</h3>
 * "Due" is decided with the institute's own {@link java.time.ZoneId}. The
 * admin_core JVM runs UTC and must keep doing so; nothing here reads the default
 * zone.
 */
@Service
@Slf4j
public class ClassroomNotifyService {

    /** Fleet alert kinds that are worth a notice. The rest stay in the console. */
    static final Set<String> NOTIFY_KINDS = Set.of(
            "OFFLINE", "AWAITING_APPROVAL", "UPDATE_REQUIRED", "LICENCE_ROOM", "LICENCE_ENDING");

    static final String KIND_WEEKLY = "WEEKLY_WA";
    static final String SUBJECT_WEEK = "week";
    /** One row per institute and local day: the daily alert digest has run. */
    static final String KIND_ALERT_DAY = "ALERT_DAY";
    static final String SUBJECT_DAY = "day";

    /** Hours after the configured hour in which a missed run is made up, same local day. */
    static final int CATCH_UP_HOURS = 3;
    static final String ADMIN = "ADMIN";

    /** Upper bound on alerts listed in one digest; the console has the rest. */
    static final int MAX_DIGEST_ITEMS = 50;

    private final ClassroomNotifySettingReader settingReader;
    private final ClassroomPanelReportClient panels;
    private final ClassroomNoticeLog noticeLog;
    private final AuthService authService;
    private final NotificationService notificationService;
    private final ClassroomDigestRenderer renderer;
    private final ClassroomWhatsAppClient whatsApp;
    private final boolean whatsappEnabled;
    private final Set<String> roleAllowlist;
    private final String consoleBaseUrl;
    private final int maxInstitutePages;

    @Autowired
    public ClassroomNotifyService(
            ClassroomNotifySettingReader settingReader,
            ClassroomPanelReportClient panels,
            ClassroomNoticeLog noticeLog,
            AuthService authService,
            NotificationService notificationService,
            ClassroomDigestRenderer renderer,
            ClassroomWhatsAppClient whatsApp,
            @Value("${classroom.notify.whatsapp-enabled:false}") boolean whatsappEnabled,
            @Value("${classroom.notify.recipient-roles:ADMIN}") String roleAllowlist,
            @Value("${classroom.console.base-url:https://dash.vacademy.io}") String consoleBaseUrl,
            @Value("${classroom.notify.max-institute-pages:200}") int maxInstitutePages) {
        this.settingReader = settingReader;
        this.panels = panels;
        this.noticeLog = noticeLog;
        this.authService = authService;
        this.notificationService = notificationService;
        this.renderer = renderer;
        this.whatsApp = whatsApp;
        this.whatsappEnabled = whatsappEnabled;
        this.roleAllowlist = parseRoles(roleAllowlist);
        this.consoleBaseUrl = consoleBaseUrl;
        this.maxInstitutePages = Math.max(1, maxInstitutePages);
    }

    /** Outcome of one tick, for logs and tests. */
    public record TickResult(int optedIn, int due, int processed, int failed, int alertsClaimed, int weeklyClaimed) {
    }

    public TickResult runTick(Instant now) {
        List<ClassroomNotifySettingReader.OptedIn> optedIn = settingReader.loadOptedIn();
        List<ClassroomNotifySettingReader.OptedIn> due = new ArrayList<>();
        for (ClassroomNotifySettingReader.OptedIn o : optedIn) {
            if (isDue(o.setting(), now)) due.add(o);
        }
        if (due.isEmpty()) {
            return new TickResult(optedIn.size(), 0, 0, 0, 0, 0);
        }

        Set<String> withPanels = institutesWithPanels();
        if (withPanels == null) {
            log.warn("[classroom] panel institute list unavailable; notify tick skipped");
            return new TickResult(optedIn.size(), due.size(), 0, due.size(), 0, 0);
        }

        int processed = 0;
        int failed = 0;
        int alerts = 0;
        int weekly = 0;
        for (ClassroomNotifySettingReader.OptedIn o : due) {
            if (!withPanels.contains(o.instituteId())) continue;
            // One institute, or one of its two notices, must never stop the others.
            boolean ok = true;
            try {
                alerts += processAlerts(o, now);
            } catch (Exception e) {
                ok = false;
                log.error("[classroom] alert digest failed for institute {}", o.instituteId(), e);
            }
            try {
                weekly += processWeekly(o, now);
            } catch (Exception e) {
                ok = false;
                log.error("[classroom] weekly summary failed for institute {}", o.instituteId(), e);
            }
            if (ok) processed++;
            else failed++;
        }
        if (alerts > 0 || weekly > 0 || failed > 0) {
            log.info("[classroom] notify tick: {} due, {} processed, {} failed, {} alerts, {} weekly",
                    due.size(), processed, failed, alerts, weekly);
        }
        return new TickResult(optedIn.size(), due.size(), processed, failed, alerts, weekly);
    }

    /** The institute's local hour is its configured hour or one of the catch-up hours after it. */
    static boolean isDue(ClassroomNotifySetting s, Instant now) {
        int hour = ZonedDateTime.ofInstant(now, s.zone()).getHour();
        return hour >= s.hour() && hour < s.hour() + CATCH_UP_HOURS;
    }

    /** Every institute auth reports as having panels, or null if the list could not be read. */
    Set<String> institutesWithPanels() {
        Set<String> ids = new HashSet<>();
        for (int page = 0; page < maxInstitutePages; page++) {
            JsonNode body = panels.fetchInstitutesPage(page);
            if (body == null || !body.path("institutes").isArray()) return null;
            for (JsonNode row : body.path("institutes")) {
                String id = row.path("institute_id").asText("");
                if (!id.isEmpty()) ids.add(id);
            }
            if (!body.path("has_more").asBoolean(false)) return ids;
        }
        log.warn("[classroom] institute list still had more after {} pages; using what was read",
                maxInstitutePages);
        return ids;
    }

    // ── daily alert digest ─────────────────────────────────────────────────────

    int processAlerts(ClassroomNotifySettingReader.OptedIn o, Instant now) {
        ClassroomNotifySetting s = o.setting();
        boolean viaEmail = s.alertsEmail();
        boolean viaWhatsApp = s.alertsWhatsapp() && whatsappEnabled;
        if (!viaEmail && !viaWhatsApp) return 0;
        String day = LocalDate.ofInstant(now, s.zone()).toString();
        if (noticeLog.isClaimed(o.instituteId(), KIND_ALERT_DAY, SUBJECT_DAY, day)) return 0;

        JsonNode fleet = panels.fetchFleet(o.instituteId());
        if (fleet == null) {
            throw new IllegalStateException("panel alerts unavailable");
        }
        List<JsonNode> candidates = new ArrayList<>();
        for (JsonNode a : fleet.path("alerts")) {
            if (NOTIFY_KINDS.contains(a.path("kind").asText(""))) candidates.add(a);
        }
        if (candidates.isEmpty()) {
            // Today's run is done: an incident that appears later waits for tomorrow's digest.
            claimDay(o.instituteId(), day);
            return 0;
        }

        // Recipients before claims: a failed lookup must leave the incidents unclaimed.
        List<UserDTO> recipients = recipients(o.instituteId(), s);
        boolean emailReachable = viaEmail && recipients.stream()
                .anyMatch(u -> u.getEmail() != null && !u.getEmail().isBlank());
        boolean whatsAppReachable = viaWhatsApp && recipients.stream()
                .anyMatch(u -> u.getMobileNumber() != null && !u.getMobileNumber().isBlank());
        if (!emailReachable && !whatsAppReachable) {
            log.warn("[classroom] no recipient can receive the alert digest for institute {}", o.instituteId());
            return 0;
        }
        if (!claimDay(o.instituteId(), day)) return 0; // another pod ran it

        List<String> claimed = new ArrayList<>();
        List<ClassroomDigestRenderer.Item> items = new ArrayList<>();
        for (JsonNode a : candidates) {
            String kind = a.path("kind").asText();
            String id = noticeLog.claim(o.instituteId(), kind, subjectOf(a), a.path("incident_key").asText(null));
            if (id == null) continue; // already notified
            claimed.add(id);
            if (items.size() < MAX_DIGEST_ITEMS) {
                items.add(new ClassroomDigestRenderer.Item(kind, a.path("severity").asText("warn"),
                        a.path("room").path("name").asText(null), a.path("since").asText(null)));
            }
        }
        if (claimed.isEmpty()) return 0;

        String link = link("alerts");
        boolean anySent = false;
        boolean anyFailed = false;
        if (emailReachable) {
            String subject = renderer.subject(o.instituteName(), claimed.size());
            String body = renderer.render(o.instituteName(), items, claimed.size(), s.zone(), link);
            for (UserDTO u : recipients) {
                if (u.getEmail() == null || u.getEmail().isBlank()) continue;
                try {
                    notificationService.sendHtmlEmailViaUnified(
                            u.getEmail(), subject, body, o.instituteId(), null, null, "UTILITY_EMAIL");
                    anySent = true;
                } catch (Exception e) {
                    anyFailed = true;
                    log.warn("[classroom] alert email to user {} failed: {}", u.getId(), e.getMessage());
                }
            }
        }
        if (whatsAppReachable) {
            Map<String, String> vars = new LinkedHashMap<>();
            vars.put("alert_count", String.valueOf(claimed.size()));
            vars.put("link", link == null ? "" : link);
            boolean india = PhoneCountryUtil.defaultsToIndia(o.country());
            for (UserDTO u : recipients) {
                ClassroomWhatsAppClient.Outcome outcome = whatsApp.send(ClassroomWhatsAppClient.KIND_ALERTS,
                        PhoneCountryUtil.normalizePhone(u.getMobileNumber(), india), o.instituteName(), vars);
                if (outcome == ClassroomWhatsAppClient.Outcome.SENT) anySent = true;
                else if (outcome == ClassroomWhatsAppClient.Outcome.FAILED) anyFailed = true;
            }
        }
        if (!anySent && !anyFailed) {
            // Nothing could be attempted (channel off or not set up): offer these again later.
            log.warn("[classroom] alert channel unavailable for institute {}; incidents kept for a later run",
                    o.instituteId());
            noticeLog.release(claimed);
            return 0;
        }
        noticeLog.markSent(claimed, anySent);
        return claimed.size();
    }

    /** Claims today's digest row. False when it was already claimed (another pod or tick). */
    private boolean claimDay(String instituteId, String day) {
        String id = noticeLog.claim(instituteId, KIND_ALERT_DAY, SUBJECT_DAY, day);
        if (id == null) return false;
        noticeLog.markSent(List.of(id), true);
        return true;
    }

    /** What the incident is about: the device, else the room, else the institute. */
    static String subjectOf(JsonNode alert) {
        String device = alert.path("device_id").asText("");
        if (!device.isBlank()) return device;
        String room = alert.path("room").path("id").asText("");
        if (!room.isBlank()) return room;
        return "institute";
    }

    // ── weekly WhatsApp summary ────────────────────────────────────────────────

    int processWeekly(ClassroomNotifySettingReader.OptedIn o, Instant now) {
        ClassroomNotifySetting s = o.setting();
        if (!s.whatsappWeekly() || !whatsappEnabled) return 0;
        LocalDate today = LocalDate.ofInstant(now, s.zone());
        if (today.getDayOfWeek() != s.weeklyDay()) return 0;

        // The seven local days before today.
        LocalDate from = today.minusDays(7);
        LocalDate to = today.minusDays(1);
        if (noticeLog.isClaimed(o.instituteId(), KIND_WEEKLY, SUBJECT_WEEK, from.toString())) return 0;
        JsonNode summary = panels.fetchUsageSummary(o.instituteId(), from, to, s.zone().getId());
        if (summary == null || !summary.path("totals").isObject()) {
            throw new IllegalStateException("panel usage summary unavailable");
        }
        JsonNode t = summary.path("totals");
        int sessions = t.path("sessions").asInt(0);
        int idle = t.path("idle_rooms").asInt(0);
        if (sessions == 0 && idle == 0) return 0; // nothing to say this week

        List<UserDTO> recipients = recipients(o.instituteId(), s);
        if (recipients.stream().noneMatch(u -> u.getMobileNumber() != null && !u.getMobileNumber().isBlank())) {
            log.warn("[classroom] no recipient has a phone number for the weekly summary of institute {}",
                    o.instituteId());
            return 0;
        }
        String id = noticeLog.claim(o.instituteId(), KIND_WEEKLY, SUBJECT_WEEK, from.toString());
        if (id == null) return 0;

        Map<String, String> vars = new LinkedHashMap<>();
        vars.put("hours", hoursText(t.path("panel_hours").asDouble(0)));
        vars.put("rooms_used", String.valueOf(t.path("rooms_used").asInt(0)));
        vars.put("rooms_total", String.valueOf(t.path("rooms_with_panel").asInt(0)));
        vars.put("idle_rooms", String.valueOf(idle));
        String link = link("usage");
        vars.put("link", link == null ? "" : link);

        boolean anySent = false;
        boolean anyFailed = false;
        boolean india = PhoneCountryUtil.defaultsToIndia(o.country());
        for (UserDTO u : recipients) {
            ClassroomWhatsAppClient.Outcome outcome = whatsApp.send(ClassroomWhatsAppClient.KIND_WEEKLY_SUMMARY,
                    PhoneCountryUtil.normalizePhone(u.getMobileNumber(), india), o.instituteName(), vars);
            if (outcome == ClassroomWhatsAppClient.Outcome.SENT) anySent = true;
            else if (outcome == ClassroomWhatsAppClient.Outcome.FAILED) anyFailed = true;
        }
        if (!anySent && !anyFailed) {
            noticeLog.release(List.of(id));
            return 0;
        }
        noticeLog.markSent(List.of(id), anySent);
        return 1;
    }

    // ── shared ─────────────────────────────────────────────────────────────────

    /**
     * Recipients for one institute. Throws when auth cannot be asked, so the
     * caller claims nothing.
     */
    List<UserDTO> recipients(String instituteId, ClassroomNotifySetting s) {
        List<UserDTO> users;
        if (!s.recipientUserIds().isEmpty()) {
            Set<String> wanted = new HashSet<>(s.recipientUserIds());
            users = new ArrayList<>();
            for (UserDTO u : authService.requireUsersByInstituteAndRoles(instituteId, List.of(ADMIN))) {
                if (u != null && wanted.contains(u.getId())) users.add(u);
            }
        } else {
            List<String> roles = new ArrayList<>();
            for (String r : s.recipientRoles()) {
                if (roleAllowlist.contains(r)) roles.add(r);
            }
            if (roles.isEmpty()) roles.add(ADMIN);
            users = authService.requireUsersByInstituteAndRoles(instituteId, roles);
        }
        Map<String, UserDTO> byId = new LinkedHashMap<>();
        for (UserDTO u : users) {
            if (u != null && u.getId() != null) byId.putIfAbsent(u.getId(), u);
        }
        return new ArrayList<>(byId.values());
    }

    String link(String view) {
        if (consoleBaseUrl == null || consoleBaseUrl.isBlank()) return null;
        String base = consoleBaseUrl.trim();
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        return base + "/settings?selectedTab=classroomPanels&view=" + view;
    }

    static Set<String> parseRoles(String csv) {
        Set<String> out = new HashSet<>();
        if (csv != null) {
            Arrays.stream(csv.split(","))
                    .map(r -> r.trim().toUpperCase(Locale.ROOT))
                    .filter(r -> !r.isEmpty())
                    .forEach(out::add);
        }
        if (out.isEmpty()) out.add(ADMIN);
        return out;
    }

    static String hoursText(double hours) {
        if (Double.isNaN(hours) || Double.isInfinite(hours) || hours < 0) hours = 0;
        java.math.BigDecimal d = java.math.BigDecimal.valueOf(hours)
                .setScale(1, java.math.RoundingMode.HALF_UP).stripTrailingZeros();
        return d.scale() < 0 ? d.setScale(0).toPlainString() : d.toPlainString();
    }
}
