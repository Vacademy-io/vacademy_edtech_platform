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
 * Instagram business account publishing (Content Publishing API, Page token of the linked Page):
 * <ul>
 *   <li>one image: {@code POST /{ig}/media} (image_url, caption) then {@code /media_publish};</li>
 *   <li>several images: one {@code is_carousel_item} container per image, a {@code CAROUSEL}
 *       container with {@code children}, then {@code /media_publish};</li>
 *   <li>video: a {@code REELS} container, returned as PENDING_CONTAINER. Later calls (with
 *       {@code target.containerId} set) read {@code status_code}: FINISHED publishes, IN_PROGRESS
 *       stays pending, ERROR / EXPIRED fail.</li>
 * </ul>
 * An image container that is not ready yet at publish time (Meta error 9007), or whose
 * media_publish failed transiently (timeout, 5xx, code 1/2: it may have gone live), is also
 * returned as PENDING_CONTAINER, so the next pass reads its status_code (PUBLISHED = done) instead
 * of building and publishing a second container. The caption is the text plus the link (links
 * are not clickable in Instagram captions).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class InstagramPublisher implements SocialPublisher {

    private static final String LABEL = "Instagram";
    /** Meta: "Media ID is not available" — the container is still being processed. */
    private static final String MEDIA_NOT_READY_CODE = "9007";

    private final MetaGraphClient graph;
    private final TokenEncryptionService tokenEncryptionService;

    @Override
    public String platform() {
        return MarketingConstants.PLATFORM_INSTAGRAM;
    }

    @Override
    public PublishResult publish(SocialPost post, SocialPostTarget target, SocialAccount account,
                                 ResolvedMedia media, String text) {
        String token = SocialPublisherSupport.pageToken(account, tokenEncryptionService, LABEL);
        String igId = account.getExternalId();

        if (target.getContainerId() != null && !target.getContainerId().isBlank()) {
            return resumeContainer(igId, target.getContainerId(), token);
        }

        String caption = SocialPostRules.instagramCaption(text, post.getLinkUrl());
        ResolvedMedia.Item video = media.video();
        if (video != null) {
            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("media_type", "REELS");
            form.add("video_url", requireUrl(video));
            if (!caption.isEmpty()) form.add("caption", caption);
            JsonNode res = graph.postForm(igId + "/media", form, token);
            return PublishResult.pendingContainer(requireId(res));
        }

        List<ResolvedMedia.Item> images = media.images();
        if (images.isEmpty()) {
            throw new MarketingApiException("NO_MEDIA", "Instagram needs at least one photo or a video.",
                    false, false);
        }

        String containerId;
        if (images.size() == 1) {
            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("image_url", requireUrl(images.get(0)));
            if (!caption.isEmpty()) form.add("caption", caption);
            containerId = requireId(graph.postForm(igId + "/media", form, token));
        } else {
            List<String> children = new ArrayList<>();
            for (ResolvedMedia.Item image : images) {
                MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
                form.add("image_url", requireUrl(image));
                form.add("is_carousel_item", "true");
                children.add(requireId(graph.postForm(igId + "/media", form, token)));
            }
            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("media_type", "CAROUSEL");
            form.add("children", String.join(",", children));
            if (!caption.isEmpty()) form.add("caption", caption);
            containerId = requireId(graph.postForm(igId + "/media", form, token));
        }
        return publishContainer(igId, containerId, token);
    }

    private PublishResult resumeContainer(String igId, String containerId, String token) {
        JsonNode res = graph.get(containerId + "?fields=status_code,status", token);
        String statusCode = res.path("status_code").asText("");
        switch (statusCode) {
            case "FINISHED":
                return publishContainer(igId, containerId, token);
            case "PUBLISHED":
                // Published by an earlier pass whose result was lost; the media id is unknown.
                return PublishResult.posted(null, null);
            case "ERROR": {
                String detail = res.path("status").asText("");
                throw new MarketingApiException("CONTAINER_ERROR",
                        "Instagram could not process this media" + (detail.isBlank() ? "." : ": " + detail),
                        false, false);
            }
            case "EXPIRED":
                throw new MarketingApiException("CONTAINER_EXPIRED",
                        "Instagram media expired before it could be published. Retry the post.", false, false);
            default:
                // IN_PROGRESS (or not reported yet): check again later.
                return PublishResult.pendingContainer(containerId);
        }
    }

    private PublishResult publishContainer(String igId, String containerId, String token) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("creation_id", containerId);
        JsonNode res;
        try {
            res = graph.postForm(igId + "/media_publish", form, token);
        } catch (MarketingApiException e) {
            String code = e.getPlatformCode();
            if (code != null && (code.equals(MEDIA_NOT_READY_CODE) || code.startsWith(MEDIA_NOT_READY_CODE + "/"))) {
                return PublishResult.pendingContainer(containerId);
            }
            if (e.isTransientError()) {
                // Outcome unknown: keep the container so the next pass checks whether it went live.
                log.info("Instagram media_publish of container {} failed transiently ({}); checking it next pass",
                        containerId, e.getPlatformCode());
                return PublishResult.pendingContainer(containerId);
            }
            throw e;
        }
        String mediaId = res.path("id").asText(null);
        if (mediaId == null || mediaId.isBlank()) {
            return PublishResult.posted(null, null);
        }
        return PublishResult.posted(mediaId, permalink(mediaId, token));
    }

    private String permalink(String mediaId, String token) {
        try {
            JsonNode res = graph.get(mediaId + "?fields=permalink", token);
            return SocialPublisherSupport.text(res.path("permalink").asText(null));
        } catch (Exception e) {
            log.info("Instagram permalink lookup failed for {}: {}", mediaId, e.getMessage());
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

    private static String requireId(JsonNode res) {
        String id = res == null ? null : res.path("id").asText(null);
        if (id == null || id.isBlank()) {
            throw new MarketingApiException("NO_ID", "Instagram did not accept the media. Please try again.",
                    true, false);
        }
        return id;
    }
}
