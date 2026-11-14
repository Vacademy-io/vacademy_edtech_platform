package vacademy.io.admin_core_service.features.live_activity.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityBus;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityAnalyticsDTO;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityFeedItemDTO;
import vacademy.io.admin_core_service.features.live_activity.dto.StreamTokenResponse;
import vacademy.io.admin_core_service.features.live_activity.service.LiveActivityAccessService;
import vacademy.io.admin_core_service.features.live_activity.service.LiveActivityAnalyticsService;
import vacademy.io.admin_core_service.features.live_activity.service.LiveActivityReadService;
import vacademy.io.admin_core_service.features.live_activity.service.LiveActivityStreamTokenService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Live activity feed: the SSE stream, its token mint, and the history reads.
 *
 * <p>Only {@code /stream} is on a permitAll path, and only because {@code EventSource}
 * cannot send an Authorization header. Everything else is an ordinary authenticated call.
 */
@RestController
@RequestMapping("/admin-core-service/v1/live-activity")
@RequiredArgsConstructor
public class LiveActivityController {

    private final LiveActivityBus bus;
    private final LiveActivityReadService readService;
    private final LiveActivityAnalyticsService analyticsService;
    private final LiveActivityAccessService accessService;
    private final LiveActivityStreamTokenService tokenService;
    private final InstituteAccessValidator instituteAccessValidator;

    /**
     * Mint a short-lived stream credential.
     *
     * <p>This is where authorization actually happens: membership of the institute is
     * checked here, the caller's visible categories are resolved here, and both are sealed
     * into the token. The stream endpoint then does no lookup of its own.
     */
    @PostMapping("/stream-token")
    public ResponseEntity<StreamTokenResponse> streamToken(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {

        instituteAccessValidator.validateUserAccess(user, instituteId);

        Set<String> allowed = accessService.allowedCategories(user, instituteId);
        String token = tokenService.mint(instituteId, user.getUserId(), allowed);
        long expiresAt = tokenService.expiryOf(instituteId, user.getUserId(), allowed);

        return ResponseEntity.ok(new StreamTokenResponse(token, expiresAt, new ArrayList<>(allowed)));
    }

    /**
     * The live stream.
     *
     * <p>Public path, token-gated. The institute is taken from the verified token and never
     * from a request parameter -- reading it from the query string would make the whole
     * token pointless, since an institute id is guessable in a way a call-log UUID is not.
     */
    @GetMapping(path = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> stream(@RequestParam("token") String token) {
        LiveActivityStreamTokenService.Claims claims = tokenService.verify(token);
        if (claims == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        SseEmitter emitter = bus.subscribe(claims.instituteId(), claims.allowedCategories());
        return ResponseEntity.ok()
                // Without this, a proxy that buffers the response holds every frame until the
                // stream closes, which looks exactly like a silently dead stream.
                .header("X-Accel-Buffering", "no")
                .header(HttpHeaders.CACHE_CONTROL, "no-cache")
                .body(emitter);
    }

    /** History, and the backfill the page loads before attaching the stream. */
    @GetMapping("/events")
    public ResponseEntity<Page<LiveActivityFeedItemDTO>> events(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "categories", required = false) String categories,
            @RequestParam(value = "from", required = false) Long from,
            @RequestParam(value = "to", required = false) Long to,
            @RequestParam(value = "counsellorUserId", required = false) String counsellorUserId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "100") int size) {

        instituteAccessValidator.validateUserAccess(user, instituteId);
        Set<String> allowed = accessService.allowedCategories(user, instituteId);

        return ResponseEntity.ok(readService.feed(
                instituteId, allowed, categories, from, to, counsellorUserId, page, size));
    }

    /**
     * The whole dashboard in one call.
     *
     * <p>One endpoint rather than one per card, on purpose. Institute Pulse split its rails
     * across five endpoints and a cross-service fan-out, which is what made it expensive --
     * every figure here is a grouped query over a single table, so splitting them would buy
     * nothing and cost a round trip each.
     */
    @GetMapping("/analytics")
    public ResponseEntity<LiveActivityAnalyticsDTO> analytics(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam("from") long from,
            @RequestParam("to") long to) {

        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(analyticsService.analytics(instituteId, from, to));
    }

    /** Counter strip. */
    @GetMapping("/counts")
    public ResponseEntity<Map<String, Long>> counts(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam("since") long since) {

        instituteAccessValidator.validateUserAccess(user, instituteId);
        Set<String> allowed = accessService.allowedCategories(user, instituteId);
        return ResponseEntity.ok(readService.counts(instituteId, allowed, since));
    }

    /** Sidebar badge. */
    @GetMapping("/unseen-count")
    public ResponseEntity<Long> unseenCount(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {

        instituteAccessValidator.validateUserAccess(user, instituteId);
        Set<String> allowed = accessService.allowedCategories(user, instituteId);
        return ResponseEntity.ok(readService.unseenCount(user.getUserId(), instituteId, allowed));
    }

    @PostMapping("/mark-seen")
    public ResponseEntity<Void> markSeen(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId) {

        instituteAccessValidator.validateUserAccess(user, instituteId);
        readService.markSeen(user.getUserId(), instituteId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/export.csv")
    public ResponseEntity<String> export(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "categories", required = false) String categories,
            @RequestParam(value = "from", required = false) Long from,
            @RequestParam(value = "to", required = false) Long to,
            @RequestParam(value = "counsellorUserId", required = false) String counsellorUserId) {

        instituteAccessValidator.validateUserAccess(user, instituteId);
        Set<String> allowed = accessService.allowedCategories(user, instituteId);

        List<LiveActivityFeedItemDTO> rows = readService.exportRows(
                instituteId, allowed, categories, from, to, counsellorUserId);

        StringBuilder csv = new StringBuilder(
                "When (UTC),Category,Action,Actor type,Name,Email,Mobile,Counsellor,Entity ID\n");
        for (LiveActivityFeedItemDTO row : rows) {
            csv.append(new java.sql.Timestamp(row.getOccurredAtEpochMillis())).append(',')
                    .append(csvCell(row.getCategory())).append(',')
                    .append(csvCell(row.getAction())).append(',')
                    .append(csvCell(row.getActorType())).append(',')
                    .append(csvCell(row.getSubjectName())).append(',')
                    .append(csvCell(row.getSubjectEmail())).append(',')
                    .append(csvCell(row.getSubjectMobile())).append(',')
                    .append(csvCell(row.getCounsellorName())).append(',')
                    .append(csvCell(row.getEntityId())).append('\n');
        }

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"live-activity.csv\"")
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(csv.toString());
    }

    /**
     * Quote and escape. Note the leading apostrophe on formula-leading characters: these
     * rows carry attacker-influenced free text (a prospect types their own name), and
     * spreadsheet software executes a cell beginning = + - @ on open.
     */
    private static String csvCell(String value) {
        if (value == null) {
            return "";
        }
        String cleaned = value;
        if (!cleaned.isEmpty() && "=+-@".indexOf(cleaned.charAt(0)) >= 0) {
            cleaned = "'" + cleaned;
        }
        return "\"" + cleaned.replace("\"", "\"\"") + "\"";
    }
}
