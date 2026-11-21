package vacademy.io.admin_core_service.features.live_session.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

@Entity
@Table(name = "live_session_logs")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LiveSessionLogs {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(nullable = false)
    private String sessionId;

    @Column(nullable = false)
    private String scheduleId;

    @Column(name = "user_source_type", nullable = false, length = 30)
    private String userSourceType;

    @Column(name = "user_source_id", nullable = false, length = 255)
    private String userSourceId;

    @Column(name = "log_type", nullable = false, length = 30)
    private String logType;

    @Column(length = 20)
    private String status;

    @Column(columnDefinition = "TEXT")
    private String details;

    /**
     * ONLINE = user joined via app/BBB (auto-tracked).
     * OFFLINE = admin manually marked attendance.
     */
    @Column(name = "status_type", length = 10)
    @Builder.Default
    private String statusType = "ONLINE";

    /**
     * JSON string with provider engagement metrics.
     * E.g. {"chats":5,"talks":3,"talkTime":120,"raisehand":2,"emojis":1,"pollVotes":4}
     */
    @Column(name = "engagement_data", columnDefinition = "TEXT")
    private String engagementData;

    /**
     * The specific provider meeting instance ID this log belongs to.
     * Important for schedule retry/recreate — scheduleId stays the same
     * but providerMeetingId changes with each new meeting.
     */
    @Column(name = "provider_meeting_id")
    private String providerMeetingId;

    /**
     * ISO-8601 join time from the meeting provider (e.g. Zoho).
     * Includes provider-specific timezone offsets dynamically if returned.
     * Populated by the hourly sync scheduler.
     */
    @Column(name = "provider_join_time", length = 50)
    private String providerJoinTime;

    /**
     * Total minutes the attendee was in the meeting, from provider data.
     * Useful for queries like "most-attended student".
     */
    @Column(name = "provider_total_duration_minutes")
    private Integer providerTotalDurationMinutes;

    /**
     * Exact seconds in the meeting, when the provider reports that precisely
     * (BBB does; Zoom gives whole minutes, leaving this NULL). The minutes
     * column above is a floor of this and is kept for existing consumers.
     */
    @Column(name = "provider_total_duration_seconds")
    private Integer providerTotalDurationSeconds;

    /**
     * Audit of the attendance-criteria evaluation for this row: verdict, reason,
     * attendedMinutes, scheduledMinutes, requiredMinutes, thresholdPercent,
     * previousStatus, evaluatedAt. Attendance is disputed data, so an absence
     * must stay explainable after the fact.
     */
    @Column(name = "attendance_evaluation_json", columnDefinition = "TEXT")
    private String attendanceEvaluationJson;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
