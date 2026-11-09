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
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

/**
 * Platform-reported spend for one campaign on one day (in the ad account time zone). Written only
 * through AdSpendDailyRepository#upsert so a re-sync overwrites the same (account, campaign, day) row.
 */
@Entity
@Table(name = "ad_spend_daily")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AdSpendDaily {

    @Id
    @UuidGenerator
    @Column(length = 255, nullable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "ad_account_id", nullable = false)
    private String adAccountId;

    /** META | GOOGLE */
    @Column(name = "platform", nullable = false, length = 16)
    private String platform;

    /** META for Meta rows; Google advertising_channel_type (SEARCH, PERFORMANCE_MAX, VIDEO, ...). */
    @Column(name = "channel", length = 32)
    private String channel;

    @Column(name = "campaign_id", nullable = false, length = 64)
    private String campaignId;

    @Column(name = "campaign_name", length = 512)
    private String campaignName;

    @Column(name = "day", nullable = false)
    private LocalDate day;

    @Builder.Default
    @Column(name = "spend", nullable = false, precision = 14, scale = 2)
    private BigDecimal spend = BigDecimal.ZERO;

    @Column(name = "currency", length = 8)
    private String currency;

    @Builder.Default
    @Column(name = "impressions", nullable = false)
    private Long impressions = 0L;

    @Builder.Default
    @Column(name = "clicks", nullable = false)
    private Long clicks = 0L;

    @Builder.Default
    @Column(name = "platform_leads", nullable = false, precision = 12, scale = 2)
    private BigDecimal platformLeads = BigDecimal.ZERO;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
