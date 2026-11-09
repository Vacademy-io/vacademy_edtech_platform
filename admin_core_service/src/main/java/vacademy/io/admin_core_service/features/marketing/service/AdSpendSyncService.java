package vacademy.io.admin_core_service.features.marketing.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.client.GoogleAdsApiClient;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.client.MetaGraphClient;
import vacademy.io.admin_core_service.features.marketing.config.MarketingAsyncConfig;
import vacademy.io.admin_core_service.features.marketing.entity.AdAccount;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.repository.AdAccountRepository;
import vacademy.io.admin_core_service.features.marketing.repository.AdSpendDailyRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;

/**
 * Pulls daily campaign spend from Meta (ads insights) and Google Ads (GAQL) into ad_spend_daily.
 *
 * <p>Window: an account that never synced gets a backfill of {@code marketing.ads.sync.backfill-days};
 * afterwards each run re-fetches the last {@code refresh-days} (platforms revise recent days), always
 * through today in the ad account time zone (today is partial and is re-fetched next run).
 * Rows are upserted on (ad_account_id, campaign_id, day) in one transaction, only after every
 * platform call of the run succeeded, so a failed run never leaves a half-written window.
 *
 * <p>Outcome on the ad_account row: success sets last_synced_at, last_sync_status=OK, synced_from
 * and clears an ERROR. An auth error sets ERROR "Reconnect Meta|Google" (and, when the grant itself
 * is dead, the connection RECONNECT_NEEDED and its other accounts ERROR). Any other permanent error
 * sets ERROR with the platform message; a transient error only records FAILED + the message.
 */
@Service
@Slf4j
public class AdSpendSyncService implements AdSpendSyncTrigger {

    static final int META_MAX_PAGES = 50;
    /** Meta windows longer than this are split into {@link #META_CHUNK_DAYS}-day requests. */
    static final int META_SINGLE_REQUEST_MAX_DAYS = 90;
    static final int META_CHUNK_DAYS = 30;
    /** Upper bound for an explicit window (manual sync). */
    static final int MAX_WINDOW_DAYS = 400;

    private static final String META_INSIGHT_FIELDS =
            "campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency";

    private final AdAccountRepository adAccountRepository;
    private final AdSpendDailyRepository adSpendDailyRepository;
    private final MarketingConnectionService connectionService;
    private final MetaGraphClient metaGraphClient;
    private final GoogleAdsApiClient googleAdsApiClient;
    private final TransactionTemplate writeTx;
    private final Executor syncExecutor;

    /** Accounts syncing on this pod right now (another pod may still run one; upserts make that harmless). */
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();

    @Value("${marketing.ads.sync.backfill-days:180}")
    private int backfillDays;

    @Value("${marketing.ads.sync.refresh-days:7}")
    private int refreshDays;

    public AdSpendSyncService(AdAccountRepository adAccountRepository,
                              AdSpendDailyRepository adSpendDailyRepository,
                              MarketingConnectionService connectionService,
                              MetaGraphClient metaGraphClient,
                              GoogleAdsApiClient googleAdsApiClient,
                              PlatformTransactionManager transactionManager,
                              @Qualifier(MarketingAsyncConfig.MARKETING_SYNC_EXECUTOR) Executor syncExecutor) {
        this.adAccountRepository = adAccountRepository;
        this.adSpendDailyRepository = adSpendDailyRepository;
        this.connectionService = connectionService;
        this.metaGraphClient = metaGraphClient;
        this.googleAdsApiClient = googleAdsApiClient;
        this.writeTx = new TransactionTemplate(transactionManager);
        this.syncExecutor = syncExecutor;
    }

    /** Outcome of one sync run. {@code account} is the row as saved after the run (null if it vanished). */
    public record SyncResult(AdAccount account, boolean ok, int rowsWritten, MarketingApiException error) {
    }

    public int refreshDays() {
        return refreshDays;
    }

    // ── Entry points ─────────────────────────────────────────────────────────

    /** Queues a sync on the marketing executor and returns at once. Never throws. */
    @Override
    public void syncAccountAsync(String adAccountId) {
        if (adAccountId == null) return;
        try {
            syncExecutor.execute(() -> {
                try {
                    syncAccount(adAccountId, null);
                } catch (Exception e) {
                    log.error("Background ad spend sync failed for ad account {}", adAccountId, e);
                }
            });
        } catch (RejectedExecutionException e) {
            log.warn("Ad spend sync queue is full; ad account {} waits for the scheduled sync", adAccountId);
        }
    }

    /**
     * Syncs one ad account now, on the calling thread.
     *
     * @param days explicit refresh window in days (ignored for the first sync, which always
     *             backfills); null = {@code refresh-days}
     */
    public SyncResult syncAccount(String adAccountId, Integer days) {
        if (adAccountId == null) return new SyncResult(null, false, 0, null);
        if (!inFlight.add(adAccountId)) {
            log.info("Ad spend sync for ad account {} is already running on this pod; skipping", adAccountId);
            return new SyncResult(adAccountRepository.findById(adAccountId).orElse(null), false, 0, null);
        }
        try {
            return doSync(adAccountId, days);
        } finally {
            inFlight.remove(adAccountId);
        }
    }

    // ── Sync ─────────────────────────────────────────────────────────────────

    private SyncResult doSync(String adAccountId, Integer days) {
        AdAccount account = adAccountRepository.findById(adAccountId).orElse(null);
        if (account == null) return new SyncResult(null, false, 0, null);
        if (MarketingConstants.STATUS_DISCONNECTED.equals(account.getStatus())) {
            return new SyncResult(account, false, 0, null);
        }

        LocalDate today = LocalDate.now(zoneOf(account.getTimeZone()));
        int windowDays = account.getSyncedFrom() == null ? backfillDays
                : days != null && days > 0 ? Math.min(days, MAX_WINDOW_DAYS) : refreshDays;
        LocalDate from = today.minusDays(Math.max(0, windowDays));

        MarketingConnection connection = connectionService.findById(account.getConnectionId()).orElse(null);
        try {
            List<AdSpendRowMapper.SpendRow> rows = MarketingConstants.PLATFORM_GOOGLE.equals(account.getPlatform())
                    ? fetchGoogle(account, connection, from, today)
                    : fetchMeta(account, connection, from, today);
            write(account, rows);
            AdAccount saved = recordSuccess(adAccountId, from);
            log.info("Ad spend sync OK: account={} platform={} window={}..{} rows={}",
                    adAccountId, account.getPlatform(), from, today, rows.size());
            return new SyncResult(saved, true, rows.size(), null);
        } catch (MarketingApiException e) {
            log.warn("Ad spend sync failed: account={} platform={} code={} transient={} auth={}: {}",
                    adAccountId, account.getPlatform(), e.getPlatformCode(), e.isTransientError(),
                    e.isAuthError(), e.getMessage());
            return new SyncResult(recordFailure(account, e), false, 0, e);
        } catch (VacademyException e) {
            // Configuration problems such as a missing Google Ads developer token.
            MarketingApiException wrapped = new MarketingApiException("CONFIG", e.getMessage(), false, false);
            log.warn("Ad spend sync failed: account={} platform={}: {}", adAccountId, account.getPlatform(),
                    e.getMessage());
            return new SyncResult(recordFailure(account, wrapped), false, 0, wrapped);
        } catch (Exception e) {
            log.error("Ad spend sync crashed: account={} platform={}", adAccountId, account.getPlatform(), e);
            MarketingApiException wrapped = new MarketingApiException("INTERNAL",
                    "Sync failed unexpectedly. It will be retried.", true, false);
            return new SyncResult(recordFailure(account, wrapped), false, 0, wrapped);
        }
    }

    private List<AdSpendRowMapper.SpendRow> fetchMeta(AdAccount account, MarketingConnection connection,
                                                      LocalDate from, LocalDate to) {
        String token = connectionService.metaUserToken(connection);
        String actId = "act_" + GoogleAdsApiClient.digits(account.getExternalAccountId());
        List<JsonNode> insights = new ArrayList<>();
        for (LocalDate[] window : AdSpendRowMapper.metaRequestWindows(from, to,
                META_SINGLE_REQUEST_MAX_DAYS, META_CHUNK_DAYS)) {
            insights.addAll(metaGraphClient.getAllPages(metaInsightsPath(actId, window[0], window[1]),
                    token, META_MAX_PAGES));
        }
        return AdSpendRowMapper.fromMetaInsights(insights, account.getCurrency());
    }

    static String metaInsightsPath(String actId, LocalDate since, LocalDate until) {
        String timeRange = "{\"since\":\"" + since + "\",\"until\":\"" + until + "\"}";
        return actId + "/insights?level=campaign&time_increment=1"
                + "&time_range=" + MetaGraphClient.enc(timeRange)
                + "&fields=" + MetaGraphClient.enc(META_INSIGHT_FIELDS)
                + "&limit=500";
    }

    private List<AdSpendRowMapper.SpendRow> fetchGoogle(AdAccount account, MarketingConnection connection,
                                                        LocalDate from, LocalDate to) {
        if (connection == null) {
            throw new MarketingApiException("NO_CONNECTION", "Google is not connected. Reconnect Google.", false, true);
        }
        List<JsonNode> rows = googleAdsApiClient.search(account.getExternalAccountId(), account.getLoginCustomerId(),
                AdSpendRowMapper.googleSpendQuery(from, to), connection);
        return AdSpendRowMapper.fromGoogleSearch(rows, account.getCurrency());
    }

    private void write(AdAccount account, List<AdSpendRowMapper.SpendRow> rows) {
        if (rows.isEmpty()) return;
        writeTx.executeWithoutResult(status -> {
            for (AdSpendRowMapper.SpendRow row : rows) {
                adSpendDailyRepository.upsert(account.getInstituteId(), account.getId(), account.getPlatform(),
                        row.channel(), row.campaignId(), truncate(row.campaignName(), 512), row.day(),
                        row.spend(), row.currency() != null ? truncate(row.currency(), 8) : account.getCurrency(),
                        row.impressions(), row.clicks(), row.platformLeads());
            }
        });
    }

    // ── Outcome bookkeeping ──────────────────────────────────────────────────

    private AdAccount recordSuccess(String adAccountId, LocalDate windowFrom) {
        AdAccount fresh = adAccountRepository.findById(adAccountId).orElse(null);
        if (fresh == null) return null;
        fresh.setLastSyncedAt(Instant.now());
        fresh.setLastSyncStatus(MarketingConstants.SYNC_STATUS_OK);
        if (fresh.getSyncedFrom() == null || windowFrom.isBefore(fresh.getSyncedFrom())) {
            fresh.setSyncedFrom(windowFrom);
        }
        if (!MarketingConstants.STATUS_DISCONNECTED.equals(fresh.getStatus())) {
            fresh.setStatus(MarketingConstants.STATUS_ACTIVE);
            fresh.setStatusDetail(null);
        }
        return adAccountRepository.save(fresh);
    }

    private AdAccount recordFailure(AdAccount account, MarketingApiException e) {
        AdAccount fresh = adAccountRepository.findById(account.getId()).orElse(null);
        if (fresh == null) return null;
        fresh.setLastSyncStatus(MarketingConstants.SYNC_STATUS_FAILED);
        boolean disconnected = MarketingConstants.STATUS_DISCONNECTED.equals(fresh.getStatus());
        if (e.isAuthError()) {
            String reconnect = "Reconnect " + platformLabel(fresh.getPlatform());
            if (!disconnected) {
                fresh.setStatus(MarketingConstants.STATUS_ERROR);
                fresh.setStatusDetail(isAccountScopedAuthError(e) ? reconnect + ": " + e.getMessage() : reconnect);
            }
            if (!isAccountScopedAuthError(e)) {
                // The grant itself is unusable: every account on it needs the same reconnect.
                connectionService.markReconnect(fresh.getConnectionId(), e.getMessage());
                adAccountRepository.markErrorForConnection(fresh.getConnectionId(), reconnect);
            }
        } else if (e.isTransientError()) {
            if (!disconnected) fresh.setStatusDetail(truncate(e.getMessage(), 2000));
        } else if (!disconnected) {
            fresh.setStatus(MarketingConstants.STATUS_ERROR);
            fresh.setStatusDetail(truncate(e.getMessage(), 2000));
        }
        return adAccountRepository.save(fresh);
    }

    /** The user lost access to this one ad account; the grant still works for the others. */
    private static boolean isAccountScopedAuthError(MarketingApiException e) {
        return "USER_PERMISSION_DENIED".equals(e.getPlatformCode());
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** ACTIVE accounts, and ERROR accounts whose grant is ACTIVE again (e.g. after a reconnect). */
    public static boolean isSyncable(AdAccount account, MarketingConnection connection) {
        if (account == null) return false;
        if (MarketingConstants.STATUS_ACTIVE.equals(account.getStatus())) return true;
        return MarketingConstants.STATUS_ERROR.equals(account.getStatus())
                && connection != null
                && MarketingConstants.STATUS_ACTIVE.equals(connection.getStatus());
    }

    static String platformLabel(String platform) {
        return MarketingConstants.PLATFORM_GOOGLE.equals(platform) ? "Google" : "Meta";
    }

    static ZoneId zoneOf(String timeZone) {
        if (timeZone == null || timeZone.isBlank()) return ZoneOffset.UTC;
        try {
            return ZoneId.of(timeZone.trim());
        } catch (Exception e) {
            return ZoneOffset.UTC;
        }
    }

    private static String truncate(String value, int max) {
        if (value == null) return null;
        return value.length() <= max ? value : value.substring(0, max);
    }
}
