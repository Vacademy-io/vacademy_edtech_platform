package vacademy.io.admin_core_service.features.audience.dto;

import lombok.Builder;
import lombok.Data;
import vacademy.io.admin_core_service.features.audience.entity.FormWebhookConnector;

/**
 * Safe DTO for listing connectors. Omits encrypted tokens.
 */
@Data
@Builder
public class ConnectorListItemDTO {
    private String id;
    private String vendor;
    private String vendorId;
    private String audienceId;
    private String platformPageId;
    private String platformFormId;
    private String platformFormName;
    private String connectionStatus;
    /** Human reason/remediation when connectionStatus is not ACTIVE (e.g. needs Full control). */
    private String statusDetail;
    private String lastCheckedAt;
    private String producesSourceType;
    private String createdAt;
    private String tokenExpiresAt;

    /**
     * Free-form JSON of default/static values merged into form payloads at webhook time.
     * Typically used by admins to set per-connector center metadata such as
     * {"center name": "Baner", "Schedule Link": "...", "School Phone": "..."}.
     * Editable from the UI via PUT /connectors/{id}.
     */
    private String defaultValuesJson;

    /** Google: campaigns that have sent leads but are not routed to a list yet (their
     *  leads go to this connector's own audience). Null for other vendors. */
    private Integer unmappedCampaigns;

    public static ConnectorListItemDTO from(FormWebhookConnector c) {
        return ConnectorListItemDTO.builder()
                .id(c.getId())
                .vendor(c.getVendor())
                .vendorId(c.getVendorId())
                .audienceId(c.getAudienceId())
                .platformPageId(c.getPlatformPageId())
                .platformFormId(c.getPlatformFormId())
                .platformFormName(c.getPlatformFormName())
                .connectionStatus(c.getConnectionStatus())
                .statusDetail(c.getStatusDetail())
                .lastCheckedAt(c.getLastCheckedAt() != null ? c.getLastCheckedAt().toString() : null)
                .producesSourceType(c.getProducesSourceType())
                .createdAt(c.getCreatedAt() != null ? c.getCreatedAt().toString() : null)
                .tokenExpiresAt(c.getOauthTokenExpiresAt() != null
                        ? c.getOauthTokenExpiresAt().toString() : null)
                .defaultValuesJson(c.getDefaultValuesJson())
                .build();
    }
}
