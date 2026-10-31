package vacademy.io.admin_core_service.features.audience.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.entity.AdCampaignRoute;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface AdCampaignRouteRepository extends JpaRepository<AdCampaignRoute, String> {

    Optional<AdCampaignRoute> findByConnectorIdAndCampaignId(String connectorId, String campaignId);

    /** The row locked for update, so two leads of a new campaign can't both create its list. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM AdCampaignRoute r WHERE r.connectorId = :connectorId AND r.campaignId = :campaignId")
    Optional<AdCampaignRoute> lockByConnectorIdAndCampaignId(@Param("connectorId") String connectorId,
                                                            @Param("campaignId") String campaignId);

    /** Create the (connector, campaign) row if missing, without counting a lead. */
    @Modifying
    @Query(value = """
            INSERT INTO ad_campaign_route (id, connector_id, institute_id, campaign_id, lead_count,
                                           added_manually, created_at, updated_at)
            VALUES (:id, :connectorId, :instituteId, :campaignId, 0, FALSE, :now, :now)
            ON CONFLICT (connector_id, campaign_id) DO NOTHING
            """, nativeQuery = true)
    void ensureRow(@Param("id") String id,
                   @Param("connectorId") String connectorId,
                   @Param("instituteId") String instituteId,
                   @Param("campaignId") String campaignId,
                   @Param("now") LocalDateTime now);

    /** Newest activity first; manually added rows with no lead yet sort last. */
    @Query(value = "SELECT * FROM ad_campaign_route WHERE connector_id = :connectorId "
            + "ORDER BY last_lead_at DESC NULLS LAST, created_at DESC", nativeQuery = true)
    List<AdCampaignRoute> findForConnector(@Param("connectorId") String connectorId);

    /** connector id → campaigns still waiting to be mapped, for the connector list badge. */
    @Query(value = "SELECT connector_id, COUNT(*) FROM ad_campaign_route "
            + "WHERE connector_id IN (:connectorIds) AND audience_id IS NULL GROUP BY connector_id",
            nativeQuery = true)
    List<Object[]> countUnmapped(@Param("connectorIds") Collection<String> connectorIds);

    /**
     * Count one more lead for (connector, campaign), creating the row on the
     * campaign's first lead. One atomic upsert, so two leads arriving together
     * can neither double-insert nor lose a count.
     */
    @Transactional
    @Modifying
    @Query(value = """
            INSERT INTO ad_campaign_route (id, connector_id, institute_id, campaign_id, lead_count,
                                           first_lead_at, last_lead_at, added_manually, created_at, updated_at)
            VALUES (:id, :connectorId, :instituteId, :campaignId, 1, :now, :now, FALSE, :now, :now)
            ON CONFLICT (connector_id, campaign_id) DO UPDATE
               SET lead_count = ad_campaign_route.lead_count + 1,
                   first_lead_at = COALESCE(ad_campaign_route.first_lead_at, EXCLUDED.first_lead_at),
                   last_lead_at = EXCLUDED.last_lead_at,
                   updated_at = EXCLUDED.updated_at
            """, nativeQuery = true)
    void recordLead(@Param("id") String id,
                    @Param("connectorId") String connectorId,
                    @Param("instituteId") String instituteId,
                    @Param("campaignId") String campaignId,
                    @Param("now") LocalDateTime now);
}
