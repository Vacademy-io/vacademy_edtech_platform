package vacademy.io.admin_core_service.features.marketing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.marketing.entity.AdSpendDaily;

import java.math.BigDecimal;
import java.time.LocalDate;

@Repository
public interface AdSpendDailyRepository extends JpaRepository<AdSpendDaily, String> {

    /**
     * Insert or overwrite the (ad account, campaign, day) row. Every argument except channel,
     * campaignName and currency must be non-null (pass BigDecimal.ZERO / 0L for empty metrics).
     * Returns 1.
     */
    @Modifying
    @Transactional
    @Query(value = """
            INSERT INTO ad_spend_daily
                   (id, institute_id, ad_account_id, platform, channel, campaign_id, campaign_name,
                    day, spend, currency, impressions, clicks, platform_leads, updated_at)
            VALUES (gen_random_uuid()::text, :instituteId, :adAccountId, :platform, :channel, :campaignId,
                    :campaignName, :day, :spend, :currency, :impressions, :clicks, :platformLeads, now())
            ON CONFLICT (ad_account_id, campaign_id, day) DO UPDATE
               SET institute_id   = EXCLUDED.institute_id,
                   platform       = EXCLUDED.platform,
                   channel        = EXCLUDED.channel,
                   campaign_name  = EXCLUDED.campaign_name,
                   spend          = EXCLUDED.spend,
                   currency       = EXCLUDED.currency,
                   impressions    = EXCLUDED.impressions,
                   clicks         = EXCLUDED.clicks,
                   platform_leads = EXCLUDED.platform_leads,
                   updated_at     = now()
            """, nativeQuery = true)
    int upsert(@Param("instituteId") String instituteId,
               @Param("adAccountId") String adAccountId,
               @Param("platform") String platform,
               @Param("channel") String channel,
               @Param("campaignId") String campaignId,
               @Param("campaignName") String campaignName,
               @Param("day") LocalDate day,
               @Param("spend") BigDecimal spend,
               @Param("currency") String currency,
               @Param("impressions") Long impressions,
               @Param("clicks") Long clicks,
               @Param("platformLeads") BigDecimal platformLeads);
}
