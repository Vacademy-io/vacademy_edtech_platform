package vacademy.io.admin_core_service.features.live_session.provider.service.zoom;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.CacheManager;
import org.springframework.cache.Cache;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.live_session.provider.dto.zoom.ZoomAccount;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.external.VendorCallLog;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Fetches and caches Server-to-Server OAuth access tokens for Zoom accounts.
 *
 * Tokens are valid for 60 minutes; we cache for 50 (see CacheConfiguration#caffeineCacheZoomTokenBuilder)
 * so an in-flight request never hits a freshly-expired token. The cache key is the
 * ZoomAccount.id (our own UUID), NOT the Zoom-side account_id.
 *
 * Decrypted secrets MUST NOT be logged. The error-path uses sanitized identifiers only.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ZoomAccessTokenService {

    private static final String CACHE_NAME = "zoomAccessToken";

    private final CacheManager cacheManager;
    private final TokenEncryptionService encryption;
    private final WebClient.Builder webClientBuilder;
    private final ZoomOAuthService zoomOAuthService;

    /**
     * Returns a valid bearer access token for the given Zoom account. Hits the cache
     * first; on miss, performs the S2S OAuth client-credentials request against Zoom.
     *
     * @throws VacademyException if Zoom rejects the credentials (caller should mark the account INVALID)
     */
    public String getAccessToken(ZoomAccount account) {
        Cache cache = cacheManager.getCache(CACHE_NAME);
        if (cache != null) {
            String cached = cache.get(account.getId(), String.class);
            if (cached != null) {
                return cached;
            }
        }

        // OAUTH accounts ("Connect with Zoom") mint tokens from the rotating refresh token;
        // S2S accounts use the account_credentials grant. Everything downstream (meeting
        // create, ZAK, recordings) is unchanged — it all flows through this one method.
        String token = "OAUTH".equalsIgnoreCase(account.getAuthType())
                ? zoomOAuthService.refreshAndGet(account)
                : fetchFromZoom(account);
        if (cache != null) {
            cache.put(account.getId(), token);
        }
        return token;
    }

    /**
     * Fetches a ZAK (Zoom Access Key) token for the account owner — required for the
     * Meeting SDK to *start* a meeting as host (role = 1). Returns null on failure so
     * callers can degrade gracefully (participants don't need a ZAK).
     */
    public String getZakToken(ZoomAccount account) {
        try {
            String token = getAccessToken(account);
            JsonNode resp = webClientBuilder.build()
                    .get()
                    .uri(ZoomEndpoints.API_BASE_URL + "/users/me/token?type=zak")
                    .header("Authorization", "Bearer " + token)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .doOnError(e -> VendorCallLog.failed(ZoomEndpoints.API_BASE_URL, "fetch zak token", null, e))
                    .block();
            return resp != null && resp.hasNonNull("token") ? resp.get("token").asText() : null;
        } catch (WebClientResponseException e) {
            // Surface Zoom's body so a missing ZAK scope is visible — e.g. a 400 with
            // "does not contain scopes:[user_zak:read]" means the app needs that scope to
            // mint the host's ZAK (host/role=1 can't start the meeting without it).
            log.warn("zoom.zak.fetch.fail accountId={} status={} body={}", account.getId(),
                    e.getStatusCode().value(), e.getResponseBodyAsString());
            return null;
        } catch (Exception e) {
            log.warn("zoom.zak.fetch.fail accountId={} reason={}", account.getId(),
                    e.getClass().getSimpleName());
            return null;
        }
    }

    /**
     * Evicts the cached token for an account. Call this after a 401 from the Zoom API
     * so the next request re-issues a fresh token.
     */
    public void evict(String accountId) {
        Cache cache = cacheManager.getCache(CACHE_NAME);
        if (cache != null) {
            cache.evict(accountId);
        }
    }

    private String fetchFromZoom(ZoomAccount account) {
        String clientId = account.getS2sClientId();
        String clientSecret = encryption.decrypt(account.getS2sClientSecretEnc());

        String basic = Base64.getEncoder().encodeToString(
                (clientId + ":" + clientSecret).getBytes(StandardCharsets.UTF_8));

        // Zoom's S2S OAuth uses query-string params even on POST.
        String url = ZoomEndpoints.OAUTH_TOKEN_URL
                + "?grant_type=account_credentials"
                + "&account_id=" + account.getZoomAccountId();

        long start = System.currentTimeMillis();
        try {
            JsonNode response = webClientBuilder.build()
                    .post()
                    .uri(url)
                    .header("Authorization", "Basic " + basic)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .doOnError(e -> VendorCallLog.failed(url, "fetch s2s access token", null, e))
                    .block();

            if (response == null || !response.hasNonNull("access_token")) {
                throw new VacademyException("Zoom OAuth response missing access_token");
            }

            long elapsed = System.currentTimeMillis() - start;
            log.info("zoom.token.refresh accountId={} latencyMs={} success=true",
                    account.getId(), elapsed);
            return response.get("access_token").asText();

        } catch (WebClientResponseException e) {
            long elapsed = System.currentTimeMillis() - start;
            log.error("zoom.token.refresh accountId={} latencyMs={} httpStatus={} success=false",
                    account.getId(), elapsed, e.getStatusCode().value());
            throw new VacademyException(
                    "Zoom rejected credentials for account '" + account.getLabel()
                            + "': HTTP " + e.getStatusCode().value());
        } catch (Exception e) {
            log.error("zoom.token.refresh accountId={} exception={} success=false",
                    account.getId(), e.getClass().getSimpleName());
            throw new VacademyException("Failed to fetch Zoom access token: " + e.getMessage());
        }
    }

}
