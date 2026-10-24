package vacademy.io.admin_core_service.features.audience.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.audience.dto.AudienceDTO;
import vacademy.io.admin_core_service.features.audience.util.AudienceTagsUtil;

import java.sql.Timestamp;

/**
 * Entity representing an Audience Campaign/Form
 * Used for lead capture across multiple channels (website forms, ad platforms)
 */
@Entity
@Table(name = "audience")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Audience {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "campaign_name", nullable = false)
    private String campaignName;

    @Column(name = "campaign_type", columnDefinition = "TEXT")
    private String campaignType; // Comma-separated: "WEBSITE,GOOGLE_ADS,FACEBOOK_ADS"

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "campaign_objective", length = 50)
    private String campaignObjective; // LEAD_GENERATION, EVENT_REGISTRATION, etc.

    @Column(name = "start_date")
    private Timestamp startDate;

    @Column(name = "end_date")
    private Timestamp endDate;

    @Column(name = "status", length = 20)
    private String status; // ACTIVE, PAUSED, COMPLETED, ARCHIVED

    @Column(name = "json_web_metadata", columnDefinition = "TEXT")
    private String jsonWebMetadata; // For webhook URLs, configuration, etc.

    @Column(name = "to_notify", columnDefinition = "TEXT")
    private String toNotify; // Comma-separated emails for additional notification recipients

    @Column(name = "send_respondent_email")
    private Boolean sendRespondentEmail; // Whether to send email to the respondent

    @Column(name = "session_id")
    private String sessionId; // References session(id)

    @Column(name = "setting_json", columnDefinition = "TEXT")
    private String settingJson; // JSON settings for the audience campaign

    /** Floor score applied to every new lead in this campaign. Overrides the institute-level default. Null = no floor. */
    @Column(name = "default_initial_score")
    private Integer defaultInitialScore;

    /** Sub-org this campaign belongs to. Nullable. Stores the child-institute id (= ssigm.sub_org_id). */
    @Column(name = "sub_org_id")
    private String subOrgId;

    /**
     * Key -> value tags on this list (e.g. {"course":"MBA","state":"Maharashtra"}), stored as
     * canonical JSON with sorted keys, or null when the list has none. Always written through
     * {@code AudienceTagsUtil}; read directly by reports that group leads by a tag.
     */
    @Column(name = "tags_json", columnDefinition = "TEXT")
    private String tagsJson;

    @Column(name = "created_by_user_id")
    private String createdByUserId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;

    /**
     * Constructor from DTO
     */
    public Audience(AudienceDTO dto) {
        this.id = dto.getId();
        this.instituteId = dto.getInstituteId();
        this.campaignName = dto.getCampaignName();
        this.campaignType = dto.getCampaignType();
        this.description = dto.getDescription();
        this.campaignObjective = dto.getCampaignObjective();
        this.startDate = dto.getStartDateLocal();
        this.endDate = dto.getEndDateLocal();
        this.status = dto.getStatus();
        this.jsonWebMetadata = dto.getJsonWebMetadata();
        this.toNotify = dto.getToNotify();
        this.sendRespondentEmail = dto.getSendRespondentEmail();
        this.sessionId = dto.getSessionId();
        this.settingJson = dto.getSettingJson();
        this.defaultInitialScore = dto.getDefaultInitialScore();
        this.subOrgId = dto.getSubOrgId();
        this.createdByUserId = dto.getCreatedByUserId();
        this.tagsJson = AudienceTagsUtil.toJson(AudienceTagsUtil.normalize(dto.getTags()));
    }
}

