package vacademy.io.admin_core_service.features.marketing.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.repository.AdAccountRepository;
import vacademy.io.admin_core_service.features.marketing.repository.MarketingConnectionRepository;
import vacademy.io.admin_core_service.features.marketing.service.MarketingConnectionService;
import vacademy.io.common.logging.SentryLogger;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Daily sweep of Meta Ads grants. Meta user tokens live about 60 days and cannot be refreshed
 * server-side, so an admin must reconnect before expiry or spend stops syncing.
 * <ul>
 *   <li>expiring within 7 days: Sentry warning (so the team can nudge the institute);</li>
 *   <li>already expired: connection RECONNECT_NEEDED and its ACTIVE ad accounts ERROR
 *       ("Reconnect Meta"), so the dashboard shows the Reconnect banner.</li>
 * </ul>
 * META_SOCIAL grants are not swept: posting uses the Page tokens, which do not expire with the
 * user token, so an expired user token there needs no action.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class MarketingConnectionMonitorJob {

    private static final Duration WARN_WINDOW = Duration.ofDays(7);
    private static final String RECONNECT_META = "Reconnect Meta";

    private final MarketingConnectionRepository connectionRepository;
    private final MarketingConnectionService connectionService;
    private final AdAccountRepository adAccountRepository;

    @Value("${marketing.connection.monitor.enabled:true}")
    private boolean enabled;

    @Scheduled(cron = "${marketing.connection.monitor.cron:0 10 3 * * ?}")
    @SchedulerLock(name = "MarketingConnectionMonitorJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void sweepMetaTokens() {
        if (!enabled) {
            log.info("MarketingConnectionMonitorJob: disabled, skipping");
            return;
        }
        Instant now = Instant.now();
        List<MarketingConnection> connections = connectionRepository.findByProviderInAndStatusAndTokenExpiresAtBefore(
                List.of(MarketingConstants.PROVIDER_META_ADS), MarketingConstants.STATUS_ACTIVE, now.plus(WARN_WINDOW));
        int expired = 0;
        int expiring = 0;
        for (MarketingConnection connection : connections) {
            try {
                if (!connection.getTokenExpiresAt().isAfter(now)) {
                    expired++;
                    connectionService.markReconnect(connection.getId(), "Meta access expired. Reconnect Meta.");
                    int accounts = adAccountRepository.markErrorForConnection(connection.getId(), RECONNECT_META);
                    alert(connection, "Meta Ads access expired; " + accounts + " ad account(s) stopped syncing");
                } else {
                    expiring++;
                    long days = Math.max(0, Duration.between(now, connection.getTokenExpiresAt()).toDays());
                    alert(connection, "Meta Ads access expires in " + days + " day(s); the institute must reconnect");
                }
            } catch (Exception e) {
                log.error("MarketingConnectionMonitorJob: connection {} failed", connection.getId(), e);
            }
        }
        log.info("MarketingConnectionMonitorJob: {} expired, {} expiring within 7 days", expired, expiring);
    }

    private void alert(MarketingConnection connection, String message) {
        Map<String, String> tags = new LinkedHashMap<>();
        tags.put("feature", "marketing_connection");
        tags.put("provider", connection.getProvider());
        tags.put("connection_id", connection.getId());
        tags.put("institute_id", connection.getInstituteId());
        SentryLogger.logWarning(message + ": institute=" + connection.getInstituteId()
                + " connection=" + connection.getId(), tags);
        log.warn("MarketingConnectionMonitorJob: {} (institute={}, connection={})",
                message, connection.getInstituteId(), connection.getId());
    }
}
