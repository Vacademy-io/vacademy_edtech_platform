package vacademy.io.admin_core_service.features.marketing.publisher;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPost;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPostTarget;
import vacademy.io.admin_core_service.features.marketing.service.SocialPostRules;
import vacademy.io.admin_core_service.features.youtube.entity.InstituteYoutubeCredentials;
import vacademy.io.admin_core_service.features.youtube.repository.InstituteYoutubeCredentialsRepository;
import vacademy.io.admin_core_service.features.youtube.service.YoutubeUploadService;

import java.util.Set;

/**
 * Uploads the post's video to the institute's connected YouTube channel (public) through
 * {@link YoutubeUploadService#publishVideo}. Slow: runs only from the scheduled job.
 */
@Component
@RequiredArgsConstructor
public class YoutubePublisher implements SocialPublisher {

    private static final String PRIVACY_PUBLIC = "public";
    /** YouTube / OAuth reasons that need the admin to reconnect YouTube. */
    private static final Set<String> AUTH_CODES = Set.of("invalid_grant", "invalidGrant", "unauthorized",
            "authError", "youtubeSignupRequired", "channelClosed");
    /** Reasons a retry in a few minutes will not fix. */
    private static final Set<String> PERMANENT_CODES = Set.of("forbidden", "invalidVideoMetadata",
            "videoTitleEmpty", "invalidCategoryId", "invalidTitle", "invalidDescription", "invalidTags",
            "FILE_NOT_FOUND", "quotaExceeded", "dailyLimitExceeded", "uploadLimitExceeded");

    private final YoutubeUploadService uploadService;
    private final InstituteYoutubeCredentialsRepository credentialsRepository;

    @Override
    public String platform() {
        return MarketingConstants.SOCIAL_PLATFORM_YOUTUBE;
    }

    @Override
    public boolean slow() {
        return true;
    }

    @Override
    public boolean needsMediaUrls() {
        return false;
    }

    @Override
    public PublishResult publish(SocialPost post, SocialPostTarget target, SocialAccount account,
                                 ResolvedMedia media, String text) {
        InstituteYoutubeCredentials creds = credentialsRepository.findById(post.getInstituteId()).orElse(null);
        if (creds == null || !MarketingConstants.STATUS_ACTIVE.equals(creds.getStatus())) {
            throw new MarketingApiException("YOUTUBE_NOT_CONNECTED",
                    "YouTube needs to be reconnected from Settings → YouTube Integration.", false, true);
        }
        if (account.getExternalId() != null && creds.getChannelId() != null
                && !account.getExternalId().equals(creds.getChannelId())) {
            throw new MarketingApiException("YOUTUBE_CHANNEL_CHANGED",
                    "The connected YouTube channel has changed. Pick the current channel and retry.", false, false);
        }
        ResolvedMedia.Item video = media.video();
        if (video == null || video.fileId() == null) {
            throw new MarketingApiException("NO_VIDEO", "YouTube needs exactly one video.", false, false);
        }

        String title = SocialPostRules.youtubeTitle(post.getTitle(), text);
        if (title.isEmpty()) title = "Video";
        String description = SocialPostRules.withLink(text, post.getLinkUrl());

        YoutubeUploadService.UploadResult result = uploadService.publishVideo(post.getInstituteId(),
                video.fileId(), title, description, PRIVACY_PUBLIC, null);
        if (result.success()) {
            return PublishResult.posted(result.videoId(), result.videoUrl());
        }

        String code = result.errorCode() == null ? "TRANSIENT" : result.errorCode();
        String message = describe(code, result.errorMessage());
        if (AUTH_CODES.contains(code)) {
            throw new MarketingApiException(code, message, false, true);
        }
        boolean transientError = !PERMANENT_CODES.contains(code);
        throw new MarketingApiException(code, message, transientError, false);
    }

    private static String describe(String code, String rawMessage) {
        return switch (code) {
            case "quotaExceeded", "dailyLimitExceeded", "uploadLimitExceeded" ->
                    "YouTube's daily upload limit for this channel is used up. Retry tomorrow.";
            case "FILE_NOT_FOUND" -> "The video file could not be found. Upload it again.";
            case "invalid_grant", "invalidGrant", "unauthorized", "authError" ->
                    "YouTube access was revoked. Reconnect it from Settings → YouTube Integration.";
            case "youtubeSignupRequired" -> "This Google account has no YouTube channel yet.";
            case "channelClosed" -> "The YouTube channel is closed or suspended.";
            default -> rawMessage == null || rawMessage.isBlank()
                    ? "YouTube upload failed (" + code + ")."
                    : "YouTube upload failed: " + truncate(rawMessage, 300);
        };
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
