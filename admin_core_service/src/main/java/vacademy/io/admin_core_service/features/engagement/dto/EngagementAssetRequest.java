package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EngagementAssetRequest {
    private String title;
    /** What it is and when to send it — the reply brain matches a request against this. */
    private String description;
    /** document | image | video | audio | link */
    private String mediaType;
    /** Public https URL of the file (or the page, for a link). */
    private String url;
    private String fileId;
    private String filename;
    private String mimeType;
    private Long sizeBytes;
}
