package vacademy.io.admin_core_service.features.slide_activity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionPostRepository;
import vacademy.io.admin_core_service.features.discussion.repository.DiscussionPostRepository.SlideDocumentRow;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Poll and Game slides: DOCUMENT slides of type POLL / GAME. The question, options and
 * settings (or the game page) are the slide's published JSON; this service records what
 * learners did and decides what they may see.
 *
 * <p>Poll JSON: {@code {"question": "...", "options": [{"id","text"}],
 * "settings": {"results": "AFTER_VOTE" | "ALWAYS" | "TEACHER_ONLY", "allowChange": bool}}}.
 * <br>Game JSON: {@code {"html": "...", "maxScore": number | null, "instructions": "..."}}.
 *
 * <p>Votes and scores are per batch: a learner sees their own batch's results only.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class SlideActivityService {

    public static final String POLL_TYPE = "POLL";
    public static final String GAME_TYPE = "GAME";
    /** A game that names no top score may still not report more than this. */
    static final double MAX_UNBOUNDED_SCORE = 1000;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final SlideActivityResponseRepository repository;
    private final DiscussionPostRepository slideRepository;
    private final LearnerQuizAccessService learnerAccessService;
    private final InstituteAccessValidator instituteAccessValidator;
    private final AuthService authService;

    // ── settings parsed from the slide ───────────────────────────────────────

    public record PollOption(String id, String text) {}

    public record PollSpec(List<PollOption> options, String results, boolean allowChange) {
        boolean has(String optionId) {
            return options.stream().anyMatch(o -> o.id().equals(optionId));
        }
    }

    static PollSpec parsePoll(String json) {
        List<PollOption> options = new ArrayList<>();
        String results = "AFTER_VOTE";
        boolean allowChange = false;
        try {
            JsonNode root = StringUtils.hasText(json) ? MAPPER.readTree(json) : null;
            if (root != null) {
                for (JsonNode o : root.path("options")) {
                    String id = o.path("id").asText("");
                    String text = o.path("text").asText("");
                    if (!id.isBlank() && !text.isBlank()) options.add(new PollOption(id, text));
                }
                String r = root.path("settings").path("results").asText("AFTER_VOTE");
                if (List.of("AFTER_VOTE", "ALWAYS", "TEACHER_ONLY").contains(r)) results = r;
                allowChange = root.path("settings").path("allowChange").asBoolean(false);
            }
        } catch (Exception e) {
            // An unreadable poll takes no votes and shows nothing.
            log.warn("[slide-activity] unreadable poll JSON: {}", e.getMessage());
            return new PollSpec(List.of(), "TEACHER_ONLY", false);
        }
        return new PollSpec(options, results, allowChange);
    }

    /** The game's top score, or null when it names none. */
    static Double parseGameMax(String json) {
        try {
            JsonNode n = StringUtils.hasText(json) ? MAPPER.readTree(json).path("maxScore") : null;
            if (n == null || !n.isNumber() || n.asDouble() <= 0) return null;
            return Math.min(n.asDouble(), MAX_UNBOUNDED_SCORE);
        } catch (Exception e) {
            return null;
        }
    }

    /** Clamp a reported result: never negative, never above the slide's (or the page's) top score. */
    static double[] clampScore(Double score, Double reportedMax, Double slideMax) {
        double max = slideMax != null ? slideMax
                : reportedMax != null && reportedMax > 0 ? Math.min(reportedMax, MAX_UNBOUNDED_SCORE)
                : MAX_UNBOUNDED_SCORE;
        double s = score == null || score.isNaN() || score.isInfinite() ? 0 : score;
        return new double[] {Math.max(0, Math.min(max, s)), max};
    }

    // ── learner: poll ────────────────────────────────────────────────────────

    public record PollView(String myOptionId, boolean canVote, boolean resultsVisible, long totalVotes,
                           Map<String, Long> counts) {}

    public record LearnerCtx(String userId, String instituteId, String packageSessionId, String chapterId,
                             String json) {}

    LearnerCtx learnerCtx(CustomUserDetails user, String slideId, String type, String clientId,
                          String packageSessionId, String chapterId) {
        SlideDocumentRow row = requireSlide(slideId, type);
        LearnerQuizAccessService.Access access = learnerAccessService.requireAccess(user, slideId, clientId,
                packageSessionId, chapterId);
        boolean published = "PUBLISHED".equals(row.getSlideStatus()) || "UNSYNC".equals(row.getSlideStatus());
        if (!published) {
            try {
                instituteAccessValidator.requireInstituteStaff(user, access.instituteId());
            } catch (RuntimeException notStaff) {
                throw new ForbiddenException("This slide is not published yet");
            }
        }
        String json = StringUtils.hasText(row.getPublishedData()) ? row.getPublishedData() : row.getData();
        return new LearnerCtx(user.getUserId(), access.instituteId(), access.packageSessionId(),
                access.chapterId(), json);
    }

    public PollView pollForLearner(LearnerCtx ctx, String slideId) {
        PollSpec spec = parsePoll(ctx.json());
        SlideActivityResponse mine = repository
                .findBySlideIdAndUserIdAndKind(slideId, ctx.userId(), SlideActivityResponse.POLL).orElse(null);
        return pollView(spec, ctx, slideId, mine);
    }

    /** @return the view, and whether this was the learner's first vote (it completes the slide). */
    public record Voted(PollView view, boolean firstVote) {}

    public Voted vote(LearnerCtx ctx, String slideId, String optionId) {
        PollSpec spec = parsePoll(ctx.json());
        if (!StringUtils.hasText(optionId) || !spec.has(optionId)) {
            throw new VacademyException("Pick one of the poll's options.");
        }
        SlideActivityResponse mine = repository
                .findBySlideIdAndUserIdAndKind(slideId, ctx.userId(), SlideActivityResponse.POLL).orElse(null);
        boolean first = mine == null;
        if (mine != null && !spec.allowChange() && !optionId.equals(mine.getOptionId())) {
            throw new VacademyException("Your vote is already in. This poll does not allow changing it.");
        }
        if (mine == null) {
            mine = newRow(slideId, ctx, SlideActivityResponse.POLL);
        } else {
            mine.setAttempts(mine.getAttempts() + 1);
        }
        mine.setOptionId(optionId);
        mine.setPackageSessionId(ctx.packageSessionId());
        mine.setUpdatedAt(now());
        mine = saveOrReload(mine, slideId, ctx.userId(), SlideActivityResponse.POLL);
        return new Voted(pollView(spec, ctx, slideId, mine), first);
    }

    private PollView pollView(PollSpec spec, LearnerCtx ctx, String slideId, SlideActivityResponse mine) {
        boolean voted = mine != null;
        boolean visible = switch (spec.results()) {
            case "ALWAYS" -> true;
            case "TEACHER_ONLY" -> false;
            default -> voted;
        };
        Map<String, Long> counts = new LinkedHashMap<>();
        long total = 0;
        if (visible) {
            Map<String, Long> raw = counts(slideId, ctx.instituteId(), ctx.packageSessionId());
            for (PollOption o : spec.options()) {
                long n = raw.getOrDefault(o.id(), 0L);
                counts.put(o.id(), n);
                total += n;
            }
        }
        boolean canVote = !spec.options().isEmpty() && (!voted || spec.allowChange());
        return new PollView(voted ? mine.getOptionId() : null, canVote, visible, total, counts);
    }

    // ── learner: game ────────────────────────────────────────────────────────

    public record GameView(Double bestScore, Double lastScore, Double maxScore, int attempts) {}

    public record Scored(GameView view, boolean firstResult) {}

    public GameView gameForLearner(LearnerCtx ctx, String slideId) {
        SlideActivityResponse mine = repository
                .findBySlideIdAndUserIdAndKind(slideId, ctx.userId(), SlideActivityResponse.GAME).orElse(null);
        return gameView(mine, parseGameMax(ctx.json()));
    }

    public Scored recordScore(LearnerCtx ctx, String slideId, Double score, Double reportedMax) {
        Double slideMax = parseGameMax(ctx.json());
        double[] clamped = clampScore(score, reportedMax, slideMax);
        SlideActivityResponse mine = repository
                .findBySlideIdAndUserIdAndKind(slideId, ctx.userId(), SlideActivityResponse.GAME).orElse(null);
        boolean first = mine == null;
        if (mine == null) {
            mine = newRow(slideId, ctx, SlideActivityResponse.GAME);
        } else {
            mine.setAttempts(mine.getAttempts() + 1);
        }
        mine.setScore(clamped[0]);
        mine.setMaxScore(clamped[1]);
        mine.setBestScore(mine.getBestScore() == null ? clamped[0] : Math.max(mine.getBestScore(), clamped[0]));
        mine.setPackageSessionId(ctx.packageSessionId());
        mine.setUpdatedAt(now());
        mine = saveOrReload(mine, slideId, ctx.userId(), SlideActivityResponse.GAME);
        return new Scored(gameView(mine, slideMax), first);
    }

    private static GameView gameView(SlideActivityResponse r, Double slideMax) {
        if (r == null) return new GameView(null, null, slideMax, 0);
        return new GameView(r.getBestScore(), r.getScore(), slideMax != null ? slideMax : r.getMaxScore(),
                r.getAttempts());
    }

    // ── staff ────────────────────────────────────────────────────────────────

    public record Batch(String packageSessionId, String name) {}

    public record PollResults(List<PollOption> options, Map<String, Long> counts, long totalVotes,
                              List<Batch> batches) {}

    public record ScoreRow(String userId, String name, Double bestScore, Double lastScore, Double maxScore,
                           int attempts, String updatedAt) {}

    public record GameResults(List<ScoreRow> rows, Double maxScore, List<Batch> batches) {}

    private String staffJson(CustomUserDetails user, String slideId, String type, String instituteId) {
        SlideDocumentRow row = requireSlide(slideId, type);
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        if (slideRepository.findBatchesOfSlide(slideId, instituteId).isEmpty()) {
            throw new ForbiddenException("This slide does not belong to your institute");
        }
        return StringUtils.hasText(row.getPublishedData()) ? row.getPublishedData() : row.getData();
    }

    public PollResults pollResults(CustomUserDetails user, String slideId, String instituteId,
                                   String packageSessionId) {
        PollSpec spec = parsePoll(staffJson(user, slideId, POLL_TYPE, instituteId));
        Map<String, Long> raw = counts(slideId, instituteId, packageSessionId);
        Map<String, Long> counts = new LinkedHashMap<>();
        long total = 0;
        for (PollOption o : spec.options()) {
            long n = raw.getOrDefault(o.id(), 0L);
            counts.put(o.id(), n);
            total += n;
        }
        return new PollResults(spec.options(), counts, total, batches(slideId, instituteId));
    }

    public GameResults gameResults(CustomUserDetails user, String slideId, String instituteId,
                                   String packageSessionId, int limit) {
        Double slideMax = parseGameMax(staffJson(user, slideId, GAME_TYPE, instituteId));
        List<SlideActivityResponse> rows = repository.findForSlide(slideId, SlideActivityResponse.GAME, instituteId,
                StringUtils.hasText(packageSessionId) ? packageSessionId : "",
                PageRequest.of(0, Math.max(1, Math.min(500, limit))));
        Map<String, String> names = new HashMap<>();
        List<String> ids = rows.stream().map(SlideActivityResponse::getUserId).distinct().toList();
        if (!ids.isEmpty()) {
            try {
                for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(ids)) {
                    if (u != null && u.getId() != null) names.put(u.getId(), u.getFullName());
                }
            } catch (Exception e) {
                log.warn("[slide-activity] name lookup failed for {} learners", ids.size(), e);
            }
        }
        List<ScoreRow> out = new ArrayList<>();
        for (SlideActivityResponse r : rows) {
            out.add(new ScoreRow(r.getUserId(), names.get(r.getUserId()), r.getBestScore(), r.getScore(),
                    slideMax != null ? slideMax : r.getMaxScore(), r.getAttempts(),
                    r.getUpdatedAt() == null ? null : r.getUpdatedAt().toInstant().toString()));
        }
        return new GameResults(out, slideMax, batches(slideId, instituteId));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private SlideDocumentRow requireSlide(String slideId, String type) {
        if (!StringUtils.hasText(slideId)) throw new VacademyException("slideId is required");
        SlideDocumentRow row = slideRepository.findSlideDocument(slideId)
                .orElseThrow(() -> new VacademyException("Slide not found"));
        if (!"DOCUMENT".equals(row.getSourceType()) || !type.equals(row.getDocumentType())
                || "DELETED".equals(row.getSlideStatus())) {
            throw new VacademyException("Slide not found");
        }
        return row;
    }

    private Map<String, Long> counts(String slideId, String instituteId, String packageSessionId) {
        Map<String, Long> out = new HashMap<>();
        for (Object[] row : repository.countVotes(slideId, instituteId,
                StringUtils.hasText(packageSessionId) ? packageSessionId : "")) {
            if (row[0] != null) out.put((String) row[0], ((Number) row[1]).longValue());
        }
        return out;
    }

    private List<Batch> batches(String slideId, String instituteId) {
        List<Batch> out = new ArrayList<>();
        for (DiscussionPostRepository.BatchRow b : slideRepository.findBatchesOfSlide(slideId, instituteId)) {
            List<String> parts = new ArrayList<>();
            for (String p : new String[] {b.getPackageName(), b.getSessionName(), b.getLevelName()}) {
                if (p != null && !p.isBlank() && !"DEFAULT".equalsIgnoreCase(p.strip())) parts.add(p.strip());
            }
            out.add(new Batch(b.getPackageSessionId(), parts.isEmpty() ? b.getPackageName() : String.join(" · ", parts)));
        }
        return out;
    }

    private static SlideActivityResponse newRow(String slideId, LearnerCtx ctx, String kind) {
        SlideActivityResponse r = new SlideActivityResponse();
        r.setId(UUID.randomUUID().toString());
        r.setSlideId(slideId);
        r.setInstituteId(ctx.instituteId());
        r.setUserId(ctx.userId());
        r.setKind(kind);
        r.setAttempts(1);
        return r;
    }

    /** Two quick taps race on the unique index; the loser reads the winner's row. */
    private SlideActivityResponse saveOrReload(SlideActivityResponse r, String slideId, String userId, String kind) {
        try {
            return repository.saveAndFlush(r);
        } catch (DataIntegrityViolationException e) {
            return repository.findBySlideIdAndUserIdAndKind(slideId, userId, kind).orElseThrow(() -> e);
        }
    }

    private static Timestamp now() {
        return Timestamp.from(Instant.now());
    }
}
