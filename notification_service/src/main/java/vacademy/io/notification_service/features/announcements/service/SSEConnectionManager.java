package vacademy.io.notification_service.features.announcements.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import vacademy.io.notification_service.features.announcements.dto.AnnouncementEvent;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * Manages Server-Sent Events (SSE) connections for real-time notifications
 */
@Slf4j
@Service
public class SSEConnectionManager {
    
    @Value("${sse.timeout:300000}")
    private long sseTimeout;
    
    @Value("${sse.max.connections.per.user:5}")
    private int maxConnectionsPerUser;
    
    // Store active connections per user
    private final Map<String, Set<SseEmitter>> userConnections = new ConcurrentHashMap<>();
    
    // Store connection metadata (creation time, last activity, subscription filters, etc.)
    private final Map<SseEmitter, ConnectionMetadata> connectionMetadata = new ConcurrentHashMap<>();
    
    // Store connections per institute for broadcast messages
    private final Map<String, Set<String>> instituteUsers = new ConcurrentHashMap<>();
    
    /**
     * Create a new SSE connection for a user
     */
    public SseEmitter createConnection(String userId, String instituteId) {
        log.info("Creating SSE connection for user: {} in institute: {}", userId, instituteId);
        
        // Check connection limit
        Set<SseEmitter> existingConnections = userConnections.get(userId);
        if (existingConnections != null && existingConnections.size() >= maxConnectionsPerUser) {
            log.warn("User {} has reached maximum connections limit: {}", userId, maxConnectionsPerUser);
            // Remove oldest connection
            removeOldestConnection(userId);
        }
        
        // Create new SSE emitter
        SseEmitter emitter = new SseEmitter(sseTimeout);
        
        // Add connection handlers
        emitter.onCompletion(() -> removeConnection(userId, emitter));
        emitter.onTimeout(() -> {
            log.debug("SSE connection timeout for user: {}", userId);
            removeConnection(userId, emitter);
        });
        emitter.onError(throwable -> {
            // Fires routinely when a client disconnects mid-stream (broken pipe / connection reset).
            // Expected churn, not an error — debug-level so it doesn't flood Sentry.
            log.debug("SSE connection closed with error for user {}: {}", userId,
                    throwable != null ? throwable.toString() : "unknown");
            removeConnection(userId, emitter);
        });
        
        // Store connection
        userConnections.computeIfAbsent(userId, k -> new CopyOnWriteArraySet<>()).add(emitter);
        connectionMetadata.put(emitter, new ConnectionMetadata(userId, instituteId));
        
        // Track institute users
        instituteUsers.computeIfAbsent(instituteId, k -> new CopyOnWriteArraySet<>()).add(userId);
        
        // Send initial connection confirmation
        try {
            emitter.send(SseEmitter.event()
                    .name("connection")
                    .data("Connected to announcement stream"));
        } catch (Exception e) {
            // Client bailed during the handshake (IOException) or the emitter was already torn down
            // (IllegalStateException). Routine — fail the connection cleanly, no error-level noise.
            log.debug("Failed to send connection confirmation to user {}: {}", userId, e.toString());
            removeConnection(userId, emitter);
            return null;
        }
        
        log.info("SSE connection created successfully for user: {}", userId);
        return emitter;
    }
    
    /**
     * Send event to a specific user
     */
    public void sendToUser(String userId, AnnouncementEvent event) {
        Set<SseEmitter> connections = userConnections.get(userId);
        if (connections == null || connections.isEmpty()) {
            log.debug("No active connections for user: {}", userId);
            return;
        }
        
        log.debug("Sending event {} to user: {}", event.getType(), userId);
        
        // Send to all user's connections
        Iterator<SseEmitter> iterator = connections.iterator();
        while (iterator.hasNext()) {
            SseEmitter emitter = iterator.next();
            try {
                // Apply per-connection subscription filter
                ConnectionMetadata metadata = connectionMetadata.get(emitter);
                if (metadata != null && !metadata.shouldSend(event)) {
                    continue;
                }
                emitter.send(SseEmitter.event()
                        .name(event.getType().toString())
                        .id(event.getEventId())
                        .data(event));
                
                // Update last activity
                if (metadata != null) metadata.updateLastActivity();

            } catch (Exception e) {
                // Routine churn: a dead/closed emitter throws here — IOException on a broken pipe, OR
                // IllegalStateException("ResponseBodyEmitter has already completed", a RuntimeException
                // with a frequently-null message) for a stale/timed-out connection. Catch BOTH (not
                // just IOException): an uncaught RuntimeException here would propagate out of
                // broadcastToInstitute, abort delivery to every remaining user in the loop, and trip
                // the *Manager tracing aspect into an ERROR Sentry event. Drop this one emitter and
                // continue; debug-level since a disconnected client is expected, not an error.
                log.debug("Dropping unsendable SSE connection for user {}: {}", userId, e.toString());
                // NOT iterator.remove(): connections is a CopyOnWriteArraySet whose snapshot iterator
                // throws UnsupportedOperationException on remove — that aborted the whole fan-out and
                // left the dead emitter registered (user stuck "online"). Removing by value is safe
                // mid-iteration on a COW set, and removeConnection also clears the user/institute maps.
                removeConnection(userId, emitter);
            }
        }
    }

    /**
     * Whether the user currently has at least one live SSE connection. Read-only; used to decide
     * whether a chat message needs an offline push fallback.
     */
    public boolean isUserOnline(String userId) {
        Set<SseEmitter> connections = userConnections.get(userId);
        return connections != null && !connections.isEmpty();
    }

    /**
     * Subscribe a specific emitter to a mode filter so it only receives events for that mode
     */
    public void subscribeEmitterToMode(SseEmitter emitter, String modeType) {
        if (emitter == null || modeType == null) {
            return;
        }
        ConnectionMetadata metadata = connectionMetadata.get(emitter);
        if (metadata != null) {
            metadata.subscribeMode(modeType);
            log.debug("Emitter subscribed to mode: {} for user: {}", modeType, metadata.getUserId());
        } else {
            log.warn("Could not subscribe emitter to mode {} because metadata was not found", modeType);
        }
    }
    
    /**
     * Send event to multiple users
     */
    public void sendToUsers(List<String> userIds, AnnouncementEvent event) {
        log.debug("Sending event {} to {} users", event.getType(), userIds.size());
        userIds.forEach(userId -> sendToUser(userId, event));
    }
    
    /**
     * Broadcast event to all users in an institute
     */
    public void broadcastToInstitute(String instituteId, AnnouncementEvent event) {
        Set<String> users = instituteUsers.get(instituteId);
        if (users == null || users.isEmpty()) {
            log.debug("No active users for institute: {}", instituteId);
            return;
        }
        
        log.debug("Broadcasting event {} to institute: {} ({} users)", 
                event.getType(), instituteId, users.size());
        
        users.forEach(userId -> sendToUser(userId, event));
    }
    
    /**
     * Remove a specific connection
     */
    private void removeConnection(String userId, SseEmitter emitter) {
        Set<SseEmitter> connections = userConnections.get(userId);
        if (connections != null) {
            connections.remove(emitter);
            if (connections.isEmpty()) {
                userConnections.remove(userId);
                
                // Remove from institute tracking
                ConnectionMetadata metadata = connectionMetadata.get(emitter);
                if (metadata != null) {
                    Set<String> users = instituteUsers.get(metadata.getInstituteId());
                    if (users != null) {
                        users.remove(userId);
                        if (users.isEmpty()) {
                            instituteUsers.remove(metadata.getInstituteId());
                        }
                    }
                }
            }
        }
        connectionMetadata.remove(emitter);
        
        log.debug("Removed SSE connection for user: {}", userId);
    }
    
    /**
     * Remove oldest connection for a user
     */
    private void removeOldestConnection(String userId) {
        Set<SseEmitter> connections = userConnections.get(userId);
        if (connections == null || connections.isEmpty()) {
            return;
        }
        
        // Find oldest connection
        SseEmitter oldestEmitter = null;
        long oldestTime = Long.MAX_VALUE;
        
        for (SseEmitter emitter : connections) {
            ConnectionMetadata metadata = connectionMetadata.get(emitter);
            if (metadata != null && metadata.getCreatedAt() < oldestTime) {
                oldestTime = metadata.getCreatedAt();
                oldestEmitter = emitter;
            }
        }
        
        if (oldestEmitter != null) {
            log.info("Removing oldest connection for user: {}", userId);
            removeConnection(userId, oldestEmitter);
            oldestEmitter.complete();
        }
    }
    
    /**
     * Send heartbeat to all active connections
     */
    @Scheduled(fixedRateString = "${sse.heartbeat.interval:30000}")
    public void sendHeartbeat() {
        if (userConnections.isEmpty()) {
            return;
        }
        
        log.debug("Sending heartbeat to {} users", userConnections.size());
        AnnouncementEvent heartbeat = AnnouncementEvent.heartbeat();
        
        userConnections.forEach((userId, connections) -> {
            sendToUser(userId, heartbeat);
        });
    }
    
    /**
     * Cleanup stale connections
     */
    @Scheduled(fixedRateString = "${sse.cleanup.interval:60000}")
    public void cleanupStaleConnections() {
        long staleThreshold = System.currentTimeMillis() - (5 * 60 * 1000); // 5 minutes
        
        List<SseEmitter> staleConnections = new ArrayList<>();
        connectionMetadata.forEach((emitter, metadata) -> {
            if (metadata.getLastActivity() < staleThreshold) {
                staleConnections.add(emitter);
            }
        });
        
        if (!staleConnections.isEmpty()) {
            log.info("Cleaning up {} stale SSE connections", staleConnections.size());
            staleConnections.forEach(emitter -> {
                ConnectionMetadata metadata = connectionMetadata.get(emitter);
                if (metadata != null) {
                    removeConnection(metadata.getUserId(), emitter);
                }
                emitter.complete();
            });
        }
    }
    
    /**
     * Get statistics about active connections
     */
    public ConnectionStats getConnectionStats() {
        int totalConnections = connectionMetadata.size();
        int totalUsers = userConnections.size();
        int totalInstitutes = instituteUsers.size();
        
        return new ConnectionStats(totalConnections, totalUsers, totalInstitutes);
    }
    
    /**
     * Connection metadata class
     */
    private static class ConnectionMetadata {
        private final String userId;
        private final String instituteId;
        private final long createdAt;
        private long lastActivity;
        private Set<String> subscribedModes; // Optional mode subscriptions
        
        public ConnectionMetadata(String userId, String instituteId) {
            this.userId = userId;
            this.instituteId = instituteId;
            this.createdAt = System.currentTimeMillis();
            this.lastActivity = this.createdAt;
            this.subscribedModes = new HashSet<>();
        }
        
        public void updateLastActivity() {
            this.lastActivity = System.currentTimeMillis();
        }
        
        public void subscribeMode(String mode) {
            if (mode != null && !mode.isBlank()) this.subscribedModes.add(mode.toUpperCase());
        }
        
        public boolean shouldSend(AnnouncementEvent event) {
            if (subscribedModes == null || subscribedModes.isEmpty()) return true;
            if (event == null) return true;
            if (event.getModeType() == null) return true; // Global events go to all
            return subscribedModes.contains(event.getModeType().name());
        }
        
        public String getUserId() { return userId; }
        public String getInstituteId() { return instituteId; }
        public long getCreatedAt() { return createdAt; }
        public long getLastActivity() { return lastActivity; }
    }
    
    /**
     * Connection statistics class
     */
    public static class ConnectionStats {
        private final int totalConnections;
        private final int totalUsers;
        private final int totalInstitutes;
        
        public ConnectionStats(int totalConnections, int totalUsers, int totalInstitutes) {
            this.totalConnections = totalConnections;
            this.totalUsers = totalUsers;
            this.totalInstitutes = totalInstitutes;
        }
        
        public int getTotalConnections() { return totalConnections; }
        public int getTotalUsers() { return totalUsers; }
        public int getTotalInstitutes() { return totalInstitutes; }
    }
}
