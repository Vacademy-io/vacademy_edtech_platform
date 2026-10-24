package vacademy.io.common.auth.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.common.auth.dto.UserActivityAnalyticsDto;

import vacademy.io.common.auth.entity.UserActivityLog;
import vacademy.io.common.auth.entity.UserSession;
import vacademy.io.common.auth.repository.DailyUserActivitySummaryRepository;
import vacademy.io.common.auth.repository.UserActivityLogRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserSessionRepository;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
public class UserActivityTrackingService {

        private static final String AUTH_SERVICE_NAME = "auth_service";

        // last_activity_time is written at most this often per session; see
        // UserSessionRepository.updateLastActivityTime.
        private static final long ACTIVITY_WRITE_INTERVAL_SECONDS = 60;

        @Autowired
        private UserActivityLogRepository activityLogRepository;

        @Autowired
        private UserSessionRepository sessionRepository;

        @Autowired
        private DailyUserActivitySummaryRepository dailySummaryRepository;

        @Autowired
        private UserRepository userRepository;

        @Value("${spring.application.name:}")
        private String applicationName;

        /**
         * Log user activity asynchronously
         */
        @Async
        public void logUserActivity(String userId, String instituteId, String serviceName,
                        String endpoint, String actionType, String sessionToken,
                        String ipAddress, String userAgent, Integer responseStatus,
                        Long responseTimeMs) {
                if (!shouldLogActivity()) {
                        return;
                }
                try {
                        UserActivityLog log = UserActivityLog.builder()
                                        .userId(userId)
                                        .instituteId(instituteId)
                                        .serviceName(serviceName)
                                        .endpoint(endpoint)
                                        .actionType(actionType)
                                        .sessionId(sessionToken)
                                        .ipAddress(ipAddress)
                                        .userAgent(userAgent)
                                        .deviceType(extractDeviceType(userAgent))
                                        .responseStatus(responseStatus)
                                        .responseTimeMs(responseTimeMs)
                                        .createdAt(LocalDateTime.now())
                                        .build();

                        activityLogRepository.save(log);

                        // Update session activity time
                        updateSessionActivity(sessionToken);

                } catch (Exception e) {
                        log.error("Error logging user activity", e);
                }
        }

        private boolean shouldLogActivity() {
                if (applicationName == null || applicationName.trim().isEmpty()) {
                        return false;
                }
                return AUTH_SERVICE_NAME.equalsIgnoreCase(applicationName.trim());
        }

        /**
         * Create or update user session asynchronously
         */
        @Async
        @Transactional
        public void createOrUpdateSession(String userId, String instituteId, String sessionToken,
                        String ipAddress, String userAgent) {
                if (!shouldLogActivity() || instituteId == null || instituteId.isBlank()) {
                        return;
                }

                try {

                        List<UserSession> existingSessions = sessionRepository
                                        .findBySessionTokenAndIsActive(sessionToken, true);

                        if (!existingSessions.isEmpty()) {
                                // Update existing session
                                touchSession(sessionToken);
                        } else {
                                // Create new session
                                UserSession newSession = UserSession.builder()
                                                .userId(userId)
                                                .instituteId(instituteId)
                                                .sessionToken(sessionToken)
                                                .ipAddress(ipAddress)
                                                .userAgent(userAgent)
                                                .deviceType(extractDeviceType(userAgent))
                                                .deviceId(generateDeviceId(userAgent, ipAddress))
                                                .isActive(true)
                                                .loginTime(LocalDateTime.now())
                                                .lastActivityTime(LocalDateTime.now())
                                                .build();

                                sessionRepository.save(newSession);
                        }
                } catch (Exception e) {
                        log.error("Error creating or updating user session", e);
                }
        }

        /**
         * End user session
         */
        @Transactional
        public void endSession(String sessionToken) {
                sessionRepository.endSession(sessionToken, LocalDateTime.now());
        }

        /**
         * Clean up inactive sessions
         */
        @Transactional
        public void cleanupInactiveSessions(int inactiveMinutes) {
                LocalDateTime cutoffTime = LocalDateTime.now().minusMinutes(inactiveMinutes);
                sessionRepository.endInactiveSessions(cutoffTime, LocalDateTime.now());
        }

        /**
         * Generate comprehensive analytics for institute
         */
        public UserActivityAnalyticsDto getInstituteAnalytics(String instituteId) {
                LocalDateTime now = LocalDateTime.now();
                LocalDate today = LocalDate.now();

                // Real-time metrics
                Long currentlyActiveUsers = sessionRepository.countCurrentlyActiveUsers(instituteId);
                Long activeUsersLast5Min = sessionRepository.countActiveUsersInInstitute(instituteId,
                                now.minusMinutes(5));
                Long activeUsersLastHour = activityLogRepository.countActiveUsersInInstituteSince(instituteId,
                                now.minusHours(1));
                Long activeUsersLast24Hours = activityLogRepository.countActiveUsersInInstituteSince(instituteId,
                                now.minusHours(24));

                // Currently active users with details
                List<UserActivityAnalyticsDto.CurrentlyActiveUserDto> currentlyActiveUsersList = getCurrentlyActiveUsersWithDetails(
                                instituteId);

                // Today's activity summary
                Optional<Object[]> todayActivity = Optional.ofNullable(
                                dailySummaryRepository.getInstituteActivitySummaryForDate(instituteId, today));

                Long todayTotalSessions = 0L;
                Long todayTotalActivityTime = 0L;
                Long todayTotalApiCalls = 0L;

                if (todayActivity.isPresent() && todayActivity.get().length >= 3) {
                        Object[] data = todayActivity.get();
                        todayTotalSessions = data[0] != null ? ((Number) data[0]).longValue() : 0L;
                        todayTotalActivityTime = data[1] != null ? ((Number) data[1]).longValue() : 0L;
                        todayTotalApiCalls = data[2] != null ? ((Number) data[2]).longValue() : 0L;
                }

                Long todayUniqueUsers = dailySummaryRepository.countActiveUsersForDate(instituteId, today);

                // Average session duration
                Double avgSessionDuration = sessionRepository.getAverageSessionDuration(instituteId, now.minusDays(7));

                // Trends for last 7 days
                List<Object[]> trendData = dailySummaryRepository.getActivityTrendData(
                                instituteId, today.minusDays(6), today);

                List<UserActivityAnalyticsDto.DailyActivityTrendDto> dailyTrends = trendData.stream()
                                .map(this::mapToDailyTrend)
                                .collect(Collectors.toList());

                // Service usage statistics with user details
                List<UserActivityAnalyticsDto.ServiceUsageDto> serviceUsage = getServiceUsageWithUserDetails(
                                instituteId,
                                now.minusDays(7));

                // Device usage statistics with user details
                List<UserActivityAnalyticsDto.DeviceUsageDto> deviceUsage = getDeviceUsageWithUserDetails(instituteId,
                                now.minusDays(7));

                // Most active users
                List<UserActivityAnalyticsDto.ActiveUserDto> mostActiveUsers = getMostActiveUsersEnhanced(instituteId,
                                10);

                // Hourly activity with user details
                List<UserActivityAnalyticsDto.HourlyActivityDto> hourlyActivity = getHourlyActivityWithUserDetails(
                                instituteId,
                                now.minusDays(1));

                // Peak activity hour
                Integer peakHour = hourlyActivity.stream()
                                .max(Comparator.comparing(UserActivityAnalyticsDto.HourlyActivityDto::getActivityCount))
                                .map(UserActivityAnalyticsDto.HourlyActivityDto::getHour)
                                .orElse(12); // Default to noon

                // Most used services
                List<String> mostUsedServices = serviceUsage.stream()
                                .sorted(Comparator.comparing(UserActivityAnalyticsDto.ServiceUsageDto::getUsageCount)
                                                .reversed())
                                .limit(5)
                                .map(UserActivityAnalyticsDto.ServiceUsageDto::getServiceName)
                                .collect(Collectors.toList());

                return UserActivityAnalyticsDto.builder()
                                .currentlyActiveUsers(currentlyActiveUsers)
                                .activeUsersLast5Minutes(activeUsersLast5Min)
                                .activeUsersLastHour(activeUsersLastHour)
                                .activeUsersLast24Hours(activeUsersLast24Hours)
                                .currentlyActiveUsersList(currentlyActiveUsersList)
                                .todayTotalSessions(todayTotalSessions)
                                .todayTotalApiCalls(todayTotalApiCalls)
                                .todayTotalActivityTimeMinutes(todayTotalActivityTime)
                                .todayUniqueActiveUsers(todayUniqueUsers)
                                .averageSessionDurationMinutes(avgSessionDuration)
                                .peakActivityHour(peakHour)
                                .mostUsedServices(mostUsedServices)
                                .dailyActivityTrend(dailyTrends)
                                .serviceUsageStats(serviceUsage)
                                .deviceUsageStats(deviceUsage)
                                .mostActiveUsers(mostActiveUsers)
                                .hourlyActivity(hourlyActivity)
                                .build();
        }

        /**
         * Update session activity time
         */
        private void updateSessionActivity(String sessionToken) {
                if (sessionToken != null) {
                        touchSession(sessionToken);
                }
        }

        private void touchSession(String sessionToken) {
                LocalDateTime now = LocalDateTime.now();
                sessionRepository.updateLastActivityTime(sessionToken, now,
                                now.minusSeconds(ACTIVITY_WRITE_INTERVAL_SECONDS));
        }

        /**
         * Extract device type from user agent
         */
        private String extractDeviceType(String userAgent) {
                if (userAgent == null)
                        return "unknown";

                userAgent = userAgent.toLowerCase();
                if (userAgent.contains("mobile") || userAgent.contains("android") || userAgent.contains("iphone")) {
                        return "mobile";
                } else if (userAgent.contains("tablet") || userAgent.contains("ipad")) {
                        return "tablet";
                } else {
                        return "desktop";
                }
        }

        /**
         * Generate device ID
         */
        private String generateDeviceId(String userAgent, String ipAddress) {
                return String.valueOf((userAgent + ipAddress).hashCode());
        }

        /**
         * Get currently active users with their details
         */
        private List<UserActivityAnalyticsDto.CurrentlyActiveUserDto> getCurrentlyActiveUsersWithDetails(
                        String instituteId) {
                LocalDateTime fiveMinutesAgo = LocalDateTime.now().minusMinutes(5);
                List<UserSession> activeSessions = sessionRepository.findActiveSessionsInInstitute(instituteId,
                                fiveMinutesAgo);

                return activeSessions.stream()
                                .map(session -> userRepository.findById(session.getUserId())
                                                .map(user -> {
                                                        // Get latest activity log for current service
                                                        List<UserActivityLog> recentLogs = activityLogRepository
                                                                        .findByUserIdAndInstituteIdAndCreatedAtBetween(
                                                                                        session.getUserId(),
                                                                                        instituteId,
                                                                                        LocalDateTime.now()
                                                                                                        .minusMinutes(10),
                                                                                        LocalDateTime.now());

                                                        String currentService = recentLogs.isEmpty() ? "unknown"
                                                                        : recentLogs.get(recentLogs.size() - 1)
                                                                                        .getServiceName();

                                                        Long sessionDuration = session.getLoginTime() != null
                                                                        ? java.time.Duration.between(
                                                                                        session.getLoginTime(),
                                                                                        LocalDateTime.now())
                                                                                        .toMinutes()
                                                                        : 0L;

                                                        return UserActivityAnalyticsDto.CurrentlyActiveUserDto.builder()
                                                                        .userId(user.getId())
                                                                        .username(user.getUsername())
                                                                        .fullName(user.getFullName())
                                                                        .email(user.getEmail())
                                                                        .loginTime(session.getLoginTime())
                                                                        .lastActivity(session.getLastActivityTime())
                                                                        .currentService(currentService)
                                                                        .deviceType(session.getDeviceType())
                                                                        .ipAddress(session.getIpAddress())
                                                                        .sessionDurationMinutes(sessionDuration)
                                                                        .build();
                                                })
                                                .orElse(null))
                                .filter(Objects::nonNull)
                                .collect(Collectors.toList());
        }

        /**
         * Get service usage statistics with user details
         */
        private List<UserActivityAnalyticsDto.ServiceUsageDto> getServiceUsageWithUserDetails(String instituteId,
                        LocalDateTime startTime) {
                List<Object[]> serviceStats = activityLogRepository.getServiceUsageStats(instituteId, startTime);

                return serviceStats.stream()
                                .map(data -> {
                                        String serviceName = (String) data[0];
                                        Long usageCount = ((Number) data[1]).longValue();

                                        // Get top users for this service
                                        List<UserActivityAnalyticsDto.ServiceUserDto> topUsers = getTopUsersForService(
                                                        instituteId,
                                                        serviceName, startTime, 5);

                                        return UserActivityAnalyticsDto.ServiceUsageDto.builder()
                                                        .serviceName(serviceName)
                                                        .usageCount(usageCount)
                                                        .averageResponseTime(0.0) // Could be enhanced with response
                                                                                  // time data
                                                        .uniqueUsers((long) topUsers.size())
                                                        .topUsers(topUsers)
                                                        .build();
                                })
                                .collect(Collectors.toList());
        }

        /**
         * Get device usage statistics with user details
         */
        private List<UserActivityAnalyticsDto.DeviceUsageDto> getDeviceUsageWithUserDetails(String instituteId,
                        LocalDateTime startTime) {
                List<Object[]> deviceStats = activityLogRepository.getDeviceTypeUsage(instituteId, startTime);

                return deviceStats.stream()
                                .map(data -> {
                                        String deviceType = (String) data[0];
                                        Long uniqueUsers = ((Number) data[1]).longValue();

                                        // Get top users for this device type
                                        List<UserActivityAnalyticsDto.DeviceUserDto> topUsers = getTopUsersForDeviceType(
                                                        instituteId,
                                                        deviceType, startTime, 5);

                                        return UserActivityAnalyticsDto.DeviceUsageDto.builder()
                                                        .deviceType(deviceType)
                                                        .usageCount(topUsers.stream()
                                                                        .mapToLong(UserActivityAnalyticsDto.DeviceUserDto::getUsageCount)
                                                                        .sum())
                                                        .uniqueUsers(uniqueUsers)
                                                        .topUsers(topUsers)
                                                        .build();
                                })
                                .collect(Collectors.toList());
        }

        /**
         * Get enhanced most active users with complete details
         */
        private List<UserActivityAnalyticsDto.ActiveUserDto> getMostActiveUsersEnhanced(String instituteId, int limit) {
                LocalDate startDate = LocalDate.now().minusDays(7);
                LocalDate endDate = LocalDate.now();

                List<Object[]> activeUsersData = dailySummaryRepository.getMostActiveUsersInDateRange(
                                instituteId, startDate, endDate);

                return activeUsersData.stream()
                                .limit(limit)
                                .map(data -> {
                                        String userId = (String) data[0];
                                        Long totalSessions = ((Number) data[1]).longValue();
                                        Long totalActivityTime = ((Number) data[2]).longValue();
                                        Long totalApiCalls = ((Number) data[3]).longValue();

                                        // Get user details
                                        return userRepository.findById(userId)
                                                        .map(user -> {
                                                                // Get user's current status
                                                                String currentStatus = getUserCurrentStatus(userId,
                                                                                instituteId);

                                                                // Get user's frequent services
                                                                List<String> frequentServices = getUserFrequentServices(
                                                                                userId, instituteId,
                                                                                startDate.atStartOfDay());

                                                                // Get user's preferred device type
                                                                String preferredDeviceType = getUserPreferredDeviceType(
                                                                                userId, instituteId,
                                                                                startDate.atStartOfDay());

                                                                // Get last activity time
                                                                LocalDateTime lastActivity = getLastActivityTime(userId,
                                                                                instituteId);

                                                                return UserActivityAnalyticsDto.ActiveUserDto.builder()
                                                                                .userId(userId)
                                                                                .username(user.getUsername())
                                                                                .fullName(user.getFullName())
                                                                                .email(user.getEmail())
                                                                                .totalSessions(totalSessions)
                                                                                .totalActivityTimeMinutes(
                                                                                                totalActivityTime)
                                                                                .totalApiCalls(totalApiCalls)
                                                                                .lastActivity(lastActivity)
                                                                                .currentStatus(currentStatus)
                                                                                .frequentServices(frequentServices)
                                                                                .preferredDeviceType(
                                                                                                preferredDeviceType)
                                                                                .build();
                                                        })
                                                        .orElse(UserActivityAnalyticsDto.ActiveUserDto.builder()
                                                                        .userId(userId)
                                                                        .username("unknown")
                                                                        .fullName("Unknown User")
                                                                        .email("unknown@example.com")
                                                                        .totalSessions(totalSessions)
                                                                        .totalActivityTimeMinutes(totalActivityTime)
                                                                        .totalApiCalls(totalApiCalls)
                                                                        .lastActivity(LocalDateTime.now())
                                                                        .currentStatus("OFFLINE")
                                                                        .frequentServices(new ArrayList<>())
                                                                        .preferredDeviceType("unknown")
                                                                        .build());
                                })
                                .collect(Collectors.toList());
        }

        /**
         * Get hourly activity with user details
         */
        private List<UserActivityAnalyticsDto.HourlyActivityDto> getHourlyActivityWithUserDetails(String instituteId,
                        LocalDateTime startTime) {
                List<Object[]> hourlyStats = activityLogRepository.getPeakHoursActivity(instituteId, startTime);

                return hourlyStats.stream()
                                .map(data -> {
                                        Integer hour = ((Number) data[0]).intValue();
                                        Long activityCount = ((Number) data[1]).longValue();

                                        // Get top active users for this hour
                                        List<UserActivityAnalyticsDto.HourlyActiveUserDto> topUsers = getTopUsersForHour(
                                                        instituteId, hour,
                                                        startTime, 3);

                                        return UserActivityAnalyticsDto.HourlyActivityDto.builder()
                                                        .hour(hour)
                                                        .activityCount(activityCount)
                                                        .uniqueUsers((long) topUsers.size())
                                                        .topActiveUsers(topUsers)
                                                        .build();
                                })
                                .collect(Collectors.toList());
        }

        /**
         * Get most active users with their details
         */
        private List<UserActivityAnalyticsDto.ActiveUserDto> getMostActiveUsers(String instituteId, int limit) {
                // This method is kept for backward compatibility, now delegates to enhanced
                // version
                return getMostActiveUsersEnhanced(instituteId, limit);
        }

        // Mapping helper methods
        private UserActivityAnalyticsDto.DailyActivityTrendDto mapToDailyTrend(Object[] data) {
                return UserActivityAnalyticsDto.DailyActivityTrendDto.builder()
                                .date((LocalDate) data[0])
                                .uniqueUsers(((Number) data[1]).longValue())
                                .totalSessions(((Number) data[2]).longValue())
                                .totalApiCalls(((Number) data[3]).longValue())
                                .averageSessionDuration(0.0) // Could be calculated
                                .build();
        }

        private UserActivityAnalyticsDto.ServiceUsageDto mapToServiceUsage(Object[] data) {
                return UserActivityAnalyticsDto.ServiceUsageDto.builder()
                                .serviceName((String) data[0])
                                .usageCount(((Number) data[1]).longValue())
                                .averageResponseTime(0.0) // Could be enhanced with response time data
                                .uniqueUsers(0L) // Could be enhanced
                                .build();
        }

        private UserActivityAnalyticsDto.DeviceUsageDto mapToDeviceUsage(Object[] data) {
                return UserActivityAnalyticsDto.DeviceUsageDto.builder()
                                .deviceType((String) data[0])
                                .usageCount(0L) // Could be enhanced
                                .uniqueUsers(((Number) data[1]).longValue())
                                .build();
        }

        private UserActivityAnalyticsDto.HourlyActivityDto mapToHourlyActivity(Object[] data) {
                return UserActivityAnalyticsDto.HourlyActivityDto.builder()
                                .hour(((Number) data[0]).intValue())
                                .activityCount(((Number) data[1]).longValue())
                                .uniqueUsers(0L) // Could be enhanced
                                .build();
        }

        // Helper methods for user details in analytics

        /**
         * Get top users for a specific service
         */
        private List<UserActivityAnalyticsDto.ServiceUserDto> getTopUsersForService(String instituteId,
                        String serviceName,
                        LocalDateTime startTime, int limit) {
                List<Object[]> topUsersData = activityLogRepository.getMostActiveUsers(instituteId, startTime);

                return topUsersData.stream()
                                .limit(limit)
                                .map(data -> {
                                        String userId = (String) data[0];
                                        Long usageCount = ((Number) data[1]).longValue();

                                        return userRepository.findById(userId)
                                                        .map(user -> UserActivityAnalyticsDto.ServiceUserDto.builder()
                                                                        .userId(userId)
                                                                        .username(user.getUsername())
                                                                        .fullName(user.getFullName())
                                                                        .email(user.getEmail())
                                                                        .usageCount(usageCount)
                                                                        .lastUsed(LocalDateTime.now())
                                                                        .build())
                                                        .orElse(null);
                                })
                                .filter(Objects::nonNull)
                                .collect(Collectors.toList());
        }

        /**
         * Get top users for a specific device type
         */
        private List<UserActivityAnalyticsDto.DeviceUserDto> getTopUsersForDeviceType(String instituteId,
                        String deviceType,
                        LocalDateTime startTime, int limit) {
                List<Object[]> topUsersData = activityLogRepository.getMostActiveUsers(instituteId, startTime);

                return topUsersData.stream()
                                .limit(limit)
                                .map(data -> {
                                        String userId = (String) data[0];
                                        Long usageCount = ((Number) data[1]).longValue();

                                        return userRepository.findById(userId)
                                                        .map(user -> UserActivityAnalyticsDto.DeviceUserDto.builder()
                                                                        .userId(userId)
                                                                        .username(user.getUsername())
                                                                        .fullName(user.getFullName())
                                                                        .email(user.getEmail())
                                                                        .usageCount(usageCount)
                                                                        .lastUsed(LocalDateTime.now())
                                                                        .build())
                                                        .orElse(null);
                                })
                                .filter(Objects::nonNull)
                                .collect(Collectors.toList());
        }

        /**
         * Get top active users for a specific hour
         */
        private List<UserActivityAnalyticsDto.HourlyActiveUserDto> getTopUsersForHour(String instituteId, Integer hour,
                        LocalDateTime startTime, int limit) {
                List<Object[]> topUsersData = activityLogRepository.getMostActiveUsers(instituteId, startTime);

                return topUsersData.stream()
                                .limit(limit)
                                .map(data -> {
                                        String userId = (String) data[0];
                                        Long activityCount = ((Number) data[1]).longValue();

                                        return userRepository.findById(userId)
                                                        .map(user -> UserActivityAnalyticsDto.HourlyActiveUserDto
                                                                        .builder()
                                                                        .userId(userId)
                                                                        .username(user.getUsername())
                                                                        .fullName(user.getFullName())
                                                                        .email(user.getEmail())
                                                                        .activityCount(activityCount)
                                                                        .build())
                                                        .orElse(null);
                                })
                                .filter(Objects::nonNull)
                                .collect(Collectors.toList());
        }

        /**
         * Get user's current status (ONLINE, RECENTLY_ACTIVE, OFFLINE)
         */
        private String getUserCurrentStatus(String userId, String instituteId) {
                LocalDateTime fiveMinutesAgo = LocalDateTime.now().minusMinutes(5);
                LocalDateTime thirtyMinutesAgo = LocalDateTime.now().minusMinutes(30);

                // Check if user has active session
                List<UserSession> activeSessions = sessionRepository.findActiveSessionsByUserId(userId);
                boolean hasActiveSession = activeSessions.stream()
                                .anyMatch(session -> session.getLastActivityTime().isAfter(fiveMinutesAgo));

                if (hasActiveSession) {
                        return "ONLINE";
                }

                // Check recent activity
                Long recentActivity = activityLogRepository.countActivityInInstituteSince(instituteId,
                                thirtyMinutesAgo);
                if (recentActivity > 0) {
                        return "RECENTLY_ACTIVE";
                }

                return "OFFLINE";
        }

        /**
         * Get user's frequently used services
         */
        private List<String> getUserFrequentServices(String userId, String instituteId, LocalDateTime startTime) {
                List<Object[]> results = activityLogRepository.getUserFrequentServices(
                                userId, instituteId, startTime, 5);

                return results.stream()
                                .map(row -> (String) row[0])
                                .collect(Collectors.toList());
        }

        /**
         * Get user's preferred device type
         */
        private String getUserPreferredDeviceType(String userId, String instituteId, LocalDateTime startTime) {
                List<Object[]> results = activityLogRepository.getUserPreferredDeviceType(
                                userId, instituteId, startTime);

                if (results.isEmpty()) {
                        return "unknown";
                }
                return (String) results.get(0)[0];
        }

        /**
         * Get user's last activity time
         */
        private LocalDateTime getLastActivityTime(String userId, String instituteId) {
                LocalDateTime lastTime = activityLogRepository.getLastUserActivityTime(
                                userId, instituteId, LocalDateTime.now().minusDays(30));

                return lastTime != null ? lastTime : LocalDateTime.now().minusDays(30);
        }
}