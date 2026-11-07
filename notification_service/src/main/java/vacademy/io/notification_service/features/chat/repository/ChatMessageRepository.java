package vacademy.io.notification_service.features.chat.repository;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.notification_service.features.chat.entity.ChatMessage;

import java.util.List;
import java.util.Optional;

@Repository
public interface ChatMessageRepository extends JpaRepository<ChatMessage, String> {

    /** Newest live (non-deleted) message before {@code seq} — the previous message a reader could have seen. */
    java.util.Optional<ChatMessage> findFirstByConversationIdAndSeqLessThanAndIsDeletedFalseOrderBySeqDesc(String conversationId, Long seq);

    /** Whether any live (non-deleted) message comes after {@code seq}. */
    boolean existsByConversationIdAndSeqGreaterThanAndIsDeletedFalse(String conversationId, Long seq);


    // Latest page (newest first)
    List<ChatMessage> findByConversationIdAndIsDeletedFalseOrderBySeqDesc(String conversationId, Pageable pageable);

    // Older page (keyset before a seq)
    List<ChatMessage> findByConversationIdAndSeqLessThanAndIsDeletedFalseOrderBySeqDesc(
            String conversationId, Long beforeSeq, Pageable pageable);

    // Catch-up after a seq (oldest first)
    List<ChatMessage> findByConversationIdAndSeqGreaterThanAndIsDeletedFalseOrderBySeqAsc(
            String conversationId, Long sinceSeq, Pageable pageable);

    long countByConversationIdAndSeqGreaterThanAndIsDeletedFalse(String conversationId, Long lastReadSeq);

    Optional<ChatMessage> findFirstByConversationIdAndSenderIdAndIsDeletedFalseOrderBySeqDesc(
            String conversationId, String senderId);

    Optional<ChatMessage> findByConversationIdAndSenderIdAndClientDedupKey(
            String conversationId, String senderId, String clientDedupKey);
}
