package vacademy.io.admin_core_service.features.slide_activity;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingService;
import vacademy.io.common.auth.model.CustomUserDetails;

/** Poll and Game slides for the signed-in learner. The learner is always the token holder. */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/slide-activity/learner/v1")
@RequiredArgsConstructor
public class SlideActivityLearnerController {

    private final SlideActivityService service;
    private final LearnerTrackingService learnerTrackingService;

    /** Where the slide sits, so its completion lands on the right chapter. */
    public record Place(String slideId, String packageSessionId, String chapterId, String moduleId,
                        String subjectId) {}

    public record VoteBody(String slideId, String packageSessionId, String chapterId, String moduleId,
                           String subjectId, String optionId) {}

    public record ScoreBody(String slideId, String packageSessionId, String chapterId, String moduleId,
                            String subjectId, Double score, Double maxScore) {}

    @GetMapping("/poll")
    public ResponseEntity<SlideActivityService.PollView> poll(@RequestParam("slideId") String slideId,
            @RequestParam(value = "packageSessionId", required = false) String packageSessionId,
            @RequestParam(value = "chapterId", required = false) String chapterId,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        SlideActivityService.LearnerCtx ctx = service.learnerCtx(user, slideId, SlideActivityService.POLL_TYPE,
                clientId, packageSessionId, chapterId);
        return ResponseEntity.ok(service.pollForLearner(ctx, slideId));
    }

    @PostMapping("/poll/vote")
    public ResponseEntity<SlideActivityService.PollView> vote(@RequestBody VoteBody body,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        SlideActivityService.LearnerCtx ctx = service.learnerCtx(user, body.slideId(),
                SlideActivityService.POLL_TYPE, clientId, body.packageSessionId(), body.chapterId());
        SlideActivityService.Voted voted = service.vote(ctx, body.slideId(), body.optionId());
        if (voted.firstVote()) {
            complete(new Place(body.slideId(), ctx.packageSessionId(), ctx.chapterId(), body.moduleId(),
                    body.subjectId()), user);
        }
        return ResponseEntity.ok(voted.view());
    }

    @GetMapping("/game")
    public ResponseEntity<SlideActivityService.GameView> game(@RequestParam("slideId") String slideId,
            @RequestParam(value = "packageSessionId", required = false) String packageSessionId,
            @RequestParam(value = "chapterId", required = false) String chapterId,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        SlideActivityService.LearnerCtx ctx = service.learnerCtx(user, slideId, SlideActivityService.GAME_TYPE,
                clientId, packageSessionId, chapterId);
        return ResponseEntity.ok(service.gameForLearner(ctx, slideId));
    }

    @PostMapping("/game/score")
    public ResponseEntity<SlideActivityService.GameView> score(@RequestBody ScoreBody body,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        SlideActivityService.LearnerCtx ctx = service.learnerCtx(user, body.slideId(),
                SlideActivityService.GAME_TYPE, clientId, body.packageSessionId(), body.chapterId());
        SlideActivityService.Scored scored = service.recordScore(ctx, body.slideId(), body.score(), body.maxScore());
        if (scored.firstResult()) {
            complete(new Place(body.slideId(), ctx.packageSessionId(), ctx.chapterId(), body.moduleId(),
                    body.subjectId()), user);
        }
        return ResponseEntity.ok(scored.view());
    }

    /** Voting / finishing the game completes the slide. Never allowed to fail the answer itself. */
    private void complete(Place p, CustomUserDetails user) {
        try {
            learnerTrackingService.markSlideCompletion(p.slideId(), "DOCUMENT", p.chapterId(), p.moduleId(),
                    p.subjectId(), p.packageSessionId(), true, user);
        } catch (RuntimeException e) {
            log.warn("[slide-activity] could not mark slide {} complete for {}: {}", p.slideId(),
                    user.getUserId(), e.getMessage());
        }
    }
}
