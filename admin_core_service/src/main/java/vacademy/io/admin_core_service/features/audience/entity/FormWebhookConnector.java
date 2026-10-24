package vacademy.io.admin_core_service.features.audience.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;
import java.util.Date;

/**
 * Entity representing a form webhook connector configuration
 * 
 * This table stores the mapping between external form providers (Zoho, Google, etc.)
 * and internal audience campaigns.
 * 
 * Key fields:
 * - vendor: Form provider type (ZOHO_FORMS, GOOGLE_FORMS, etc.)
 * - vendor_id: Unique identifier from the form provider (e.g., Zoho form ID)
 * - institute_id: Which institute this form belongs to
 * - audience_id: Which audience/campaign to link submissions to
 * - sample_map_json: JSON mapping configuration for field names
 *   Example: {"Email": "email", "Primary Email": "email", "Phone": "phoneNumber"}
 *   This maps form field names to standardized user fields
 */
@Entity
@Table(name = "form_webhook_connector")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FormWebhookConnector {
    
    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;
    
    /**
     * Form provider vendor type (ZOHO_FORMS, GOOGLE_FORMS, MICROSOFT_FORMS)
     */
    @Column(name = "vendor", nullable = false, length = 50)
    private String vendor;
    
    /**
     * Unique identifier from the form provider
     * For Zoho: This is the Zoho form ID
     * For Google: This would be the Google Form ID
     * This allows multiple forms from the same vendor to map to different campaigns
     */
    @Column(name = "vendor_id", nullable = false, length = 255)
    private String vendorId;
    
    /**
     * Institute ID that owns this form configuration
     */
    @Column(name = "institute_id", nullable = false)
    private String instituteId;
    
    /**
     * Audience/Campaign ID to link form submissions to
     */
    @Column(name = "audience_id", nullable = false)
    private String audienceId;
    
    /**
     * Optional type/category for the connector
     */
    @Column(name = "type", length = 50)
    private String type;
    
    /**
     * JSON mapping configuration for field names
     * 
     * Structure: Maps form field names to standardized fields
     * {
     *   "Email": "email",
     *   "Primary Email": "email",
     *   "Full Name": "fullName",
     *   "Name": "fullName",
     *   "Phone Number": "phoneNumber",
     *   "Mobile": "phoneNumber",
     *   "Company Name": "companyName"
     * }
     * 
     * This allows flexible mapping when different forms use different field names
     * for the same data (e.g., "Email" vs "Primary Email" both map to "email")
     */
    @Column(name = "sample_map_json", columnDefinition = "TEXT")
    private String sampleMapJson;
    
    /**
     * Whether this connector is active
     */
    @Column(name = "is_active")
    @Builder.Default
    private Boolean isActive = true;

    // ─── Ad Platform fields (Meta Lead Ads, Google Lead Form Extensions) ──────

    /** AES-256-GCM encrypted OAuth access token (base64-encoded IV + ciphertext) */
    @Column(name = "oauth_access_token_enc", columnDefinition = "TEXT")
    private String oauthAccessTokenEnc;

    /** When the OAuth token expires; null for non-expiring credentials (Google key) */
    @Column(name = "oauth_token_expires_at")
    private LocalDateTime oauthTokenExpiresAt;

    /** Platform page/account ID: Meta Page ID or Google Customer ID */
    @Column(name = "platform_page_id", length = 255)
    private String platformPageId;

    /** Platform form ID: Meta Lead Gen Form ID or Google Campaign ID.
     *  Used as primary lookup key on webhook arrival. */
    @Column(name = "platform_form_id", length = 255)
    private String platformFormId;

    /** Human-readable form name shown in the admin connector list (e.g.
     *  "Wakad_leadform_2026"). Captured at connector-create time so we don't
     *  need to call Meta Graph API on every list render. Nullable for older
     *  rows and Google connectors. */
    @Column(name = "platform_form_name", length = 255)
    private String platformFormName;

    /** JSON routing rules for conditional lead routing to different audiences.
     *  Example: {"rules":[...],"default_audience_id":"uuid","no_match_action":"USE_DEFAULT"} */
    @Column(name = "routing_rules_json", columnDefinition = "TEXT")
    private String routingRulesJson;

    /** JSON field mapping: maps platform field keys → STANDARD/CUSTOM targets.
     *  Example: {"mappings":[{"platform_key":"full_name","target":"STANDARD:parent_name"}]} */
    @Column(name = "field_mapping_json", columnDefinition = "TEXT")
    private String fieldMappingJson;

    /** Connection lifecycle status: ACTIVE, ACTION_REQUIRED, REVOKED, TOKEN_EXPIRED */
    @Column(name = "connection_status", length = 30)
    @Builder.Default
    private String connectionStatus = "ACTIVE";

    /** Human-readable reason/remediation when connection_status is not ACTIVE.
     *  E.g. "Couldn't link this Page — the account you connected with needs
     *  Full control of the Facebook Page." Populated when the page-subscribe
     *  call fails or a health check finds a broken link. */
    @Column(name = "status_detail", columnDefinition = "TEXT")
    private String statusDetail;

    /** When the connector health check last ran. For Google connectors: when Google last
     *  reached the webhook with a known key (test data or a lead); statusDetail then holds
     *  why that delivery failed, or null if it was accepted. */
    @Column(name = "last_checked_at")
    private LocalDateTime lastCheckedAt;

    // ─── Lead polling cursor (MetaLeadPollingJob) ─────────────────────────────
    // Polling is a PULL fallback for when realtime push is blocked (Meta CRM
    // access revoked). It reuses the same ingest pipeline as the webhook.

    /** Watermark: only Meta leads created after this instant are pulled next poll.
     *  Null = never polled; the job seeds a going-forward cursor on first run so
     *  it never mass-imports historical leads (and mass-fires their workflows). */
    @Column(name = "last_polled_at")
    private LocalDateTime lastPolledAt;

    /** Meta lead id (leadgen_id) of the most recent lead the poller ingested.
     *  Diagnostic only — the time watermark drives the query. */
    @Column(name = "last_polled_lead_id", length = 255)
    private String lastPolledLeadId;

    /** Per-connector polling kill switch. Defaults true so the poller backstops
     *  every Meta connector; set false to opt a healthy-realtime connector out. */
    @Column(name = "polling_enabled")
    @Builder.Default
    private Boolean pollingEnabled = true;

    /** Source type tag for leads from this connector: FACEBOOK_ADS, INSTAGRAM_ADS, GOOGLE_ADS */
    @Column(name = "produces_source_type", length = 50)
    private String producesSourceType;

    /** Webhook verify token for Meta hub challenge verification */
    @Column(name = "webhook_verify_token", length = 255)
    private String webhookVerifyToken;

    /**
     * JSON containing default/static values to merge into form data during webhook processing.
     * Used for center-specific constants (e.g., schedule link, location link, phone, PM name)
     * that are not provided by the external form but are needed by downstream workflows.
     * Values from the form payload take precedence over defaults.
     * Example: {"center name": "Baner", "Schedule Link": "https://cal.com/...", "School Phone": "8530553999"}
     */
    @Column(name = "default_values_json", columnDefinition = "TEXT")
    private String defaultValuesJson;

    /** Google: give each new campaign its own lead list on its first lead (V564).
     *  Null/false = unmapped campaigns keep feeding this connector's audience. */
    @Column(name = "auto_create_campaign_lists")
    @Builder.Default
    private Boolean autoCreateCampaignLists = false;
    
    @Column(name = "created_at", updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date createdAt;
    
    @Column(name = "updated_at")
    @Temporal(TemporalType.TIMESTAMP)
    private Date updatedAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = new Date();
        updatedAt = new Date();
    }
    
    @PreUpdate
    protected void onUpdate() {
        updatedAt = new Date();
    }
}
