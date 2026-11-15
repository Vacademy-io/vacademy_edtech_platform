package vacademy.io.admin_core_service.features.telephony.demo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.sql.Timestamp;
import java.util.Optional;

public interface AiDemoCallRequestRepository extends JpaRepository<AiDemoCallRequest, String> {

    Optional<AiDemoCallRequest> findFirstByCallLogId(String callLogId);

    Optional<AiDemoCallRequest> findByIdAndInstituteId(String id, String instituteId);

    Optional<AiDemoCallRequest> findFirstByInstituteIdAndPhoneAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
            String instituteId, String phone, String status, Timestamp now);

    /** A newer request from the same phone replaces any still waiting for a call. */
    @Modifying
    @Query("UPDATE AiDemoCallRequest r SET r.status = 'SUPERSEDED' "
            + "WHERE r.instituteId = :instituteId AND r.phone = :phone AND r.status = 'PENDING'")
    int supersedePending(@Param("instituteId") String instituteId, @Param("phone") String phone);

    /** Claims a waiting request for a call. Returns 0 when another call claimed it first. */
    @Modifying
    @Query("UPDATE AiDemoCallRequest r SET r.status = 'CONNECTED', r.callLogId = :callLogId, "
            + "r.connectedAt = :now WHERE r.id = :id AND r.status = 'PENDING'")
    int bind(@Param("id") String id, @Param("callLogId") String callLogId, @Param("now") Timestamp now);
}
