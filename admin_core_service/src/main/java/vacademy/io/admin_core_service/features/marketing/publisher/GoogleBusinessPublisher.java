package vacademy.io.admin_core_service.features.marketing.publisher;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.client.GoogleApiClient;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPost;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPostTarget;
import vacademy.io.admin_core_service.features.marketing.service.GoogleOAuthTokenService;
import vacademy.io.admin_core_service.features.marketing.service.MarketingConnectionService;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Google Business Profile "What's new" posts:
 * {@code POST https://mybusiness.googleapis.com/v4/{account}/{location}/localPosts} with the
 * summary, photos and a LEARN_MORE button for the link. A post Google marks REJECTED fails.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class GoogleBusinessPublisher implements SocialPublisher {

    private static final String LOCAL_POSTS_BASE = "https://mybusiness.googleapis.com/v4/";

    private final GoogleApiClient googleApiClient;
    private final GoogleOAuthTokenService tokenService;
    private final MarketingConnectionService connectionService;

    @Override
    public String platform() {
        return MarketingConstants.PLATFORM_GOOGLE_BUSINESS;
    }

    @Override
    public PublishResult publish(SocialPost post, SocialPostTarget target, SocialAccount account,
                                 ResolvedMedia media, String text) {
        String accountResource = account.getParentExternalId();
        String locationResource = account.getExternalId();
        if (accountResource == null || accountResource.isBlank()
                || locationResource == null || locationResource.isBlank()) {
            throw new MarketingApiException("LOCATION_INCOMPLETE",
                    "This Business Profile location is incomplete. Reconnect Google Business Profile.", false, true);
        }
        MarketingConnection connection = connectionService.findById(account.getConnectionId())
                .orElseThrow(() -> new MarketingApiException("NO_CONNECTION",
                        "Google Business Profile is not connected. Connect it again.", false, true));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("languageCode", "en");
        body.put("summary", text);
        body.put("topicType", "STANDARD");
        List<Map<String, Object>> photos = new ArrayList<>();
        for (ResolvedMedia.Item image : media.images()) {
            if (image.url() == null || image.url().isBlank()) {
                throw new MarketingApiException("MEDIA_URL_MISSING",
                        "A photo of this post could not be found. Upload it again.", false, false);
            }
            photos.add(Map.of("mediaFormat", "PHOTO", "sourceUrl", image.url()));
        }
        if (!photos.isEmpty()) body.put("media", photos);
        String link = post.getLinkUrl();
        if (link != null && !link.isBlank()) {
            body.put("callToAction", Map.of("actionType", "LEARN_MORE", "url", link));
        }

        String url = LOCAL_POSTS_BASE + stripSlashes(accountResource) + "/" + stripSlashes(locationResource)
                + "/localPosts";
        JsonNode res;
        // localPosts.create is not idempotent: a timeout / 5xx may still have created the post.
        // The token is fetched outside createOnce: a failed token refresh never reached localPosts.
        try {
            String accessToken = tokenService.getAccessToken(connection);
            res = SocialPublisherSupport.createOnce(() -> googleApiClient.postJson(url, body, accessToken),
                    "Google Business Profile", "the Business Profile");
        } catch (MarketingApiException e) {
            if (!e.isAuthError()) throw e;
            // A cached token can be revoked early; mint a fresh one once before giving up.
            tokenService.evict(connection.getId());
            String freshToken = tokenService.getAccessToken(connection);
            res = SocialPublisherSupport.createOnce(() -> googleApiClient.postJson(url, body, freshToken),
                    "Google Business Profile", "the Business Profile");
        }

        String state = res.path("state").asText("");
        if ("REJECTED".equals(state)) {
            throw new MarketingApiException("REJECTED",
                    "Google rejected this post (it may break the Business Profile content policy).", false, false);
        }
        String name = res.path("name").asText(null);
        String searchUrl = res.path("searchUrl").asText(null);
        return PublishResult.posted(name, searchUrl == null || searchUrl.isBlank() ? null : searchUrl);
    }

    private static String stripSlashes(String s) {
        String out = s.strip();
        while (out.startsWith("/")) out = out.substring(1);
        while (out.endsWith("/")) out = out.substring(0, out.length() - 1);
        return out;
    }
}
