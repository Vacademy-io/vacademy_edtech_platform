package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Flat read/write shape for the lead SLA settings UI (GET/PUT). The fixed trigger keys/stages
 * are applied server-side; the UI only deals with on/off, durations, before-windows and roles.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadSlaSettingsDTO {
    private boolean tatEnabled;
    /** TAT duration in minutes (e.g. 90 = 1h 30m). Preferred over tatHours on write. */
    private Integer tatMinutes;
    /** Legacy whole hours. Read: CEIL(tatMinutes / 60). Write: used only when tatMinutes is absent. */
    private Integer tatHours;
    /** "remind N minutes before the TAT deadline" windows (multiple allowed). */
    private List<Integer> tatBeforeMinutes;
    private List<String> tatNotifyRoles;

    private boolean followupEnabled;
    /** Follow-up SLA duration in minutes. Preferred over followupSlaHours on write. */
    private Integer followupSlaMinutes;
    /** Legacy whole hours. Read: CEIL(followupSlaMinutes / 60). Write: used only when minutes are absent. */
    private Integer followupSlaHours;
    private Integer followupRemindBeforeMinutes;
    private List<String> followupNotifyRoles;

    // ── Working hours (apply to TAT and follow-up SLA) ───────────────────────
    private boolean workingHoursEnabled;
    /** ISO weekdays, 1 = Monday … 7 = Sunday. */
    private List<Integer> workingDays;
    /** "HH:mm", institute-local. */
    private String workingStartTime;
    private String workingEndTime;
    /** "HH:mm" — TAT due time on the next working day for leads arriving outside hours. */
    private String tatOffhoursDueTime;
    /** "HH:mm" — follow-up due time on the next working day when the last response was outside hours. */
    private String followupOffhoursDueTime;
    /** Read-only: the institute timezone (Settings → Language) the hours are evaluated in. */
    private String timezone;
}
