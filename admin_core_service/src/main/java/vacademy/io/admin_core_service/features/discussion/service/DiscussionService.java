package vacademy.io.admin_core_service.features.discussion.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionPostView;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionRequests;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionSettings;
import vacademy.io.admin_core_service.features.discussion.dto.DiscussionThreadView;
import vacademy.io.admin_core_service.features.discussion.entity.DiscussionPost;
import vacademy.io.admin_core_service.features.discussion.entity.DiscussionReaction;
import vacademy.io.admin_core_service.features.discussion.entity.DiscussionReport;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionPostRepository;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionPostRepository.BatchRow;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionPostRepository.SlideDocumentRow;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionReactionRepository;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionReportRepository;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Discussion forum slides: a teacher asks a question, learners respond, classmates
 * comment and react, and the teacher moderates.
 *
 * <p>Every rule is enforced here from the slide's saved settings, never from what the
 * client sends: who may see a reply, whether comments, reactions and anonymous posts
 * are allowed, whether posts wait for approval, and whether the discussion is locked.
 * Learners only ever see their own batch. Anonymous posts are anonymous to classmates
 * only; teachers always see who wrote them, so they can follow up on a learner who
 * needs help.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DiscussionService {

    public static final String DOCUMENT_TYPE = "DISCUSSION";
    static final int MAX_CONTENT = 5000;
    static final int MAX_REASON = 500;
    static final int MAX_RESPONSES = 500;
    static final String ANONYMOUS_NAME = "Anonymous classmate";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final DiscussionPostRepository postRepository;
    private final DiscussionReactionRepository reactionRepository;
    private final DiscussionReportRepository reportRepository;
    private final LearnerQuizAccessService learnerAccessService;
    private final InstituteAccessValidator instituteAccessValidator;

    /** Who is asking, about which slide, and under which rules. */
    record Context(String userId, boolean staff, String instituteId, String packageSessionId, String chapterId,
            DiscussionSettings settings) {
    }

    // ------------------------------------------------------------------ context

    private SlideDocumentRow requireDiscussionSlide(String slideId) {
        if (!StringUtils.hasText(slideId)) {
            throw new VacademyException("slide_id is required");
        }
        SlideDocumentRow row = postRepository.findSlideDocument(slideId)
                .orElseThrow(() -> new VacademyException("Discussion not found"));
        if (!"DOCUMENT".equals(row.getSourceType()) || !DOCUMENT_TYPE.equals(row.getDocumentType())
                || "DELETED".equals(row.getSlideStatus())) {
            throw new VacademyException("Discussion not found");
        }
        return row;
    }

    /**
     * Learner context: the caller holds a live membership in a batch whose course has
     * this slide (or is staff of the owning institute, previewing as a learner).
     */
    Context learnerContext(CustomUserDetails user, String slideId, String clientId, String packageSessionId,
            String chapterId) {
        SlideDocumentRow row = requireDiscussionSlide(slideId);
        LearnerQuizAccessService.Access access = learnerAccessService.requireAccess(user, slideId, clientId,
                packageSessionId, chapterId);
        boolean published = "PUBLISHED".equals(row.getSlideStatus()) || "UNSYNC".equals(row.getSlideStatus());
        if (!published) {
            // A draft discussion is only open to staff previewing it.
            try {
                instituteAccessValidator.requireInstituteStaff(user, access.instituteId());
            } catch (RuntimeException notStaff) {
                throw new ForbiddenException("This discussion is not published yet");
            }
        }
        String json = StringUtils.hasText(row.getPublishedData()) ? row.getPublishedData() : row.getData();
        return new Context(user.getUserId(), false, access.instituteId(), access.packageSessionId(),
                access.chapterId(), parseSettings(json));
    }

    /** Staff context: institute staff (no root bypass), and the slide is in one of the institute's courses. */
    Context staffContext(CustomUserDetails user, String slideId, String instituteId) {
        SlideDocumentRow row = requireDiscussionSlide(slideId);
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        if (postRepository.findBatchesOfSlide(slideId, instituteId).isEmpty()) {
            throw new ForbiddenException("This discussion does not belong to your institute");
        }
        String json = StringUtils.hasText(row.getPublishedData()) ? row.getPublishedData() : row.getData();
        return new Context(user.getUserId(), true, instituteId, null, null, parseSettings(json));
    }

    /**
     * Reads {"settings": {...}} from the slide's document JSON. A missing block means
     * the defaults the teacher saw in the editor; an unreadable one falls back to the
     * most private, locked state so a broken save can never open a discussion up.
     */
    static DiscussionSettings parseSettings(String json) {
        if (!StringUtils.hasText(json)) {
            return new DiscussionSettings().normalised();
        }
        try {
            JsonNode root = MAPPER.readTree(json);
            JsonNode node = root == null ? null : root.get("settings");
            if (node == null || node.isNull()) {
                return new DiscussionSettings().normalised();
            }
            return MAPPER.treeToValue(node, DiscussionSettings.class).normalised();
        } catch (Exception e) {
            log.warn("[discussion] unreadable settings JSON, using private+locked: {}", e.getMessage());
            DiscussionSettings closed = new DiscussionSettings();
            closed.setVisibility(DiscussionSettings.VISIBILITY_PRIVATE);
            closed.setLocked(true);
            return closed.normalised();
        }
    }

    // ------------------------------------------------------------------ reading

    @Transactional(readOnly = true)
    public DiscussionThreadView learnerThread(CustomUserDetails user, String slideId, String packageSessionId,
            String chapterId, String clientId) {
        Context ctx = learnerContext(user, slideId, clientId, packageSessionId, chapterId);
        return buildThread(ctx, slideId, loadForBatch(slideId, ctx.packageSessionId()));
    }

    @Transactional(readOnly = true)
    public DiscussionThreadView staffThread(CustomUserDetails user, String slideId, String instituteId,
            String packageSessionId) {
        Context ctx = staffContext(user, slideId, instituteId);
        List<DiscussionPost> posts = postRepository.findForInstitute(slideId, instituteId);
        if (StringUtils.hasText(packageSessionId)) {
            posts = posts.stream()
                    .filter(p -> p.getPackageSessionId() == null || packageSessionId.equals(p.getPackageSessionId()))
                    .collect(Collectors.toList());
        }
        DiscussionThreadView view = buildThread(ctx, slideId, posts);
        view.setPackageSessionId(StringUtils.hasText(packageSessionId) ? packageSessionId : null);
        view.setBatches(postRepository.findBatchesOfSlide(slideId, instituteId).stream()
                .map(DiscussionService::toBatch)
                .sorted(Comparator.comparing(DiscussionThreadView.Batch::getName, String.CASE_INSENSITIVE_ORDER))
                .collect(Collectors.toList()));
        return view;
    }

    private List<DiscussionPost> loadForBatch(String slideId, String packageSessionId) {
        // Without a batch (a staff preview) only posts addressed to every batch show.
        return postRepository.findForBatch(slideId, packageSessionId == null ? "" : packageSessionId);
    }

    private DiscussionThreadView buildThread(Context ctx, String slideId, List<DiscussionPost> posts) {
        DiscussionSettings settings = ctx.settings();
        boolean hasResponded = posts.stream().anyMatch(p -> p.isRoot() && ctx.userId().equals(p.getUserId())
                && !DiscussionPost.STATUS_DELETED.equals(p.getStatus()));
        boolean othersVisible = ctx.staff() || settings.othersVisibleBy(hasResponded);

        Map<String, DiscussionPost> roots = new LinkedHashMap<>();
        Map<String, List<DiscussionPost>> commentsByRoot = new HashMap<>();
        for (DiscussionPost p : posts) {
            if (p.isRoot()) {
                if (canSee(ctx, p, othersVisible)) {
                    roots.put(p.getId(), p);
                }
            } else {
                commentsByRoot.computeIfAbsent(p.getParentId(), k -> new ArrayList<>()).add(p);
            }
        }

        List<DiscussionPost> visibleRoots = roots.values().stream()
                .sorted(Comparator.comparing(DiscussionPost::isPinned).reversed()
                        .thenComparing(DiscussionPost::getCreatedAt, Comparator.reverseOrder()))
                .limit(MAX_RESPONSES)
                .collect(Collectors.toList());

        List<DiscussionPost> shown = new ArrayList<>(visibleRoots);
        Map<String, List<DiscussionPost>> visibleComments = new HashMap<>();
        for (DiscussionPost root : visibleRoots) {
            List<DiscussionPost> list = commentsByRoot.getOrDefault(root.getId(), List.of()).stream()
                    .filter(c -> canSee(ctx, c, othersVisible))
                    .sorted(Comparator.comparing(DiscussionPost::getCreatedAt))
                    .collect(Collectors.toList());
            visibleComments.put(root.getId(), list);
            shown.addAll(list);
        }

        Set<String> ids = shown.stream().map(DiscussionPost::getId).collect(Collectors.toSet());
        Map<String, List<DiscussionReaction>> reactions = ids.isEmpty() ? Map.of()
                : reactionRepository.findByPostIdIn(ids).stream()
                        .collect(Collectors.groupingBy(DiscussionReaction::getPostId));
        Map<String, List<String>> reportReasons = new HashMap<>();
        Set<String> reportedByMe = new HashSet<>();
        if (!ids.isEmpty()) {
            if (ctx.staff()) {
                for (DiscussionReport r : reportRepository.findByPostIdIn(ids)) {
                    if (StringUtils.hasText(r.getReason())) {
                        reportReasons.computeIfAbsent(r.getPostId(), k -> new ArrayList<>()).add(r.getReason());
                    }
                }
            } else {
                reportRepository.findByUserIdAndPostIdIn(ctx.userId(), ids)
                        .forEach(r -> reportedByMe.add(r.getPostId()));
            }
        }

        DiscussionThreadView view = new DiscussionThreadView();
        view.setSlideId(slideId);
        view.setPackageSessionId(ctx.packageSessionId());
        view.setSettings(settings);
        for (DiscussionPost root : visibleRoots) {
            DiscussionPostView rv = toView(ctx, root, reactions, reportReasons, reportedByMe, settings);
            List<DiscussionPostView> cv = new ArrayList<>();
            for (DiscussionPost c : visibleComments.get(root.getId())) {
                cv.add(toView(ctx, c, reactions, reportReasons, reportedByMe, settings));
            }
            rv.setComments(cv);
            view.getPosts().add(rv);
        }

        DiscussionThreadView.Viewer viewer = new DiscussionThreadView.Viewer();
        viewer.setUserId(ctx.userId());
        viewer.setStaff(ctx.staff());
        viewer.setHasResponded(hasResponded);
        viewer.setCanSeeOthers(othersVisible);
        viewer.setCanRespond(ctx.staff() || !settings.isLocked());
        viewer.setCanCommentOnOthers(ctx.staff() || (!settings.isLocked() && settings.isAllowComments()
                && othersVisible));
        view.setViewer(viewer);

        DiscussionThreadView.Stats stats = new DiscussionThreadView.Stats();
        List<DiscussionPost> learnerRoots = posts.stream()
                .filter(p -> p.isRoot() && !p.isStaffPost() && DiscussionPost.STATUS_PUBLISHED.equals(p.getStatus()))
                .collect(Collectors.toList());
        stats.setResponses(learnerRoots.size());
        stats.setParticipants((int) learnerRoots.stream().map(DiscussionPost::getUserId).distinct().count());
        if (ctx.staff()) {
            stats.setPending((int) posts.stream()
                    .filter(p -> DiscussionPost.STATUS_PENDING.equals(p.getStatus())).count());
            stats.setHidden((int) posts.stream()
                    .filter(p -> DiscussionPost.STATUS_HIDDEN.equals(p.getStatus())).count());
            stats.setFlagged((int) posts.stream().filter(p -> p.getReportCount() > 0).count());
        }
        view.setStats(stats);
        return view;
    }

    /**
     * The one visibility rule. Staff see everything that is not deleted. A learner sees
     * their own posts in any state (so they know one is awaiting approval or was hidden),
     * published teacher posts, and published classmates' posts only when the discussion's
     * visibility lets them.
     */
    static boolean canSee(Context ctx, DiscussionPost p, boolean othersVisible) {
        if (DiscussionPost.STATUS_DELETED.equals(p.getStatus())) {
            return false;
        }
        if (ctx.staff() || ctx.userId().equals(p.getUserId())) {
            return true;
        }
        if (!DiscussionPost.STATUS_PUBLISHED.equals(p.getStatus())) {
            return false;
        }
        return p.isStaffPost() || othersVisible;
    }

    private DiscussionPostView toView(Context ctx, DiscussionPost p, Map<String, List<DiscussionReaction>> reactions,
            Map<String, List<String>> reportReasons, Set<String> reportedByMe, DiscussionSettings settings) {
        boolean mine = ctx.userId().equals(p.getUserId());
        DiscussionPostView v = new DiscussionPostView();
        v.setId(p.getId());
        v.setParentId(p.getParentId());
        v.setContent(p.getContent());
        v.setCreatedAt(p.getCreatedAt());
        v.setEditedAt(p.getEditedAt());
        v.setAuthorRole(p.getAuthorRole());
        v.setAnonymous(p.isAnonymous());
        v.setMine(mine);
        v.setStatus(p.getStatus());
        v.setPinned(p.isPinned());
        boolean hideIdentity = p.isAnonymous() && !mine && !ctx.staff();
        v.setAuthorName(hideIdentity ? ANONYMOUS_NAME : displayName(p));
        v.setAuthorUserId(hideIdentity ? null : p.getUserId());
        v.setReactions(reactionCounts(reactions.getOrDefault(p.getId(), List.of()), ctx.userId(), settings));
        if (ctx.staff()) {
            v.setReportCount(p.getReportCount());
            v.setReportReasons(reportReasons.getOrDefault(p.getId(), List.of()));
            v.setPackageSessionId(p.getPackageSessionId());
        } else {
            v.setReportedByMe(reportedByMe.contains(p.getId()));
        }
        return v;
    }

    private static String displayName(DiscussionPost p) {
        if (StringUtils.hasText(p.getAuthorName())) {
            return p.getAuthorName();
        }
        return p.isStaffPost() ? "Teacher" : "Learner";
    }

    /** Counts in the order the teacher listed the reactions; reactions since switched off are left out. */
    static List<DiscussionPostView.ReactionCount> reactionCounts(List<DiscussionReaction> rows, String userId,
            DiscussionSettings settings) {
        List<DiscussionPostView.ReactionCount> out = new ArrayList<>();
        for (String key : settings.getReactions()) {
            int count = 0;
            boolean mine = false;
            for (DiscussionReaction r : rows) {
                if (key.equals(r.getReaction())) {
                    count++;
                    mine |= userId.equals(r.getUserId());
                }
            }
            if (count > 0) {
                out.add(new DiscussionPostView.ReactionCount(key, count, mine));
            }
        }
        return out;
    }

    private static DiscussionThreadView.Batch toBatch(BatchRow row) {
        DiscussionThreadView.Batch b = new DiscussionThreadView.Batch();
        b.setPackageSessionId(row.getPackageSessionId());
        List<String> parts = new ArrayList<>();
        for (String s : new String[] { row.getPackageName(), row.getLevelName(), row.getSessionName() }) {
            if (StringUtils.hasText(s) && !"DEFAULT".equalsIgnoreCase(s)) {
                parts.add(s);
            }
        }
        b.setName(parts.isEmpty() ? row.getPackageSessionId() : String.join(" · ", parts));
        return b;
    }

    // ------------------------------------------------------------------ writing

    /** Result of a learner post, so the controller can mark the slide complete after commit. */
    public record Created(DiscussionPostView post, boolean firstResponse, String packageSessionId, String chapterId) {
    }

    @Transactional
    public Created createAsLearner(CustomUserDetails user, DiscussionRequests.CreatePost req, String clientId) {
        Context ctx = learnerContext(user, req.getSlideId(), clientId, req.getPackageSessionId(), req.getChapterId());
        DiscussionSettings settings = ctx.settings();
        if (!StringUtils.hasText(ctx.packageSessionId()) || postRepository.findBatchesOfSlide(req.getSlideId(),
                ctx.instituteId()).stream().noneMatch(b -> ctx.packageSessionId().equals(b.getPackageSessionId()))) {
            throw new VacademyException("Open this discussion from your course to post in it");
        }
        if (settings.isLocked()) {
            throw new VacademyException("This discussion is closed to new posts");
        }
        String content = cleanContent(req.getContent());

        boolean hasResponded = postRepository.hasResponded(req.getSlideId(), ctx.userId());
        String parentId = null;
        boolean anonymous = req.isAnonymous() && settings.isAllowAnonymous();
        if (StringUtils.hasText(req.getParentId())) {
            DiscussionPost parent = postRepository.findById(req.getParentId())
                    .orElseThrow(() -> new VacademyException("That post no longer exists"));
            boolean othersVisible = settings.othersVisibleBy(hasResponded);
            if (!parent.isRoot() || !req.getSlideId().equals(parent.getSlideId())
                    || !inBatch(parent, ctx.packageSessionId()) || !canSee(ctx, parent, othersVisible)) {
                throw new ForbiddenException("You cannot comment on this post");
            }
            boolean ownThread = ctx.userId().equals(parent.getUserId());
            if (!ownThread && !settings.isAllowComments()) {
                throw new ForbiddenException("Comments are turned off for this discussion");
            }
            if (ownThread && parent.isAnonymous()) {
                // Replying under your own anonymous response must not reveal who wrote it.
                anonymous = true;
            }
            parentId = parent.getId();
        }

        DiscussionPost post = new DiscussionPost();
        post.setSlideId(req.getSlideId());
        post.setInstituteId(ctx.instituteId());
        post.setPackageSessionId(ctx.packageSessionId());
        post.setParentId(parentId);
        post.setUserId(ctx.userId());
        post.setAuthorName(nameOf(user));
        post.setAuthorRole(DiscussionPost.ROLE_LEARNER);
        post.setAnonymous(anonymous);
        post.setContent(content);
        post.setStatus(settings.isRequireApproval() ? DiscussionPost.STATUS_PENDING : DiscussionPost.STATUS_PUBLISHED);
        postRepository.save(post);

        DiscussionPostView view = toView(ctx, post, Map.of(), Map.of(), Set.of(), settings);
        if (post.isRoot()) {
            view.setComments(new ArrayList<>());
        }
        return new Created(view, post.isRoot() && !hasResponded, ctx.packageSessionId(), ctx.chapterId());
    }

    @Transactional
    public DiscussionPostView createAsStaff(CustomUserDetails user, String instituteId,
            DiscussionRequests.CreatePost req) {
        Context ctx = staffContext(user, req.getSlideId(), instituteId);
        String content = cleanContent(req.getContent());
        String packageSessionId;
        String parentId = null;
        if (StringUtils.hasText(req.getParentId())) {
            DiscussionPost parent = postRepository.findById(req.getParentId())
                    .orElseThrow(() -> new VacademyException("That post no longer exists"));
            if (!parent.isRoot() || !req.getSlideId().equals(parent.getSlideId())
                    || !instituteId.equals(parent.getInstituteId())
                    || DiscussionPost.STATUS_DELETED.equals(parent.getStatus())) {
                throw new ForbiddenException("You cannot comment on this post");
            }
            parentId = parent.getId();
            packageSessionId = parent.getPackageSessionId();
        } else if (StringUtils.hasText(req.getPackageSessionId())) {
            packageSessionId = req.getPackageSessionId();
            boolean known = postRepository.findBatchesOfSlide(req.getSlideId(), instituteId).stream()
                    .anyMatch(b -> packageSessionId.equals(b.getPackageSessionId()));
            if (!known) {
                throw new VacademyException("That batch does not have this discussion");
            }
        } else {
            packageSessionId = null; // every batch
        }

        DiscussionPost post = new DiscussionPost();
        post.setSlideId(req.getSlideId());
        post.setInstituteId(instituteId);
        post.setPackageSessionId(packageSessionId);
        post.setParentId(parentId);
        post.setUserId(ctx.userId());
        post.setAuthorName(nameOf(user));
        post.setAuthorRole(DiscussionPost.ROLE_STAFF);
        post.setAnonymous(false);
        post.setContent(content);
        post.setStatus(DiscussionPost.STATUS_PUBLISHED);
        postRepository.save(post);
        DiscussionPostView view = toView(ctx, post, Map.of(), Map.of(), Set.of(), ctx.settings());
        if (post.isRoot()) {
            view.setComments(new ArrayList<>());
        }
        return view;
    }

    @Transactional
    public DiscussionPostView editAsLearner(CustomUserDetails user, String postId, DiscussionRequests.EditPost req,
            String clientId) {
        DiscussionPost post = requirePost(postId);
        Context ctx = learnerContext(user, post.getSlideId(), clientId, post.getPackageSessionId(), null);
        requireOwnEditable(ctx, post);
        if (ctx.settings().isLocked()) {
            throw new VacademyException("This discussion is closed");
        }
        post.setContent(cleanContent(req.getContent()));
        post.setEditedAt(now());
        if (ctx.settings().isRequireApproval() && DiscussionPost.STATUS_PUBLISHED.equals(post.getStatus())) {
            // An edit is new text: it goes back for approval like a new post would.
            post.setStatus(DiscussionPost.STATUS_PENDING);
        }
        postRepository.save(post);
        return viewOf(ctx, post);
    }

    @Transactional
    public void deleteAsLearner(CustomUserDetails user, String postId, String clientId) {
        DiscussionPost post = requirePost(postId);
        Context ctx = learnerContext(user, post.getSlideId(), clientId, post.getPackageSessionId(), null);
        requireOwnEditable(ctx, post);
        post.setStatus(DiscussionPost.STATUS_DELETED);
        postRepository.save(post);
    }

    private void requireOwnEditable(Context ctx, DiscussionPost post) {
        if (!ctx.userId().equals(post.getUserId()) || post.isStaffPost()) {
            throw new ForbiddenException("You can only change your own posts");
        }
        if (!ctx.settings().isAllowEditOwn()) {
            throw new ForbiddenException("Editing posts is turned off for this discussion");
        }
        if (!DiscussionPost.STATUS_PUBLISHED.equals(post.getStatus())
                && !DiscussionPost.STATUS_PENDING.equals(post.getStatus())) {
            throw new ForbiddenException("This post can no longer be changed");
        }
    }

    @Transactional
    public DiscussionPostView editAsStaff(CustomUserDetails user, String instituteId, String postId,
            DiscussionRequests.EditPost req) {
        DiscussionPost post = requirePost(postId);
        Context ctx = staffContext(user, post.getSlideId(), instituteId);
        if (!instituteId.equals(post.getInstituteId()) || !ctx.userId().equals(post.getUserId())
                || !post.isStaffPost() || DiscussionPost.STATUS_DELETED.equals(post.getStatus())) {
            throw new ForbiddenException("You can only edit your own posts");
        }
        post.setContent(cleanContent(req.getContent()));
        post.setEditedAt(now());
        postRepository.save(post);
        return viewOf(ctx, post);
    }

    /** Toggle one reaction. Returns the post's reaction counts afterwards. */
    @Transactional
    public List<DiscussionPostView.ReactionCount> react(CustomUserDetails user, String postId,
            DiscussionRequests.React req, String clientId, String staffInstituteId) {
        DiscussionPost post = requirePost(postId);
        Context ctx;
        if (StringUtils.hasText(staffInstituteId)) {
            ctx = staffContext(user, post.getSlideId(), staffInstituteId);
            if (!staffInstituteId.equals(post.getInstituteId())) {
                throw new ForbiddenException("You cannot react to this post");
            }
        } else {
            ctx = learnerContext(user, post.getSlideId(), clientId, post.getPackageSessionId(), null);
            requireLearnerCanSee(ctx, post);
        }
        DiscussionSettings settings = ctx.settings();
        String reaction = req == null ? null : req.getReaction();
        if (!settings.isAllowReactions() || reaction == null || !settings.getReactions().contains(reaction)) {
            throw new VacademyException("That reaction is not available here");
        }
        if (!DiscussionPost.STATUS_PUBLISHED.equals(post.getStatus())) {
            throw new VacademyException("You can react once the post is published");
        }
        if (reactionRepository.deleteOne(postId, ctx.userId(), reaction) == 0) {
            reactionRepository.insertIfAbsent(UUID.randomUUID().toString(), postId, ctx.userId(), reaction);
        }
        return reactionCounts(reactionRepository.findByPostId(postId), ctx.userId(), settings);
    }

    @Transactional
    public void report(CustomUserDetails user, String postId, DiscussionRequests.Report req, String clientId) {
        DiscussionPost post = requirePost(postId);
        Context ctx = learnerContext(user, post.getSlideId(), clientId, post.getPackageSessionId(), null);
        requireLearnerCanSee(ctx, post);
        if (ctx.userId().equals(post.getUserId())) {
            throw new VacademyException("You cannot report your own post");
        }
        String reason = req == null || req.getReason() == null ? null : req.getReason().trim();
        if (reason != null && reason.length() > MAX_REASON) {
            reason = reason.substring(0, MAX_REASON);
        }
        if (reportRepository.insertIfAbsent(UUID.randomUUID().toString(), postId, ctx.userId(),
                StringUtils.hasText(reason) ? reason : null) > 0) {
            postRepository.incrementReportCount(postId);
        }
    }

    /** A learner may only touch a post they can see, in their own batch. */
    private void requireLearnerCanSee(Context ctx, DiscussionPost post) {
        boolean hasResponded = postRepository.hasResponded(post.getSlideId(), ctx.userId());
        boolean othersVisible = ctx.settings().othersVisibleBy(hasResponded);
        if (!inBatch(post, ctx.packageSessionId()) || !canSee(ctx, post, othersVisible)) {
            throw new ForbiddenException("You cannot see this post");
        }
        if (!post.isRoot()) {
            DiscussionPost root = postRepository.findById(post.getParentId()).orElse(null);
            if (root == null || !canSee(ctx, root, othersVisible)) {
                throw new ForbiddenException("You cannot see this post");
            }
        }
    }

    @Transactional
    public DiscussionPostView moderate(CustomUserDetails user, String instituteId, String postId,
            DiscussionRequests.Moderate req) {
        DiscussionPost post = requirePost(postId);
        Context ctx = staffContext(user, post.getSlideId(), instituteId);
        if (!instituteId.equals(post.getInstituteId()) || DiscussionPost.STATUS_DELETED.equals(post.getStatus())) {
            throw new ForbiddenException("You cannot moderate this post");
        }
        String action = req == null || req.getAction() == null ? "" : req.getAction().toUpperCase();
        switch (action) {
            case "APPROVE", "UNHIDE" -> post.setStatus(DiscussionPost.STATUS_PUBLISHED);
            case "HIDE" -> post.setStatus(DiscussionPost.STATUS_HIDDEN);
            case "DELETE" -> post.setStatus(DiscussionPost.STATUS_DELETED);
            case "PIN", "UNPIN" -> {
                if (!post.isRoot()) {
                    throw new VacademyException("Only responses can be pinned");
                }
                post.setPinned("PIN".equals(action));
            }
            case "CLEAR_REPORTS" -> {
                reportRepository.deleteByPost(postId);
                post.setReportCount(0);
            }
            default -> throw new VacademyException("Unknown action: " + action);
        }
        post.setModeratedBy(ctx.userId());
        post.setModeratedAt(now());
        postRepository.save(post);
        return viewOf(ctx, post);
    }

    // ------------------------------------------------------------------ helpers

    private DiscussionPostView viewOf(Context ctx, DiscussionPost post) {
        Map<String, List<DiscussionReaction>> reactions = Map.of(post.getId(),
                reactionRepository.findByPostId(post.getId()));
        return toView(ctx, post, reactions, Map.of(), Set.of(), ctx.settings());
    }

    private DiscussionPost requirePost(String postId) {
        if (!StringUtils.hasText(postId)) {
            throw new VacademyException("post id is required");
        }
        DiscussionPost post = postRepository.findById(postId)
                .orElseThrow(() -> new VacademyException("That post no longer exists"));
        if (DiscussionPost.STATUS_DELETED.equals(post.getStatus())) {
            throw new VacademyException("That post no longer exists");
        }
        return post;
    }

    private static boolean inBatch(DiscussionPost post, String packageSessionId) {
        return post.getPackageSessionId() == null || post.getPackageSessionId().equals(packageSessionId);
    }

    /** Plain text only: trimmed, control characters other than newlines and tabs removed, length capped. */
    static String cleanContent(String raw) {
        if (raw == null) {
            throw new VacademyException("Write something before posting");
        }
        String text = raw.replace("\r\n", "\n").replaceAll("[\\p{Cntrl}&&[^\n\t]]", "").trim();
        if (text.isEmpty()) {
            throw new VacademyException("Write something before posting");
        }
        if (text.length() > MAX_CONTENT) {
            throw new VacademyException("Posts can be at most " + MAX_CONTENT + " characters");
        }
        return text;
    }

    private static String nameOf(CustomUserDetails user) {
        if (StringUtils.hasText(user.getFullName())) {
            return user.getFullName().trim();
        }
        return StringUtils.hasText(user.getUsername()) ? user.getUsername() : null;
    }

    private static Timestamp now() {
        return new Timestamp(System.currentTimeMillis());
    }
}
