package vacademy.io.community_service.feature.webinar.dto;

import lombok.Data;

/**
 * Create / update body from the health-check Webinars page. On update, a null field is left as
 * it is; an empty string clears description, joinUrl and recordingUrl.
 */
@Data
public class UpsertWebinarRequest {
    private String title;
    private String description;
    /** ISO-8601 instant or offset date-time, e.g. "2026-12-04T11:30:00Z". Required on create. */
    private String startsAt;
    /** ISO-8601 like startsAt. Defaults to one hour after startsAt on create. */
    private String endsAt;
    private String joinUrl;
    private String recordingUrl;
    private String recordingFileId;
    /** The webinar's live class (session_schedules id) for PROD admins' one-click join. "" clears it. */
    private String liveScheduleId;
    private Boolean active;
}
