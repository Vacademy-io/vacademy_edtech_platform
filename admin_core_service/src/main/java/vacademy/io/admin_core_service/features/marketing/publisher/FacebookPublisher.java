package vacademy.io.admin_core_service.features.marketing.publisher;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.client.MetaGraphClient;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPost;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPostTarget;
import vacademy.io.admin_core_service.features.marketing.service.SocialPostRules;

import java.util.ArrayList;
import java.util.List;

/**
 * Facebook Page posts with the Page token:
 * <ul>
 *   <li>text / link: {@code POST /{page}/feed} (message, link);</li>
 *   <li>one image: {@code POST /{page}/photos} (url, caption);</li>
 *   <li>several images: each {@code POST /{page}/photos published=false}, then {@code /feed}
 *       with {@code attached_media[i]};</li>
 *   <li>video: {@code POST /{page}/videos} (file_url, description).</li>
 * </ul>
 * With media the link is appended to the text (Facebook takes no separate link there).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class FacebookPublisher implements SocialPublisher {

    private static final String LABEL = "Facebook";

    private final MetaGraphClient graph;
    private final TokenEncryptionService tokenEncryptionService;

    @Override
    public String platform() {
        return MarketingConstants.PLATFORM_FACEBOOK;
    }

    @Override
    public PublishResult publish(SocialPost post, SocialPostTarget target, SocialAccount account,
                                 ResolvedMedia media, String text) {
        String token = SocialPublisherSupport.pageToken(account, tokenEncryptionService, LABEL);
        String pageId = account.getExternalId();
        String link = SocialPublisherSupport.text(post.getLinkUrl());

        ResolvedMedia.Item video = media.video();
        if (video != null) {
            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("file_url", requireUrl(video));
            form.add("description", SocialPostRules.withLink(text, link));
            if (post.getTitle() != null && !post.getTitle().isBlank()) form.add("title", post.getTitle());
            JsonNode res = graph.postForm(pageId + "/videos", form, token);
            String videoId = requireId(res, "id");
            return PublishResult.posted(videoId, permalink(videoId, token));
        }

        List<ResolvedMedia.Item> images = media.images();
        if (images.size() == 1) {
            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("url", requireUrl(images.get(0)));
            String caption = SocialPostRules.withLink(text, link);
            if (!caption.isEmpty()) form.add("caption", caption);
            JsonNode res = graph.postForm(pageId + "/photos", form, token);
            String postId = res.path("post_id").asText(null);
            String id = postId != null && !postId.isBlank() ? postId : requireId(res, "id");
            return PublishResult.posted(id, permalink(id, token));
        }

        if (images.size() > 1) {
            List<String> photoIds = new ArrayList<>();
            for (ResolvedMedia.Item image : images) {
                MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
                form.add("url", requireUrl(image));
                form.add("published", "false");
                JsonNode res = graph.postForm(pageId + "/photos", form, token);
                photoIds.add(requireId(res, "id"));
            }
            MultiValueMap<String, String> feed = new LinkedMultiValueMap<>();
            String message = SocialPostRules.withLink(text, link);
            if (!message.isEmpty()) feed.add("message", message);
            for (int i = 0; i < photoIds.size(); i++) {
                feed.add("attached_media[" + i + "]", "{\"media_fbid\":\"" + photoIds.get(i) + "\"}");
            }
            JsonNode res = graph.postForm(pageId + "/feed", feed, token);
            String id = requireId(res, "id");
            return PublishResult.posted(id, permalink(id, token));
        }

        MultiValueMap<String, String> feed = new LinkedMultiValueMap<>();
        if (!text.isEmpty()) feed.add("message", text);
        if (link != null) feed.add("link", link);
        if (feed.isEmpty()) {
            throw new MarketingApiException("EMPTY_POST", "Facebook needs some text, a link or a photo/video.",
                    false, false);
        }
        JsonNode res = graph.postForm(pageId + "/feed", feed, token);
        String id = requireId(res, "id");
        return PublishResult.posted(id, permalink(id, token));
    }

    /** Best effort: a post that went live must not fail because its link could not be read. */
    private String permalink(String objectId, String token) {
        try {
            JsonNode res = graph.get(objectId + "?fields=permalink_url", token);
            return SocialPublisherSupport.absoluteFacebookUrl(res.path("permalink_url").asText(null));
        } catch (Exception e) {
            log.info("Facebook permalink lookup failed for {}: {}", objectId, e.getMessage());
            return null;
        }
    }

    private static String requireUrl(ResolvedMedia.Item item) {
        if (item.url() == null || item.url().isBlank()) {
            throw new MarketingApiException("MEDIA_URL_MISSING",
                    "A photo or video of this post could not be found. Upload it again.", false, false);
        }
        return item.url();
    }

    private static String requireId(JsonNode res, String field) {
        String id = res == null ? null : res.path(field).asText(null);
        if (id == null || id.isBlank()) {
            // Not transient: the call may have created the post, and a retry could post it twice.
            throw new MarketingApiException("NO_ID",
                    "Facebook did not confirm the post. Check the Page before retrying.", false, false);
        }
        return id;
    }
}
