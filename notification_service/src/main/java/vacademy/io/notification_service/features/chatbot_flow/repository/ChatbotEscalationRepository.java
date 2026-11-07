package vacademy.io.notification_service.features.chatbot_flow.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotEscalation;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

public interface ChatbotEscalationRepository extends JpaRepository<ChatbotEscalation, String> {

    /** The single open escalation for a conversation, if any (partial unique index in V32). */
    Optional<ChatbotEscalation> findFirstByInstituteIdAndUserPhoneAndStatusOrderByCreatedAtDesc(
            String instituteId, String userPhone, String status);

    List<ChatbotEscalation> findByInstituteIdAndStatusOrderByCreatedAtDesc(
            String instituteId, String status);

    List<ChatbotEscalation> findByInstituteIdOrderByCreatedAtDesc(String instituteId);

    /**
     * Open escalations for the phones on one page of the Inbox conversation list — one query, not
     * one per row. Ordered so a caller building a phone→escalation map keeps the newest.
     */
    @Query("""
                SELECT e FROM ChatbotEscalation e
                WHERE e.instituteId = :instituteId
                  AND e.status = 'PENDING'
                  AND e.userPhone IN :phones
                ORDER BY e.createdAt DESC
            """)
    List<ChatbotEscalation> findPendingForPhones(@Param("instituteId") String instituteId,
                                                 @Param("phones") List<String> phones);

    /** Phones with an open escalation — drives the Inbox "Unanswered" filter. */
    @Query("""
                SELECT DISTINCT e.userPhone FROM ChatbotEscalation e
                WHERE e.instituteId = :instituteId AND e.status = 'PENDING'
            """)
    List<String> findPendingPhones(@Param("instituteId") String instituteId);

    /**
     * Resolve every open escalation on a conversation in one statement. Used when a human replies
     * from the Inbox — the reply IS the answer the learner was waiting for.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
                UPDATE ChatbotEscalation e
                SET e.status = 'RESOLVED', e.resolvedAt = :now, e.resolvedBy = :resolvedBy,
                    e.updatedAt = :now
                WHERE e.instituteId = :instituteId AND e.userPhone = :phone AND e.status = 'PENDING'
            """)
    int resolvePendingForPhone(@Param("instituteId") String instituteId,
                               @Param("phone") String phone,
                               @Param("resolvedBy") String resolvedBy,
                               @Param("now") Timestamp now);
}
