package vacademy.io.admin_core_service.features.marketing.publisher;

import com.fasterxml.jackson.databind.JsonNode;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;

import java.util.Set;
import java.util.function.Supplier;

/** Small helpers shared by the publishers. */
final class SocialPublisherSupport {

    private SocialPublisherSupport() {
    }

    /** Meta rate-limit / throttling codes: rejected before anything was created. */
    private static final Set<String> META_REJECTED_BEFORE_PROCESSING = Set.of("4", "17", "32", "341", "613");
    /** Google / HTTP codes that mean the request was refused before it ran. */
    private static final Set<String> REJECTED_BEFORE_PROCESSING = Set.of(
            MarketingApiException.CONNECT_ERROR, "HTTP_429", "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED",
            "rateLimitExceeded", "userRateLimitExceeded");

    /**
     * Runs the call that creates a public post (not idempotent). A transient failure that does not
     * prove the request was refused before it ran (timeout, dropped response, 5xx, Meta code 1/2)
     * becomes a permanent OUTCOME_UNKNOWN: retrying could publish the same post twice, so the admin
     * is told to check the profile first. Rate limits and connect failures stay transient.
     *
     * @param where e.g. "the Page", used in the message
     */
    static JsonNode createOnce(Supplier<JsonNode> call, String platformLabel, String where) {
        try {
            return call.get();
        } catch (MarketingApiException e) {
            if (e.isTransientError() && !rejectedBeforeProcessing(e)) {
                throw new MarketingApiException(MarketingApiException.OUTCOME_UNKNOWN,
                        platformLabel + " did not confirm the post (" + e.getMessage() + "). It may already be live: "
                                + "check " + where + " before retrying.", false, false);
            }
            throw e;
        }
    }

    /** True when the platform refused the request before acting on it, so a retry cannot duplicate. */
    static boolean rejectedBeforeProcessing(MarketingApiException e) {
        String code = e.getPlatformCode();
        if (code == null) return false;
        if (REJECTED_BEFORE_PROCESSING.contains(code)) return true;
        int slash = code.indexOf('/');
        String main = slash < 0 ? code : code.substring(0, slash);
        if (META_REJECTED_BEFORE_PROCESSING.contains(main)) return true;
        try {
            int n = Integer.parseInt(main);
            return n >= 80000 && n <= 80014;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    /** Decrypted Page token of a Facebook/Instagram account; an auth error when it is missing. */
    static String pageToken(SocialAccount account, TokenEncryptionService encryption, String platformLabel) {
        String enc = account.getAccessTokenEnc();
        if (enc == null || enc.isBlank()) {
            throw new MarketingApiException("NO_TOKEN",
                    platformLabel + " access is missing. Reconnect Facebook & Instagram.", false, true);
        }
        String token;
        try {
            token = encryption.decrypt(enc);
        } catch (Exception e) {
            throw new MarketingApiException("TOKEN_DECRYPT_FAILED",
                    platformLabel + " access could not be read. Reconnect Facebook & Instagram.", false, true);
        }
        if (token == null || token.isBlank()) {
            throw new MarketingApiException("NO_TOKEN",
                    platformLabel + " access is missing. Reconnect Facebook & Instagram.", false, true);
        }
        return token;
    }

    /** Facebook permalinks sometimes come back site-relative ("/page/videos/1/"). */
    static String absoluteFacebookUrl(String url) {
        if (url == null || url.isBlank()) return null;
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        return "https://www.facebook.com" + (url.startsWith("/") ? url : "/" + url);
    }

    static String text(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
