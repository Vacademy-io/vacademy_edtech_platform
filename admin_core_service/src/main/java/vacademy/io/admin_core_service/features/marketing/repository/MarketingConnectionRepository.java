package vacademy.io.admin_core_service.features.marketing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface MarketingConnectionRepository extends JpaRepository<MarketingConnection, String> {

    Optional<MarketingConnection> findFirstByInstituteIdAndProviderAndExternalUserIdOrderByUpdatedAtDesc(
            String instituteId, String provider, String externalUserId);

    Optional<MarketingConnection> findByOauthStateId(String oauthStateId);

    Optional<MarketingConnection> findByIdAndInstituteId(String id, String instituteId);

    List<MarketingConnection> findByInstituteIdAndProvider(String instituteId, String provider);

    List<MarketingConnection> findByIdIn(Collection<String> ids);

    /** Connections of the given providers in a status whose token expires before a moment. */
    List<MarketingConnection> findByProviderInAndStatusAndTokenExpiresAtBefore(
            Collection<String> providers, String status, Instant before);

    /** Flip a grant to RECONNECT_NEEDED; a REVOKED grant stays REVOKED. Returns rows changed. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE marketing_connection
               SET status = 'RECONNECT_NEEDED', status_detail = :detail, updated_at = now()
             WHERE id = :id
               AND status <> 'REVOKED'
            """, nativeQuery = true)
    int markReconnect(@Param("id") String id, @Param("detail") String detail);
}
