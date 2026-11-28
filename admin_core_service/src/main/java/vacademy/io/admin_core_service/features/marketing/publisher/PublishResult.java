package vacademy.io.admin_core_service.features.marketing.publisher;

/**
 * Outcome of one {@link SocialPublisher#publish} call.
 *
 * @param status      POSTED | PENDING_CONTAINER
 * @param externalId  platform post/media/video id (POSTED; may be null when the platform did not say)
 * @param permalink   public link to the post, best effort (may be null)
 * @param containerId media container still being processed (PENDING_CONTAINER)
 */
public record PublishResult(String status, String externalId, String permalink, String containerId) {

    public static final String STATUS_POSTED = "POSTED";
    public static final String STATUS_PENDING_CONTAINER = "PENDING_CONTAINER";

    public static PublishResult posted(String externalId, String permalink) {
        return new PublishResult(STATUS_POSTED, externalId, permalink, null);
    }

    public static PublishResult pendingContainer(String containerId) {
        return new PublishResult(STATUS_PENDING_CONTAINER, null, null, containerId);
    }

    public boolean isPosted() {
        return STATUS_POSTED.equals(status);
    }

    public boolean isPendingContainer() {
        return STATUS_PENDING_CONTAINER.equals(status);
    }
}
