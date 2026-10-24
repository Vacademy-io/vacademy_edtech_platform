package vacademy.io.admin_core_service.features.live_session.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * State of a session content link captured before a rename/delete, for the admin
 * activity log ({@code before_payload}) and the row's description.
 */
@AllArgsConstructor
@Data
@NoArgsConstructor
public class ContentLinkAuditDTO {
    private String linkId;
    private String sessionId;
    /** "class material" or "recording" — the noun used in the log sentence. */
    private String kind;
    private String title;
    private String chapterName;
    /** False when the link was already deleted, so a repeat DELETE logs nothing. */
    private boolean active;
}
