package vacademy.io.admin_core_service.features.institute_api.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiKey;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface InstituteApiKeyRepository extends JpaRepository<InstituteApiKey, String> {

    /** The verify lookup: key_hash is UNIQUE. */
    Optional<InstituteApiKey> findByKeyHash(String keyHash);

    List<InstituteApiKey> findByInstituteIdOrderByCreatedAtDesc(String instituteId);

    Optional<InstituteApiKey> findByIdAndInstituteId(String id, String instituteId);

    /** Keys that still authenticate: ACTIVE and not expired. */
    @Query("""
            SELECT COUNT(k) FROM InstituteApiKey k
             WHERE k.instituteId = :instituteId
               AND k.status = 'ACTIVE'
               AND (k.expiresAt IS NULL OR k.expiresAt > :now)
            """)
    long countUsable(@Param("instituteId") String instituteId, @Param("now") Instant now);

    @Query("""
            SELECT k.id FROM InstituteApiKey k
             WHERE k.instituteId = :instituteId AND k.status = 'ACTIVE'
            """)
    List<String> findActiveIds(@Param("instituteId") String instituteId);

    @Modifying
    @Query("""
            UPDATE InstituteApiKey k
               SET k.status = 'REVOKED', k.revokedAt = :now, k.revokedBy = :revokedBy
             WHERE k.id = :id AND k.instituteId = :instituteId AND k.status = 'ACTIVE'
            """)
    int revoke(@Param("id") String id,
               @Param("instituteId") String instituteId,
               @Param("now") Instant now,
               @Param("revokedBy") String revokedBy);

    @Modifying
    @Query("""
            UPDATE InstituteApiKey k
               SET k.status = 'REVOKED', k.revokedAt = :now, k.revokedBy = :revokedBy
             WHERE k.instituteId = :instituteId AND k.status = 'ACTIVE'
            """)
    int revokeAllActive(@Param("instituteId") String instituteId,
                        @Param("now") Instant now,
                        @Param("revokedBy") String revokedBy);

    /** Best-effort last-used stamp in its own transaction; the caller throttles it. */
    @Transactional
    @Modifying
    @Query("UPDATE InstituteApiKey k SET k.lastUsedAt = :now WHERE k.id = :id")
    int touchLastUsed(@Param("id") String id, @Param("now") Instant now);

    @Transactional
    @Modifying
    @Query("UPDATE InstituteApiKey k SET k.lastUsedAt = :now, k.lastUsedIp = :ip WHERE k.id = :id")
    int touchLastUsedWithIp(@Param("id") String id, @Param("now") Instant now, @Param("ip") String ip);
}
