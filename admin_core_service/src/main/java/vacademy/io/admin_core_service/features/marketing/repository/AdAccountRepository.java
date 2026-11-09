package vacademy.io.admin_core_service.features.marketing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.marketing.entity.AdAccount;

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
}
