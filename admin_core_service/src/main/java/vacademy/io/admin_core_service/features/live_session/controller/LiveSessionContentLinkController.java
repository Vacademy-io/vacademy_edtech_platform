package vacademy.io.admin_core_service.features.live_session.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.live_session.dto.ContentLinkOutcomeDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LinkContentRequestDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionContentLinkDTO;
import vacademy.io.admin_core_service.features.live_session.dto.RenameContentLinkRequestDTO;
import vacademy.io.admin_core_service.features.live_session.service.LiveSessionContentLinkService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

/**
 * Track B — teacher flow: link a session recording / uploaded class material
 * to one or more course chapters. See docs/LIVE_CLASS_PAST_SESSIONS_AND_CONTENT_LINKING_PLAN.md
 * section B2.
 */
@RestController
@RequestMapping("/admin-core-service/live-sessions/content")
@RequiredArgsConstructor
public class LiveSessionContentLinkController {

    private final LiveSessionContentLinkService liveSessionContentLinkService;

    @PostMapping("/link")
    @Auditable(
            entityType = "LIVE_SESSION_MATERIAL",
            action = "CREATE",
            conditionExpr = "@liveSessionContentLinkService.hasCreatedOutcome(#result?.body)",
            entityIdExpr = "#request?.sessionId",
            descriptionExpr = "@liveSessionContentLinkService.describeLinkAdded(#request, #result?.body)")
    public ResponseEntity<List<ContentLinkOutcomeDTO>> linkContent(@RequestBody LinkContentRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(liveSessionContentLinkService.linkContent(request, user));
    }

    @GetMapping("/links")
    public ResponseEntity<List<LiveSessionContentLinkDTO>> getLinks(@RequestParam String sessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(liveSessionContentLinkService.getLinksForSession(sessionId));
    }

    @PutMapping("/link/{linkId}/title")
    @Auditable(
            entityType = "LIVE_SESSION_MATERIAL",
            action = "UPDATE",
            captureBefore = "@liveSessionContentLinkService.auditSnapshot(#linkId)",
            entityIdExpr = "#before?.sessionId",
            descriptionExpr = "@liveSessionContentLinkService.describeLinkRenamed(#before, #request?.title)")
    public ResponseEntity<String> renameLink(@PathVariable String linkId,
            @RequestBody RenameContentLinkRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        liveSessionContentLinkService.renameLink(linkId, request.getTitle(), user);
        return ResponseEntity.ok("Content link renamed successfully");
    }

    @DeleteMapping("/link/{linkId}")
    @Auditable(
            entityType = "LIVE_SESSION_MATERIAL",
            action = "DELETE",
            captureBefore = "@liveSessionContentLinkService.auditSnapshot(#linkId)",
            conditionExpr = "#before?.active == true",
            entityIdExpr = "#before?.sessionId",
            descriptionExpr = "@liveSessionContentLinkService.describeLinkRemoved(#before)")
    public ResponseEntity<String> deleteLink(@PathVariable String linkId,
            @RequestAttribute("user") CustomUserDetails user) {
        liveSessionContentLinkService.deleteLink(linkId, user);
        return ResponseEntity.ok("Content link deleted successfully");
    }
}
