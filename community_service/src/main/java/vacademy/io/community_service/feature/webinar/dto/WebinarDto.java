package vacademy.io.community_service.feature.webinar.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * A webinar as both the health-check Webinars page and the admin dashboard's Webinars panel see
 * it. Times are ISO-8601 instants in UTC ("2026-12-04T11:30:00Z"); each client shows them in the
 * viewer's own time zone and works out upcoming / live / past from them.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WebinarDto {
    private String id;
    private String title;
    private String description;
    private String startsAt;
    private String endsAt;
    /** The link admins open to join; null until it is added. */
    private String joinUrl;
    /** The recording, once it is added (public S3 URL or any video link). */
    private String recordingUrl;
    /** media-service file id of the recording, when it was uploaded through the platform. */
    private String recordingFileId;
    /**
     * The webinar's live class (session_schedules id), for a one-click join. The institute-facing
     * listing returns it only to admins of PROD institutes; null for everyone else.
     */
    private String liveScheduleId;
    private boolean active;
    private Date createdAt;
    private Date updatedAt;
}
