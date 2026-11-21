package vacademy.io.community_service.feature.session.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import vacademy.io.community_service.feature.presentation.dto.question.PresentationSlideDto;
import vacademy.io.community_service.feature.session.dto.admin.*;
import vacademy.io.community_service.feature.session.manager.LiveSessionPersistenceService;
import vacademy.io.community_service.feature.session.manager.LiveSessionService;
import vacademy.io.community_service.feature.session.manager.PresenterKeyService;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/community-service/engage/admin")
public class AdminSessionController {

    /**
     * Named with "token" so the shared Sentry scrubber and request logging redact them like any
     * other credential.
     */
    private static final String PRESENTER_KEY_HEADER = "X-Presenter-Token";
    private static final String PRESENTER_KEY_PARAM = "presenter_token";

    @Autowired
    LiveSessionService liveSessionService;

    @Autowired
    PresenterKeyService presenterKeyService;

    @Autowired
    LiveSessionPersistenceService persistenceService;

    @Autowired
    @Qualifier("sseHeartbeatScheduler")
    private ScheduledExecutorService sseHeartbeatScheduler;

    @PostMapping("/create")
    public ResponseEntity<LiveSessionDto> createSession(@RequestBody CreateSessionDto createSessionDto) {
        LiveSessionDto sessionDto = liveSessionService.createSession(createSessionDto);
        return ResponseEntity.ok(sessionDto);
    }

    /**
     * Same as /create, and also returns a presenter key. Every later presenter call on this
     * session has to carry that key. EventSource cannot set headers, so the read calls also
     * accept it as ?presenter_token=.
     */
    @PostMapping("/v2/create")
    public ResponseEntity<CreateSessionV2ResponseDto> createSessionV2(@RequestBody CreateSessionDto createSessionDto) {
        LiveSessionDto sessionDto = liveSessionService.createSession(createSessionDto);
        String presenterKey = presenterKeyService.issue(sessionDto.getSessionId());
        return ResponseEntity.ok(new CreateSessionV2ResponseDto(sessionDto, presenterKey));
    }

    @GetMapping("/{sessionId}")
    public SseEmitter presenterStream(@PathVariable String sessionId,
            @RequestHeader(value = PRESENTER_KEY_HEADER, required = false) String presenterKey,
            @RequestParam(value = PRESENTER_KEY_PARAM, required = false) String queryKey) {
        requirePresenterKey(sessionId, presenterKey, queryKey);

        SseEmitter emitter = new SseEmitter(3L * 60 * 60 * 1000); // 3 hours, for example

        liveSessionService.setPresenterEmitter(sessionId, emitter, true); // Send initial state

        Runnable heartbeatTask = () -> {
            try {
                emitter.send(
                        SseEmitter.event().name("presenter_heartbeat").id(UUID.randomUUID().toString()).data("ping"));
            } catch (IOException | IllegalStateException ignored) {
                // Emitter already closed; the future will be cancelled by the handlers below.
            }
        };
        ScheduledFuture<?> heartbeatFuture =
                sseHeartbeatScheduler.scheduleAtFixedRate(heartbeatTask, 0, 30, TimeUnit.SECONDS);

        emitter.onCompletion(() -> heartbeatFuture.cancel(false));
        emitter.onTimeout(() -> heartbeatFuture.cancel(false));
        emitter.onError(e -> heartbeatFuture.cancel(false));

        return emitter;
    }

    @PostMapping("/start")
    public ResponseEntity<LiveSessionDto> startSession(@RequestBody StartPresentationDto startPresentationDto,
            @RequestHeader(value = PRESENTER_KEY_HEADER, required = false) String presenterKey) {
        requirePresenterKey(startPresentationDto.getSessionId(), presenterKey, null);
        LiveSessionDto liveSessionDto = liveSessionService.startSession(startPresentationDto);
        return ResponseEntity.ok(liveSessionDto);
    }

    @PostMapping("/move")
    public ResponseEntity<LiveSessionDto> moveTo(@RequestBody StartPresentationDto startPresentationDto,
            @RequestHeader(value = PRESENTER_KEY_HEADER, required = false) String presenterKey) {
        requirePresenterKey(startPresentationDto.getSessionId(), presenterKey, null);
        LiveSessionDto liveSessionDto = liveSessionService.moveTo(startPresentationDto);
        return ResponseEntity.ok(liveSessionDto);
    }

    @PostMapping("/finish")
    public ResponseEntity<LiveSessionDto> finishSession(@RequestBody StartPresentationDto startPresentationDto,
            @RequestHeader(value = PRESENTER_KEY_HEADER, required = false) String presenterKey) {
        requirePresenterKey(startPresentationDto.getSessionId(), presenterKey, null);
        LiveSessionDto liveSessionDto = liveSessionService.finishSession(startPresentationDto);
        presenterKeyService.retire(startPresentationDto.getSessionId());
        return ResponseEntity.ok(liveSessionDto);
    }

    @PostMapping("/finish-send-notifications")
    public ResponseEntity<LiveSessionDto> sendParticipantNotifications(
            @RequestBody NotifyPresentationRequestDto notifyPresentationRequestDto,
            @RequestHeader(value = PRESENTER_KEY_HEADER, required = false) String presenterKey) {
        requirePresenterKey(notifyPresentationRequestDto.getSessionId(), presenterKey, null);
        LiveSessionDto liveSessionDto = liveSessionService.sendParticipantNotifications(notifyPresentationRequestDto);
        return ResponseEntity.ok(liveSessionDto);
    }

    @PostMapping("/add-slide-in-session")
    public ResponseEntity<LiveSessionDto> addSlideInLiveSession(@RequestBody PresentationSlideDto presentationSlideDto,
            @RequestParam String sessionId, @RequestParam Integer afterSlideOrder,
            @RequestHeader(value = PRESENTER_KEY_HEADER, required = false) String presenterKey) {
        requirePresenterKey(sessionId, presenterKey, null);
        LiveSessionDto liveSessionDto = liveSessionService.addSlideInLiveSession(presentationSlideDto, sessionId,
                afterSlideOrder);
        return ResponseEntity.ok(liveSessionDto);
    }

    // New endpoint to get slide responses
    @GetMapping("/{sessionId}/slide/{slideId}/responses")
    public ResponseEntity<List<AdminSlideResponseViewDto>> getSlideResponses(
            @PathVariable String sessionId,
            @PathVariable String slideId,
            @RequestHeader(value = PRESENTER_KEY_HEADER, required = false) String presenterKey,
            @RequestParam(value = PRESENTER_KEY_PARAM, required = false) String queryKey) {
        requirePresenterKey(sessionId, presenterKey, queryKey);
        List<AdminSlideResponseViewDto> responses = liveSessionService.getSlideResponses(sessionId, slideId);
        return ResponseEntity.ok(responses);
    }

    // Leaderboard endpoint - JSON
    @GetMapping("/{sessionId}/leaderboard")
    public ResponseEntity<List<LeaderboardEntryDto>> getLeaderboard(@PathVariable String sessionId,
            @RequestHeader(value = PRESENTER_KEY_HEADER, required = false) String presenterKey,
            @RequestParam(value = PRESENTER_KEY_PARAM, required = false) String queryKey) {
        requirePresenterKey(sessionId, presenterKey, queryKey);
        List<LeaderboardEntryDto> leaderboard = liveSessionService.computeLeaderboard(sessionId);
        return ResponseEntity.ok(leaderboard);
    }

    // Session history for a presentation (DB-backed, works even after in-memory cleanup)
    @GetMapping("/presentation/{presentationId}/sessions")
    public ResponseEntity<List<Map<String, Object>>> getSessionHistory(
            @PathVariable String presentationId) {
        return ResponseEntity.ok(persistenceService.getSessionHistoryForPresentation(presentationId));
    }

    // Leaderboard endpoint - CSV download
    @GetMapping("/{sessionId}/leaderboard/csv")
    public ResponseEntity<String> getLeaderboardCsv(@PathVariable String sessionId,
            @RequestHeader(value = PRESENTER_KEY_HEADER, required = false) String presenterKey,
            @RequestParam(value = PRESENTER_KEY_PARAM, required = false) String queryKey) {
        requirePresenterKey(sessionId, presenterKey, queryKey);
        List<LeaderboardEntryDto> leaderboard = liveSessionService.computeLeaderboard(sessionId);
        StringBuilder csv = new StringBuilder();
        csv.append("Rank,Username,Score,Total Time (ms),Correct,Wrong,Unanswered,Total MCQ Questions\n");
        for (LeaderboardEntryDto entry : leaderboard) {
            csv.append(entry.getRank()).append(",")
                    .append("\"").append(entry.getUsername().replace("\"", "\"\"")).append("\",")
                    .append(entry.getTotalScore()).append(",")
                    .append(entry.getTotalTimeMillis()).append(",")
                    .append(entry.getCorrectCount()).append(",")
                    .append(entry.getWrongCount()).append(",")
                    .append(entry.getUnansweredCount()).append(",")
                    .append(entry.getTotalMcqQuestions()).append("\n");
        }
        return ResponseEntity.ok()
                .header("Content-Type", "text/csv")
                .header("Content-Disposition", "attachment; filename=leaderboard_" + sessionId + ".csv")
                .body(csv.toString());
    }

    /**
     * The content type is set here because a presenter stream or CSV request can arrive with an
     * Accept header that has no JSON in it, and the refusal still has to be written as a 403.
     */
    @ExceptionHandler(PresenterKeyRejectedException.class)
    public ResponseEntity<Map<String, String>> handlePresenterKeyRejected() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("code", "FORBIDDEN", "message", "Presenter key required"));
    }

    /**
     * Hashed here, so no *Service method is ever called with the raw key: the shared logging aspect
     * prints the arguments of slow or failing *Service calls.
     */
    private void requirePresenterKey(String sessionId, String headerKey, String queryKey) {
        String presented = headerKey != null ? headerKey : queryKey;
        if (!presenterKeyService.allows(sessionId, PresenterKeyService.hash(presented))) {
            throw new PresenterKeyRejectedException();
        }
    }

    private static class PresenterKeyRejectedException extends RuntimeException {
        PresenterKeyRejectedException() {
            super("Presenter key required", null, false, false);
        }
    }
}
