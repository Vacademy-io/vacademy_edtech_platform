package vacademy.io.admin_core_service.features.user_subscription.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.user_subscription.dto.CouponCodeDTO;

import java.sql.Timestamp;
import java.util.Date;

// You might need a custom AttributeConverter for List<String> to JSONB for robust handling
// For simplicity in the entity definition, I'll represent it as a String if stored as JSONB string,
// or a List<String> if using a custom converter. For direct entity representation,
// a List<String> would require an @ElementCollection or a custom converter.
// Given the SQL table used JSONB, a String mapping for the JSON content is common if you serialize/deserialize it in application logic.
// If you want JPA to handle the List directly, you'd need @Convert or @ElementCollection.
// For now, I'll keep it as String for simplicity to match JSONB column definition.

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "coupon_code")
public class CouponCode {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "code", nullable = false)
    private String code; // Actual coupon code shown to users. Uniqueness is composite (institute_id, code) — see V309.

    @Column(name = "status") // e.g., ACTIVE, EXPIRED, REDEEMED
    private String status;

    @Column(name = "source_type") // Where this coupon originated from (e.g., ADMIN, SYSTEM)
    private String sourceType;

    @Column(name = "source_id") // ID of the source entity (e.g., campaign, admin ID)
    private String sourceId;

    @Column(name = "institute_id")
    private String instituteId;

    @Column(name = "is_email_restricted") // If true, applicable only to listed email IDs
    private boolean isEmailRestricted;

    // Option 1: Store as JSON string in DB
    @Column(name = "allowed_email_ids")
    private String allowedEmailIds;

    @Column(name = "tag")
    private String tag;

    @Column(name = "generation_date")
    private Date generationDate;

    @Column(name = "short_url")
    private String shortUrl;

    @Column(name = "redeem_start_date")
    private Date redeemStartDate;

    @Column(name = "redeem_end_date")
    private Date redeemEndDate;

    @Column(name = "usage_limit") // Maximum number of times this coupon can be used
    private Long usageLimit;

    /**
     * Smallest basket this coupon may be used on — "₹99 off when you take 2 or
     * more". NULL means no condition, which is every coupon that predates this,
     * so nothing changes until an admin sets one.
     */
    @Column(name = "min_items")
    private Integer minItems;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;

    @Column(name = "can_be_added")
    private boolean canBeAdded;

    public CouponCodeDTO toDTO() {
        return CouponCodeDTO.builder()
            .id(this.id)
            .code(this.code)
            .status(this.status)
            .sourceType(this.sourceType)
            .sourceId(this.sourceId)
            .emailRestricted(this.isEmailRestricted)
            .allowedEmailIds(this.allowedEmailIds)
            .tag(this.tag)
            .generationDate(this.generationDate)
            .redeemStartDate(this.redeemStartDate)
            .redeemEndDate(this.redeemEndDate)
            .usageLimit(this.usageLimit)
            .createdAt(this.createdAt)
            .updatedAt(this.updatedAt)
            .canBeAdded(this.canBeAdded)
            .shortUrl(this.shortUrl)
            .shortReferralLink(this.shortUrl)
            .build();
    }
}
