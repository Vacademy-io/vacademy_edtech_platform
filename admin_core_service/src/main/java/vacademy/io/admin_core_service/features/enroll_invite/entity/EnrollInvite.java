package vacademy.io.admin_core_service.features.enroll_invite.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Id; // Added
import jakarta.persistence.Table; // Added
import lombok.AllArgsConstructor; // Added for consistency
import lombok.Getter; // Added for consistency
import lombok.NoArgsConstructor; // Added for consistency
import lombok.Setter; // Added for consistency
import org.hibernate.annotations.UuidGenerator; // Assuming UUID generation for IDs
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteDTO;

import java.sql.Date;
import java.sql.Timestamp;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "enroll_invite")
public class EnrollInvite {

    @Id // Assuming 'id' is the primary key
    @UuidGenerator // Assuming UUID generation for IDs
    private String id;

    @Column(name = "name")
    private String name;

    @Column(name = "end_date")
    private Date endDate;

    @Column(name = "start_date")
    private Date startDate;

    @Column(name = "invite_code")
    private String inviteCode;

    @Column(name = "status")
    private String status;

    @Column(name = "institute_id")
    private String instituteId;

    @Column(name = "vendor")
    private String vendor;

    @Column(name = "vendor_id")
    private String vendorId;

    @Column(name = "currency")
    private String currency;

    @Column(name = "tag")
    private String tag;

    @Column(name = "web_page_meta_data_json", columnDefinition = "TEXT") // Mapped to TEXT in DB
    private String webPageMetaDataJson;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    // Written on every save (see touchUpdatedAt): the DB default only covers the
    // insert, and no trigger maintains this column, so before this it never moved.
    @Column(name = "updated_at", insertable = false)
    private Timestamp updatedAt;

    /** auth_service user id of the admin who created the invite. Stamped once, never rewritten. */
    @Column(name = "created_by_user_id", updatable = false)
    private String createdByUserId;

    /** auth_service user id of the admin who last saved the invite (edit, delete, make default). */
    @Column(name = "updated_by_user_id")
    private String updatedByUserId;

    @Column(name = "learner_access_days")
    private Integer learnerAccessDays;

    @Column(name = "is_bundled")
    private Boolean isBundled;

    @Column(name = "setting_json", columnDefinition = "TEXT")
    private String settingJson;

    @Column(name = "short_url")
    private String shortUrl;

    @Column(name = "sub_org_id")
    private String subOrgId;

    @PreUpdate
    void touchUpdatedAt() {
        this.updatedAt = new Timestamp(System.currentTimeMillis());
    }

    public EnrollInvite(EnrollInviteDTO enrollInviteDTO) {
        this.id = enrollInviteDTO.getId();
        this.name = enrollInviteDTO.getName();
        this.endDate = enrollInviteDTO.getEndDate();
        this.startDate = enrollInviteDTO.getStartDate();
        this.inviteCode = enrollInviteDTO.getInviteCode();
        this.status = enrollInviteDTO.getStatus();
        this.instituteId = enrollInviteDTO.getInstituteId();
        this.vendor = enrollInviteDTO.getVendor();
        this.vendorId = enrollInviteDTO.getVendorId();
        this.currency = enrollInviteDTO.getCurrency();
        this.tag = enrollInviteDTO.getTag();
        this.learnerAccessDays = enrollInviteDTO.getLearnerAccessDays();
        this.webPageMetaDataJson = enrollInviteDTO.getWebPageMetaDataJson();
        this.isBundled = enrollInviteDTO.getIsBundled();
        this.settingJson = enrollInviteDTO.getSettingJson();
        this.shortUrl = enrollInviteDTO.getShortUrl();
        this.subOrgId = enrollInviteDTO.getSubOrgId();
    }

    public EnrollInviteDTO toEnrollInviteDTO() {
        EnrollInviteDTO enrollInviteDTO = new EnrollInviteDTO();
        enrollInviteDTO.setId(id);
        enrollInviteDTO.setName(name);
        enrollInviteDTO.setEndDate(endDate);
        enrollInviteDTO.setStartDate(startDate);
        enrollInviteDTO.setInviteCode(inviteCode);
        enrollInviteDTO.setStatus(status);
        enrollInviteDTO.setInstituteId(instituteId);
        enrollInviteDTO.setVendor(vendor);
        enrollInviteDTO.setVendorId(vendorId);
        enrollInviteDTO.setCurrency(currency);
        enrollInviteDTO.setTag(tag);
        enrollInviteDTO.setLearnerAccessDays(learnerAccessDays);
        enrollInviteDTO.setWebPageMetaDataJson(webPageMetaDataJson);
        enrollInviteDTO.setIsBundled(isBundled);
        enrollInviteDTO.setSettingJson(settingJson);
        enrollInviteDTO.setShortUrl(shortUrl);
        enrollInviteDTO.setSubOrgId(subOrgId);
        return enrollInviteDTO;
    }
}
