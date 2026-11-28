package vacademy.io.admin_core_service.features.marketing.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.entity.AdAccount;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.repository.AdAccountRepository;
import vacademy.io.admin_core_service.features.marketing.service.AdSpendSyncService;
import vacademy.io.admin_core_service.features.marketing.service.MarketingConnectionService;
import vacademy.io.common.logging.SentryLogger;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Refreshes ad spend for every syncable ad account (ACTIVE, or ERROR whose connection is ACTIVE
 * again), one account at a time, every 6 hours by default. One pod runs it (ShedLock); one bad
 * account never stops the sweep. Permanent failures (not rate limits / outages) raise a Sentry
 * warning so the team sees broken accounts before the institute does.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AdSpendSyncJob {

    private final AdAccountRepository adAccountRepository;
    private final MarketingConnectionService connectionService;
    private final AdSpendSyncService adSpendSyncService;

    @Value("${marketing.ads.sync.enabled:true}")
    private boolean enabled;

    @Scheduled(cron = "${marketing.ads.sync.cron:0 20 */6 * * ?}")
    @SchedulerLock(name = "MarketingAdSpendSyncJob", lockAtMostFor = "PT2H", lockAtLeastFor = "PT5M")
    public void syncAdSpend() {
        if (!enabled) {
            log.info("AdSpendSyncJob: disabled, skipping");
            return;
        }
        List<AdAccount> accounts = adAccountRepository.findByStatusIn(
                List.of(MarketingConstants.STATUS_ACTIVE, MarketingConstants.STATUS_ERROR));
        Map<String, MarketingConnection> connections = connectionService.findByIds(
                accounts.stream().map(AdAccount::getConnectionId).toList());

        int ok = 0;
        int failed = 0;
        int skipped = 0;
        for (AdAccount account : accounts) {
            try {
                if (!AdSpendSyncService.isSyncable(account, connections.get(account.getConnectionId()))) {
                    skipped++;
                    continue;
                }
                AdSpendSyncService.SyncResult result = adSpendSyncService.syncAccount(account.getId(), null);
                if (result.ok()) {
                    ok++;
                } else if (result.error() != null) {
                    failed++;
                    if (!result.error().isTransientError()) alert(account, result.error());
                } else {
                    skipped++;
                }
            } catch (Exception e) {
                failed++;
                log.error("AdSpendSyncJob: ad account {} failed", account.getId(), e);
            }
        }
        log.info("AdSpendSyncJob: {} synced, {} failed, {} skipped (of {})", ok, failed, skipped, accounts.size());
    }

    private void alert(AdAccount account, MarketingApiException error) {
        Map<String, String> tags = new LinkedHashMap<>();
        tags.put("feature", "marketing_ad_spend_sync");
        tags.put("platform", account.getPlatform());
        tags.put("ad_account_id", account.getId());
        tags.put("institute_id", account.getInstituteId());
        tags.put("platform_code", String.valueOf(error.getPlatformCode()));
        tags.put("auth_error", String.valueOf(error.isAuthError()));
        SentryLogger.logWarning("Ad spend sync failed for " + account.getPlatform() + " ad account "
                + account.getId() + " (institute " + account.getInstituteId() + "): " + error.getMessage(), tags);
    }
}
