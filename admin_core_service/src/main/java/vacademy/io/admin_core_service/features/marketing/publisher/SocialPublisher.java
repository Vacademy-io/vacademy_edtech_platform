package vacademy.io.admin_core_service.features.marketing.publisher;

import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPost;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPostTarget;

/**
 * Publishes one social post to one account on one platform.
 *
 * <p>Contract:
 * <ul>
 *   <li>returns {@link PublishResult#posted} when the post is live, or
 *       {@link PublishResult#pendingContainer} when the platform is still processing media and the
 *       same target must be offered again later (Instagram video/reels). On that later call
 *       {@code target.getContainerId()} is set and the publisher only checks/finishes the
 *       container;</li>
 *   <li>throws {@link vacademy.io.admin_core_service.features.marketing.client.MarketingApiException}
 *       on failure; {@code transientError} = worth retrying, {@code authError} = the account must
 *       be reconnected. Any other exception is treated as transient by the caller.</li>
 * </ul>
 * Publishers never write to the database; SocialPublishService owns all state.
 */
public interface SocialPublisher {

    /** FACEBOOK | INSTAGRAM | GOOGLE_BUSINESS | YOUTUBE */
    String platform();

    /**
     * @param media resolved media of the post (public URLs); empty when the post has none
     * @param text  the text for this platform (override or body), never null
     */
    PublishResult publish(SocialPost post, SocialPostTarget target, SocialAccount account,
                          ResolvedMedia media, String text);

    /**
     * True when one publish can take minutes (YouTube uploads stream the whole file). Slow
     * publishers run only from the scheduled job, never from a request-triggered publish.
     */
    default boolean slow() {
        return false;
    }

    /** True when the publisher needs public media URLs (YouTube streams by file id itself). */
    default boolean needsMediaUrls() {
        return true;
    }
}
