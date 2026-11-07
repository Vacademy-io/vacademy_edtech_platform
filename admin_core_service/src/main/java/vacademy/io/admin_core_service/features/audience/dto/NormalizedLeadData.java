package vacademy.io.admin_core_service.features.audience.dto;

import lombok.Builder;
import lombok.Data;

import java.util.Map;

/**
 * Normalized lead data extracted from any ad platform webhook.
 * All platform-specific parsing happens in the strategy; this is the common output.
 */
@Data
@Builder
public class NormalizedLeadData {
    /** Resolved target audience ID (after routing rules have been applied) */
    private String targetAudienceId;

    /** Flat key→value map of ALL lead fields after field mapping is applied */
    private Map<String, String> fields;

    /** Email address (extracted from fields for quick access) */
    private String email;

    /** Phone number */
    private String phone;

    /** Full name */
    private String fullName;

    /** Original platform lead ID (for deduplication / audit) */
    private String platformLeadId;

    /** Source type to tag the lead with (FACEBOOK_ADS, INSTAGRAM_ADS, GOOGLE_ADS) */
    private String sourceType;

    /** True if this is a platform test lead — should be processed but flagged */
    private boolean testLead;

    /** Ad campaign the lead came from, stored as audience_response.source_id. Null = none known. */
    private String campaignId;

    /** utm_source/utm_medium/utm_campaign/utm_content for the lead's utm_attribution row. Null/empty = none. */
    private Map<String, String> utmParams;

    /** List chosen for this lead by its campaign's route; when set it wins over routing rules. */
    private String routedAudienceId;
}
