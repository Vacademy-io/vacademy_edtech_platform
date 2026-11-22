package vacademy.io.notification_service.features.email_tracking.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.notification_service.features.email_tracking.dto.UserEmailTrackingRequest;
import vacademy.io.notification_service.features.email_tracking.dto.UserEmailTrackingResponse;
import vacademy.io.notification_service.features.email_tracking.service.EmailTrackingService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.config.InstituteStaffAccess;

import java.time.LocalDateTime;
import java.util.List;

/**
 * REST Controller for user-centric email tracking
 * Provides APIs to track emails sent to users and their delivery/engagement status
 */
@RestController
@RequestMapping("/notification-service/v1/email-tracking")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class EmailTrackingController {
    
    private final EmailTrackingService emailTrackingService;
    
    /**
     * Get paginated list of emails sent to a user with their latest tracking status
     * 
     * Query by userId:
     * GET /notification-service/v1/email-tracking/user/{userId}?page=0&size=20
     * 
     * Query by email address:
     * GET /notification-service/v1/email-tracking/email/{email}?page=0&size=20
     */
    @GetMapping("/user/{userId}")
    public ResponseEntity<Page<UserEmailTrackingResponse>> getEmailsByUserId(
            @PathVariable String userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String source,
            @RequestParam(required = false) String sourceId,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate,
            @RequestParam(required = false) String eventType,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        InstituteStaffAccess.requireSelfOrStaff(user, clientId, userId);
        
        try {
            log.info("Fetching emails for userId: {}, page: {}, size: {}", userId, page, size);
            
            UserEmailTrackingRequest request = UserEmailTrackingRequest.builder()
                .userId(userId)
                .source(source)
                .sourceId(sourceId)
                .fromDate(fromDate != null ? LocalDateTime.parse(fromDate) : null)
                .toDate(toDate != null ? LocalDateTime.parse(toDate) : null)
                .eventType(eventType)
                .page(page)
                .size(size)
                .build();
            
            Page<UserEmailTrackingResponse> response = emailTrackingService.getUserEmails(request);
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            log.error("Error fetching emails for user {}: {}", userId, e.getMessage(), e);
            return ResponseEntity.badRequest().build();
        }
    }
    
    /**
     * Get paginated list of emails sent to an email address with their latest tracking status
     */
    @GetMapping("/email/{email}")
    public ResponseEntity<Page<UserEmailTrackingResponse>> getEmailsByEmailAddress(
            @PathVariable String email,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String source,
            @RequestParam(required = false) String sourceId,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate,
            @RequestParam(required = false) String eventType,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        InstituteStaffAccess.requireStaff(user, clientId);
        
        try {
            log.info("Fetching emails for email address: {}, page: {}, size: {}", email, page, size);
            
            UserEmailTrackingRequest request = UserEmailTrackingRequest.builder()
                .email(email)
                .source(source)
                .sourceId(sourceId)
                .fromDate(fromDate != null ? LocalDateTime.parse(fromDate) : null)
                .toDate(toDate != null ? LocalDateTime.parse(toDate) : null)
                .eventType(eventType)
                .page(page)
                .size(size)
                .build();
            
            Page<UserEmailTrackingResponse> response = emailTrackingService.getUserEmails(request);
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            log.error("Error fetching emails for email address {}: {}", email, e.getMessage(), e);
            return ResponseEntity.badRequest().build();
        }
    }
    
    /**
     * Get tracking details for a specific email by its log ID
     * 
     * GET /notification-service/v1/email-tracking/{emailId}
     */
    @GetMapping("/{emailId}")
    public ResponseEntity<UserEmailTrackingResponse> getEmailTracking(
            @PathVariable String emailId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        InstituteStaffAccess.requireStaff(user, clientId);
        
        try {
            log.info("Fetching tracking details for email: {}", emailId);
            
            UserEmailTrackingResponse response = emailTrackingService.getEmailTracking(emailId);
            return ResponseEntity.ok(response);
            
        } catch (IllegalArgumentException e) {
            log.error("Invalid email ID: {}", emailId, e);
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("Error fetching tracking for email {}: {}", emailId, e.getMessage(), e);
            return ResponseEntity.badRequest().build();
        }
    }
    
    /**
     * Get full event history for a specific email (all SES events)
     * 
     * GET /notification-service/v1/email-tracking/{emailId}/history
     */
    @GetMapping("/{emailId}/history")
    public ResponseEntity<List<UserEmailTrackingResponse.EmailTrackingStatus>> getEmailEventHistory(
            @PathVariable String emailId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        InstituteStaffAccess.requireStaff(user, clientId);
        
        try {
            log.info("Fetching full event history for email: {}", emailId);
            
            List<UserEmailTrackingResponse.EmailTrackingStatus> events = 
                emailTrackingService.getEmailEventHistory(emailId);
            
            return ResponseEntity.ok(events);
            
        } catch (IllegalArgumentException e) {
            log.error("Invalid email ID: {}", emailId, e);
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("Error fetching event history for email {}: {}", emailId, e.getMessage(), e);
            return ResponseEntity.badRequest().build();
        }
    }
    
    /**
     * Advanced search with POST for complex filtering
     * 
     * POST /notification-service/v1/email-tracking/search
     */
    @PostMapping("/search")
    public ResponseEntity<Page<UserEmailTrackingResponse>> searchEmails(
            @RequestBody UserEmailTrackingRequest request,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        InstituteStaffAccess.requireStaff(user, clientId);
        
        try {
            log.info("Searching emails with request: {}", request);
            
            Page<UserEmailTrackingResponse> response = emailTrackingService.getUserEmails(request);
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            log.error("Error searching emails: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().build();
        }
    }
}


