package vacademy.io.admin_core_service.features.marketing.publisher;

import vacademy.io.admin_core_service.features.marketing.MarketingConstants;

import java.util.List;

/**
 * The media of a post with public URLs resolved (media-service permanent CDN URLs). A post holds
 * either up to 10 images or exactly one video (enforced when the post is saved).
 */
public record ResolvedMedia(List<Item> items) {

    /** {@code url} is null when the publisher does not need URLs (YouTube streams by file id). */
    public record Item(String fileId, String type, String name, String url) {
        public boolean isVideo() {
            return MarketingConstants.MEDIA_TYPE_VIDEO.equals(type);
        }

        public boolean isImage() {
            return MarketingConstants.MEDIA_TYPE_IMAGE.equals(type);
        }
    }

    public static ResolvedMedia empty() {
        return new ResolvedMedia(List.of());
    }

    public ResolvedMedia {
        items = items == null ? List.of() : List.copyOf(items);
    }

    public boolean isEmpty() {
        return items.isEmpty();
    }

    public List<Item> images() {
        return items.stream().filter(Item::isImage).toList();
    }

    /** The post's video, or null. */
    public Item video() {
        return items.stream().filter(Item::isVideo).findFirst().orElse(null);
    }
}
