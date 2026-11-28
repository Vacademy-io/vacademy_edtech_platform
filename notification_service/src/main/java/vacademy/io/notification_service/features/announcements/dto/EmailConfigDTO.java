package vacademy.io.notification_service.features.announcements.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * DTO for email configuration dropdown options
 */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EmailConfigDTO {

    /**
     * Stable handle for the row from the client's perspective. Backed by `type`
     * (the JSON key inside institute.setting.EMAIL_SETTING.data), since `type`
     * is the natural primary key for an email configuration and is immutable
     * once created.
     */
    private String id;

    private String email;
    private String name;
    private String type; // marketing, transactional, notifications
    private String description;
    private String displayText; // For frontend dropdown display

    // Sending controls (optional; null = leave unchanged on update, absent on read = not set)
    private Integer maxPerDay;        // 0/null = unlimited
    private String timezone;          // IANA zone for the daily boundary, e.g. America/New_York
    private Integer sendAfterHour;    // local hour the next day's window opens (0-23)
    private String postalAddress;     // CAN-SPAM footer address
    private Boolean listUnsubscribe;  // unsubscribe headers/footer even for non-promotional types

    // Warm-up ramp: when enabled, maxPerDay is computed from the schedule instead of being read.
    private Boolean rampEnabled;
    private Integer rampStartPerDay;
    private Integer rampStep;
    private Integer rampEveryDays;
    private Integer rampCeiling;
    private String rampStartedOn;     // ISO date; set to today when the ramp is first enabled
    private Boolean skipWeekends;
}
