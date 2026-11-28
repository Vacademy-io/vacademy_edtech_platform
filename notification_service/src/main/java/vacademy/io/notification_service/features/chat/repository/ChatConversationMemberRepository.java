package vacademy.io.notification_service.features.chat.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.notification_service.features.chat.entity.ChatConversationMember;

import java.util.List;
import java.util.Optional;

@Repository
public interface ChatConversationMemberRepository extends JpaRepository<ChatConversationMember, String> {

    Optional<ChatConversationMember> findByConversationIdAndUserId(String conversationId, String userId);

    List<ChatConversationMember> findByConversationIdAndIsActiveTrue(String conversationId);

    List<ChatConversationMember> findByConversationIdInAndIsActiveTrue(List<String> conversationIds);

    List<ChatConversationMember> findByUserIdAndIsActiveTrue(String userId);

    boolean existsByConversationIdAndUserIdAndIsActiveTrue(String conversationId, String userId);

    /** Forward-only read-cursor move; returns 0 when the stored cursor is already at or past {@code seq}. */
    @org.springframework.data.jpa.repository.Modifying
    @Query("UPDATE ChatConversationMember m SET m.lastReadSeq = :seq, m.lastReadMessageId = :messageId, m.lastReadAt = :at "
            + "WHERE m.id = :id AND (m.lastReadSeq IS NULL OR m.lastReadSeq < :seq)")
    int advanceReadCursor(@Param("id") String memberId, @Param("seq") long seq,
                          @Param("messageId") String messageId, @Param("at") java.time.LocalDateTime at);

    @Query("SELECT m.userId FROM ChatConversationMember m WHERE m.conversationId = :cid AND m.isActive = true")
    List<String> findActiveMemberIds(@Param("cid") String conversationId);

    /**
     * Active, unmuted members who have not read message {@code seq} and whose read cursor is at or after
     * {@code minReadSeq}. Pass -1 for no lower bound (push every unread message); pass seq - 1 to reach only
     * members who were caught up before this message, so each gets one push until they read.
     */
    @Query("SELECT m.userId FROM ChatConversationMember m WHERE m.conversationId = :cid AND m.isActive = true "
            + "AND (m.muted IS NULL OR m.muted = false) AND m.lastReadSeq < :seq AND m.lastReadSeq >= :minReadSeq")
    List<String> findMemberIdsToNotify(@Param("cid") String conversationId, @Param("seq") Long seq,
                                       @Param("minReadSeq") Long minReadSeq);

    /**
     * Total unread across the caller's conversations in one institute, using the same arithmetic as the
     * conversation list (per conversation: last_message_seq - last_read_seq, capped). Backs the unread badge
     * so clients need not poll the full conversation list.
     */
    @Query(value = "SELECT CAST(COALESCE(SUM(LEAST(:cap, GREATEST(0, c.last_message_seq - m.last_read_seq))), 0) AS BIGINT) "
            + "FROM chat_conversation_members m JOIN chat_conversations c ON c.id = m.conversation_id "
            + "WHERE m.user_id = :uid AND m.is_active = true AND c.institute_id = :iid "
            + "AND (:includeCommunity = true OR c.type <> 'COMMUNITY')", nativeQuery = true)
    Long sumUnread(@Param("uid") String userId, @Param("iid") String instituteId,
                   @Param("includeCommunity") boolean includeCommunity, @Param("cap") long cap);
}
