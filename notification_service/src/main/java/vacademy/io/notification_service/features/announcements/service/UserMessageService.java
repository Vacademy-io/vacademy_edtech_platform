package vacademy.io.notification_service.features.announcements.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.announcements.dto.MessageInteractionRequest;
import vacademy.io.notification_service.features.announcements.enums.EventType;
import vacademy.io.notification_service.features.announcements.event.MessageInteractionEvent;
import vacademy.io.notification_service.features.announcements.dto.UserMessagesResponse;
import vacademy.io.notification_service.features.announcements.entity.*;
import vacademy.io.notification_service.features.announcements.enums.InteractionType;
import vacademy.io.notification_service.features.announcements.enums.ModeType;
import vacademy.io.notification_service.features.announcements.repository.*;
import vacademy.io.notification_service.features.announcements.client.AuthServiceClient;
import vacademy.io.common.auth.entity.User;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class UserMessageService {

    private final RecipientMessageRepository recipientMessageRepository;
    private final MessageInteractionRepository messageInteractionRepository;
    private final AnnouncementRepository announcementRepository;
    private final RichTextDataRepository richTextDataRepository;
    private final MessageReplyRepository messageReplyRepository;
    private final AuthServiceClient authServiceClient;
    private final AnnouncementEventService eventService;
    private final ApplicationEventPublisher eventPublisher;

    @Transactional(readOnly = true)
    public Page<UserMessagesResponse> getUserMessages(String userId, Pageable pageable) {
        return recipientMessageRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable)
                .map(this::mapToUserMessagesResponse);
    }

    @Transactional(readOnly = true)
    public Page<UserMessagesResponse> getUserMessagesByMode(String userId, ModeType modeType, Pageable pageable) {
        return recipientMessageRepository.findByUserIdAndModeTypeOrderByCreatedAtDesc(userId, modeType, pageable)
                .map(this::mapToUserMessagesResponse);
    }

    @Transactional(readOnly = true)
    public Long getUnreadCountByMode(String userId, ModeType modeType) {
        return recipientMessageRepository.countUnreadMessagesByUserAndMode(userId, modeType);
    }

    @Transactional(readOnly = true)
    public Map<String, Long> getUnreadCountsByMode(String userId) {
        Map<String, Long> counts = new HashMap<>();
        
        for (ModeType modeType : ModeType.values()) {
            Long count = recipientMessageRepository.countUnreadMessagesByUserAndMode(userId, modeType);
            counts.put(modeType.name().toLowerCase(), count);
        }
        
        return counts;
    }

    @Transactional
    public void markAsRead(String recipientMessageId, String userId) {
        // Check if already marked as read
        if (!messageInteractionRepository.existsByRecipientMessageIdAndUserIdAndInteractionType(
                recipientMessageId, userId, InteractionType.READ)) {
            
            MessageInteraction interaction = new MessageInteraction();
            interaction.setRecipientMessageId(recipientMessageId);
            interaction.setUserId(userId);
            interaction.setInteractionType(InteractionType.READ);
            interaction.setInteractionTime(LocalDateTime.now());
            
            messageInteractionRepository.save(interaction);
            log.debug("Marked message {} as read for user {}", recipientMessageId, userId);

            // Hand the receipt to MessageInteractionListener, which emits it AFTER this
            // transaction commits and off the request thread. Emitting inline meant the learner
            // waited on the whole SSE fan-out while holding a pooled DB connection.
            try {
                recipientMessageRepository.findById(recipientMessageId).ifPresent(rm ->
                        eventPublisher.publishEvent(new MessageInteractionEvent(
                                this, rm.getAnnouncementId(), recipientMessageId, userId,
                                EventType.MESSAGE_READ, rm.getModeType())));
            } catch (Exception e) {
                log.warn("Failed to publish MESSAGE_READ receipt for {}", recipientMessageId, e);
            }
        }
    }

    @Transactional
    public void dismissMessage(String recipientMessageId, String userId) {
        // Check if already dismissed
        if (!messageInteractionRepository.existsByRecipientMessageIdAndUserIdAndInteractionType(
                recipientMessageId, userId, InteractionType.DISMISSED)) {
            
            MessageInteraction interaction = new MessageInteraction();
            interaction.setRecipientMessageId(recipientMessageId);
            interaction.setUserId(userId);
            interaction.setInteractionType(InteractionType.DISMISSED);
            interaction.setInteractionTime(LocalDateTime.now());
            
            messageInteractionRepository.save(interaction);
            log.debug("Dismissed message {} for user {}", recipientMessageId, userId);

            // Same after-commit hand-off as markAsRead above.
            try {
                recipientMessageRepository.findById(recipientMessageId).ifPresent(rm ->
                        eventPublisher.publishEvent(new MessageInteractionEvent(
                                this, rm.getAnnouncementId(), recipientMessageId, userId,
                                EventType.MESSAGE_DISMISSED, rm.getModeType())));
            } catch (Exception e) {
                log.warn("Failed to publish MESSAGE_DISMISSED receipt for {}", recipientMessageId, e);
            }
        }
    }

    @Transactional
    public void recordInteraction(MessageInteractionRequest request) {
        MessageInteraction interaction = new MessageInteraction();
        interaction.setRecipientMessageId(request.getRecipientMessageId());
        interaction.setUserId(request.getUserId());
        interaction.setInteractionType(request.getInteractionType());
        interaction.setInteractionTime(LocalDateTime.now());
        interaction.setAdditionalData(request.getAdditionalData());
        
        messageInteractionRepository.save(interaction);
        log.debug("Recorded interaction {} for message {} by user {}", 
                request.getInteractionType(), request.getRecipientMessageId(), request.getUserId());
    }

    // Mode-specific methods using the enhanced repository queries
    
    @Transactional(readOnly = true)
    public Page<UserMessagesResponse> getResourceMessages(String userId, String folderName, String category, Pageable pageable) {
        log.debug("Getting resource messages for user: {} with folderName: {}, category: {}", userId, folderName, category);
        return recipientMessageRepository.findResourceMessages(userId, folderName, category, pageable)
                .map(this::mapToUserMessagesResponse);
    }

    @Transactional(readOnly = true)
    public Page<UserMessagesResponse> getCommunityMessages(String userId, String communityType, String tag, Pageable pageable) {
        log.debug("Getting community messages for user: {} with communityType: {}, tag: {}", userId, communityType, tag);
        vacademy.io.notification_service.features.announcements.enums.CommunityType enumType = null;
        if (communityType != null && !communityType.isBlank()) {
            try {
                enumType = vacademy.io.notification_service.features.announcements.enums.CommunityType.valueOf(communityType.toUpperCase());
            } catch (IllegalArgumentException ex) {
                log.warn("Invalid communityType provided: {}. Ignoring filter.", communityType);
            }
        }
        return recipientMessageRepository.findCommunityMessages(userId, enumType, tag, pageable)
                .map(this::mapToUserMessagesResponse);
    }

    @Transactional(readOnly = true)
    public Page<UserMessagesResponse> getTaskMessages(String userId, String status, String slideId, Pageable pageable) {
        log.debug("Getting task messages for user: {} with status: {}, slideId: {}", userId, status, slideId);
        return recipientMessageRepository.findTaskMessages(userId, status, slideId, pageable)
                .map(this::mapToUserMessagesResponse);
    }

    @Transactional(readOnly = true)
    public List<UserMessagesResponse> getActiveTaskMessages(String userId) {
        log.debug("Getting active task messages for user: {}", userId);
        return recipientMessageRepository.findActiveTaskMessages(userId)
                .stream()
                .map(this::mapToUserMessagesResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<UserMessagesResponse> getOverdueTaskMessages(String userId) {
        log.debug("Getting overdue task messages for user: {}", userId);
        return recipientMessageRepository.findOverdueTaskMessages(userId)
                .stream()
                .map(this::mapToUserMessagesResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<UserMessagesResponse> getActiveDashboardPins(String userId) {
        log.debug("Getting active dashboard pins for user: {}", userId);
        return recipientMessageRepository.findActiveDashboardPins(userId)
                .stream()
                .map(this::mapToUserMessagesResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<UserMessagesResponse> getActiveAppOverlays(String userId) {
        log.debug("Getting active app overlays for user: {}", userId);
        return recipientMessageRepository.findActiveAppOverlays(userId)
                .stream()
                .map(this::mapToUserMessagesResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public Page<UserMessagesResponse> getStreamMessages(String userId, String packageSessionId, String streamType, Pageable pageable) {
        log.debug("Getting stream messages for user: {} with packageSessionId: {}, streamType: {}", userId, packageSessionId, streamType);
        vacademy.io.notification_service.features.announcements.enums.StreamType enumType = null;
        if (streamType != null && !streamType.isBlank()) {
            try {
                enumType = vacademy.io.notification_service.features.announcements.enums.StreamType.valueOf(streamType.toUpperCase());
            } catch (IllegalArgumentException ex) {
                log.warn("Invalid streamType provided: {}. Ignoring filter.", streamType);
            }
        }
        return recipientMessageRepository.findStreamMessages(userId, packageSessionId, enumType, pageable)
                .map(this::mapToUserMessagesResponse);
    }

    @Transactional(readOnly = true)
    public Page<UserMessagesResponse> getSystemAlerts(String userId, String priority, Pageable pageable) {
        log.debug("Getting system alerts for user: {} with priority: {}", userId, priority);
        Integer intPriority = null;
        if (priority != null && !priority.isBlank()) {
            try {
                intPriority = Integer.valueOf(priority);
            } catch (NumberFormatException ex) {
                log.warn("Invalid priority provided: {}. Ignoring filter.", priority);
            }
        }
        return recipientMessageRepository.findSystemAlerts(userId, intPriority, pageable)
                .map(this::mapToUserMessagesResponse);
    }

    @Transactional(readOnly = true)
    public Page<UserMessagesResponse> getDirectMessages(String userId, Pageable pageable) {
        log.debug("Getting direct messages for user: {}", userId);
        return recipientMessageRepository.findDirectMessages(userId, pageable)
                .map(this::mapToUserMessagesResponse);
    }

    // Helper method to map entity to response DTO
    private UserMessagesResponse mapToUserMessagesResponse(RecipientMessage message) {
        UserMessagesResponse response = new UserMessagesResponse();
        response.setMessageId(message.getId());
        response.setAnnouncementId(message.getAnnouncementId());
        response.setModeType(message.getModeType());
        response.setStatus(message.getStatus());
        response.setCreatedAt(message.getCreatedAt());
        response.setDeliveredAt(message.getDeliveredAt());
        
        // Check if message is read
        boolean isRead = messageInteractionRepository.existsByRecipientMessageIdAndUserIdAndInteractionType(
                message.getId(), message.getUserId(), InteractionType.READ);
        response.setIsRead(isRead);
        
        // Check if message is dismissed
        boolean isDismissed = messageInteractionRepository.existsByRecipientMessageIdAndUserIdAndInteractionType(
                message.getId(), message.getUserId(), InteractionType.DISMISSED);
        response.setIsDismissed(isDismissed);
        
        // Get interaction time (latest interaction)
        messageInteractionRepository.findByRecipientMessageId(message.getId())
                .stream()
                .max((i1, i2) -> i1.getInteractionTime().compareTo(i2.getInteractionTime()))
                .ifPresent(interaction -> response.setInteractionTime(interaction.getInteractionTime()));
        
        // Load announcement details
        try {
            announcementRepository.findById(message.getAnnouncementId()).ifPresent(announcement -> {
                response.setTitle(announcement.getTitle());
                response.setCreatedBy(announcement.getCreatedBy());
                
                // Load rich text content
                if (announcement.getRichTextId() != null) {
                    richTextDataRepository.findById(announcement.getRichTextId()).ifPresent(richTextData -> {
                        UserMessagesResponse.RichTextDataResponse contentResponse = new UserMessagesResponse.RichTextDataResponse();
                        contentResponse.setId(richTextData.getId());
                        contentResponse.setType(richTextData.getType());
                        contentResponse.setContent(richTextData.getContent());
                        response.setContent(contentResponse);
                    });
                }
                
                // Use stored creator details from announcement
                response.setCreatedByName(announcement.getCreatedByName());
                response.setCreatedByRole(announcement.getCreatedByRole());
                
                // Fallback to auth service if createdByName is not stored
                if (response.getCreatedByName() == null || response.getCreatedByName().trim().isEmpty()) {
                    try {
                        List<User> users = authServiceClient.getUsersByIds(List.of(announcement.getCreatedBy()));
                        if (!users.isEmpty()) {
                            User creator = users.get(0);
                            response.setCreatedByName(creator.getFullName());
                        }
                    } catch (Exception e) {
                        log.warn("Failed to load creator details for announcement: {}", announcement.getId(), e);
                    }
                }
            });
        } catch (Exception e) {
            log.warn("Failed to load announcement details for message: {}", message.getId(), e);
        }
        
        // Load replies count for community/DM modes
        if (message.getModeType() == ModeType.COMMUNITY || message.getModeType() == ModeType.DM) {
            try {
                long repliesCount = messageReplyRepository.countByAnnouncementIdAndIsActive(message.getAnnouncementId(), true);
                response.setRepliesCount(repliesCount);
                
                // Load recent replies (top 3)
                List<MessageReply> recentReplies = messageReplyRepository.findTop3ByAnnouncementIdOrderByCreatedAtDesc(message.getAnnouncementId());
                List<UserMessagesResponse.MessageReplyResponse> replyResponses = recentReplies.stream()
                        .map(this::mapToMessageReplyResponse)
                        .toList();
                response.setRecentReplies(replyResponses);
                
            } catch (Exception e) {
                log.warn("Failed to load replies for message: {}", message.getId(), e);
            }
        }
        
        return response;
    }
    
    private UserMessagesResponse.MessageReplyResponse mapToMessageReplyResponse(MessageReply reply) {
        UserMessagesResponse.MessageReplyResponse response = new UserMessagesResponse.MessageReplyResponse();
        response.setId(reply.getId());
        response.setUserId(reply.getUserId());
        response.setCreatedAt(reply.getCreatedAt());
        
        // Load reply content
        if (reply.getRichTextId() != null) {
            richTextDataRepository.findById(reply.getRichTextId()).ifPresent(richTextData -> {
                UserMessagesResponse.RichTextDataResponse contentResponse = new UserMessagesResponse.RichTextDataResponse();
                contentResponse.setId(richTextData.getId());
                contentResponse.setType(richTextData.getType());
                contentResponse.setContent(richTextData.getContent());
                response.setContent(contentResponse);
            });
        }
        
        // Load user details
        try {
            List<User> users = authServiceClient.getUsersByIds(List.of(reply.getUserId()));
            if (!users.isEmpty()) {
                User user = users.get(0);
                response.setUserName(user.getFullName());
            }
        } catch (Exception e) {
            log.warn("Failed to load user details for reply: {}", reply.getId(), e);
        }
        
        // Count child replies
        long childRepliesCount = messageReplyRepository.countByParentMessageIdAndIsActive(reply.getId(), true);
        response.setChildRepliesCount(childRepliesCount);
        
        return response;
    }
}