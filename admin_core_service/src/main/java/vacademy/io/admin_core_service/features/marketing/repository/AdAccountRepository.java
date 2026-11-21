package vacademy.io.admin_core_service.features.marketing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.marketing.entity.AdAccount;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface AdAccountRepository extends JpaRepository<AdAccount, String> {

    List<AdAccount> findByInstituteIdAndStatusNot(String instituteId, String status);

    List<AdAccount> findByInstituteIdAndStatus(String instituteId, String status);

    List<AdAccount> findByStatus(String status);

    List<AdAccount> findByStatusIn(Collection<String> statuses);

    List<AdAccount> findByConnectionId(String connectionId);

    Optional<AdAccount> findByIdAndInstituteId(String id, String instituteId);

    Optional<AdAccount> findByInstituteIdAndPlatformAndExternalAccountId(
            String instituteId, String platform, String externalAccountId);

    /** Puts every ACTIVE ad account of a connection into ERROR (e.g. the Meta token expired). */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE ad_account
               SET status = 'ERROR', status_detail = :detail, updated_at = now()
             WHERE connection_id = :connectionId
               AND status = 'ACTIVE'
            """, nativeQuery = true)
    int markErrorForConnection(@Param("connectionId") String connectionId, @Param("detail") String detail);

    // ── Sync outcome: targeted UPDATEs, so a concurrent disconnect / re-select is never reverted ──

    /** A successful sync: stamps it, widens synced_from, and clears an ERROR unless DISCONNECTED. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE ad_account
               SET last_synced_at = now(),
                   last_sync_status = 'OK',
                   synced_from = CASE WHEN synced_from IS NULL OR synced_from > :windowFrom
                                      THEN :windowFrom ELSE synced_from END,
                   status = CASE WHEN status <> 'DISCONNECTED' THEN 'ACTIVE' ELSE status END,
                   status_detail = CASE WHEN status <> 'DISCONNECTED' THEN NULL ELSE status_detail END,
                   updated_at = now()
             WHERE id = :id
            """, nativeQuery = true)
    int recordSyncSuccess(@Param("id") String id, @Param("windowFrom") LocalDate windowFrom);

    /** A failed sync: last_sync_status = FAILED, nothing else. */
    @Modifying
    @Transactional
    @Query(value = "UPDATE ad_account SET last_sync_status = 'FAILED', updated_at = now() WHERE id = :id",
            nativeQuery = true)
    int recordSyncFailed(@Param("id") String id);

    /**
     * ERROR + detail after a failed sync, only while the account is not DISCONNECTED and still on
     * the connection the sync used (a reconnect onto a new grant meanwhile is not marked broken).
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE ad_account
               SET status = 'ERROR', status_detail = :detail, updated_at = now()
             WHERE id = :id
               AND connection_id = :connectionId
               AND status <> 'DISCONNECTED'
            """, nativeQuery = true)
    int recordSyncError(@Param("id") String id, @Param("connectionId") String connectionId,
                        @Param("detail") String detail);

    /** As {@link #recordSyncError} but keeps the status (a transient failure): detail only. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE ad_account
               SET status_detail = :detail, updated_at = now()
             WHERE id = :id
               AND connection_id = :connectionId
               AND status <> 'DISCONNECTED'
            """, nativeQuery = true)
    int recordSyncDetail(@Param("id") String id, @Param("connectionId") String connectionId,
                         @Param("detail") String detail);
}
