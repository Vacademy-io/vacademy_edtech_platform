package vacademy.io.admin_core_service.features.marketing.publisher;

import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;

/** Small helpers shared by the Meta publishers. */
final class SocialPublisherSupport {

    private SocialPublisherSupport() {
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
