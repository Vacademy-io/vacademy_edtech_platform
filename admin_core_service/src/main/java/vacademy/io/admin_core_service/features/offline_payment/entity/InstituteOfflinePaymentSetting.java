package vacademy.io.admin_core_service.features.offline_payment.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * The offline payment modes an institute offers (V577), as JSON
 * ({@link vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentModesDTO}). Kept out of
 * {@code institutes.setting_json}, whose parts reach learners and the public, because the
 * options can name bank accounts.
 */
@Entity
@Table(name = "institute_offline_payment_setting")
@Getter
@Setter
@NoArgsConstructor
public class InstituteOfflinePaymentSetting {

    @Id
    @Column(name = "institute_id")
    private String instituteId;

    @Column(name = "setting_json", columnDefinition = "TEXT", nullable = false)
    private String settingJson;

    @Column(name = "updated_by_user_id")
    private String updatedByUserId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
