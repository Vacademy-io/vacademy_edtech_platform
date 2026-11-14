package vacademy.io.admin_core_service.features.catalogue_resources.dto;

import lombok.Data;

/**
 * One freebie opened on a catalogue site, sent by the visitor's browser.
 *
 * email / mobileNumber are what the visitor typed into the gate form in that
 * browser. They are only used to find the lead the download belongs to and
 * are never stored on the download row.
 */
@Data
public class ResourceDownloadRequest {
    private String instituteId;
    private String catalogueId;
    private String pageRoute;
    /** The gate list of the clicked card, when it has one. */
    private String audienceId;
    private String resourceTitle;
    private String resourceUrl;
    private String email;
    private String mobileNumber;
}
