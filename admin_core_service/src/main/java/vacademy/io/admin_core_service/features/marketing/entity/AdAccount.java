package vacademy.io.admin_core_service.features.marketing.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.time.LocalDate;

/** A Meta ad account or Google Ads customer whose spend is synced into ad_spend_daily. */
@Entity
@Table(name = "ad_account")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AdAccount {

    @Id
    @UuidGenerator
    @Column(length = 255, nullable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "connection_id", nullable = false)
    private String connectionId;

    /** META | GOOGLE */
    @Column(name = "platform", nullable = false, length = 16)
    private String platform;

    /** Meta: digits without act_ ; Google: customer id digits. */
    @Column(name = "external_account_id", nullable = false, length = 64)
    private String externalAccountId;

    /** Google manager (MCC) id when the customer is reached through a manager. */
    @Column(name = "login_customer_id", length = 64)
    private String loginCustomerId;

    @Column(name = "name")
    private String name;

    @Column(name = "currency", length = 8)
    private String currency;

    @Column(name = "time_zone", length = 64)
    private String timeZone;

    /** ACTIVE | ERROR | DISCONNECTED */
    @Builder.Default
    @Column(name = "status", nullable = false, length = 32)
    private String status = "ACTIVE";

    @Column(name = "status_detail", columnDefinition = "TEXT")
    private String statusDetail;

    @Column(name = "last_synced_at")
    private Instant lastSyncedAt;

    /** OK | FAILED */
    @Column(name = "last_sync_status", length = 32)
    private String lastSyncStatus;

    /** Earliest day fetched so far. */
    @Column(name = "synced_from")
    private LocalDate syncedFrom;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
