package vacademy.io.admin_core_service.features.telephony.apikey.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.telephony.apikey.entity.AiCallApiKey;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface AiCallApiKeyRepository extends JpaRepository<AiCallApiKey, String> {

    /** Indexed authentication lookup for a presented API key. */
    Optional<AiCallApiKey> findByApiKeyAndStatus(String apiKey, String status);

    List<AiCallApiKey> findByInstituteIdOrderByCreatedAtDesc(String instituteId);

    @Modifying
    @Query("""
            UPDATE AiCallApiKey k
               SET k.status = 'REVOKED', k.revokedAt = :now
             WHERE k.id = :id AND k.instituteId = :instituteId AND k.status = 'ACTIVE'
            """)
    int revoke(@Param("id") String id,
            @Param("instituteId") String instituteId,
            @Param("now") Instant now);

    /**
     * Best-effort last-used stamp. Fire-and-forget by the caller — a failed stamp
     * must never fail an authenticated call.
     */
    @Modifying
    @Query("""
            UPDATE AiCallApiKey k
               SET k.lastUsedAt = :now
             WHERE k.id = :id
            """)
    int touchLastUsed(@Param("id") String id, @Param("now") Instant now);
}
