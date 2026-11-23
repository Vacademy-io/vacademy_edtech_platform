package vacademy.io.admin_core_service.features.commerce.notify.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.Date;

/** What staff changed for one trigger of one shop. No row: the defaults (on, both channels, default texts). */
@Getter
@Setter
@NoArgsConstructor
@Entity
@IdClass(CommerceNotificationSettingId.class)
@Table(name = "commerce_notification_setting")
public class CommerceNotificationSetting {

    @Id
    @Column(name = "institute_id", length = 36, nullable = false)
    private String instituteId;

    @Id
    @Column(name = "trigger_code", length = 32, nullable = false)
    private String triggerCode;

    @Column(name = "enabled", nullable = false)
    private Boolean enabled = true;

    @Column(name = "email_enabled", nullable = false)
    private Boolean emailEnabled = true;

    @Column(name = "whatsapp_enabled", nullable = false)
    private Boolean whatsappEnabled = true;

    @Column(name = "whatsapp_template_name", length = 100)
    private String whatsappTemplateName;

    @Column(name = "email_subject_hi", length = 200)
    private String emailSubjectHi;

    @Column(name = "email_body_hi", columnDefinition = "TEXT")
    private String emailBodyHi;

    @Column(name = "email_subject_en", length = 200)
    private String emailSubjectEn;

    @Column(name = "email_body_en", columnDefinition = "TEXT")
    private String emailBodyEn;

    @Column(name = "version", nullable = false)
    private Integer version = 0;

    @Column(name = "updated_by", length = 36)
    private String updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Date updatedAt;

    /** The staff subject of a language, or null (the default). */
    public String subject(String locale) {
        return "en".equals(locale) ? emailSubjectEn : emailSubjectHi;
    }

    /** The staff body of a language, or null (the default). */
    public String body(String locale) {
        return "en".equals(locale) ? emailBodyEn : emailBodyHi;
    }
}
