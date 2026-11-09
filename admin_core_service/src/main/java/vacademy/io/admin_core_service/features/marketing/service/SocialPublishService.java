package vacademy.io.admin_core_service.features.marketing.service;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostMediaDTO;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPost;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPostTarget;
import vacademy.io.admin_core_service.features.marketing.publisher.PublishResult;
import vacademy.io.admin_core_service.features.marketing.publisher.ResolvedMedia;
import vacademy.io.admin_core_service.features.marketing.publisher.SocialPublisher;
import vacademy.io.admin_core_service.features.marketing.repository.SocialAccountRepository;
import vacademy.io.admin_core_service.features.marketing.repository.SocialPostClaimDao;
import vacademy.io.admin_core_service.features.marketing.repository.SocialPostRepository;
import vacademy.io.admin_core_service.features.marketing.repository.SocialPostTargetRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.logging.SentryLogger;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Publishes social posts.
 *
 * <ol>
 *   <li>A post enters PUBLISHING only through a claim UPDATE (FOR UPDATE SKIP LOCKED): the job's
 *       batch claim of due SCHEDULED posts, or {@link SocialPostStateStore#claimPost} for
 *       post-now / approve.</li>
 *   <li>Each due target is claimed (PENDING to PUBLISHING) before its publisher runs, so the job
 *       and a post-now thread never publish the same target twice. POSTED, PENDING_CONTAINER
 *       (Instagram video; checked again every minute, up to {@value #CONTAINER_MAX_POLLS}
 *       checks) or a failure: transient = back to PENDING with a 2^attempts-minute backoff (3
 *       attempts), auth = FAILED + account RECONNECT_NEEDED, otherwise FAILED.</li>
 *   <li>When no target is pending the post rolls up to POSTED / PARTIAL / FAILED.</li>
 *   <li>The reaper fails targets left PUBLISHING without a container (a pod died mid-call) and
 *       finalises posts with nothing pending.</li>
 * </ol>
 * YouTube uploads (slow publishers) run only from the job, never from a request-triggered publish.
 * No database transaction is held across a platform call.
 */
@Service
@Slf4j
public class SocialPublishService {

    static final int CLAIM_BATCH = 20;
    static final int CONTAINER_POLL_SECONDS = 60;
    /** Lease on a container check while it runs; replaced by the real next check time after. */
    static final int CONTAINER_LEASE_SECONDS = 180;
    static final int CONTAINER_MAX_POLLS = 30;
    static final Duration STALE_TARGET = Duration.ofMinutes(30);
    /** A YouTube upload streams the whole file; give it far longer before calling it interrupted. */
    static final Duration STALE_YOUTUBE_TARGET = Duration.ofHours(3);
    static final Duration STALE_POST = Duration.ofMinutes(30);
    static final String INTERRUPTED_MESSAGE = "Publishing was interrupted. Retry the post.";
    private static final int ERROR_MAX = 1000;

    private final SocialPostClaimDao claimDao;
    private final SocialPostStateStore stateStore;
    private final SocialPostRepository postRepository;
    private final SocialPostTargetRepository targetRepository;
    private final SocialAccountRepository accountRepository;
    private final MediaService mediaService;
    private final Map<String, SocialPublisher> publishers = new HashMap<>();
    private final ThreadPoolExecutor postNowExecutor;

    public SocialPublishService(SocialPostClaimDao claimDao,
                                SocialPostStateStore stateStore,
                                SocialPostRepository postRepository,
                                SocialPostTargetRepository targetRepository,
                                SocialAccountRepository accountRepository,
                                MediaService mediaService,
                                List<SocialPublisher> publisherBeans) {
        this.claimDao = claimDao;
        this.stateStore = stateStore;
        this.postRepository = postRepository;
        this.targetRepository = targetRepository;
        this.accountRepository = accountRepository;
        this.mediaService = mediaService;
        for (SocialPublisher p : publisherBeans) publishers.put(p.platform(), p);
        AtomicInteger threadNo = new AtomicInteger();
        this.postNowExecutor = new ThreadPoolExecutor(1, 2, 60, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(100), r -> {
                    Thread t = new Thread(r, "social-post-now-" + threadNo.incrementAndGet());
                    t.setDaemon(true);
                    return t;
                });
    }

    @PreDestroy
    void shutdown() {
        postNowExecutor.shutdown();
    }

    // ── Entry points ─────────────────────────────────────────────────────────

    /** One job pass: claim due posts, work every post with a due target, then reap. */
    public void runPublishCycle() {
        Set<String> postIds = new LinkedHashSet<>(claimDao.claimDuePosts(CLAIM_BATCH));
        postIds.addAll(targetRepository.findPostIdsWithDueTargets(Instant.now()));
        for (String postId : postIds) {
            try {
                processPost(postId, true);
            } catch (Exception e) {
                log.error("Social post {} publish pass failed", postId, e);
                SentryLogger.logWarning("Social post publish pass failed: " + e.getMessage(),
                        Map.of("feature", "marketing_social", "post_id", postId));
            }
        }
        reap();
    }

    /**
     * Starts publishing a post that was just made due (post-now, approve, retry) on a background
     * thread. Call after the transaction that set it SCHEDULED has committed. When the queue is
     * full, or another worker claims it first, the job publishes it on its next pass.
     */
    public void publishNowAsync(String postId) {
        try {
            postNowExecutor.execute(() -> {
                try {
                    if (stateStore.claimPost(postId)) {
                        processPost(postId, false);
                    }
                } catch (Exception e) {
                    log.error("Immediate publish of social post {} failed; the job will continue it", postId, e);
                }
            });
        } catch (RejectedExecutionException e) {
            log.info("Immediate publish queue full; social post {} will be published by the job", postId);
        }
    }

    // ── Core ─────────────────────────────────────────────────────────────────

    /**
     * Publishes every due target of a PUBLISHING post, then rolls the post up.
     *
     * @param allowSlow false from request-triggered publishing: YouTube targets stay PENDING for
     *                  the job
     */
    void processPost(String postId, boolean allowSlow) {
        SocialPost post = postRepository.findById(postId).orElse(null);
        if (post == null || post.getDeletedAt() != null
                || !MarketingConstants.POST_STATUS_PUBLISHING.equals(post.getStatus())) {
            return;
        }
        List<SocialPostTarget> targets = targetRepository.findByPostId(postId);
        Map<String, SocialAccount> accounts = new HashMap<>();
        List<String> accountIds = targets.stream().map(SocialPostTarget::getSocialAccountId)
                .filter(Objects::nonNull).distinct().toList();
        if (!accountIds.isEmpty()) {
            for (SocialAccount a : accountRepository.findByIdIn(accountIds)) accounts.put(a.getId(), a);
        }
        PostMedia media = new PostMedia(SocialPostJson.readMedia(post.getMediaJson()));
        Map<String, String> overrides = SocialPostJson.readOverrides(post.getOverridesJson());

        Instant now = Instant.now();
        for (SocialPostTarget target : targets) {
            SocialPublisher publisher = publishers.get(target.getPlatform());
            if (publisher != null && publisher.slow() && !allowSlow) continue;
            if (target.getNextAttemptAt() != null && target.getNextAttemptAt().isAfter(now)) continue;

            boolean claimed;
            if (MarketingConstants.TARGET_STATUS_PENDING.equals(target.getStatus())) {
                claimed = stateStore.claimTarget(target.getId());
            } else if (MarketingConstants.TARGET_STATUS_PUBLISHING.equals(target.getStatus())
                    && target.getContainerId() != null) {
                claimed = stateStore.leaseContainerPoll(target.getId(), CONTAINER_LEASE_SECONDS);
            } else {
                claimed = false;
            }
            if (!claimed) continue;

            SocialPostTarget fresh = targetRepository.findById(target.getId()).orElse(null);
            if (fresh == null) continue;
            publishTarget(post, fresh, accounts.get(fresh.getSocialAccountId()), publisher, media, overrides);
        }
        finalizeIfDone(postId);
    }

    private void publishTarget(SocialPost post, SocialPostTarget target, SocialAccount account,
                               SocialPublisher publisher, PostMedia media, Map<String, String> overrides) {
        boolean containerPhase = target.getContainerId() != null;
        int attempts = target.getAttempts() == null ? 0 : target.getAttempts();
        try {
            if (account == null || !Objects.equals(account.getInstituteId(), post.getInstituteId())) {
                throw new MarketingApiException("ACCOUNT_MISSING",
                        "This account was removed. Pick another account and retry.", false, false);
            }
            if (!MarketingConstants.STATUS_ACTIVE.equals(account.getStatus())) {
                throw new MarketingApiException("ACCOUNT_NOT_ACTIVE",
                        SocialPostRules.accountLabel(account) + " is not connected. Reconnect it and retry.",
                        false, false);
            }
            if (publisher == null) {
                throw new MarketingApiException("UNSUPPORTED",
                        "Posting to " + target.getPlatform() + " is not supported.", false, false);
            }
            String text = SocialPostRules.resolveText(post.getBody(), overrides, target.getPlatform());
            ResolvedMedia resolved = publisher.needsMediaUrls() ? media.withUrls() : media.withoutUrls();
            PublishResult result = publisher.publish(post, target, account, resolved, text);

            if (result.isPendingContainer()) {
                if (!containerPhase) {
                    // Container polls are counted from here (attempts = checks made so far).
                    target.setAttempts(0);
                } else if (attempts >= CONTAINER_MAX_POLLS) {
                    fail(target, "Instagram is still processing the video after 30 minutes. "
                            + "Try a shorter video, then retry.");
                    targetRepository.save(target);
                    return;
                }
                target.setStatus(MarketingConstants.TARGET_STATUS_PUBLISHING);
                target.setContainerId(result.containerId());
                target.setNextAttemptAt(Instant.now().plusSeconds(CONTAINER_POLL_SECONDS));
                target.setErrorMessage(null);
            } else {
                target.setStatus(MarketingConstants.TARGET_STATUS_POSTED);
                target.setExternalPostId(result.externalId());
                target.setPermalink(result.permalink());
                target.setPostedAt(Instant.now());
                target.setNextAttemptAt(null);
                target.setErrorMessage(null);
                log.info("Social post {} published to {} account {}", post.getId(), target.getPlatform(),
                        target.getSocialAccountId());
            }
        } catch (MarketingApiException e) {
            handleFailure(post, target, account, e.getMessage(), e.isTransientError(), e.isAuthError(),
                    containerPhase, attempts);
        } catch (Exception e) {
            log.warn("Social post {} target {} failed unexpectedly", post.getId(), target.getId(), e);
            handleFailure(post, target, account, "Publishing failed unexpectedly ("
                    + e.getClass().getSimpleName() + ").", true, false, containerPhase, attempts);
        }
        targetRepository.save(target);
    }

    private void handleFailure(SocialPost post, SocialPostTarget target, SocialAccount account, String message,
                               boolean transientError, boolean authError, boolean containerPhase, int attempts) {
        String label = SocialPostRules.platformLabel(target.getPlatform());
        if (authError) {
            fail(target, message);
            if (account != null && stateStore.markAccountReconnect(account.getId(), truncate(message))) {
                log.warn("Social account {} ({}) marked RECONNECT_NEEDED: {}", account.getId(), label, message);
                SentryLogger.logWarning("Social account needs reconnect: " + label,
                        Map.of("feature", "marketing_social", "institute_id", post.getInstituteId(),
                                "social_account_id", account.getId()));
            }
            return;
        }
        if (transientError) {
            if (containerPhase) {
                if (attempts < CONTAINER_MAX_POLLS) {
                    target.setStatus(MarketingConstants.TARGET_STATUS_PUBLISHING);
                    target.setNextAttemptAt(Instant.now().plusSeconds(CONTAINER_POLL_SECONDS));
                    target.setErrorMessage(truncate(message));
                    return;
                }
            } else if (SocialPostRules.shouldRetry(attempts)) {
                target.setStatus(MarketingConstants.TARGET_STATUS_PENDING);
                target.setNextAttemptAt(Instant.now().plus(SocialPostRules.retryDelay(attempts)));
                target.setErrorMessage(truncate(message));
                log.info("Social post {} to {} will be retried (attempt {}): {}", post.getId(), label,
                        attempts, message);
                return;
            }
        }
        fail(target, message);
    }

    private static void fail(SocialPostTarget target, String message) {
        target.setStatus(MarketingConstants.TARGET_STATUS_FAILED);
        target.setNextAttemptAt(null);
        target.setErrorMessage(truncate(message == null || message.isBlank() ? "Publishing failed." : message));
    }

    /** Rolls a PUBLISHING post up to POSTED / PARTIAL / FAILED once no target is pending. */
    void finalizeIfDone(String postId) {
        List<SocialPostTarget> targets = targetRepository.findByPostId(postId);
        String status = SocialPostRules.rollUpStatus(targets.stream().map(SocialPostTarget::getStatus).toList());
        if (!SocialPostRules.isFinal(status)) return;

        String lastError = null;
        Instant publishedAt = null;
        if (!MarketingConstants.POST_STATUS_POSTED.equals(status)) {
            lastError = targets.isEmpty() ? "No accounts to post to." : firstError(targets);
        }
        if (!MarketingConstants.POST_STATUS_FAILED.equals(status)) {
            publishedAt = targets.stream().map(SocialPostTarget::getPostedAt).filter(Objects::nonNull)
                    .min(Comparator.naturalOrder()).orElse(Instant.now());
        }
        if (stateStore.finishPost(postId, status, lastError, publishedAt)) {
            log.info("Social post {} finished: {}", postId, status);
        }
    }

    private static String firstError(List<SocialPostTarget> targets) {
        for (SocialPostTarget t : targets) {
            if (MarketingConstants.TARGET_STATUS_FAILED.equals(t.getStatus())) {
                String message = t.getErrorMessage() == null || t.getErrorMessage().isBlank()
                        ? "Publishing failed." : t.getErrorMessage();
                return truncate(SocialPostRules.platformLabel(t.getPlatform()) + ": " + message);
            }
        }
        return "Publishing failed.";
    }

    /** Fails interrupted targets and finalises posts that have nothing left to do. */
    void reap() {
        Instant now = Instant.now();
        try {
            int interrupted = targetRepository.failStalePublishing(now.minus(STALE_TARGET),
                    now.minus(STALE_YOUTUBE_TARGET), INTERRUPTED_MESSAGE);
            if (interrupted > 0) {
                log.warn("Social publish reaper failed {} interrupted target(s)", interrupted);
                SentryLogger.logWarning("Social publish reaper failed " + interrupted + " interrupted target(s)",
                        Map.of("feature", "marketing_social"));
            }
        } catch (Exception e) {
            log.error("Social publish reaper could not fail stale targets", e);
        }
        List<String> stale;
        try {
            stale = postRepository.findStalePublishingIds(now.minus(STALE_POST));
        } catch (Exception e) {
            log.error("Social publish reaper could not list stale posts", e);
            return;
        }
        for (String postId : stale) {
            try {
                finalizeIfDone(postId);
            } catch (Exception e) {
                log.error("Social publish reaper could not finalise post {}", postId, e);
            }
        }
    }

    private static String truncate(String s) {
        if (s == null) return null;
        return s.length() <= ERROR_MAX ? s : s.substring(0, ERROR_MAX);
    }

    // ── Media ────────────────────────────────────────────────────────────────

    /** A post's media; public URLs are resolved once, on first need, for all targets. */
    private final class PostMedia {
        private final List<SocialPostMediaDTO> items;
        private ResolvedMedia withUrls;

        PostMedia(List<SocialPostMediaDTO> items) {
            this.items = items;
        }

        ResolvedMedia withoutUrls() {
            List<ResolvedMedia.Item> out = new ArrayList<>();
            for (SocialPostMediaDTO m : items) {
                out.add(new ResolvedMedia.Item(m.getFileId(), m.getType(), m.getName(), null));
            }
            return new ResolvedMedia(out);
        }

        ResolvedMedia withUrls() {
            if (withUrls != null) return withUrls;
            List<ResolvedMedia.Item> out = new ArrayList<>();
            for (SocialPostMediaDTO m : items) {
                out.add(new ResolvedMedia.Item(m.getFileId(), m.getType(), m.getName(), publicUrl(m.getFileId())));
            }
            withUrls = new ResolvedMedia(out);
            return withUrls;
        }

        private String publicUrl(String fileId) {
            String url;
            try {
                url = mediaService.getFilePublicUrlByIdWithoutExpiry(fileId);
            } catch (Exception e) {
                throw new MarketingApiException("MEDIA_SERVICE_ERROR",
                        "The photos/videos could not be prepared right now. It will be retried.", true, false);
            }
            url = url == null ? null : url.strip();
            if (url != null && url.length() > 1 && url.startsWith("\"") && url.endsWith("\"")) {
                url = url.substring(1, url.length() - 1);
            }
            if (url == null || url.isBlank() || !url.startsWith("http")) {
                throw new MarketingApiException("MEDIA_NOT_FOUND",
                        "A photo or video of this post could not be found. Upload it again.", false, false);
            }
            return url;
        }
    }
}
