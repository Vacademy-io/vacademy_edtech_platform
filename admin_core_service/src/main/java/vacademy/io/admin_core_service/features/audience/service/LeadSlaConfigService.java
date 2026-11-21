package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.dto.LeadSlaConfigDTO;
import vacademy.io.admin_core_service.features.audience.dto.LeadSlaSettingsDTO;
import vacademy.io.admin_core_service.features.audience.entity.LeadSlaConfig;
import vacademy.io.admin_core_service.features.audience.entity.LeadSlaNotifyRole;
import vacademy.io.admin_core_service.features.audience.entity.LeadSlaReminderWindow;
import vacademy.io.admin_core_service.features.audience.repository.LeadSlaConfigRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadSlaNotifyRoleRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadSlaReminderWindowRepository;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Reads/writes the table-backed TAT + Follow-up SLA config (replaces the LEAD_SETTING JSON).
 * Exposes a flat shape for the settings UI and the nested {@link LeadSlaConfigDTO} the scheduler
 * already consumes — so the scheduler logic is unchanged, only its source.
 */
@Service
@RequiredArgsConstructor
public class LeadSlaConfigService {

    private static final String TAT = "TAT";
    private static final String FOLLOWUP = "FOLLOWUP";
    private static final int DEFAULT_MINUTES = 24 * 60;
    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
    private static final String DEFAULT_WORKING_DAYS = "1,2,3,4,5,6";
    private static final LocalTime DEFAULT_START = LocalTime.of(9, 0);
    private static final LocalTime DEFAULT_END = LocalTime.of(18, 0);
    private static final LocalTime DEFAULT_OFFHOURS_DUE = LocalTime.of(10, 0);

    private final LeadSlaConfigRepository configRepository;
    private final LeadSlaReminderWindowRepository windowRepository;
    private final LeadSlaNotifyRoleRepository notifyRoleRepository;
    private final InstituteTimezoneService instituteTimezoneService;
    private final ObjectMapper objectMapper;

    // ── Settings UI (flat) ───────────────────────────────────────────────────

    public LeadSlaSettingsDTO getSettings(String instituteId) {
        LeadSlaConfig c = configRepository.findByInstituteId(instituteId).orElse(null);
        List<Integer> tatBefore = windowRepository
                .findByInstituteIdAndSlaTypeOrderByDisplayOrderAsc(instituteId, TAT).stream()
                .map(LeadSlaReminderWindow::getBeforeMinutes).collect(Collectors.toList());
        // Default 30-min reminder only for an institute that has never saved the settings —
        // once saved, an empty list means the admin removed every early reminder.
        if (tatBefore.isEmpty() && c == null) tatBefore = List.of(30);

        int tatMinutes = c != null ? tatMinutesOf(c) : DEFAULT_MINUTES;
        int followupMinutes = c != null ? followupMinutesOf(c) : DEFAULT_MINUTES;
        return LeadSlaSettingsDTO.builder()
                .tatEnabled(c != null && Boolean.TRUE.equals(c.getTatEnabled()))
                .tatMinutes(tatMinutes)
                .tatHours(ceilHours(tatMinutes))
                .tatBeforeMinutes(tatBefore)
                .tatNotifyRoles(roleNames(instituteId, TAT))
                .followupEnabled(c != null && Boolean.TRUE.equals(c.getFollowupEnabled()))
                .followupSlaMinutes(followupMinutes)
                .followupSlaHours(ceilHours(followupMinutes))
                .followupRemindBeforeMinutes(c != null ? c.getFollowupRemindBeforeMinutes() : 30)
                .followupNotifyRoles(roleNames(instituteId, FOLLOWUP))
                .workingHoursEnabled(c != null && Boolean.TRUE.equals(c.getWorkingHoursEnabled()))
                .workingDays(parseDays(c != null ? c.getWorkingDays() : null))
                .workingStartTime(fmt(c != null ? c.getWorkingStartTime() : null, DEFAULT_START))
                .workingEndTime(fmt(c != null ? c.getWorkingEndTime() : null, DEFAULT_END))
                .tatOffhoursDueTime(fmt(c != null ? c.getTatOffhoursDueTime() : null, DEFAULT_OFFHOURS_DUE))
                .followupOffhoursDueTime(fmt(c != null ? c.getFollowupOffhoursDueTime() : null, DEFAULT_OFFHOURS_DUE))
                .timezone(instituteTimezoneService.getTimezoneId(instituteId))
                .build();
    }

    @Transactional
    public void save(String instituteId, LeadSlaSettingsDTO dto) {
        LeadSlaConfig c = configRepository.findByInstituteId(instituteId)
                .orElseGet(() -> LeadSlaConfig.builder().instituteId(instituteId).build());
        int tatMinutes = resolveMinutes(dto.getTatMinutes(), dto.getTatHours());
        int followupMinutes = resolveMinutes(dto.getFollowupSlaMinutes(), dto.getFollowupSlaHours());
        c.setTatEnabled(dto.isTatEnabled());
        c.setTatMinutes(tatMinutes);
        c.setTatHours(ceilHours(tatMinutes));
        c.setFollowupEnabled(dto.isFollowupEnabled());
        c.setFollowupSlaMinutes(followupMinutes);
        c.setFollowupSlaHours(ceilHours(followupMinutes));
        c.setFollowupRemindBeforeMinutes(
                dto.getFollowupRemindBeforeMinutes() != null ? dto.getFollowupRemindBeforeMinutes() : 30);
        applyWorkingHours(c, dto);
        c.setUpdatedAt(new Timestamp(System.currentTimeMillis()));
        configRepository.save(c);

        // Replace TAT before-windows
        windowRepository.deleteByInstituteIdAndSlaType(instituteId, TAT);
        if (dto.getTatBeforeMinutes() != null) {
            int order = 1;
            for (Integer m : dto.getTatBeforeMinutes()) {
                if (m == null || m <= 0) continue;
                windowRepository.save(LeadSlaReminderWindow.builder()
                        .instituteId(instituteId).slaType(TAT).beforeMinutes(m).displayOrder(order++).build());
            }
        }

        // Replace notify roles
        notifyRoleRepository.deleteByInstituteId(instituteId);
        saveRoles(instituteId, TAT, dto.getTatNotifyRoles());
        saveRoles(instituteId, FOLLOWUP, dto.getFollowupNotifyRoles());
    }

    // ── Working hours ────────────────────────────────────────────────────────

    /**
     * Copies the working-hours fields onto the entity. Validated only when the feature is on,
     * so a half-filled form can still be saved with working hours off.
     */
    private void applyWorkingHours(LeadSlaConfig c, LeadSlaSettingsDTO dto) {
        List<Integer> days = dto.getWorkingDays() == null ? parseDays(c.getWorkingDays())
                : dto.getWorkingDays().stream().filter(Objects::nonNull)
                        .filter(d -> d >= 1 && d <= 7).distinct().sorted().collect(Collectors.toList());
        LocalTime start = parseTime(dto.getWorkingStartTime(), orDefault(c.getWorkingStartTime(), DEFAULT_START));
        LocalTime end = parseTime(dto.getWorkingEndTime(), orDefault(c.getWorkingEndTime(), DEFAULT_END));
        LocalTime tatOff = parseTime(dto.getTatOffhoursDueTime(),
                orDefault(c.getTatOffhoursDueTime(), DEFAULT_OFFHOURS_DUE));
        LocalTime fuOff = parseTime(dto.getFollowupOffhoursDueTime(),
                orDefault(c.getFollowupOffhoursDueTime(), DEFAULT_OFFHOURS_DUE));

        if (dto.isWorkingHoursEnabled()) {
            if (days.isEmpty()) {
                throw new VacademyException("Pick at least one working day.");
            }
            if (!start.isBefore(end)) {
                throw new VacademyException("Working hours must end after they start.");
            }
        }

        c.setWorkingHoursEnabled(dto.isWorkingHoursEnabled());
        c.setWorkingDays(days.isEmpty() ? DEFAULT_WORKING_DAYS
                : days.stream().map(d -> Integer.toString(d)).collect(Collectors.joining(",")));
        c.setWorkingStartTime(start);
        c.setWorkingEndTime(end);
        c.setTatOffhoursDueTime(tatOff);
        c.setFollowupOffhoursDueTime(fuOff);
    }

    /**
     * The JSON rule lead_sla_due_at() evaluates, or null when working hours are off (plain
     * wall-clock deadlines). {@code offhoursDue} is the TAT or follow-up off-hours time.
     */
    private String workingHoursRule(String instituteId, LeadSlaConfig c, LocalTime offhoursDue) {
        if (!Boolean.TRUE.equals(c.getWorkingHoursEnabled())) return null;
        List<Integer> days = parseDays(c.getWorkingDays());
        if (days.isEmpty()) return null;
        Map<String, Object> rule = new LinkedHashMap<>();
        rule.put("tz", instituteTimezoneService.getTimezoneId(instituteId));
        rule.put("days", days);
        rule.put("start", fmt(c.getWorkingStartTime(), DEFAULT_START));
        rule.put("end", fmt(c.getWorkingEndTime(), DEFAULT_END));
        rule.put("off", fmt(offhoursDue, DEFAULT_OFFHOURS_DUE));
        try {
            return objectMapper.writeValueAsString(rule);
        } catch (Exception e) {
            return null; // fall back to wall clock rather than break every SLA query
        }
    }

    private static List<Integer> parseDays(String csv) {
        String src = (csv == null || csv.isBlank()) ? DEFAULT_WORKING_DAYS : csv;
        return Arrays.stream(src.split(","))
                .map(String::trim).filter(x -> !x.isEmpty())
                .map(x -> {
                    try { return Integer.parseInt(x); } catch (NumberFormatException e) { return null; }
                })
                .filter(Objects::nonNull).filter(d -> d >= 1 && d <= 7)
                .distinct().sorted().collect(Collectors.toList());
    }

    private static LocalTime parseTime(String hhmm, LocalTime fallback) {
        if (hhmm == null || hhmm.isBlank()) return fallback;
        try {
            return LocalTime.parse(hhmm.trim().length() == 5 ? hhmm.trim() : hhmm.trim().substring(0, 5), HH_MM);
        } catch (Exception e) {
            throw new VacademyException("Invalid time '" + hhmm + "' — use HH:mm.");
        }
    }

    private static LocalTime orDefault(LocalTime t, LocalTime fallback) {
        return t != null ? t : fallback;
    }

    private static String fmt(LocalTime t, LocalTime fallback) {
        return orDefault(t, fallback).format(HH_MM);
    }

    // ── Duration helpers ─────────────────────────────────────────────────────

    /**
     * Minutes from the request: explicit minutes win, else legacy whole hours, else 24h.
     * Non-positive values fall back to the default so a deadline can never be "now".
     */
    private static int resolveMinutes(Integer minutes, Integer hours) {
        if (minutes != null && minutes > 0) return minutes;
        if (hours != null && hours > 0) return hours * 60;
        return DEFAULT_MINUTES;
    }

    private static int tatMinutesOf(LeadSlaConfig c) {
        if (c.getTatMinutes() != null && c.getTatMinutes() > 0) return c.getTatMinutes();
        return c.getTatHours() != null && c.getTatHours() > 0 ? c.getTatHours() * 60 : DEFAULT_MINUTES;
    }

    private static int followupMinutesOf(LeadSlaConfig c) {
        if (c.getFollowupSlaMinutes() != null && c.getFollowupSlaMinutes() > 0) return c.getFollowupSlaMinutes();
        return c.getFollowupSlaHours() != null && c.getFollowupSlaHours() > 0
                ? c.getFollowupSlaHours() * 60 : DEFAULT_MINUTES;
    }

    /** Whole hours rounded up — what the legacy *_hours columns/fields carry. */
    private static int ceilHours(int minutes) {
        return Math.max(1, (minutes + 59) / 60);
    }

    /**
     * Human-readable duration for workflow copy and UI text: "45 minutes", "1 hour",
     * "1 hour 30 minutes", "24 hours".
     */
    public static String formatDuration(int minutes) {
        int h = minutes / 60;
        int m = minutes % 60;
        String hPart = h == 1 ? "1 hour" : h + " hours";
        String mPart = m == 1 ? "1 minute" : m + " minutes";
        if (h == 0) return mPart;
        if (m == 0) return hPart;
        return hPart + " " + mPart;
    }

    private void saveRoles(String instituteId, String slaType, List<String> roles) {
        if (roles == null) return;
        for (String r : roles) {
            if (r == null || r.isBlank()) continue;
            notifyRoleRepository.save(LeadSlaNotifyRole.builder()
                    .instituteId(instituteId).slaType(slaType).roleName(r).build());
        }
    }

    private List<String> roleNames(String instituteId, String slaType) {
        return notifyRoleRepository.findByInstituteIdAndSlaType(instituteId, slaType).stream()
                .map(LeadSlaNotifyRole::getRoleName).collect(Collectors.toList());
    }

    // ── Scheduler (nested DTO it already consumes) ────────────────────────────

    /** Returns the scheduler config, or null when no config exists / both SLAs are off. */
    public LeadSlaConfigDTO getSchedulerConfig(String instituteId) {
        LeadSlaConfig c = configRepository.findByInstituteId(instituteId).orElse(null);
        if (c == null) return null;
        boolean tatOn = Boolean.TRUE.equals(c.getTatEnabled());
        boolean fuOn = Boolean.TRUE.equals(c.getFollowupEnabled());
        if (!tatOn && !fuOn) return null;

        LeadSlaConfigDTO dto = new LeadSlaConfigDTO();

        LeadSlaConfigDTO.TatReminder tat = new LeadSlaConfigDTO.TatReminder();
        tat.setEnabled(tatOn);
        tat.setTatMinutes(tatMinutesOf(c));
        tat.setTatHours(ceilHours(tatMinutesOf(c)));
        tat.setWorkingHoursRule(workingHoursRule(instituteId, c, c.getTatOffhoursDueTime()));
        List<LeadSlaConfigDTO.BeforeTrigger> windows = new ArrayList<>();
        for (LeadSlaReminderWindow w : windowRepository
                .findByInstituteIdAndSlaTypeOrderByDisplayOrderAsc(instituteId, TAT)) {
            LeadSlaConfigDTO.BeforeTrigger b = new LeadSlaConfigDTO.BeforeTrigger();
            b.setBeforeMinutes(w.getBeforeMinutes());
            b.setTriggerKey("LEAD_TAT_REMINDER_BEFORE");
            b.setStage("BEFORE_" + w.getBeforeMinutes() + "M");
            windows.add(b);
        }
        tat.setBeforeTatTriggers(windows);
        LeadSlaConfigDTO.TriggerRef tatOverdue = new LeadSlaConfigDTO.TriggerRef();
        tatOverdue.setTriggerKey("LEAD_TAT_OVERDUE");
        tatOverdue.setStage("OVERDUE");
        tat.setOverdueTrigger(tatOverdue);
        tat.setNotifyRoles(roleNames(instituteId, TAT));
        dto.setTatReminder(tat);

        LeadSlaConfigDTO.FollowUp fu = new LeadSlaConfigDTO.FollowUp();
        fu.setEnabled(fuOn);
        fu.setFollowUpSlaMinutes(followupMinutesOf(c));
        fu.setFollowUpSlaHours(ceilHours(followupMinutesOf(c)));
        fu.setWorkingHoursRule(workingHoursRule(instituteId, c, c.getFollowupOffhoursDueTime()));
        LeadSlaConfigDTO.BeforeTrigger before = new LeadSlaConfigDTO.BeforeTrigger();
        before.setBeforeMinutes(c.getFollowupRemindBeforeMinutes());
        before.setTriggerKey("FOLLOW_UP_DUE");
        fu.setBeforeFollowUpTrigger(before);
        LeadSlaConfigDTO.TriggerRef fuOverdue = new LeadSlaConfigDTO.TriggerRef();
        fuOverdue.setTriggerKey("FOLLOW_UP_OVERDUE");
        fu.setOverdueTrigger(fuOverdue);
        fu.setNotifyRoles(roleNames(instituteId, FOLLOWUP));
        dto.setFollowUp(fu);

        return dto;
    }
}
