package vacademy.io.admin_core_service.features.marketing.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.config.MarketingAsyncConfig;
import vacademy.io.admin_core_service.features.marketing.dto.AdAccountDTO;
import vacademy.io.admin_core_service.features.marketing.dto.AdPerformanceDTO;
import vacademy.io.admin_core_service.features.marketing.entity.AdAccount;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.repository.AdAccountRepository;
import vacademy.io.admin_core_service.features.marketing.service.AdPerformanceReportService;
import vacademy.io.admin_core_service.features.marketing.service.AdSpendSyncService;
import vacademy.io.admin_core_service.features.marketing.service.MarketingConnectionService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Connected ad accounts (Meta Ads, Google Ads) and the ad performance report.
 * Every endpoint is institute-admin only: the report shows spend.
 */
@RestController
@RequestMapping("/admin-core-service/v1/marketing/ads")
@Slf4j
public class MarketingAdsController {

    /** Longest a "Sync now" on one account holds the request; the sync itself keeps running. */
    private static final long SYNC_WAIT_SECONDS = 60;

    private final InstituteAccessValidator instituteAccessValidator;
    private final AdAccountRepository adAccountRepository;
    private final MarketingConnectionService connectionService;
    private final AdSpendSyncService adSpendSyncService;
    private final AdPerformanceReportService reportService;
    private final Executor syncExecutor;

    public MarketingAdsController(InstituteAccessValidator instituteAccessValidator,
                                  AdAccountRepository adAccountRepository,
                                  MarketingConnectionService connectionService,
                                  AdSpendSyncService adSpendSyncService,
                                  AdPerformanceReportService reportService,
                                  @Qualifier(MarketingAsyncConfig.MARKETING_SYNC_EXECUTOR) Executor syncExecutor) {
        this.instituteAccessValidator = instituteAccessValidator;
        this.adAccountRepository = adAccountRepository;
        this.connectionService = connectionService;
        this.adSpendSyncService = adSpendSyncService;
        this.reportService = reportService;
        this.syncExecutor = syncExecutor;
    }

    @GetMapping("/accounts")
    public ResponseEntity<List<AdAccountDTO>> listAccounts(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        List<AdAccount> accounts = adAccountRepository.findByInstituteIdAndStatusNot(
                instituteId, MarketingConstants.STATUS_DISCONNECTED);
        Map<String, MarketingConnection> connections = connectionService.findByIds(
                accounts.stream().map(AdAccount::getConnectionId).toList());
        return ResponseEntity.ok(accounts.stream()
                .sorted(Comparator.comparing(AdAccount::getPlatform, Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(AdAccount::getName, Comparator.nullsLast(Comparator.naturalOrder())))
                .map(a -> AdAccountDTO.from(a, connections.get(a.getConnectionId())))
                .toList());
    }

    /** Stops syncing an account. Its spend rows are kept; the report ignores DISCONNECTED accounts. */
    @DeleteMapping("/accounts/{id}")
    public ResponseEntity<AdAccountDTO> disconnectAccount(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        AdAccount account = requireAccount(id, instituteId);
        account.setStatus(MarketingConstants.STATUS_DISCONNECTED);
        account.setStatusDetail(null);
        AdAccount saved = adAccountRepository.save(account);
        reportService.evictInstitute(instituteId);
        log.info("Ad account {} ({} {}) disconnected in institute {} by {}", saved.getId(), saved.getPlatform(),
                saved.getExternalAccountId(), instituteId, user.getUserId());
        return ResponseEntity.ok(AdAccountDTO.from(saved, connectionService.findById(saved.getConnectionId()).orElse(null)));
    }

    /**
     * Syncs one account now (last refresh-days; a first sync backfills) and returns it. Waits at most
     * 60 seconds; a longer backfill keeps running in the background and the account is returned as it
     * stands.
     */
    @PostMapping("/accounts/{id}/sync")
    public ResponseEntity<AdAccountDTO> syncAccount(
            @PathVariable String id,
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        AdAccount account = requireAccount(id, instituteId);
        if (MarketingConstants.STATUS_DISCONNECTED.equals(account.getStatus())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "This ad account is disconnected. Connect it again to sync.");
        }
        int days = adSpendSyncService.refreshDays();
        CompletableFuture<AdSpendSyncService.SyncResult> future;
        try {
            future = CompletableFuture.supplyAsync(() -> adSpendSyncService.syncAccount(id, days), syncExecutor);
        } catch (RejectedExecutionException e) {
            throw new VacademyException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Too many syncs are running right now. Please try again in a few minutes.");
        }
        try {
            future.get(SYNC_WAIT_SECONDS, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            log.info("Sync of ad account {} is still running after {}s; answering with the current state",
                    id, SYNC_WAIT_SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (ExecutionException e) {
            log.error("Sync of ad account {} failed", id, e.getCause());
        }
        reportService.evictInstitute(instituteId);
        AdAccount fresh = requireAccount(id, instituteId);
        return ResponseEntity.ok(AdAccountDTO.from(fresh, connectionService.findById(fresh.getConnectionId()).orElse(null)));
    }

    /**
     * Queues a sync of every syncable account of the institute (ACTIVE, or ERROR while its
     * connection is ACTIVE) and answers 202 at once.
     */
    @PostMapping("/sync")
    public ResponseEntity<Map<String, Integer>> syncAll(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        List<AdAccount> accounts = adAccountRepository.findByInstituteIdAndStatusNot(
                instituteId, MarketingConstants.STATUS_DISCONNECTED);
        Map<String, MarketingConnection> connections = connectionService.findByIds(
                accounts.stream().map(AdAccount::getConnectionId).toList());
        int queued = 0;
        for (AdAccount account : accounts) {
            if (!AdSpendSyncService.isSyncable(account, connections.get(account.getConnectionId()))) continue;
            adSpendSyncService.syncAccountAsync(account.getId());
            queued++;
        }
        reportService.evictInstitute(instituteId);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of("queued", queued));
    }

    @GetMapping("/performance")
    public ResponseEntity<AdPerformanceDTO> performance(
            @RequestParam String instituteId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteAdmin(user, instituteId);
        return ResponseEntity.ok(reportService.getPerformance(instituteId, from, to));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private AdAccount requireAccount(String id, String instituteId) {
        return adAccountRepository.findById(id)
                .filter(a -> instituteId.equals(a.getInstituteId()))
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Ad account not found"));
    }
}
