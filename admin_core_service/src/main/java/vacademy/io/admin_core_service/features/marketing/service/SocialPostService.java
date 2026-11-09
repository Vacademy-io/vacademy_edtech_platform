package vacademy.io.admin_core_service.features.marketing.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.audience.service.LeadReportSettingService;
import vacademy.io.admin_core_service.features.marketing.MarketingConstants;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostDTO;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostMediaDTO;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostRequest;
import vacademy.io.admin_core_service.features.marketing.dto.SocialPostTargetDTO;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPost;
import vacademy.io.admin_core_service.features.marketing.entity.SocialPostTarget;
import vacademy.io.admin_core_service.features.marketing.repository.SocialAccountRepository;
import vacademy.io.admin_core_service.features.marketing.repository.SocialPostRepository;
import vacademy.io.admin_core_service.features.marketing.repository.SocialPostTargetRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Social posts: list, create/update, and the approval state machine.
 *
 * <pre>
 *   DRAFT ──submit──▶ NEEDS_APPROVAL ──approve (admin)──▶ SCHEDULED ──claim (job / post-now)──▶ PUBLISHING
 *     │                    │                                 ▲                                    │
 *     └──schedule/post-now (admin)───────────────────────────┘                    POSTED / PARTIAL / FAILED
 *   any of DRAFT, NEEDS_APPROVAL, SCHEDULED, FAILED ──cancel──▶ CANCELLED      FAILED / PARTIAL ──retry──▶ SCHEDULED
 * </pre>
 * Every state change locks the post row first (SocialPostStateStore.lockPost), so an API edit
 * never overwrites a publish claim that won the race. Publishing itself is SocialPublishService.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SocialPostService {

    private static final int DEFAULT_DAYS_BACK = 7;
    private static final int DEFAULT_DAYS_AHEAD = 60;
    private static final int MAX_RANGE_DAYS = 400;
    private static final int MEDIA_FALLBACK_MAX = 20;

    private static final Set<String> CANCELLABLE_BY_ADMIN = Set.of(MarketingConstants.POST_STATUS_DRAFT,
            MarketingConstants.POST_STATUS_NEEDS_APPROVAL, MarketingConstants.POST_STATUS_SCHEDULED,
            MarketingConstants.POST_STATUS_FAILED);
    private static final Set<String> CANCELLABLE_BY_AUTHOR = Set.of(MarketingConstants.POST_STATUS_DRAFT,
            MarketingConstants.POST_STATUS_NEEDS_APPROVAL);
    private static final Set<String> POST_NOW_FROM = Set.of(MarketingConstants.POST_STATUS_DRAFT,
            MarketingConstants.POST_STATUS_NEEDS_APPROVAL, MarketingConstants.POST_STATUS_SCHEDULED);
    private static final Set<String> RETRY_FROM = Set.of(MarketingConstants.POST_STATUS_FAILED,
            MarketingConstants.POST_STATUS_PARTIAL);
    private static final Set<String> DELETABLE_BY_AUTHOR = Set.of(MarketingConstants.POST_STATUS_DRAFT,
            MarketingConstants.POST_STATUS_NEEDS_APPROVAL, MarketingConstants.POST_STATUS_CANCELLED,
            MarketingConstants.POST_STATUS_FAILED);

    private final SocialPostRepository postRepository;
    private final SocialPostTargetRepository targetRepository;
    private final SocialAccountRepository accountRepository;
    private final SocialPostStateStore stateStore;
    private final SocialPublishService publishService;
    private final MediaService mediaService;
    private final LeadReportSettingService reportSettingService;

    /** Preview URLs are permanent CDN URLs, so they can be kept for a while. */
    private final Cache<String, String> previewUrlCache = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofHours(6))
            .maximumSize(20_000)
            .build();

    // ── Read ─────────────────────────────────────────────────────────────────

    /**
     * Posts whose COALESCE(scheduled_at, created_at) falls on [from, to] (institute-local dates,
     * inclusive; defaults today-7 .. today+60), optionally filtered by status (CSV).
     */
    public List<SocialPostDTO> listPosts(String instituteId, String from, String to, String statusCsv) {
        ZoneId zone = reportSettingService.zoneOf(instituteId);
        LocalDate today = LocalDate.now(zone);
        LocalDate fromDate = parseDate(from, "from", today.minusDays(DEFAULT_DAYS_BACK));
        LocalDate toDate = parseDate(to, "to", today.plusDays(DEFAULT_DAYS_AHEAD));
        if (toDate.isBefore(fromDate)) {
            throw SocialPostRules.badRequest("'to' must be on or after 'from'.");
        }
        if (ChronoUnit.DAYS.between(fromDate, toDate) > MAX_RANGE_DAYS) {
            throw SocialPostRules.badRequest("Pick a range of at most " + MAX_RANGE_DAYS + " days.");
        }
        Instant fromTs = fromDate.atStartOfDay(zone).toInstant();
        Instant toTs = toDate.plusDays(1).atStartOfDay(zone).toInstant();

        List<SocialPost> posts = postRepository.findForRange(instituteId, fromTs, toTs);
        Set<String> statuses = parseStatuses(statusCsv);
        if (!statuses.isEmpty()) {
            posts = posts.stream().filter(p -> statuses.contains(p.getStatus())).toList();
        }
        return toDtos(posts);
    }

    public SocialPostDTO getPost(String instituteId, String postId) {
        SocialPost post = postRepository.findByIdAndInstituteIdAndDeletedAtIsNull(postId, instituteId)
                .orElseThrow(() -> new ResourceNotFoundException("Post not found"));
        return toDtos(List.of(post)).get(0);
    }

    // ── Create / update ──────────────────────────────────────────────────────

    @Transactional
    public SocialPostDTO create(String instituteId, String userId, boolean admin, SocialPostRequest request) {
        SocialPostRules.PostInput input = SocialPostRules.normalize(request);
        List<SocialAccount> accounts = loadAndValidate(instituteId, input);
        Instant now = Instant.now();
        SocialPostRules.ActionOutcome outcome = SocialPostRules.outcomeFor(input.action(), admin, input.scheduledAt(), now);

        SocialPost post = SocialPost.builder()
                .instituteId(instituteId)
                .createdByUserId(userId)
                .source(input.source())
                .build();
        applyInput(post, input, outcome, userId, now);
        post = postRepository.save(post);
        List<SocialPostTarget> targets = targetRepository.saveAll(buildTargets(post, accounts));
        // Write now so generated timestamps are on the returned DTO.
        targetRepository.flush();

        if (outcome.publishNow()) publishAfterCommit(post.getId());
        return toDto(post, targets, accounts);
    }

    @Transactional
    public SocialPostDTO update(String instituteId, String postId, String userId, boolean admin,
                                SocialPostRequest request) {
        SocialPost post = lockOwned(instituteId, postId);
        if (!SocialPostRules.EDITABLE_STATUSES.contains(post.getStatus())) {
            throw new ConflictException("This post can no longer be edited (" + statusLabel(post.getStatus()) + ").");
        }
        SocialPostRules.PostInput input = SocialPostRules.normalize(request);
        List<SocialAccount> accounts = loadAndValidate(instituteId, input);
        Instant now = Instant.now();
        SocialPostRules.ActionOutcome outcome = SocialPostRules.outcomeFor(input.action(), admin, input.scheduledAt(), now);

        // The source records who wrote the post; an edit does not change it.
        applyInput(post, input, outcome, userId, now);
        post = postRepository.save(post);

        targetRepository.deleteByPostIdNative(post.getId());
        List<SocialPostTarget> targets = targetRepository.saveAll(buildTargets(post, accounts));
        // Write now so generated timestamps are on the returned DTO.
        targetRepository.flush();

        if (outcome.publishNow()) publishAfterCommit(post.getId());
        return toDto(post, targets, accounts);
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    /** NEEDS_APPROVAL -> SCHEDULED; a missing or past time publishes right away. Admin only. */
    @Transactional
    public SocialPostDTO approve(String instituteId, String postId, String userId) {
        SocialPost post = lockOwned(instituteId, postId);
        if (!MarketingConstants.POST_STATUS_NEEDS_APPROVAL.equals(post.getStatus())) {
            throw new ConflictException("Only a post that needs approval can be approved (this one is "
                    + statusLabel(post.getStatus()) + ").");
        }
        List<SocialPostTarget> targets = targetRepository.findByPostId(post.getId());
        List<SocialAccount> accounts = revalidate(instituteId, post, targets);
        Instant now = Instant.now();
        boolean publishNow = post.getScheduledAt() == null || !post.getScheduledAt().isAfter(now);
        if (publishNow) post.setScheduledAt(now);
        post.setStatus(MarketingConstants.POST_STATUS_SCHEDULED);
        post.setApprovedByUserId(userId);
        post.setApprovedAt(now);
        post.setLastError(null);
        post = postRepository.save(post);
        if (publishNow) publishAfterCommit(post.getId());
        return toDto(post, targets, accounts);
    }

    /** Publishes a DRAFT / NEEDS_APPROVAL / SCHEDULED post right away (approving it). Admin only. */
    @Transactional
    public SocialPostDTO postNow(String instituteId, String postId, String userId) {
        SocialPost post = lockOwned(instituteId, postId);
        if (!POST_NOW_FROM.contains(post.getStatus())) {
            throw new ConflictException("This post cannot be posted now (it is " + statusLabel(post.getStatus())
                    + ")." + (RETRY_FROM.contains(post.getStatus()) ? " Use Retry instead." : ""));
        }
        List<SocialPostTarget> targets = targetRepository.findByPostId(post.getId());
        List<SocialAccount> accounts = revalidate(instituteId, post, targets);
        Instant now = Instant.now();
        post.setScheduledAt(now);
        post.setStatus(MarketingConstants.POST_STATUS_SCHEDULED);
        post.setApprovedByUserId(userId);
        post.setApprovedAt(now);
        post.setLastError(null);
        post = postRepository.save(post);
        publishAfterCommit(post.getId());
        return toDto(post, targets, accounts);
    }

    /**
     * -> CANCELLED. The author may cancel their own DRAFT / NEEDS_APPROVAL post; an admin may
     * also cancel SCHEDULED and FAILED posts.
     */
    @Transactional
    public SocialPostDTO cancel(String instituteId, String postId, String userId, boolean admin) {
        SocialPost post = lockOwned(instituteId, postId);
        boolean author = userId != null && userId.equals(post.getCreatedByUserId());
        if (admin) {
            if (!CANCELLABLE_BY_ADMIN.contains(post.getStatus())) {
                throw new ConflictException("This post cannot be cancelled (it is " + statusLabel(post.getStatus()) + ").");
            }
        } else {
            if (!author) {
                throw new ForbiddenException("Only the author or an institute admin can cancel this post.");
            }
            if (!CANCELLABLE_BY_AUTHOR.contains(post.getStatus())) {
                throw new ForbiddenException("Only an institute admin can cancel a post that is "
                        + statusLabel(post.getStatus()) + ".");
            }
        }
        post.setStatus(MarketingConstants.POST_STATUS_CANCELLED);
        post = postRepository.save(post);
        return toDtos(List.of(post)).get(0);
    }

    /** FAILED / PARTIAL -> FAILED targets back to PENDING, post SCHEDULED now. Admin only. */
    @Transactional
    public SocialPostDTO retry(String instituteId, String postId) {
        SocialPost post = lockOwned(instituteId, postId);
        if (!RETRY_FROM.contains(post.getStatus())) {
            throw new ConflictException("Only a failed or partly posted post can be retried (this one is "
                    + statusLabel(post.getStatus()) + ").");
        }
        List<SocialPostTarget> targets = targetRepository.findByPostId(post.getId());
        List<SocialPostTarget> failed = targets.stream()
                .filter(t -> MarketingConstants.TARGET_STATUS_FAILED.equals(t.getStatus())).toList();
        if (failed.isEmpty()) {
            throw new ConflictException("Nothing to retry: no account failed.");
        }
        Map<String, SocialAccount> accounts = accountsById(targets);
        for (SocialPostTarget t : failed) {
            SocialAccount account = accounts.get(t.getSocialAccountId());
            if (account == null || !instituteId.equals(account.getInstituteId())
                    || MarketingConstants.STATUS_DISCONNECTED.equals(account.getStatus())) {
                throw SocialPostRules.badRequest("An account of this post was disconnected. "
                        + "Edit the post to pick another account.");
            }
            if (!MarketingConstants.STATUS_ACTIVE.equals(account.getStatus())) {
                throw SocialPostRules.badRequest(SocialPostRules.accountLabel(account)
                        + " needs to be reconnected before retrying.");
            }
        }
        for (SocialPostTarget t : failed) {
            t.setStatus(MarketingConstants.TARGET_STATUS_PENDING);
            t.setAttempts(0);
            t.setNextAttemptAt(null);
            t.setErrorMessage(null);
            t.setContainerId(null);
        }
        targetRepository.saveAll(failed);
        Instant now = Instant.now();
        post.setStatus(MarketingConstants.POST_STATUS_SCHEDULED);
        post.setScheduledAt(now);
        post.setLastError(null);
        post = postRepository.save(post);
        publishAfterCommit(post.getId());
        return toDto(post, targets, new ArrayList<>(accounts.values()));
    }

    /**
     * Soft delete. Never while PUBLISHING. The author may delete their own DRAFT / NEEDS_APPROVAL /
     * CANCELLED / FAILED post; an admin any other.
     */
    @Transactional
    public void delete(String instituteId, String postId, String userId, boolean admin) {
        SocialPost post = lockOwned(instituteId, postId);
        if (MarketingConstants.POST_STATUS_PUBLISHING.equals(post.getStatus())) {
            throw new ConflictException("This post is being published right now. Try again in a minute.");
        }
        if (!admin) {
            boolean author = userId != null && userId.equals(post.getCreatedByUserId());
            if (!author || !DELETABLE_BY_AUTHOR.contains(post.getStatus())) {
                throw new ForbiddenException("Only an institute admin can delete this post.");
            }
        }
        post.setDeletedAt(Instant.now());
        postRepository.save(post);
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /** Accounts for the request; drafts need only valid ids, everything else the full rules. */
    private List<SocialAccount> loadAndValidate(String instituteId, SocialPostRules.PostInput input) {
        boolean draft = SocialPostRequest.ACTION_DRAFT.equals(input.action());
        List<SocialAccount> found = input.accountIds().isEmpty() ? List.of()
                : accountRepository.findByIdIn(input.accountIds());
        List<SocialAccount> accounts = SocialPostRules.resolveAccounts(input.accountIds(), found, instituteId, !draft);
        if (draft) {
            SocialPostRules.validateStructure(input);
        } else {
            SocialPostRules.validateForPublishing(input, accounts);
        }
        return accounts;
    }

    /** Re-checks a stored post against the publishing rules before it is approved / posted. */
    private List<SocialAccount> revalidate(String instituteId, SocialPost post, List<SocialPostTarget> targets) {
        List<String> accountIds = targets.stream().map(SocialPostTarget::getSocialAccountId).distinct().toList();
        List<SocialAccount> found = accountIds.isEmpty() ? List.of() : accountRepository.findByIdIn(accountIds);
        List<SocialAccount> accounts = SocialPostRules.resolveAccounts(accountIds, found, instituteId, true);
        SocialPostRules.PostInput input = new SocialPostRules.PostInput(post.getTitle(), post.getBody(),
                post.getLinkUrl(), SocialPostJson.readMedia(post.getMediaJson()),
                SocialPostJson.readOverrides(post.getOverridesJson()), accountIds, post.getScheduledAt(),
                SocialPostRequest.ACTION_SCHEDULE, post.getSource());
        SocialPostRules.validateForPublishing(input, accounts);
        return accounts;
    }

    private void applyInput(SocialPost post, SocialPostRules.PostInput input, SocialPostRules.ActionOutcome outcome,
                            String userId, Instant now) {
        post.setTitle(input.title());
        post.setBody(input.body());
        post.setLinkUrl(input.linkUrl());
        post.setMediaJson(SocialPostJson.writeMedia(input.media()));
        post.setOverridesJson(SocialPostJson.writeOverrides(input.overrides()));
        post.setScheduledAt(outcome.scheduledAt());
        post.setStatus(outcome.status());
        post.setLastError(null);
        post.setPublishedAt(null);
        if (outcome.approved()) {
            post.setApprovedByUserId(userId);
            post.setApprovedAt(now);
        } else {
            post.setApprovedByUserId(null);
            post.setApprovedAt(null);
        }
    }

    private static List<SocialPostTarget> buildTargets(SocialPost post, List<SocialAccount> accounts) {
        List<SocialPostTarget> targets = new ArrayList<>();
        for (SocialAccount account : accounts) {
            targets.add(SocialPostTarget.builder()
                    .postId(post.getId())
                    .instituteId(post.getInstituteId())
                    .socialAccountId(account.getId())
                    .platform(account.getPlatform())
                    .status(MarketingConstants.TARGET_STATUS_PENDING)
                    .attempts(0)
                    .build());
        }
        return targets;
    }

    /** The post row, locked; 404 when missing, deleted or of another institute. */
    private SocialPost lockOwned(String instituteId, String postId) {
        SocialPost post = postId == null ? null : stateStore.lockPost(postId);
        if (post == null || post.getDeletedAt() != null || !Objects.equals(instituteId, post.getInstituteId())) {
            throw new ResourceNotFoundException("Post not found");
        }
        return post;
    }

    /** Starts the immediate publish once this transaction has committed (the claim must see it). */
    private void publishAfterCommit(String postId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    publishService.publishNowAsync(postId);
                }
            });
        } else {
            publishService.publishNowAsync(postId);
        }
    }

    private Map<String, SocialAccount> accountsById(Collection<SocialPostTarget> targets) {
        List<String> ids = targets.stream().map(SocialPostTarget::getSocialAccountId)
                .filter(Objects::nonNull).distinct().toList();
        Map<String, SocialAccount> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        for (SocialAccount a : accountRepository.findByIdIn(ids)) out.put(a.getId(), a);
        return out;
    }

    // ── DTO mapping ──────────────────────────────────────────────────────────

    private SocialPostDTO toDto(SocialPost post, List<SocialPostTarget> targets, List<SocialAccount> accounts) {
        Map<String, SocialAccount> byId = new HashMap<>();
        for (SocialAccount a : accounts) byId.put(a.getId(), a);
        List<SocialPostMediaDTO> media = SocialPostJson.readMedia(post.getMediaJson());
        Map<String, String> urls = previewUrls(media.stream().map(SocialPostMediaDTO::getFileId).toList());
        return map(post, targets, byId, media, urls);
    }

    private List<SocialPostDTO> toDtos(List<SocialPost> posts) {
        if (posts.isEmpty()) return List.of();
        List<String> postIds = posts.stream().map(SocialPost::getId).toList();
        Map<String, List<SocialPostTarget>> targetsByPost = targetRepository.findByPostIdIn(postIds).stream()
                .collect(Collectors.groupingBy(SocialPostTarget::getPostId));
        Map<String, SocialAccount> accounts = accountsById(
                targetsByPost.values().stream().flatMap(List::stream).toList());

        Map<String, List<SocialPostMediaDTO>> mediaByPost = new HashMap<>();
        Set<String> fileIds = new LinkedHashSet<>();
        for (SocialPost p : posts) {
            List<SocialPostMediaDTO> media = SocialPostJson.readMedia(p.getMediaJson());
            mediaByPost.put(p.getId(), media);
            media.forEach(m -> fileIds.add(m.getFileId()));
        }
        Map<String, String> urls = previewUrls(fileIds);

        List<SocialPostDTO> out = new ArrayList<>(posts.size());
        for (SocialPost p : posts) {
            out.add(map(p, targetsByPost.getOrDefault(p.getId(), List.of()), accounts,
                    mediaByPost.getOrDefault(p.getId(), List.of()), urls));
        }
        return out;
    }

    private SocialPostDTO map(SocialPost post, List<SocialPostTarget> targets, Map<String, SocialAccount> accounts,
                              List<SocialPostMediaDTO> media, Map<String, String> urls) {
        List<SocialPostMediaDTO> mediaOut = media.stream().map(m -> SocialPostMediaDTO.builder()
                .fileId(m.getFileId()).type(m.getType()).name(m.getName()).url(urls.get(m.getFileId()))
                .build()).toList();
        List<SocialPostTargetDTO> targetsOut = targets.stream().map(t -> {
            SocialAccount a = accounts.get(t.getSocialAccountId());
            return SocialPostTargetDTO.builder()
                    .id(t.getId())
                    .socialAccountId(t.getSocialAccountId())
                    .platform(t.getPlatform())
                    .accountName(a == null ? null : (a.getName() != null ? a.getName() : a.getHandle()))
                    .status(t.getStatus())
                    .permalink(t.getPermalink())
                    .errorMessage(t.getErrorMessage())
                    .postedAt(t.getPostedAt())
                    .build();
        }).toList();
        return SocialPostDTO.builder()
                .id(post.getId())
                .title(post.getTitle())
                .body(post.getBody())
                .linkUrl(post.getLinkUrl())
                .media(mediaOut)
                .overrides(SocialPostJson.readOverrides(post.getOverridesJson()))
                .scheduledAt(post.getScheduledAt())
                .status(post.getStatus())
                .source(post.getSource())
                .createdByUserId(post.getCreatedByUserId())
                .approvedByUserId(post.getApprovedByUserId())
                .approvedAt(post.getApprovedAt())
                .lastError(post.getLastError())
                .publishedAt(post.getPublishedAt())
                .createdAt(post.getCreatedAt())
                .targets(targetsOut)
                .build();
    }

    /**
     * Public preview URLs by file id, best effort: one batch call, falling back to single calls
     * (media_service fails a whole batch when one id is unknown). Missing ids map to nothing.
     */
    private Map<String, String> previewUrls(Collection<String> fileIds) {
        Map<String, String> out = new HashMap<>();
        List<String> missing = new ArrayList<>();
        for (String id : fileIds) {
            if (id == null) continue;
            String cached = previewUrlCache.getIfPresent(id);
            if (cached != null) out.put(id, cached); else missing.add(id);
        }
        if (missing.isEmpty()) return out;
        try {
            Map<String, String> batch = mediaService.getPublicUrlsWithoutExpiry(missing);
            batch.forEach((id, url) -> {
                if (id != null && url != null && !url.isBlank()) {
                    out.put(id, url);
                    previewUrlCache.put(id, url);
                }
            });
        } catch (Exception e) {
            log.info("Batch preview URL lookup failed for {} file(s): {}", missing.size(), e.getMessage());
            int tried = 0;
            for (String id : missing) {
                if (out.containsKey(id)) continue;
                if (tried++ >= MEDIA_FALLBACK_MAX) break;
                try {
                    String url = mediaService.getFilePublicUrlByIdWithoutExpiry(id);
                    if (url != null && !url.isBlank()) {
                        out.put(id, url.strip());
                        previewUrlCache.put(id, url.strip());
                    }
                } catch (Exception ex) {
                    log.debug("Preview URL lookup failed for file {}: {}", id, ex.getMessage());
                }
            }
        }
        return out;
    }

    private static LocalDate parseDate(String value, String name, LocalDate fallback) {
        if (value == null || value.isBlank()) return fallback;
        try {
            return LocalDate.parse(value.strip());
        } catch (DateTimeParseException e) {
            throw SocialPostRules.badRequest("'" + name + "' must be a date like 2026-10-31.");
        }
    }

    private static Set<String> parseStatuses(String csv) {
        if (csv == null || csv.isBlank()) return Set.of();
        return Arrays.stream(csv.split(","))
                .map(s -> s.strip().toUpperCase(Locale.ROOT))
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toSet());
    }

    private static String statusLabel(String status) {
        return status == null ? "unknown" : status.toLowerCase(Locale.ROOT).replace('_', ' ');
    }
}
