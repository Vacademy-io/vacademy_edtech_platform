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

    // ── Ad the lead came from (stored on audience_response.ad_*; null = not known) ──

    /** Ad platform campaign id (Meta campaign_id, Google campaign_id). */
    private String adCampaignId;

    /** Campaign name, when the platform returned it (Meta only). */
    private String adCampaignName;

    /** Ad set id (Meta adset_id / webhook adgroup_id; Google ad group, else asset group). */
    private String adSetId;

    /** Ad set name, when the platform returned it (Meta only). */
    private String adSetName;

    /** Ad id (Meta ad_id; Google creative_id). */
    private String adId;

    /** Ad name, when the platform returned it (Meta only). */
    private String adName;

    /** Lead form id on the platform. */
    private String adFormId;

    /** When the platform says the lead was submitted (Meta created_time, e.g. 2026-11-09T15:36:36+0000). */
    private String platformCreatedTime;
}
