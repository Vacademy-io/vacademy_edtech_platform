package vacademy.io.admin_core_service.features.catalog_api.website;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface InstituteWebsiteRepository extends JpaRepository<InstituteWebsite, String> {

    List<InstituteWebsite> findByInstituteIdOrderByCreatedAtDesc(String instituteId);

    Optional<InstituteWebsite> findByIdAndInstituteId(String id, String instituteId);

    Optional<InstituteWebsite> findByInstituteIdAndHost(String instituteId, String host);

    long countByInstituteIdAndStatusNot(String instituteId, String status);

    /** The origin-lock lookup: hosts of the institute's VERIFIED rows. */
    @Query("""
            SELECT w.host FROM InstituteWebsite w
             WHERE w.instituteId = :instituteId AND w.status = 'VERIFIED'
            """)
    List<String> findVerifiedHosts(@Param("instituteId") String instituteId);

    /** Super-admin list across institutes: the newest 500. */
    List<InstituteWebsite> findTop500ByOrderByCreatedAtDesc();

    /*
     * The writes below are conditional on the status they expect, so a super-admin revoke that
     * lands while a Verify is waiting on DNS (or a Remove is in flight) is never overwritten:
     * a REVOKED row can only change through revoke / restore.
     */

    @Transactional
    @Modifying
    @Query("""
            UPDATE InstituteWebsite w
               SET w.status = 'VERIFIED', w.verifiedAt = :now, w.lastCheckedAt = :now, w.lastError = NULL
             WHERE w.id = :id AND w.instituteId = :instituteId AND w.status = 'PENDING'
            """)
    int markVerified(@Param("id") String id, @Param("instituteId") String instituteId, @Param("now") Instant now);

    @Transactional
    @Modifying
    @Query("""
            UPDATE InstituteWebsite w
               SET w.lastCheckedAt = :now, w.lastError = :error
             WHERE w.id = :id AND w.instituteId = :instituteId AND w.status = 'PENDING'
            """)
    int markCheckFailed(@Param("id") String id, @Param("instituteId") String instituteId,
                        @Param("now") Instant now, @Param("error") String error);

    @Transactional
    @Modifying
    @Query("""
            DELETE FROM InstituteWebsite w
             WHERE w.id = :id AND w.instituteId = :instituteId AND w.status <> 'REVOKED'
            """)
    int deleteUnlessRevoked(@Param("id") String id, @Param("instituteId") String instituteId);
}
