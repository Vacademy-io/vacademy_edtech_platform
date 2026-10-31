package vacademy.io.admin_core_service.config;

import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCache;
import org.springframework.cache.support.SimpleCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import vacademy.io.admin_core_service.features.packages.service.CatalogPopularityService;

import java.util.concurrent.TimeUnit;

/**
 * Cache configuration for application-level caching.
 *
 * Currently configured caches:
 * - studyLibraryInit: Caches study library initialization data (TTL: 20
 * seconds)
 * - executionLogs: Caches workflow execution logs by execution ID (TTL: 5
 * minutes)
 * - nodeLogs: Caches workflow node logs by execution ID + node ID (TTL: 5
 * minutes)
 * - timeRangeLogs: Caches workflow logs by time range (TTL: 5 minutes)
 */
@Configuration
@EnableCaching
public class CacheConfiguration {

        /**
         * Configure Caffeine-based cache manager with per-cache TTLs.
         */
        @Bean
        public CacheManager cacheManager() {
                SimpleCacheManager cacheManager = new SimpleCacheManager();

                // 20s TTL caches (existing behavior)
                CaffeineCache studyLibraryInit = new CaffeineCache(
                                "studyLibraryInit",
                                caffeineCache20sBuilder().build());
                CaffeineCache facultyByPackageSessions = new CaffeineCache(
                                "facultyByPackageSessions",
                                caffeineCache20sBuilder().build());
                CaffeineCache studentsByPackageSessions = new CaffeineCache(
                                "studentsByPackageSessions",
                                caffeineCache20sBuilder().build());
                // Batch display names ("{Level} {Course}") rarely change -> 5m. MUST be registered or
                // @Cacheable on UserResolutionService.getBatchNamesByPackageSessions throws in the proxy.
                CaffeineCache batchNamesByPackageSessions = new CaffeineCache(
                                "batchNamesByPackageSessions",
                                caffeineCache5mBuilder().build());

                // 2 minutes TTL caches (new API-level caches)
                CaffeineCache instituteById = new CaffeineCache(
                                "instituteById",
                                caffeineCache2mBuilder().build());
                CaffeineCache openInstituteDetails = new CaffeineCache(
                                "openInstituteDetails",
                                caffeineCache2mBuilder().build());
                // Separate slot from openInstituteDetails. The two /public/institute/v1
                // detail endpoints return different bodies for the same instituteId, so
                // they cannot share a (cacheName, key) pair -- see OpenInstituteController.
                CaffeineCache openInstituteDetailsNonBatches = new CaffeineCache(
                                "openInstituteDetailsNonBatches",
                                caffeineCache2mBuilder().build());
                CaffeineCache openInstituteIdOrSubdomain = new CaffeineCache(
                                "openInstituteIdOrSubdomain",
                                caffeineCache2mBuilder().build());
                // Slide read-time aggregation per batch set. The dominant cost of the
                // institute-details payload; 2m keeps a freshly published slide from
                // being invisible for long. MUST be registered or @Cacheable on
                // SlideService.calculateReadTimesForPackageSessions throws in the proxy.
                CaffeineCache packageSessionReadTimes = new CaffeineCache(
                                "packageSessionReadTimes",
                                caffeineCache2mBuilder().build());

                CaffeineCache instituteDashboard = new CaffeineCache(
                                "instituteDashboard",
                                caffeineCache2mBuilder().build());
                CaffeineCache learnerInstituteDetails = new CaffeineCache(
                                "learnerInstituteDetails",
                                caffeineCache2mBuilder().build());
                CaffeineCache learnerInstituteDetailsByIds = new CaffeineCache(
                                "learnerInstituteDetailsByIds",
                                caffeineCache2mBuilder().build());
                CaffeineCache learnerInfo = new CaffeineCache(
                                "learnerInfo",
                                caffeineCache2mBuilder().build());

                // System Files caches
                CaffeineCache systemFileAccess = new CaffeineCache(
                                "systemFileAccess",
                                caffeineCache5mBuilder().build());
                CaffeineCache systemFileList = new CaffeineCache(
                                "systemFileList",
                                caffeineCache3mBuilder().build());
                CaffeineCache myFiles = new CaffeineCache(
                                "myFiles",
                                caffeineCache1mBuilder().build()); // Planning Logs cache
                CaffeineCache planningLogsList = new CaffeineCache(
                                "planningLogsList",
                                caffeineCache1mBuilder().build()); // Membership Details cache (user plan subscription
                // details)
                CaffeineCache membershipDetails = new CaffeineCache(
                                "membershipDetails",
                                caffeineCache2mBuilder().build());

                // User Plan related caches
                CaffeineCache userPlanById = new CaffeineCache(
                                "userPlanById",
                                caffeineCache2mBuilder().build());
                CaffeineCache userPlansByUser = new CaffeineCache(
                                "userPlansByUser",
                                caffeineCache2mBuilder().build());
                CaffeineCache userPlanWithPaymentLogs = new CaffeineCache(
                                "userPlanWithPaymentLogs",
                                caffeineCache2mBuilder().build());

                // Workflow Execution Log caches (5 minutes TTL)
                CaffeineCache executionLogs = new CaffeineCache(
                                "executionLogs",
                                caffeineCache5mBuilder().build());
                CaffeineCache nodeLogs = new CaffeineCache(
                                "nodeLogs",
                                caffeineCache5mBuilder().build());
                CaffeineCache timeRangeLogs = new CaffeineCache(
                                "timeRangeLogs",
                                caffeineCache5mBuilder().build());

                // User Details cache (5 minutes TTL) - for caching auth service calls
                CaffeineCache userDetails = new CaffeineCache(
                                "userDetails",
                                caffeineCacheUserDetailsBuilder().build());

                // Live Session caches (2 minutes TTL) - for caching session data
                CaffeineCache liveAndUpcomingSessions = new CaffeineCache(
                                "liveAndUpcomingSessions",
                                caffeineCache2mBuilder().build());

                // Zoom S2S OAuth access tokens (50 minutes TTL — Zoom tokens live for 1h).
                // Keyed by zoom account UUID; value is the bearer token string.
                CaffeineCache zoomAccessToken = new CaffeineCache(
                                "zoomAccessToken",
                                caffeineCacheZoomTokenBuilder().build());

                // Google OAuth access tokens (55 minutes TTL — Google tokens live for ~1h).
                // Keyed by GoogleAccount UUID; value is the bearer token string.
                CaffeineCache googleAccessToken = new CaffeineCache(
                                "googleAccessToken",
                                caffeineCacheGoogleTokenBuilder().build());

                // Learner Dashboard cache (2 minutes TTL)
                CaffeineCache learnerDashboard = new CaffeineCache(
                                "learnerDashboard",
                                caffeineCache2mBuilder().build());

                // Super Admin caches
                CaffeineCache superAdminInstituteList = new CaffeineCache(
                                "superAdminInstituteList",
                                caffeineCache2mBuilder().build());
                CaffeineCache superAdminInstituteDetail = new CaffeineCache(
                                "superAdminInstituteDetail",
                                caffeineCache2mBuilder().build());
                CaffeineCache superAdminPlatformDashboard = new CaffeineCache(
                                "superAdminPlatformDashboard",
                                caffeineCache5mBuilder().build());
                CaffeineCache superAdminInstituteCourses = new CaffeineCache(
                                "superAdminInstituteCourses",
                                caffeineCache2mBuilder().build());

                // Learner course structure caches (user-independent JSON trees; the
                // per-user progress is overlaid fresh on every request). Payloads can
                // be large (embedded document/quiz content), so sizes are kept small.
                CaffeineCache learnerModulesStructure = new CaffeineCache(
                                "learnerModulesStructure",
                                caffeineCacheStructureBuilder().build());
                CaffeineCache learnerPackageSlidesStructure = new CaffeineCache(
                                "learnerPackageSlidesStructure",
                                caffeineCacheStructureBuilder().build());

                // Parent-portal caches. MUST be registered or @Cacheable throws in the proxy.
                // guardianChildren: the authoritative guardian->children list (auth_service HMAC),
                // keyed on parentUserId, 60s so an admin re-link takes effect within a minute.
                CaffeineCache guardianChildren = new CaffeineCache(
                                "guardianChildren",
                                caffeineCache1mBuilder().build());
                // parentPortalSettings: institute PARENT_SETTING.parentPortal blob, 2m.
                CaffeineCache parentPortalSettings = new CaffeineCache(
                                "parentPortalSettings",
                                caffeineCache2mBuilder().build());

                // lmsConnectionHealth: the dashboard's LMS connection-health sweep, keyed on
                // instituteId. The widget polls every 60s, so without this each open dashboard
                // would independently probe the customer's WordPress/Moodle site every minute --
                // N admins means N times the outbound traffic to a third party we don't own.
                // 1m TTL matches the poll interval, so the widget is never showing anything older
                // than it claims. The manual refresh bypasses this (see LmsSettingService).
                CaffeineCache lmsConnectionHealth = new CaffeineCache(
                                "lmsConnectionHealth",
                                caffeineCache1mBuilder().build());

                // catalogPopularityRanks: public catalogue popularity ranks per instituteId
                // (CatalogPopularityService, behind the unauthenticated /open/packages/v1/popularity).
                // Lifetime per entry: loaded ranks 10m -- enrolment ranks move slowly, and this caps
                // the institute-scoped enrolment aggregate at one run per institute per pod per 10
                // minutes -- but the no-ranks stand-in for a FAILED load only 60s, so requests queued
                // behind a failing query share its answer instead of each re-running it, and the
                // ranks come back within a minute. MUST be registered or @Cacheable throws in the proxy.
                CaffeineCache catalogPopularityRanks = new CaffeineCache(
                                "catalogPopularityRanks",
                                caffeineCacheCatalogPopularityBuilder().build());

                cacheManager.setCaches(java.util.List.of(
                                studyLibraryInit,
                                facultyByPackageSessions,
                                studentsByPackageSessions,
                                batchNamesByPackageSessions,
                                instituteById,
                                openInstituteDetails,
                                openInstituteDetailsNonBatches,
                                openInstituteIdOrSubdomain,
                                packageSessionReadTimes,
                                instituteDashboard,
                                learnerInstituteDetails,
                                learnerInstituteDetailsByIds,
                                learnerInfo,
                                systemFileAccess,
                                systemFileList,
                                myFiles,
                                planningLogsList,
                                membershipDetails,
                                userPlanById,
                                userPlansByUser,
                                userPlanWithPaymentLogs,
                                executionLogs,
                                nodeLogs,
                                timeRangeLogs,
                                userDetails,
                                liveAndUpcomingSessions,
                                zoomAccessToken,
                                googleAccessToken,
                                learnerDashboard,
                                superAdminInstituteList,
                                superAdminInstituteDetail,
                                superAdminPlatformDashboard,
                                superAdminInstituteCourses,
                                learnerModulesStructure,
                                learnerPackageSlidesStructure,
                                guardianChildren,
                                parentPortalSettings,
                                lmsConnectionHealth,
                                catalogPopularityRanks));

                return cacheManager;
        }

        /**
         * 20-second TTL cache builder.
         */
        private Caffeine<Object, Object> caffeineCache20sBuilder() {
                return Caffeine.newBuilder()
                                .maximumSize(1000)
                                .expireAfterWrite(20, TimeUnit.SECONDS)
                                .recordStats();
        }

        /**
         * 1-minute TTL cache builder (for frequently changing data).
         */
        private Caffeine<Object, Object> caffeineCache1mBuilder() {
                return Caffeine.newBuilder()
                                .maximumSize(2000)
                                .expireAfterWrite(1, TimeUnit.MINUTES)
                                .recordStats();
        }

        /**
         * 2-minute TTL cache builder.
         */
        private Caffeine<Object, Object> caffeineCache2mBuilder() {
                return Caffeine.newBuilder()
                                .maximumSize(1000)
                                .expireAfterWrite(2, TimeUnit.MINUTES)
                                .recordStats();
        }

        /**
         * 3-minute TTL cache builder (for stable data).
         */
        private Caffeine<Object, Object> caffeineCache3mBuilder() {
                return Caffeine.newBuilder()
                                .maximumSize(500)
                                .expireAfterWrite(3, TimeUnit.MINUTES)
                                .recordStats();
        }

        /**
         * 5-minute TTL cache builder (for very stable data).
         */
        private Caffeine<Object, Object> caffeineCache5mBuilder() {
                return Caffeine.newBuilder()
                                .maximumSize(500)
                                .expireAfterWrite(5, TimeUnit.MINUTES)
                                .recordStats();
        }

        /**
         * catalogPopularityRanks builder: the lifetime is set per entry by
         * CatalogPopularityService.cacheExpiry() (loaded ranks 10 minutes, the stand-in for a
         * failed load 60 seconds). The size bound caps memory when the public endpoint is called
         * with many distinct (or made-up) institute ids.
         */
        private Caffeine<Object, Object> caffeineCacheCatalogPopularityBuilder() {
                return Caffeine.newBuilder()
                                .maximumSize(1000)
                                .expireAfter(CatalogPopularityService.cacheExpiry())
                                .recordStats();
        }

        /**
         * 5-minute TTL cache builder for User Details (High volume).
         */
        private Caffeine<Object, Object> caffeineCacheUserDetailsBuilder() {
                return Caffeine.newBuilder()
                                .maximumSize(10000) // Support up to 10k active users in memory
                                .expireAfterWrite(5, TimeUnit.MINUTES)
                                .recordStats();
        }

        /**
         * Course-structure JSON cache builder. 2-minute TTL bounds how long an
         * admin content edit can take to reach learners; small max size because
         * each entry is a whole course tree (can run to megabytes).
         */
        private Caffeine<Object, Object> caffeineCacheStructureBuilder() {
                return Caffeine.newBuilder()
                                .maximumSize(300)
                                .expireAfterWrite(2, TimeUnit.MINUTES)
                                .recordStats();
        }

        /**
         * Zoom S2S OAuth access token cache. TTL is 50 minutes because Zoom-issued
         * tokens are valid for 60 minutes — refreshing 10 minutes early avoids edge-case
         * 401s from clock skew or in-flight requests.
         */
        private Caffeine<Object, Object> caffeineCacheZoomTokenBuilder() {
                return Caffeine.newBuilder()
                                .maximumSize(500) // ~500 distinct zoom accounts cached in memory
                                .expireAfterWrite(50, TimeUnit.MINUTES)
                                .recordStats();
        }

        /**
         * Google OAuth access token cache. TTL 55 minutes — Google access tokens are valid
         * ~60 minutes; refreshing 5 minutes early avoids edge-case 401s.
         */
        private Caffeine<Object, Object> caffeineCacheGoogleTokenBuilder() {
                return Caffeine.newBuilder()
                                .maximumSize(500) // ~500 distinct connected Google accounts cached
                                .expireAfterWrite(55, TimeUnit.MINUTES)
                                .recordStats();
        }
}
