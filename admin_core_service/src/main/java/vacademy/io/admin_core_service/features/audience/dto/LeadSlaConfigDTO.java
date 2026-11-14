package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.List;

/**
 * Typed view of the TAT / Follow-up SLA section of the LEAD_SETTING institute setting.
 *
 * <p>Physically stored as JSON inside {@code institutes.setting_json -> setting -> LEAD_SETTING -> data}.
 * Read via {@code InstituteSettingService.getSettingByInstituteIdAndKey(instituteId, "LEAD_SETTING")} and
 * converted with the shared {@code ObjectMapper}. Unknown keys (scoring weights, table-visibility flags,
 * etc.) are ignored so this DTO can coexist with the rest of the lead settings.</p>
 *
 * <p>The backend only uses this to decide WHICH workflow trigger to emit and WHEN. Channels, templates and
 * recipients live entirely in the workflow engine.</p>
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class LeadSlaConfigDTO {

    private TatReminder tatReminder;
    private FollowUp followUp;
    private List<CustomStatus> customStatuses;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class TatReminder {
        private boolean enabled;
        /** Legacy whole hours (CEIL of tatMinutes). Use {@link #getTatMinutes()} for deadlines. */
        private Integer tatHours;
        /** TAT duration in minutes — what deadlines are computed from. */
        private Integer tatMinutes;
        /**
         * Working-hours rule JSON for lead_sla_due_at() (off = the TAT off-hours due time);
         * null when working hours are off, i.e. plain wall-clock deadlines.
         */
        private String workingHoursRule;
        private List<BeforeTrigger> beforeTatTriggers;
        private TriggerRef overdueTrigger;
        /** Institute role names to notify — emitted in the trigger ctx for the workflow to target. */
        private List<String> notifyRoles;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class FollowUp {
        private boolean enabled;
        /** Legacy whole hours (CEIL of followUpSlaMinutes). Use {@link #getFollowUpSlaMinutes()}. */
        private Integer followUpSlaHours;
        /** Follow-up SLA duration in minutes — what deadlines are computed from. */
        private Integer followUpSlaMinutes;
        /** Working-hours rule JSON (off = the follow-up off-hours due time); null = wall clock. */
        private String workingHoursRule;
        private BeforeTrigger beforeFollowUpTrigger;
        private TriggerRef overdueTrigger;
        /** Institute role names to notify — emitted in the trigger ctx for the workflow to target. */
        private List<String> notifyRoles;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class BeforeTrigger {
        private Integer beforeMinutes;
        private String triggerKey;
        private String stage;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class TriggerRef {
        private String triggerKey;
        private String stage;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CustomStatus {
        private String key;
        private String label;
        private String color;
        private Integer order;
    }
}
