package vacademy.io.common.institute.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;
import java.util.Date;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;

@Data
@Builder
@ToString
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "institutes")
public class Institute {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "name")
    private String instituteName;

    @Column(name = "address_line")
    private String address;

    @Column(name = "pin_code")
    private String pinCode;

    @Column(name = "mobile_number")
    private String mobileNumber;

    @Column(name = "logo_file_id")
    private String logoFileId;

    @Column(name = "language")
    private String Language;

    @Column(name = "institute_theme_code")
    private String instituteThemeCode;

    @Column(name = "website_url")
    private String websiteUrl;

    @Column(name = "learner_portal_base_url")
    private String learnerPortalBaseUrl;

    @Column(name = "teacher_portal_base_url")
    private String teacherPortalBaseUrl;

    @Column(name = "admin_portal_base_url")
    private String adminPortalBaseUrl;

    /**
     * Custom live-class hostname for this institute, e.g. "meet.zoeedtech.com".
     * Null means "use the platform default" (the BBB pool server's own domain).
     *
     * Stored as a bare hostname — no scheme, no path, no port. Only the join URL
     * handed to a participant is rewritten to this host; every control-plane call
     * to BBB keeps using the pool server's api_url, so a broken custom domain
     * costs branding on a link rather than a class. See BbbMeetingManager.
     */
    @Column(name = "live_session_base_url")
    private String liveSessionBaseUrl;

    @Column(name = "description")
    private String description;

    @Column(name = "type")
    private String instituteType;

    @Column(name = "held")
    private String heldBy;

    /** When a FREE_TRIAL institute stops being accessible; null for normal institutes. */
    @Column(name = "demo_expires_at")
    private java.sql.Timestamp demoExpiresAt;

    /** pricing_quote.id this institute was provisioned from. */
    @Column(name = "source_quote_id")
    private String sourceQuoteId;

    @Column(name = "founded_date")
    private Timestamp foundedData;

    @Column(name = "country")
    private String country;

    @Column(name = "state")
    private String state;

    @Column(name = "city")
    private String city;

    // V239 — AI credit pack purchase flow
    /** Optional manual currency override; NULL = derive from {@link #country}. */
    @Column(name = "currency", length = 3)
    private String currency;

    /** Buyer's 15-char Indian GSTIN, snapshotted onto invoices. */
    @Column(name = "gstin", length = 15)
    private String gstin;

    /** 2-char numeric Indian state code ("29" Karnataka). Drives CGST/SGST vs IGST. */
    @Column(name = "state_code", length = 2)
    private String stateCode;

    @Column(name = "email")
    private String email;

    @Column(name = "letterhead_file_id")
    private String letterHeadFileId;

    @Column(name = "subdomain")
    private String subdomain;

    @Column(name = "setting_json")
    private String setting;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "cover_image_file_id")
    private String coverImageFileId;

    @Column(name = "cover_text_json")
    private String coverTextJson;

    @Column(name = "board")
    private String board;

    @Column(name = "gst_details")
    private String gstDetails;

    @Column(name = "affiliation_number")
    private String affiliationNumber;

    @Column(name = "staff_strength")
    private Integer staffStrength;

    @Column(name = "school_strength")
    private Integer schoolStrength;

    @Column(name = "lead_tag")
    private String leadTag;

    @Column(name = "account_type")
    private String accountType;

    @Column(name = "product")
    private String product;

    @Column(name = "company_size")
    private String companySize;

    @PrePersist
    @PreUpdate
    private void applyDefaultsAndNormalize() {
        if (this.email != null) {
            this.email = this.email.toLowerCase();
        }
        // institutes.product is NOT NULL DEFAULT 'vacademy' (V226). The DB default only
        // fires when the column is omitted from INSERT, but Hibernate always emits it
        // with the bound value — so callers that never set product (e.g. sub-org creation
        // in InstituteCustomFieldMapper) need an explicit default here.
        if (this.product == null) {
            this.product = "vacademy";
        }
    }

}
