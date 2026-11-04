package vacademy.io.notification_service.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.dto.SesEventDTO;
import vacademy.io.notification_service.features.bounced_emails.service.BouncedEmailService;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class EmailEventService {

    private final NotificationLogRepository notificationLogRepository;
    private final BouncedEmailService bouncedEmailService;

    public void processEmailEvent(SesEventDTO sesEvent) {
        try {
            if (sesEvent == null) {
                log.error("SES event is null, skipping processing");
                return;
            }

            String eventType = sesEvent.getEventType();
            String messageId = sesEvent.getMail() != null ? sesEvent.getMail().getMessageId() : "unknown";
            
            // Reduced logging: Changed from INFO to DEBUG to prevent log flooding
            // With high-volume email sending (150K+ emails), INFO logs can overwhelm the system
            log.debug("Processing SES event: {} for message: {}", eventType, messageId);

            String recipient = getRecipientFromEvent(sesEvent);
            String timestamp = getTimestampFromEvent(sesEvent);
            
            // Process all SES events (back to original working behavior)
            
            // Find original notification log ID: the message's own tag says, else guess
            String originalLogId = findTaggedNotificationLogId(sesEvent);
            if (originalLogId == null) {
                originalLogId = findOriginalNotificationLogId(recipient, timestamp);
            }
            log.debug("Original log ID found: {} for recipient: {}", originalLogId, recipient);
            
            // Use atomic operation to prevent race conditions
            if (!createEventAtomically(originalLogId, eventType, messageId, recipient, timestamp, sesEvent)) {
                log.debug("Event already exists or failed to create atomically: {} for source: {} message: {}", 
                    eventType, originalLogId, messageId);
                return;
            }
            
            log.debug("Successfully saved SES event to database: {} for message: {} to recipient: {} with source: {}", 
                eventType, messageId, recipient, originalLogId);
            
            // Handle bounce events - add email to blocklist
            if (isBounceEvent(eventType)) {
                handleBounceEvent(sesEvent, recipient, messageId, originalLogId);
            }
            
            // Handle complaint events - also add to blocklist (user marked as spam)
            if (isComplaintEvent(eventType)) {
                handleComplaintEvent(sesEvent, recipient, messageId, originalLogId);
            }
            
        } catch (Exception e) {
            log.error("Error processing SES event: {} - Error: {}", 
                sesEvent != null ? sesEvent.getEventType() : "unknown", e.getMessage(), e);
        }
    }

    /**
     * Check if the event type is a bounce event
     */
    private boolean isBounceEvent(String eventType) {
        return eventType != null && eventType.equalsIgnoreCase("bounce");
    }

    /**
     * Check if the event type is a complaint event
     */
    private boolean isComplaintEvent(String eventType) {
        return eventType != null && eventType.equalsIgnoreCase("complaint");
    }

    /**
     * Handle bounce event - extract bounce details and add email to blocklist
     */
    private void handleBounceEvent(SesEventDTO sesEvent, String recipient, String messageId, String originalLogId) {
        try {
            if (recipient == null || recipient.equals("unknown") || recipient.trim().isEmpty()) {
                log.warn("Cannot add to blocklist - invalid recipient from bounce event");
                return;
            }

            SesEventDTO.BounceDTO bounce = sesEvent.getBounce();
            String bounceType = bounce != null ? bounce.getBounceType() : "Unknown";
            String bounceSubType = bounce != null ? bounce.getBounceSubType() : "Unknown";
            
            // Build bounce reason from diagnostic codes if available
            String bounceReason = buildBounceReason(bounce);

            log.info("Processing bounce event for email: {} (type: {}/{}) - Adding to blocklist", 
                recipient, bounceType, bounceSubType);

            bouncedEmailService.addBouncedEmail(
                recipient,
                bounceType,
                bounceSubType,
                bounceReason,
                messageId,
                originalLogId
            );

            log.info("Successfully added bounced email to blocklist: {}", recipient);

        } catch (Exception e) {
            log.error("Error handling bounce event for recipient {}: {}", recipient, e.getMessage(), e);
        }
    }

    /**
     * Handle complaint event - user marked email as spam, add to blocklist
     */
    private void handleComplaintEvent(SesEventDTO sesEvent, String recipient, String messageId, String originalLogId) {
        try {
            if (recipient == null || recipient.equals("unknown") || recipient.trim().isEmpty()) {
                log.warn("Cannot add to blocklist - invalid recipient from complaint event");
                return;
            }

            SesEventDTO.ComplaintDTO complaint = sesEvent.getComplaint();
            String complaintType = complaint != null ? complaint.getComplaintFeedbackType() : "Unknown";

            log.info("Processing complaint event for email: {} (type: {}) - Adding to blocklist", 
                recipient, complaintType);

            // Treat complaints as a special type of bounce
            bouncedEmailService.addBouncedEmail(
                recipient,
                "Complaint",
                complaintType,
                "User marked email as spam",
                messageId,
                originalLogId
            );

            log.info("Successfully added complained email to blocklist: {}", recipient);

        } catch (Exception e) {
            log.error("Error handling complaint event for recipient {}: {}", recipient, e.getMessage(), e);
        }
    }

    /**
     * Build a detailed bounce reason from the bounce DTO
     */
    private String buildBounceReason(SesEventDTO.BounceDTO bounce) {
        if (bounce == null) {
            return "No bounce details available";
        }

        StringBuilder reason = new StringBuilder();
        reason.append("Bounce Type: ").append(bounce.getBounceType());
        reason.append(", SubType: ").append(bounce.getBounceSubType());

        if (bounce.getBouncedRecipients() != null && bounce.getBouncedRecipients().length > 0) {
            SesEventDTO.BouncedRecipientDTO firstRecipient = bounce.getBouncedRecipients()[0];
            if (firstRecipient.getDiagnosticCode() != null) {
                reason.append(", Diagnostic: ").append(firstRecipient.getDiagnosticCode());
            }
            if (firstRecipient.getStatus() != null) {
                reason.append(", Status: ").append(firstRecipient.getStatus());
            }
            if (firstRecipient.getAction() != null) {
                reason.append(", Action: ").append(firstRecipient.getAction());
            }
        }

        return reason.toString();
    }

    private String getRecipientFromEvent(SesEventDTO sesEvent) {
        if (sesEvent.getMail() != null && sesEvent.getMail().getCommonHeaders() != null) {
            String[] to = sesEvent.getMail().getCommonHeaders().getTo();
            if (to != null && to.length > 0) {
                return to[0];
            }
        }
        return "unknown";
    }

    private String getTimestampFromEvent(SesEventDTO sesEvent) {
        String timestamp = null;
        
        // Handle case-insensitive event types (SES can send "Send", "Delivery", etc. with capital letters)
        String eventType = sesEvent.getEventType() != null ? sesEvent.getEventType().toLowerCase() : null;
        
        switch (eventType) {
            case "send":
                if (sesEvent.getSend() != null) {
                    timestamp = sesEvent.getSend().getTimestamp();
                }
                break;
            case "delivery":
                if (sesEvent.getDelivery() != null) {
                    timestamp = sesEvent.getDelivery().getTimestamp();
                }
                break;
            case "bounce":
                if (sesEvent.getBounce() != null) {
                    timestamp = sesEvent.getBounce().getTimestamp();
                }
                break;
            case "complaint":
                if (sesEvent.getComplaint() != null) {
                    timestamp = sesEvent.getComplaint().getTimestamp();
                }
                break;
            case "open":
                if (sesEvent.getOpen() != null) {
                    timestamp = sesEvent.getOpen().getTimestamp();
                }
                break;
            case "click":
                if (sesEvent.getClick() != null) {
                    timestamp = sesEvent.getClick().getTimestamp();
                }
                break;
            case "reject":
                // Reject event might not have specific timestamp object, use mail timestamp
                if (sesEvent.getMail() != null) {
                    timestamp = sesEvent.getMail().getTimestamp();
                }
                break;
            default:
                // Changed from WARN to DEBUG to prevent log flooding for unexpected event types
                log.debug("Unknown SES event type: {}", sesEvent.getEventType());
                break;
        }
        
        return timestamp != null ? timestamp : Instant.now().toString();
    }

    private NotificationLog createEmailEventLog(String eventType, String messageId, String recipient, 
                                              String timestamp, SesEventDTO sesEvent, String originalLogId) {
        NotificationLog notificationLog = new NotificationLog();
        notificationLog.setId(UUID.randomUUID().toString());
        notificationLog.setNotificationType("EMAIL_EVENT");
        notificationLog.setChannelId(recipient);
        notificationLog.setSource(originalLogId != null ? originalLogId : "SES"); // Use original log ID as source
        notificationLog.setSourceId(messageId);
        notificationLog.setUserId(recipient); // Using recipient as userId for email events
        
        // Create detailed body with event information
        String eventDetails = createEventDetailsBody(eventType, sesEvent);
        notificationLog.setBody(eventDetails);
        
        // Parse SES timestamp as a UTC Instant; storage and downstream display are zone-agnostic.
        try {
            if (timestamp.endsWith("Z")) {
                notificationLog.setNotificationDate(Instant.parse(timestamp));
            } else {
                // Naive ISO without zone — SES rarely emits this, but treat it as UTC for safety.
                notificationLog.setNotificationDate(
                        LocalDateTime.parse(timestamp, DateTimeFormatter.ISO_DATE_TIME).toInstant(ZoneOffset.UTC));
            }
        } catch (Exception e) {
            log.warn("Could not parse SES timestamp '{}', using current time", timestamp);
            notificationLog.setNotificationDate(Instant.now());
        }
        
        return notificationLog;
    }

    private String createEventDetailsBody(String eventType, SesEventDTO sesEvent) {
        StringBuilder body = new StringBuilder();
        body.append("Email Event: ").append(eventType.toUpperCase()).append("\n");
        body.append("Message ID: ").append(sesEvent.getMail() != null ? sesEvent.getMail().getMessageId() : "unknown").append("\n");
        
        if (sesEvent.getMail() != null && sesEvent.getMail().getCommonHeaders() != null) {
            SesEventDTO.CommonHeadersDTO headers = sesEvent.getMail().getCommonHeaders();
            body.append("Subject: ").append(headers.getSubject() != null ? headers.getSubject() : "N/A").append("\n");
            
            if (headers.getFrom() != null && headers.getFrom().length > 0) {
                body.append("From: ").append(String.join(", ", headers.getFrom())).append("\n");
            }
            
            if (headers.getTo() != null && headers.getTo().length > 0) {
                body.append("To: ").append(String.join(", ", headers.getTo())).append("\n");
            }
        }
        
        // Add event-specific details (case-insensitive matching)
        String eventTypeLower = eventType != null ? eventType.toLowerCase() : null;
        switch (eventTypeLower) {
            case "send":
                // Send event - email accepted by SES
                body.append("Status: Email accepted by SES for sending\n");
                break;
            case "reject":
                // Reject event - email rejected by SES (e.g., invalid recipient, suppression list)
                body.append("Status: Email rejected by SES\n");
                // Note: SES reject event structure might vary, add more fields as needed
                break;
            case "delivery":
                if (sesEvent.getDelivery() != null) {
                    body.append("Processing Time: ").append(sesEvent.getDelivery().getProcessingTimeMillis()).append("ms\n");
                    body.append("SMTP Response: ").append(sesEvent.getDelivery().getSmtpResponse()).append("\n");
                }
                break;
            case "bounce":
                if (sesEvent.getBounce() != null) {
                    body.append("Bounce Type: ").append(sesEvent.getBounce().getBounceType()).append("\n");
                    body.append("Bounce SubType: ").append(sesEvent.getBounce().getBounceSubType()).append("\n");
                }
                break;
            case "complaint":
                if (sesEvent.getComplaint() != null) {
                    body.append("Complaint Type: ").append(sesEvent.getComplaint().getComplaintFeedbackType()).append("\n");
                }
                break;
            case "open":
                if (sesEvent.getOpen() != null) {
                    body.append("IP Address: ").append(sesEvent.getOpen().getIpAddress()).append("\n");
                    body.append("User Agent: ").append(sesEvent.getOpen().getUserAgent()).append("\n");
                }
                break;
            case "click":
                if (sesEvent.getClick() != null) {
                    body.append("IP Address: ").append(sesEvent.getClick().getIpAddress()).append("\n");
                    body.append("User Agent: ").append(sesEvent.getClick().getUserAgent()).append("\n");
                    body.append("Link: ").append(sesEvent.getClick().getLink()).append("\n");
                }
                break;
        }
        
        return body.toString();
    }
    
    /**
     * Atomically create an event, preventing race conditions
     * Uses synchronized method and database-level checking to ensure only one event per type per message
     */
    @Transactional
    public synchronized boolean createEventAtomically(String originalLogId, String eventType, String messageId, 
                                       String recipient, String timestamp, SesEventDTO sesEvent) {
        if (originalLogId == null) {
            log.warn("Cannot create event - originalLogId is null for event: {} message: {}", eventType, messageId);
            return false; // Can't create without original log ID
        }
        
        try {
            // Double-check pattern: Check again within synchronized method
            if (isDuplicateEvent(originalLogId, eventType, messageId)) {
                log.debug("Event already exists (double-check): {} for source: {} message: {} - SKIPPING", 
                    eventType, originalLogId, messageId);
                return false; // Event already exists
            }
            
            log.debug("Creating new event: {} for source: {} message: {} recipient: {}", 
                eventType, originalLogId, messageId, recipient);
            
            // Create the event log
            NotificationLog eventLog = createEmailEventLog(eventType, messageId, recipient, timestamp, sesEvent, originalLogId);

            // Inherit institute_id from the parent EMAIL log so the Hub can scope this event row too.
            if (originalLogId != null) {
                notificationLogRepository.findById(originalLogId)
                        .ifPresent(parent -> eventLog.setInstituteId(parent.getInstituteId()));
            }

            // Save with transaction
            notificationLogRepository.save(eventLog);
            
            log.debug("Successfully created event atomically: {} for source: {} message: {} with ID: {}", 
                eventType, originalLogId, messageId, eventLog.getId());
            return true;
            
        } catch (Exception e) {
            log.error("Error creating event atomically: {} for source: {} message: {}", 
                eventType, originalLogId, messageId, e);
            return false;
        }
    }
    
    /**
     * Check if an event already exists for the same source and event type
     * Prevents duplicate events of the same type for the same email (source)
     */
    private boolean isDuplicateEvent(String originalLogId, String eventType, String messageId) {
        if (originalLogId == null) {
            return false; // Can't check duplicates without original log ID
        }
        
        try {
            // Find all events for this source (original email log ID)
            List<NotificationLog> existingEvents = notificationLogRepository
                .findBySourceAndNotificationType(originalLogId, "EMAIL_EVENT");
            
            log.debug("Checking for duplicates: {} events found for source: {} eventType: {}", 
                existingEvents.size(), originalLogId, eventType);
            
            // Check if we already have this exact event type for this source (not message ID)
            for (NotificationLog existingEvent : existingEvents) {
                String existingBody = existingEvent.getBody();
                
                if (existingBody != null) {
                    // Check the first line after "Email Event: " for exact match
                    String[] lines = existingBody.split("\n");
                    if (lines.length > 0) {
                        String firstLine = lines[0].trim();
                        if (firstLine.equals("Email Event: " + eventType.toUpperCase())) {
                            log.debug("Duplicate event found: {} for source {} (existing event ID: {}) - SKIPPING", 
                                eventType, originalLogId, existingEvent.getId());
                            return true; // True duplicate found
                        }
                    }
                }
            }
            
            log.debug("No duplicate found for event: {} source: {}", eventType, originalLogId);
            return false;
        } catch (Exception e) {
            log.error("Error checking for duplicate event: {}", e.getMessage(), e);
            return false; // Allow processing on error
        }
    }
    
    /**
     * The EMAIL row of this event's message, from the tag EmailService put on it. Null for a message
     * without the tag (OTP mail, anything sent before the tag existed) or whose row isn't saved yet;
     * those are left to the recipient-and-time guess, which picks the latest email to that address
     * and so loses a later event of an earlier email.
     */
    private String findTaggedNotificationLogId(SesEventDTO sesEvent) {
        Map<String, String[]> tags = sesEvent.getMail() != null ? sesEvent.getMail().getTags() : null;
        String[] ref = tags != null ? tags.get(EmailService.SES_TAG_MESSAGE_REF) : null;
        if (ref == null || ref.length == 0) {
            return null;
        }
        List<NotificationLog> rows = notificationLogRepository
                .findBySourceIdAndNotificationType(EmailService.messageIdOf(ref[0]), "EMAIL");
        return rows.isEmpty() ? null : rows.get(0).getId();
    }

    private String findOriginalNotificationLogId(String recipient, String timestamp) {
        try {
            // Parse the event timestamp as UTC Instant (SES timestamps are always UTC).
            Instant eventTime;
            try {
                if (timestamp.endsWith("Z")) {
                    eventTime = Instant.parse(timestamp);
                } else {
                    eventTime = LocalDateTime.parse(timestamp, DateTimeFormatter.ISO_DATE_TIME)
                            .toInstant(ZoneOffset.UTC);
                }
            } catch (Exception e) {
                log.warn("Could not parse timestamp '{}', using current time", timestamp);
                eventTime = Instant.now();
            }

            // Step 1: Look for EMAIL log for this recipient within a wider time window
            // Events can arrive within 30 minutes of email sending
            Instant searchStart = eventTime.minus(java.time.Duration.ofMinutes(30));
            Instant searchEnd = eventTime.plus(java.time.Duration.ofMinutes(15));

            Optional<NotificationLog> matchingEmail = notificationLogRepository
                .findTopByChannelIdAndNotificationTypeAndNotificationDateBeforeOrderByNotificationDateDesc(
                    recipient, "EMAIL", searchEnd);

            if (matchingEmail.isPresent()) {
                NotificationLog emailLog = matchingEmail.get();
                // Verify the email was sent within reasonable time window
                if (emailLog.getNotificationDate().isAfter(searchStart)) {
                    String logId = emailLog.getId();
                    log.debug("Found matching EMAIL log ID: '{}' for recipient: '{}' (sent at: {}, event at: {})", 
                        logId, recipient, emailLog.getNotificationDate(), eventTime);
                    return logId;
                } else {
                    log.warn("EMAIL log found but outside time window. Email sent: {}, Event: {}, Diff: {} minutes", 
                        emailLog.getNotificationDate(), eventTime, 
                        java.time.Duration.between(emailLog.getNotificationDate(), eventTime).toMinutes());
                }
            }
            
            // Step 2: If no match in time window, try most recent email to this recipient
            Optional<NotificationLog> recentEmail = notificationLogRepository
                .findTopByChannelIdAndNotificationTypeOrderByNotificationDateDesc(recipient, "EMAIL");
            
            if (recentEmail.isPresent()) {
                NotificationLog emailLog = recentEmail.get();
                String logId = emailLog.getId();
                long minutesDiff = java.time.Duration.between(emailLog.getNotificationDate(), eventTime).toMinutes();
                log.debug("Using most recent EMAIL log ID: '{}' for recipient: '{}' (time diff: {} minutes)", 
                    logId, recipient, minutesDiff);
                
                // Warn if time difference is large (might be wrong email)
                if (Math.abs(minutesDiff) > 60) {
                    log.warn("Large time difference ({} minutes) between email and event - linkage may be incorrect!", minutesDiff);
                }
                
                return logId;
            }
            
            log.warn("No EMAIL log found for recipient: '{}' - using 'SES' as source", recipient);
            return null; // Will result in source = "SES"
            
        } catch (Exception e) {
            log.error("Error finding original notification log: {}", e.getMessage(), e);
            return null;
        }
    }
}
