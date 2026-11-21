package vacademy.io.notification_service.features.email_sending_controls.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** What an admin sees for one sender: cap, used today, queued overflow, next window. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EmailSendingStatusDTO {
    private String instituteId;
    private String emailType;
    private String fromEmail;
    private int maxPerDay;          // 0 = unlimited
    private int sentToday;
    private long deferredPending;
    private String timezone;
    private int sendAfterHour;
    private String nextWindow;      // ISO local datetime, null when uncapped
    private boolean unsubscribeFooter;
    private long unsubscribedCount;
    // Warm-up ramp
    private boolean pausedToday;        // weekend skip in force
    private boolean skipWeekends;
    private boolean rampEnabled;
    private int rampCeiling;            // 0 = no ceiling configured
    private String rampStartedOn;       // ISO date, day 0
    private String rampNextIncreaseOn;  // ISO date, null once the ceiling is reached
}
