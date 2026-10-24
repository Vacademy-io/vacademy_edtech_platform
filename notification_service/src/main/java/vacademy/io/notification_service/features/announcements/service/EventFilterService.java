package vacademy.io.notification_service.features.announcements.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.announcements.dto.AnnouncementEvent;
import vacademy.io.notification_service.features.announcements.enums.EventType;
import vacademy.io.notification_service.features.announcements.repository.AnnouncementRecipientRepository;
import vacademy.io.notification_service.features.announcements.repository.RecipientMessageRepository;


/**
 * Service for filtering events based on user preferences, permissions, and business rules
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EventFilterService {
    
    private final AnnouncementRecipientRepository announcementRecipientRepository;
    private final RecipientMessageRepository recipientMessageRepository;
    
    /**
     * Determine if a user should receive a specific event
     */
    public boolean shouldReceiveEvent(String userId, AnnouncementEvent event) {
        return shouldReceiveEvent(userId, event, false);
    }

    /**
     * Determine if a user should receive a specific event.
     *
     * @param recipientVerified pass {@code true} when the caller derived this user id from the
     *   announcement's own recipient rows, so membership is already established. Every fan-out over
     *   such a list MUST pass {@code true}: the membership lookup is one query per user, so leaving
     *   it on turns a single broadcast into N round trips that re-read data the caller just loaded.
     *   Pass {@code false} for user ids that came from anywhere else (an API request body, say),
     *   where membership is still unproven. All other event-type filtering runs either way.
     */
    public boolean shouldReceiveEvent(String userId, AnnouncementEvent event, boolean recipientVerified) {
        try {
            // Basic validation
            if (userId == null || event == null || event.getType() == null) {
                return false;
            }
            
            // Always allow heartbeat events
            if (event.getType() == EventType.HEARTBEAT) {
                return true;
            }
            
            // Check if user is a recipient of the announcement
            if (!recipientVerified && event.getAnnouncementId() != null) {
                if (!isUserAnnouncementRecipient(userId, event.getAnnouncementId())) {
                    log.debug("User {} is not a recipient of announcement: {}", userId, event.getAnnouncementId());
                    return false;
                }
            }
            
            // Apply event-type specific filters
            switch (event.getType()) {
                case NEW_ANNOUNCEMENT:
                    return filterNewAnnouncement(userId, event);
                    
                case TASK_STATUS_CHANGED:
                case TASK_REMINDER:
                    return filterTaskEvent(userId, event);
                    
                case DASHBOARD_PIN_ADDED:
                case DASHBOARD_PIN_REMOVED:
                    return filterDashboardPinEvent(userId, event);
                    
                case SYSTEM_ALERT:
                    return filterSystemAlert(userId, event);
                    
                case MESSAGE_READ:
                case MESSAGE_DISMISSED:
                case MESSAGE_REPLY_ADDED:
                    return filterMessageInteraction(userId, event);
                    
                case ANNOUNCEMENT_UPDATED:
                case ANNOUNCEMENT_CANCELLED:
                    return filterAnnouncementUpdate(userId, event);
                    
                default:
                    // Allow unknown event types by default
                    return true;
            }
            
        } catch (Exception e) {
            log.error("Error filtering event for user: {}", userId, e);
            // In case of error, allow the event to prevent missing important notifications
            return true;
        }
    }
    
    /**
     * Check if user is a recipient of an announcement
     */
    private boolean isUserAnnouncementRecipient(String userId, String announcementId) {
        // Check via recipient messages, which are concrete deliveries per user
        return !recipientMessageRepository.findByAnnouncementIdAndUserId(announcementId, userId).isEmpty();
    }
    
    /**
     * Check if user has received a specific message
     */
    // Reserved for future use when needed
    private boolean hasUserReceivedMessage(String userId, String messageId) { return true; }
    
    /**
     * Filter new announcement events
     */
    private boolean filterNewAnnouncement(String userId, AnnouncementEvent event) {
        // User should receive new announcement if they are a recipient
        // This is already checked in the main method
        return true;
    }
    
    /**
     * Filter task-related events
     */
    private boolean filterTaskEvent(String userId, AnnouncementEvent event) {
        // Users should receive task events if they are recipients of the announcement
        // Additional filtering could be added based on task status, user role, etc.
        
        // For example, only send OVERDUE reminders to students, not teachers
        if (event.getType() == EventType.TASK_REMINDER) {
            // TODO: Add role-based filtering when user roles are available
            return true;
        }
        
        return true;
    }
    
    /**
     * Filter dashboard pin events
     */
    private boolean filterDashboardPinEvent(String userId, AnnouncementEvent event) {
        // Users should receive dashboard pin events if they are recipients
        return true;
    }
    
    /**
     * Filter system alert events
     */
    private boolean filterSystemAlert(String userId, AnnouncementEvent event) {
        // System alerts are typically broadcast to all users in an institute
        // Could add priority-based filtering here
        
        String priority = event.getPriority();
        if ("LOW".equals(priority)) {
            // Skip low priority alerts during certain hours
            // TODO: Add time-based filtering
        }
        
        return true;
    }
    
    /**
     * Filter message interaction events
     */
    private boolean filterMessageInteraction(String userId, AnnouncementEvent event) {
        // Users should only receive interaction events for messages they have access to
        
        // For read receipts, only the sender should be notified
        if (event.getType() == EventType.MESSAGE_READ) {
            // TODO: Check if user is the sender of the original message
            return true;
        }
        
        // For replies, all participants should be notified
        if (event.getType() == EventType.MESSAGE_REPLY_ADDED) {
            return true;
        }
        
        return true;
    }
    
    /**
     * Filter announcement update events
     */
    private boolean filterAnnouncementUpdate(String userId, AnnouncementEvent event) {
        // Users should receive update events for announcements they are recipients of
        return true;
    }
    
    /**
     * Check if user has specific permissions for event type
     */
    private boolean hasUserPermission(String userId, EventType eventType) { return true; }
    
    /**
     * Check if event should be filtered based on user preferences
     */
    private boolean matchesUserPreferences(String userId, AnnouncementEvent event) { return true; }
    
    /**
     * Check if event should be filtered based on time/schedule
     */
    private boolean matchesTimeFilter(String userId, AnnouncementEvent event) { return true; }
}
