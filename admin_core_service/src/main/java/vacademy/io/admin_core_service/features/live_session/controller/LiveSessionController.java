package vacademy.io.admin_core_service.features.live_session.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.live_session.dto.BulkLiveSessionRequestDTO;
import vacademy.io.admin_core_service.features.live_session.dto.BulkLiveSessionResponseDTO;
import vacademy.io.admin_core_service.features.live_session.dto.DeleteLiveSessionRequest;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionRequestDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionStep1RequestDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionStep2RequestDTO;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.service.BulkLiveSessionService;
import vacademy.io.admin_core_service.features.live_session.service.GetLiveSessionService;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.live_session.service.LiveSessionVisibilityService;
import vacademy.io.admin_core_service.features.live_session.service.Step1Service;
import vacademy.io.admin_core_service.features.live_session.service.Step2Service;
import vacademy.io.admin_core_service.features.session.dto.SessionDTOWithDetails;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/live-sessions/v1")
@RequiredArgsConstructor
public class LiveSessionController {

    private final Step1Service step1Service;
    private final Step2Service step2Service;
    private final GetLiveSessionService getLiveSessionService;
    private final BulkLiveSessionService bulkLiveSessionService;
    private final LiveSessionVisibilityService visibilityService;

    @PostMapping("create/step1")
    @Auditable(
            entityType = "LIVE_SESSION",
            action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'scheduled live session ' + #SessionRequest?.title")
    ResponseEntity< LiveSession> addLiveSessionStep1(@RequestBody LiveSessionStep1RequestDTO SessionRequest,
                                    @RequestAttribute("user") CustomUserDetails user) {
        // A step-1 call carrying a session_id is an edit of an existing session,
        // so it needs the same visibility check as reading it (V524). Creates
        // carry no id and are unaffected.
        visibilityService.assertCanAccessSession(SessionRequest.getSessionId(), user);
        return ResponseEntity.ok(step1Service.step1AddService(SessionRequest , user));

    }

    @PostMapping("create/step2")
    ResponseEntity<Boolean> addLiveSessionStep2(@RequestBody LiveSessionStep2RequestDTO SessionRequest,
                                    @RequestAttribute("user") CustomUserDetails user) {
        visibilityService.assertCanAccessSession(SessionRequest.getSessionId(), user);
        return ResponseEntity.ok(step2Service.step2AddService(SessionRequest , user));
    }

    @PostMapping("create/bulk")
    ResponseEntity<BulkLiveSessionResponseDTO> addLiveSessionsBulk(@RequestBody BulkLiveSessionRequestDTO request,
                                                                   @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(bulkLiveSessionService.createBulk(request, user));
    }

    @PostMapping("/delete")
    @Auditable(
            entityType = "LIVE_SESSION",
            action = "DELETE",
            captureBefore = "@getLiveSessionService.deleteAuditSnapshot(#request?.ids, #request?.type)",
            entityIdExpr = "#before?.sessionId",
            descriptionExpr = "'deleted ' + (#before?.label ?: ((#request?.ids?.size() ?: 0) + ' live session(s)'))")
    public ResponseEntity<?> deleteLiveSessions(
            @RequestBody DeleteLiveSessionRequest request,
            @RequestAttribute("user") CustomUserDetails user) {


        return ResponseEntity.ok(getLiveSessionService.deleteLiveSessions(
                request.getIds(),
                request.getType(),
                request.getNotifyStudents(),
                user));
    }

}
