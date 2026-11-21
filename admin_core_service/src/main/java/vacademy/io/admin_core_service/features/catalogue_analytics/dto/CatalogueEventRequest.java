package vacademy.io.admin_core_service.features.catalogue_analytics.dto;

import lombok.Data;

/**
 * One analytics beacon from a catalogue site. Everything is optional except
 * the institute: a beacon must never be the reason a visitor's page breaks,
 * so the server fills gaps rather than rejecting.
 *
 * Deliberately does NOT accept a visitor id, an IP, or a full referrer — those
 * are derived or truncated server-side so a caller cannot inject identity.
 */
@Data
public class CatalogueEventRequest {
    private String instituteId;
    private String catalogueId;
    private String pageRoute;
    private String eventType;
    private String sessionId;
    /** Full referrer; only its host is stored. */
    private String referrer;
    private String utmSource;
    private String utmMedium;
    private String utmCampaign;
    /** 'mobile' | 'desktop'; anything else is normalised away. */
    private String device;
}
