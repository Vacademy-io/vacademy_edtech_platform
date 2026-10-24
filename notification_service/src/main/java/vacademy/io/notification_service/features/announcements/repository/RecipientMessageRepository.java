package vacademy.io.notification_service.features.announcements.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.notification_service.features.announcements.entity.RecipientMessage;
import vacademy.io.notification_service.features.announcements.enums.MediumType;
import vacademy.io.notification_service.features.announcements.enums.MessageStatus;
import vacademy.io.notification_service.features.announcements.enums.ModeType;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface RecipientMessageRepository extends JpaRepository<RecipientMessage, String> {
    
    Page<RecipientMessage> findByUserIdOrderByCreatedAtDesc(String userId, Pageable pageable);
    
    Page<RecipientMessage> findByUserIdAndModeTypeOrderByCreatedAtDesc(String userId, ModeType modeType, Pageable pageable);
    
    List<RecipientMessage> findByAnnouncementId(String announcementId);

    Page<RecipientMessage> findByAnnouncementIdOrderByCreatedAtDesc(String announcementId, Pageable pageable);

    Page<RecipientMessage> findByAnnouncementIdAndModeTypeOrderByCreatedAtDesc(String announcementId, ModeType modeType, Pageable pageable);
    
    List<RecipientMessage> findByAnnouncementIdAndStatus(String announcementId, MessageStatus status);
    
    List<RecipientMessage> findByUserIdAndStatus(String userId, MessageStatus status);
    
    @Query("SELECT rm FROM RecipientMessage rm WHERE rm.userId = :userId AND rm.modeType = :modeType AND NOT EXISTS (SELECT mi FROM MessageInteraction mi WHERE mi.recipientMessageId = rm.id AND mi.interactionType = 'READ')")
    List<RecipientMessage> findUnreadMessagesByUserAndMode(@Param("userId") String userId, @Param("modeType") ModeType modeType);
    
    @Query("SELECT COUNT(rm) FROM RecipientMessage rm WHERE rm.userId = :userId AND rm.modeType = :modeType AND NOT EXISTS (SELECT mi FROM MessageInteraction mi WHERE mi.recipientMessageId = rm.id AND mi.interactionType = 'READ')")
    long countUnreadMessagesByUserAndMode(@Param("userId") String userId, @Param("modeType") ModeType modeType);
    
    List<RecipientMessage> findByUserIdAndMediumTypeAndStatus(String userId, MediumType mediumType, MessageStatus status);
    
    long countByAnnouncementId(String announcementId);
    
    long countByAnnouncementIdAndStatus(String announcementId, MessageStatus status);
    
    long countByAnnouncementIdAndMediumType(String announcementId, MediumType mediumType);
    
    /**
     * Next batch of a delivery, keyset-paged by id: pass the last id of the previous batch ("" for the first).
     *
     * <p>Do not page this by page number. Every batch moves its rows out of the status being queried, so
     * page N+1 of the shrinking set skips a whole page of rows: a 3,113-recipient email sent 1,613 and left
     * 1,500 PENDING. Keyset paging also stops rows that go back to PENDING (throttled sends) from being
     * picked up again in the same run.
     */
    List<RecipientMessage> findByAnnouncementIdAndStatusAndMediumTypeAndIdGreaterThanOrderByIdAsc(
        String announcementId,
        MessageStatus status,
        MediumType mediumType,
        String afterId,
        Pageable pageable
    );
    
    // Recovery/restart queries
    
    /**
     * Find messages by status created after a certain date (for auto-recovery)
     */
    List<RecipientMessage> findByStatusAndCreatedAtAfter(MessageStatus status, LocalDateTime createdAfter);
    
    /**
     * Find stuck SENT messages (sent before cutoff but not delivered)
     */
    @Query("SELECT rm FROM RecipientMessage rm WHERE rm.status = :status AND rm.sentAt < :cutoff AND rm.sentAt IS NOT NULL AND rm.deliveredAt IS NULL")
    List<RecipientMessage> findByStatusAndSentAtBefore(
        @Param("status") MessageStatus status,
        @Param("cutoff") LocalDateTime cutoff
    );
    
    /**
     * Find stuck SENT messages for a specific announcement
     */
    @Query("SELECT rm FROM RecipientMessage rm WHERE rm.announcementId = :announcementId AND rm.status = :status AND rm.sentAt < :cutoff AND rm.sentAt IS NOT NULL AND rm.deliveredAt IS NULL")
    List<RecipientMessage> findByAnnouncementIdAndStatusAndSentAtBefore(
        @Param("announcementId") String announcementId,
        @Param("status") MessageStatus status,
        @Param("cutoff") LocalDateTime cutoff
    );
    
    /**
     * Find stuck SENT messages created after a certain date (for auto-recovery)
     */
    @Query("SELECT rm FROM RecipientMessage rm WHERE rm.status = :status AND rm.sentAt < :sentCutoff AND rm.sentAt IS NOT NULL AND rm.deliveredAt IS NULL AND rm.createdAt > :createdAfter")
    List<RecipientMessage> findByStatusAndSentAtBeforeAndCreatedAtAfter(
        @Param("status") MessageStatus status,
        @Param("sentCutoff") LocalDateTime sentCutoff,
        @Param("createdAfter") LocalDateTime createdAfter
    );

    // Utility finder for SSE event filtering/routing
    List<RecipientMessage> findByAnnouncementIdAndUserId(String announcementId, String userId);

    /**
     * Distinct recipients of an announcement, as bare user ids.
     *
     * <p>SSE fan-out only ever needs the user ids, and a broadcast announcement can hold an order of
     * magnitude more rows than users (one row per delivery, not per user). Hydrating full entities
     * just to call {@code getUserId()} on them loaded 1116 rows to reach 93 users on the worst
     * announcement in prod, and then delivered the same event to each of those users 12 times.
     * Use this instead of {@link #findByAnnouncementId(String)} on any send path.
     */
    @Query("SELECT DISTINCT rm.userId FROM RecipientMessage rm WHERE rm.announcementId = :announcementId AND rm.userId IS NOT NULL")
    List<String> findDistinctUserIdsByAnnouncementId(@Param("announcementId") String announcementId);

    // Mode-specific queries with joins to mode-specific tables
    
    /**
     * Get resource messages with folder and category filtering
     */
    @Query("""
        SELECT rm FROM RecipientMessage rm 
        JOIN Announcement a ON rm.announcementId = a.id 
        JOIN AnnouncementResource ar ON ar.announcement.id = a.id 
        WHERE rm.userId = :userId 
          AND rm.modeType = 'RESOURCES' 
          AND ar.isActive = true
          AND (:folderName IS NULL OR ar.folderName = :folderName)
          AND (:category IS NULL OR ar.category = :category)
          AND NOT EXISTS (SELECT mi FROM MessageInteraction mi WHERE mi.recipientMessageId = rm.id AND mi.userId = :userId AND mi.interactionType = 'DISMISSED')
        ORDER BY rm.createdAt DESC
    """)
    Page<RecipientMessage> findResourceMessages(
            @Param("userId") String userId, 
            @Param("folderName") String folderName, 
            @Param("category") String category, 
            Pageable pageable);

    /**
     * Get community messages with type and tag filtering
     */
    @Query("""
        SELECT rm FROM RecipientMessage rm 
        JOIN Announcement a ON rm.announcementId = a.id 
        JOIN AnnouncementCommunity ac ON ac.announcement.id = a.id 
        WHERE rm.userId = :userId 
          AND rm.modeType = 'COMMUNITY' 
          AND ac.isActive = true
          AND (:communityType IS NULL OR ac.communityType = :communityType)
          AND (:tag IS NULL OR ac.tags LIKE CONCAT('%', :tag, '%'))
          AND NOT EXISTS (SELECT mi FROM MessageInteraction mi WHERE mi.recipientMessageId = rm.id AND mi.userId = :userId AND mi.interactionType = 'DISMISSED')
        ORDER BY rm.createdAt DESC
    """)
    Page<RecipientMessage> findCommunityMessages(
            @Param("userId") String userId, 
            @Param("communityType") vacademy.io.notification_service.features.announcements.enums.CommunityType communityType, 
            @Param("tag") String tag, 
            Pageable pageable);

    /**
     * Get active dashboard pins (not dismissed and within duration)
     */
    @Query("""
        SELECT rm FROM RecipientMessage rm 
        JOIN Announcement a ON rm.announcementId = a.id 
        JOIN AnnouncementDashboardPin adp ON adp.announcement.id = a.id 
        WHERE rm.userId = :userId 
          AND rm.modeType = 'DASHBOARD_PIN' 
          AND adp.isActive = true
          AND (adp.pinEndTime IS NULL OR adp.pinEndTime > CURRENT_TIMESTAMP)
          AND NOT EXISTS (SELECT mi FROM MessageInteraction mi WHERE mi.recipientMessageId = rm.id AND mi.userId = :userId AND mi.interactionType = 'DISMISSED')
        ORDER BY adp.priority DESC, rm.createdAt DESC
    """)
    List<RecipientMessage> findActiveDashboardPins(@Param("userId") String userId);

    /**
     * Get active app overlays (not dismissed, not expired). Dismiss-once semantics:
     * a DISMISSED interaction permanently hides the overlay for that user.
     */
    @Query("""
        SELECT rm FROM RecipientMessage rm
        JOIN Announcement a ON rm.announcementId = a.id
        JOIN AnnouncementAppOverlay aao ON aao.announcement.id = a.id
        WHERE rm.userId = :userId
          AND rm.modeType = 'APP_OVERLAY'
          AND aao.isActive = true
          AND (aao.showUntil IS NULL OR aao.showUntil > CURRENT_TIMESTAMP)
          AND NOT EXISTS (SELECT mi FROM MessageInteraction mi WHERE mi.recipientMessageId = rm.id AND mi.userId = :userId AND mi.interactionType = 'DISMISSED')
        ORDER BY aao.priority DESC, rm.createdAt DESC
    """)
    List<RecipientMessage> findActiveAppOverlays(@Param("userId") String userId);

    /**
     * Get stream messages with package session and stream type filtering
     */
    @Query("""
        SELECT rm FROM RecipientMessage rm 
        JOIN Announcement a ON rm.announcementId = a.id 
        JOIN AnnouncementStream ast ON ast.announcement.id = a.id 
        WHERE rm.userId = :userId 
          AND rm.modeType = 'STREAM' 
          AND ast.isActive = true
          AND (:packageSessionId IS NULL OR ast.packageSessionId = :packageSessionId)
          AND (:streamType IS NULL OR ast.streamType = :streamType)
          AND NOT EXISTS (SELECT mi FROM MessageInteraction mi WHERE mi.recipientMessageId = rm.id AND mi.userId = :userId AND mi.interactionType = 'DISMISSED')
        ORDER BY rm.createdAt DESC
    """)
    Page<RecipientMessage> findStreamMessages(
            @Param("userId") String userId, 
            @Param("packageSessionId") String packageSessionId, 
            @Param("streamType") vacademy.io.notification_service.features.announcements.enums.StreamType streamType, 
            Pageable pageable);

    /**
     * Get system alerts with priority filtering
     */
    @Query("""
        SELECT rm FROM RecipientMessage rm 
        JOIN Announcement a ON rm.announcementId = a.id 
        JOIN AnnouncementSystemAlert asa ON asa.announcement.id = a.id 
        WHERE rm.userId = :userId 
          AND rm.modeType = 'SYSTEM_ALERT' 
          AND asa.isActive = true
          AND (:priority IS NULL OR asa.priority = :priority)
          AND NOT EXISTS (SELECT mi FROM MessageInteraction mi WHERE mi.recipientMessageId = rm.id AND mi.userId = :userId AND mi.interactionType = 'DISMISSED')
        ORDER BY asa.priority DESC, rm.createdAt DESC
    """)
    Page<RecipientMessage> findSystemAlerts(
            @Param("userId") String userId, 
            @Param("priority") Integer priority, 
            Pageable pageable);

    /**
     * Get direct messages
     */
    @Query("""
        SELECT rm FROM RecipientMessage rm 
        JOIN Announcement a ON rm.announcementId = a.id 
        JOIN AnnouncementDM adm ON adm.announcement.id = a.id 
        WHERE rm.userId = :userId 
          AND rm.modeType = 'DM' 
          AND adm.isActive = true
          AND NOT EXISTS (SELECT mi FROM MessageInteraction mi WHERE mi.recipientMessageId = rm.id AND mi.userId = :userId AND mi.interactionType = 'DISMISSED')
        ORDER BY adm.messagePriority DESC, rm.createdAt DESC
    """)
    Page<RecipientMessage> findDirectMessages(@Param("userId") String userId, Pageable pageable);

    /**
     * Get task messages with filtering by status and slide ID
     */
    @Query(value = """
        SELECT rm.* FROM recipient_messages rm 
        JOIN announcements a ON rm.announcement_id = a.id 
        JOIN announcement_tasks at ON at.announcement_id = a.id 
        WHERE rm.user_id = ?1 
          AND rm.mode_type = 'TASKS' 
          AND at.is_active = true
          AND (?2 IS NULL OR at.status = ?2)
          AND (?3 IS NULL OR at.slide_ids::text LIKE CONCAT('%"', ?3, '"%'))
          AND NOT EXISTS (SELECT 1 FROM message_interactions mi WHERE mi.recipient_message_id = rm.id AND mi.user_id = ?1 AND mi.interaction_type = 'DISMISSED')
        ORDER BY at.deadline_datetime ASC, rm.created_at DESC
    """, nativeQuery = true)
    Page<RecipientMessage> findTaskMessages(String userId, String status, String slideId, Pageable pageable);

    /**
     * Get active task messages (status = LIVE and not overdue)
     */
    @Query("""
        SELECT rm FROM RecipientMessage rm 
        JOIN Announcement a ON rm.announcementId = a.id 
        JOIN AnnouncementTask at ON at.announcement.id = a.id 
        WHERE rm.userId = :userId 
          AND rm.modeType = 'TASKS' 
          AND at.isActive = true
          AND at.status = 'LIVE'
          AND at.deadlineDateTime > CURRENT_TIMESTAMP
          AND NOT EXISTS (SELECT mi FROM MessageInteraction mi WHERE mi.recipientMessageId = rm.id AND mi.userId = :userId AND mi.interactionType = 'DISMISSED')
        ORDER BY at.deadlineDateTime ASC, rm.createdAt DESC
    """)
    List<RecipientMessage> findActiveTaskMessages(@Param("userId") String userId);

    /**
     * Get overdue task messages (status = OVERDUE or LIVE but past deadline)
     */
    @Query("""
        SELECT rm FROM RecipientMessage rm 
        JOIN Announcement a ON rm.announcementId = a.id 
        JOIN AnnouncementTask at ON at.announcement.id = a.id 
        WHERE rm.userId = :userId 
          AND rm.modeType = 'TASKS' 
          AND at.isActive = true
          AND (at.status = 'OVERDUE' OR (at.status = 'LIVE' AND at.deadlineDateTime < CURRENT_TIMESTAMP))
          AND NOT EXISTS (SELECT mi FROM MessageInteraction mi WHERE mi.recipientMessageId = rm.id AND mi.userId = :userId AND mi.interactionType = 'DISMISSED')
        ORDER BY at.deadlineDateTime ASC, rm.createdAt DESC
    """)
    List<RecipientMessage> findOverdueTaskMessages(@Param("userId") String userId);
}