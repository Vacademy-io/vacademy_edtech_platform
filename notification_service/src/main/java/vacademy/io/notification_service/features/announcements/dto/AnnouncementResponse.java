package vacademy.io.notification_service.features.announcements.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.notification_service.features.announcements.enums.AnnouncementStatus;

import java.time.LocalDateTime;
import java.util.List;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class AnnouncementResponse {
    private String id;
    private String title;
    private RichTextDataResponse content;
    private String instituteId;
    private String createdBy;
    private String createdByName;
    private String createdByRole;
    private AnnouncementStatus status;
    private String timezone;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    
    // Recipients (Inclusions)
    private List<RecipientResponse> recipients;
    
    // Exclusions
    private List<RecipientResponse> exclusions;
    
    // Modes
    private List<ModeResponse> modes;
    
    // Mediums
    private List<MediumResponse> mediums;
    
    // Scheduling
    private SchedulingResponse scheduling;
    
    // Stats
    private AnnouncementStatsResponse stats;
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class RichTextDataResponse {
        private String id;
        private String type;
        private String content;
    }
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class RecipientResponse {
        private String id;
        private String recipientType;
        private String recipientId;
        private String recipientName;
    }
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class ModeResponse {
        private String id;
        private String modeType;
        private Object settings;
        private Boolean isActive;
    }
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class MediumResponse {
        private String id;
        private String mediumType;
        private Object config;
        private Boolean isActive;
    }
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class SchedulingResponse {
        private String id;
        private String scheduleType;
        private String cronExpression;
        private String timezone;
        private LocalDateTime startDate;
        private LocalDateTime endDate;
        private LocalDateTime nextRunTime;
        private LocalDateTime lastRunTime;
        private Boolean isActive;
    }
    
    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class AnnouncementStatsResponse {
        // People-level rollup. An announcement holds one recipient row per user per mode per
        // medium, so these count distinct people, not rows.
        private Long totalRecipients;          // distinct people targeted
        private Long totalMessages;            // recipient rows (deliveries across channels)
        private Long deliveredCount;           // people reached on at least one channel
        private Long readCount;                // distinct people who read it
        private Long dismissedCount;           // distinct people who dismissed it
        private Long failedCount;              // people not reached on any channel, with a failure
        private Long pendingCount;             // people not yet processed
        private Double deliveryRate;
        private Double readRate;
        private Double dismissRate;

        // Per channel (medium, or the mode for in-app rows), in distinct people
        private List<ChannelStats> channels;

        // SES email stats, cumulative over every event per email
        private Long emailsSent;               // emails handed to SES (excludes failed-to-send)
        private Long emailsFailedToSend;       // never sent: unsubscribed, no address, send error
        private Long emailsSend;               // emails with an SES send (accepted) event
        private Long emailsDelivered;          // delivered (an open or click implies delivery)
        private Long emailsOpened;             // opened (a click implies an open)
        private Long emailsClicked;            // at least one link clicked
        private Long emailsBounced;            // bounced
        private Long emailsRejected;           // rejected by SES
        private Long emailsComplained;         // marked as spam
        private Long emailsPending;            // sent, no delivery or failure event yet
        
        // Enhanced rates
        private Double emailDeliveryRate;      // (emailsDelivered / emailsSent) * 100
        private Double emailOpenRate;          // (emailsOpened / emailsDelivered) * 100
        private Double emailClickRate;         // (emailsClicked / emailsDelivered) * 100
        private Double emailBounceRate;        // (emailsBounced / emailsSent) * 100
        private Double emailRejectRate;        // (emailsRejected / emailsSent) * 100
        private Double emailComplaintRate;     // (emailsComplained / emailsSent) * 100
    }

    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    public static class ChannelStats {
        private String channel;                // EMAIL, WHATSAPP, PUSH_NOTIFICATION or an in-app mode
        private Long people;
        private Long delivered;
        private Long failed;
        private Long pending;
    }
}