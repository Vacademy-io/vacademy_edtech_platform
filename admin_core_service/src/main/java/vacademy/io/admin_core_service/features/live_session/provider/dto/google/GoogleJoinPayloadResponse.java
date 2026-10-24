package vacademy.io.admin_core_service.features.live_session.provider.dto.google;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Join payload for the learner/host "Join Google Meet" launcher. Google has no embeddable
 * SDK, so this just hands back the meetingUri to open (plus the resolved display name + role).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)
public class GoogleJoinPayloadResponse {

    /** The meet.google.com URL to open (same for everyone — there is no per-user link). */
    private String joinUrl;

    /** Resolved display name (informational — Meet cannot pre-fill it via API). */
    private String userName;

    /** Durable space name (spaces/{space}). */
    private String providerMeetingId;

    /** True when the caller is the session host/creator (host attendance isn't counted). */
    private boolean host;

    /** Connected organizer Google account — the host should open Meet signed into THIS account for
     *  auto-recording to fire (a privileged Workspace user must be present). */
    private String organizerEmail;

    /** Set when the host was made a co-host of the space — they get host controls when they open
     *  Meet signed into THIS account. */
    private String cohostEmail;
}
