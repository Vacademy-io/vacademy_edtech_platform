package vacademy.io.admin_core_service.features.marketing.service;

import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostMediaDTO;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostRequest;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure rules of social posting (no Spring, no database): request normalisation and validation,
 * which status an action leads to, per-platform text/caption resolution, the post status roll-up
 * from its targets and the retry backoff. Unit-tested in SocialPostRulesTest.
 */
public final class SocialPostRules {

    private SocialPostRules() {
    }

    public static final int MAX_MEDIA = 10;
    public static final int TITLE_MAX = 255;
    public static final int LINK_MAX = 2000;
    public static final int INSTAGRAM_CAPTION_MAX = 2200;
    public static final int INSTAGRAM_HASHTAGS_MAX = 30;
    public static final int GOOGLE_BUSINESS_TEXT_MAX = 1500;
    public static final int YOUTUBE_TITLE_MAX = 100;
    public static final int YOUTUBE_TITLE_FROM_TEXT = 90;
    public static final int YOUTUBE_DESCRIPTION_MAX = 5000;
    /** A scheduled time may lie this far in the past (clock skew, slow form submit). */
    public static final Duration SCHEDULE_GRACE = Duration.ofMinutes(1);
    /** Transient publish failures are retried until a target has this many attempts. */
    public static final int MAX_PUBLISH_ATTEMPTS = 3;

    private static final Pattern HASHTAG = Pattern.compile("(?<![\\p{L}\\p{N}_&])#[\\p{L}\\p{N}_]+");

    // ── Normalised input ─────────────────────────────────────────────────────

    /** A request after trimming / de-duplication; what gets validated and stored. */
    public record PostInput(String title, String body, String linkUrl, List<SocialPostMediaDTO> media,
                            Map<String, String> overrides, List<String> accountIds, Instant scheduledAt,
                            String action, String source) {
    }

    /**
     * Trims texts (blank becomes null), upper-cases action / source / media types / override
     * keys, drops blank overrides and duplicate account ids. Rejects unknown actions, sources and
     * override platforms with a 400.
     */
    public static PostInput normalize(SocialPostRequest request) {
        if (request == null) throw badRequest("Request body is required");
        String action = upper(request.getAction());
        if (action == null) action = SocialPostRequest.ACTION_DRAFT;
        if (!Set.of(SocialPostRequest.ACTION_DRAFT, SocialPostRequest.ACTION_SUBMIT,
                SocialPostRequest.ACTION_SCHEDULE, SocialPostRequest.ACTION_POST_NOW).contains(action)) {
            throw badRequest("Unknown action " + request.getAction() + ". Use DRAFT, SUBMIT, SCHEDULE or POST_NOW.");
        }
        String source = upper(request.getSource());
        if (source == null) source = MarketingConstants.POST_SOURCE_MANUAL;
        if (!MarketingConstants.POST_SOURCE_MANUAL.equals(source) && !MarketingConstants.POST_SOURCE_AGENT.equals(source)) {
            throw badRequest("Unknown source " + request.getSource() + ". Use MANUAL or AGENT.");
        }

        List<SocialPostMediaDTO> media = new ArrayList<>();
        if (request.getMedia() != null) {
            for (SocialPostMediaDTO m : request.getMedia()) {
                if (m == null) continue;
                media.add(SocialPostMediaDTO.builder()
                        .fileId(trimToNull(m.getFileId()))
                        .type(upper(m.getType()))
                        .name(trimToNull(m.getName()))
                        .build());
            }
        }

        Map<String, String> overrides = new LinkedHashMap<>();
        if (request.getOverrides() != null) {
            for (Map.Entry<String, String> e : request.getOverrides().entrySet()) {
                String platform = upper(e.getKey());
                if (platform == null) continue;
                if (!MarketingConstants.SOCIAL_PLATFORMS.contains(platform)) {
                    throw badRequest("Unknown platform in overrides: " + e.getKey());
                }
                String text = trimToNull(e.getValue());
                if (text != null) overrides.put(platform, text);
            }
        }

        Set<String> accountIds = new LinkedHashSet<>();
        if (request.getAccountIds() != null) {
            for (String id : request.getAccountIds()) {
                String trimmed = trimToNull(id);
                if (trimmed != null) accountIds.add(trimmed);
            }
        }

        return new PostInput(trimToNull(request.getTitle()), trimToNull(request.getBody()),
                trimToNull(request.getLinkUrl()), media, overrides, new ArrayList<>(accountIds),
                request.getScheduledAt(), action, source);
    }

    // ── Accounts ─────────────────────────────────────────────────────────────

    /**
     * Maps the requested account ids to accounts of this institute, in request order. Any id that
     * is unknown or belongs to another institute is a 400 (never revealing which institute), as is
     * an account that is not ACTIVE when {@code requireActive} (DISCONNECTED accounts are refused
     * either way).
     */
    public static List<SocialAccount> resolveAccounts(List<String> requestedIds, Collection<SocialAccount> found,
                                                      String instituteId, boolean requireActive) {
        Map<String, SocialAccount> byId = new LinkedHashMap<>();
        if (found != null) {
            for (SocialAccount a : found) {
                if (a != null && Objects.equals(instituteId, a.getInstituteId())) byId.put(a.getId(), a);
            }
        }
        List<SocialAccount> out = new ArrayList<>();
        for (String id : requestedIds == null ? List.<String>of() : requestedIds) {
            SocialAccount account = byId.get(id);
            if (account == null) {
                throw badRequest("One of the selected accounts was not found. Refresh the page and pick again.");
            }
            String status = account.getStatus();
            if (MarketingConstants.STATUS_DISCONNECTED.equals(status)) {
                throw badRequest(accountLabel(account) + " is disconnected. Pick another account or connect it again.");
            }
            if (requireActive && !MarketingConstants.STATUS_ACTIVE.equals(status)) {
                throw badRequest(accountLabel(account) + " needs to be reconnected before you can post to it.");
            }
            out.add(account);
        }
        return out;
    }

    // ── Validation ───────────────────────────────────────────────────────────

    /**
     * Checks that apply to every save, drafts included: title/link length and link scheme, media
     * shape (at most 10, IMAGE/VIDEO with a file id, one video alone or images only).
     */
    public static void validateStructure(PostInput input) {
        if (input.title() != null && input.title().length() > TITLE_MAX) {
            throw badRequest("Title can be at most " + TITLE_MAX + " characters.");
        }
        if (input.linkUrl() != null) {
            String lower = input.linkUrl().toLowerCase(Locale.ROOT);
            if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
                throw badRequest("Link must start with http:// or https://");
            }
            if (input.linkUrl().length() > LINK_MAX) {
                throw badRequest("Link is too long (at most " + LINK_MAX + " characters).");
            }
            if (input.linkUrl().chars().anyMatch(Character::isWhitespace)) {
                throw badRequest("Link cannot contain spaces.");
            }
        }
        List<SocialPostMediaDTO> media = input.media();
        if (media.size() > MAX_MEDIA) {
            throw badRequest("A post can have at most " + MAX_MEDIA + " photos or videos.");
        }
        int videos = 0;
        for (SocialPostMediaDTO m : media) {
            if (m.getFileId() == null) throw badRequest("A media item is missing its file. Upload it again.");
            if (!MarketingConstants.MEDIA_TYPE_IMAGE.equals(m.getType())
                    && !MarketingConstants.MEDIA_TYPE_VIDEO.equals(m.getType())) {
                throw badRequest("Media type must be IMAGE or VIDEO.");
            }
            if (MarketingConstants.MEDIA_TYPE_VIDEO.equals(m.getType())) videos++;
        }
        if (videos > 0 && media.size() > 1) {
            throw badRequest("A post can have one video, or photos only. Video and photos cannot be mixed.");
        }
    }

    /**
     * Full check before a post may be submitted, scheduled or published: structure plus at least
     * one account and every platform rule (Instagram needs media and a caption of at most 2,200
     * characters / 30 hashtags; YouTube needs exactly one video; Google Business Profile takes
     * no video and at most 1,500 characters; Facebook needs text, a link or media).
     */
    public static void validateForPublishing(PostInput input, List<SocialAccount> accounts) {
        validateStructure(input);
        if (accounts == null || accounts.isEmpty()) {
            throw badRequest("Pick at least one account to post to.");
        }
        List<SocialPostMediaDTO> media = input.media();
        boolean hasVideo = media.stream().anyMatch(m -> MarketingConstants.MEDIA_TYPE_VIDEO.equals(m.getType()));
        Set<String> platforms = new LinkedHashSet<>();
        for (SocialAccount a : accounts) platforms.add(a.getPlatform());

        for (String platform : platforms) {
            String text = resolveText(input.body(), input.overrides(), platform);
            switch (platform) {
                case MarketingConstants.PLATFORM_FACEBOOK -> {
                    if (text.isEmpty() && input.linkUrl() == null && media.isEmpty()) {
                        throw badRequest("Facebook needs some text, a link or a photo/video.");
                    }
                }
                case MarketingConstants.PLATFORM_INSTAGRAM -> {
                    if (media.isEmpty()) {
                        throw badRequest("Instagram needs at least one photo or a video.");
                    }
                    String caption = instagramCaption(text, input.linkUrl());
                    if (length(caption) > INSTAGRAM_CAPTION_MAX) {
                        throw badRequest("Instagram caption can be at most " + INSTAGRAM_CAPTION_MAX
                                + " characters (it is " + length(caption) + ", including the link).");
                    }
                    if (countHashtags(caption) > INSTAGRAM_HASHTAGS_MAX) {
                        throw badRequest("Instagram allows at most " + INSTAGRAM_HASHTAGS_MAX + " hashtags.");
                    }
                }
                case MarketingConstants.PLATFORM_GOOGLE_BUSINESS -> {
                    if (hasVideo) {
                        throw badRequest("Google Business Profile posts take a photo or text only, not video.");
                    }
                    if (text.isEmpty()) {
                        throw badRequest("Google Business Profile needs some text.");
                    }
                    if (length(text) > GOOGLE_BUSINESS_TEXT_MAX) {
                        throw badRequest("Google Business Profile text can be at most " + GOOGLE_BUSINESS_TEXT_MAX
                                + " characters (it is " + length(text) + ").");
                    }
                }
                case MarketingConstants.SOCIAL_PLATFORM_YOUTUBE -> {
                    if (!hasVideo || media.size() != 1) {
                        throw badRequest("YouTube needs exactly one video.");
                    }
                    if (youtubeTitle(input.title(), text).isEmpty()) {
                        throw badRequest("YouTube needs a title or some text.");
                    }
                    String description = withLink(text, input.linkUrl());
                    if (length(description) > YOUTUBE_DESCRIPTION_MAX) {
                        throw badRequest("YouTube description can be at most " + YOUTUBE_DESCRIPTION_MAX
                                + " characters (it is " + length(description) + ", including the link).");
                    }
                }
                default -> throw badRequest("Posting to " + platform + " is not supported.");
            }
        }
    }

    // ── Action -> status ─────────────────────────────────────────────────────

    /**
     * What saving with an action does.
     *
     * @param status      the post status to store
     * @param scheduledAt the scheduled time to store
     * @param approved    the caller (an admin) approves it now
     * @param publishNow  start publishing right after saving
     */
    public record ActionOutcome(String status, Instant scheduledAt, boolean approved, boolean publishNow) {
    }

    /**
     * DRAFT -> DRAFT; SUBMIT -> NEEDS_APPROVAL; SCHEDULE -> SCHEDULED for an admin (time required,
     * not more than a minute in the past) else NEEDS_APPROVAL; POST_NOW -> admin only, SCHEDULED
     * at {@code now} and publish right away.
     */
    public static ActionOutcome outcomeFor(String action, boolean admin, Instant requestedAt, Instant now) {
        return switch (action) {
            case SocialPostRequest.ACTION_DRAFT ->
                    new ActionOutcome(MarketingConstants.POST_STATUS_DRAFT, requestedAt, false, false);
            case SocialPostRequest.ACTION_SUBMIT ->
                    new ActionOutcome(MarketingConstants.POST_STATUS_NEEDS_APPROVAL, requestedAt, false, false);
            case SocialPostRequest.ACTION_SCHEDULE -> {
                if (!admin) {
                    yield new ActionOutcome(MarketingConstants.POST_STATUS_NEEDS_APPROVAL, requestedAt, false, false);
                }
                if (requestedAt == null) {
                    throw badRequest("Pick a date and time to schedule the post.");
                }
                if (requestedAt.isBefore(now.minus(SCHEDULE_GRACE))) {
                    throw badRequest("The scheduled time is in the past. Pick a later time or post now.");
                }
                yield new ActionOutcome(MarketingConstants.POST_STATUS_SCHEDULED, requestedAt, true, false);
            }
            case SocialPostRequest.ACTION_POST_NOW -> {
                if (!admin) {
                    throw new ForbiddenException("Only an institute admin can post right away. Submit it for approval.");
                }
                yield new ActionOutcome(MarketingConstants.POST_STATUS_SCHEDULED, now, true, true);
            }
            default -> throw badRequest("Unknown action " + action);
        };
    }

    /** Statuses in which a post's content may still be edited. */
    public static final Set<String> EDITABLE_STATUSES = Set.of(
            MarketingConstants.POST_STATUS_DRAFT, MarketingConstants.POST_STATUS_NEEDS_APPROVAL,
            MarketingConstants.POST_STATUS_SCHEDULED, MarketingConstants.POST_STATUS_FAILED);

    // ── Text per platform ────────────────────────────────────────────────────

    /** The override for this platform when it is not blank, else the body; never null (trimmed). */
    public static String resolveText(String body, Map<String, String> overrides, String platform) {
        if (overrides != null && platform != null) {
            String override = overrides.get(platform);
            if (override != null && !override.isBlank()) return override.strip();
        }
        return body == null ? "" : body.strip();
    }

    /** {@code text + "\n\n" + link} when a link is present (either part may be empty). */
    public static String withLink(String text, String link) {
        String t = text == null ? "" : text.strip();
        String l = link == null ? "" : link.strip();
        if (l.isEmpty()) return t;
        if (t.isEmpty()) return l;
        return t + "\n\n" + l;
    }

    /** Instagram caption: links are not clickable there, so the link is appended as text. */
    public static String instagramCaption(String text, String link) {
        return withLink(text, link);
    }

    /** YouTube title: the post title, else the first 90 characters of the text; at most 100. */
    public static String youtubeTitle(String title, String text) {
        String t = title == null ? "" : title.strip();
        if (t.isEmpty()) {
            String source = text == null ? "" : text.strip().replaceAll("\\s+", " ");
            t = truncateCodePoints(source, YOUTUBE_TITLE_FROM_TEXT).strip();
        }
        // YouTube rejects angle brackets in titles.
        t = t.replace("<", "").replace(">", "");
        return truncateCodePoints(t, YOUTUBE_TITLE_MAX).strip();
    }

    public static int countHashtags(String text) {
        if (text == null || text.isEmpty()) return 0;
        Matcher m = HASHTAG.matcher(text);
        int n = 0;
        while (m.find()) n++;
        return n;
    }

    /** Characters as a person counts them (an emoji is one). */
    public static int length(String text) {
        return text == null ? 0 : text.codePointCount(0, text.length());
    }

    public static String truncateCodePoints(String text, int max) {
        if (text == null) return "";
        if (length(text) <= max) return text;
        return text.substring(0, text.offsetByCodePoints(0, max));
    }

    // ── Status roll-up and retry ─────────────────────────────────────────────

    /**
     * Post status from its target statuses: any PENDING/PUBLISHING -> PUBLISHING (still working);
     * otherwise, ignoring SKIPPED, all POSTED -> POSTED, some POSTED -> PARTIAL, none -> FAILED.
     * No targets at all (or only SKIPPED) is FAILED.
     */
    public static String rollUpStatus(Collection<String> targetStatuses) {
        if (targetStatuses == null || targetStatuses.isEmpty()) return MarketingConstants.POST_STATUS_FAILED;
        int posted = 0;
        int counted = 0;
        for (String s : targetStatuses) {
            if (MarketingConstants.TARGET_STATUS_PENDING.equals(s)
                    || MarketingConstants.TARGET_STATUS_PUBLISHING.equals(s)) {
                return MarketingConstants.POST_STATUS_PUBLISHING;
            }
            if (MarketingConstants.TARGET_STATUS_SKIPPED.equals(s)) continue;
            counted++;
            if (MarketingConstants.TARGET_STATUS_POSTED.equals(s)) posted++;
        }
        if (counted == 0) return MarketingConstants.POST_STATUS_FAILED;
        if (posted == counted) return MarketingConstants.POST_STATUS_POSTED;
        if (posted > 0) return MarketingConstants.POST_STATUS_PARTIAL;
        return MarketingConstants.POST_STATUS_FAILED;
    }

    /** True when a final roll-up status (not PUBLISHING). */
    public static boolean isFinal(String rolledUpStatus) {
        return !MarketingConstants.POST_STATUS_PUBLISHING.equals(rolledUpStatus);
    }

    /** Whether a transient failure after {@code attempts} attempts is retried. */
    public static boolean shouldRetry(int attempts) {
        return attempts < MAX_PUBLISH_ATTEMPTS;
    }

    /** Backoff before the next attempt: 2^attempts minutes (2, 4, ...), capped at one hour. */
    public static Duration retryDelay(int attempts) {
        int exp = Math.max(0, Math.min(attempts, 6));
        return Duration.ofMinutes(Math.min(60, 1L << exp));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    public static VacademyException badRequest(String message) {
        return new VacademyException(HttpStatus.BAD_REQUEST, message);
    }

    static String accountLabel(SocialAccount account) {
        String name = account.getName() != null && !account.getName().isBlank() ? account.getName()
                : account.getHandle() != null ? account.getHandle() : "This account";
        return name + " (" + platformLabel(account.getPlatform()) + ")";
    }

    public static String platformLabel(String platform) {
        if (platform == null) return "";
        return switch (platform) {
            case MarketingConstants.PLATFORM_FACEBOOK -> "Facebook";
            case MarketingConstants.PLATFORM_INSTAGRAM -> "Instagram";
            case MarketingConstants.PLATFORM_GOOGLE_BUSINESS -> "Google Business Profile";
            case MarketingConstants.SOCIAL_PLATFORM_YOUTUBE -> "YouTube";
            default -> platform;
        };
    }

    private static String trimToNull(String s) {
        if (s == null) return null;
        String t = s.strip();
        return t.isEmpty() ? null : t;
    }

    private static String upper(String s) {
        String t = trimToNull(s);
        return t == null ? null : t.toUpperCase(Locale.ROOT);
    }
}
