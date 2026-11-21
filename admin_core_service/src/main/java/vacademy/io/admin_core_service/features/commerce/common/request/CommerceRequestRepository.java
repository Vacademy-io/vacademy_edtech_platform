package vacademy.io.admin_core_service.features.commerce.common.request;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

/** Insert and read only. */
public interface CommerceRequestRepository extends JpaRepository<CommerceRequest, String> {

    Optional<CommerceRequest> findByInstituteIdAndClientRequestId(String instituteId, String clientRequestId);

    /**
     * The first statement of a staff change. A second request with the same key waits here for
     * the first one's transaction and then fails on the unique key (or succeeds when the first
     * one rolled back).
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            INSERT INTO commerce_request (id, institute_id, client_request_id, action, reference_type,
                                          reference_id, request_hash, actor_user_id)
            VALUES (:id, :instituteId, :clientRequestId, :action, CAST(:referenceType AS VARCHAR),
                    CAST(:referenceId AS VARCHAR), :requestHash, CAST(:actorUserId AS VARCHAR))
            """, nativeQuery = true)
    int insert(@Param("id") String id, @Param("instituteId") String instituteId,
               @Param("clientRequestId") String clientRequestId, @Param("action") String action,
               @Param("referenceType") String referenceType, @Param("referenceId") String referenceId,
               @Param("requestHash") String requestHash, @Param("actorUserId") String actorUserId);
}
