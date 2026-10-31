package vacademy.io.notification_service.features.email_sending_controls.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.notification_service.features.email_sending_controls.entity.DeferredEmail;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface DeferredEmailRepository extends JpaRepository<DeferredEmail, String> {

    /** Due rows, oldest first, locked so a second pod running the drainer skips them. */
    @Query(value = """
            SELECT * FROM deferred_email
            WHERE status = 'PENDING' AND send_after <= :now
            ORDER BY created_at
            LIMIT :limit
            FOR UPDATE SKIP LOCKED
            """, nativeQuery = true)
    List<DeferredEmail> lockDue(@Param("now") LocalDateTime now, @Param("limit") int limit);

    long countBySenderKeyAndStatus(String senderKey, String status);

    long countByInstituteIdAndStatus(String instituteId, String status);

    /**
     * Stop everything still queued for a sender. A capped campaign can hold weeks of mail,
     * so there has to be a way to call it off without waiting for it to drain.
     */
    @Modifying
    @Query("UPDATE DeferredEmail d SET d.status = 'CANCELLED', d.lastError = :reason "
            + "WHERE d.senderKey = :senderKey AND d.status = 'PENDING'")
    int cancelPending(@Param("senderKey") String senderKey, @Param("reason") String reason);

    /** Push every pending row of one sender to a later window in one statement (cap hit mid-drain). */
    @Modifying
    @Query("UPDATE DeferredEmail d SET d.sendAfter = :sendAfter WHERE d.senderKey = :senderKey AND d.status = 'PENDING' AND d.sendAfter <= :now")
    int pushBack(@Param("senderKey") String senderKey, @Param("now") LocalDateTime now, @Param("sendAfter") LocalDateTime sendAfter);
}
