package vacademy.io.admin_core_service.features.marketing.service;

/**
 * Starts an ad-account spend sync in the background. Implemented by the ads sync service; the OAuth
 * account selection calls it right after an ad account is connected so the backfill starts at once.
 */
public interface AdSpendSyncTrigger {

    /** Queue a sync of one ad account (initial backfill when it has never synced). Returns at once. */
    void syncAccountAsync(String adAccountId);
}
