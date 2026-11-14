package vacademy.io.admin_core_service.features.session.contoller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.session.dto.AddNewSessionDTO;
import vacademy.io.admin_core_service.features.session.dto.EditSessionDTO;
import vacademy.io.admin_core_service.features.session.dto.SessionDTOWithDetails;
import vacademy.io.admin_core_service.features.session.service.SessionService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/sessions/v1")
@RequiredArgsConstructor
public class SessionController {

    private final SessionService sessionService;

    @GetMapping("/session-details")
    public ResponseEntity<List<SessionDTOWithDetails>> getSessionsByInstituteId(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {

        List<SessionDTOWithDetails> sessions = sessionService.getSessionsWithDetailsByInstituteId(instituteId, user);
        return ResponseEntity.ok(sessions);
    }

    @PutMapping("/edit")
    public ResponseEntity<String> editSession(
            @RequestParam("sessionId") String sessionId,
            @RequestBody EditSessionDTO editSessionDTO,
            @RequestAttribute("user") CustomUserDetails user) {

        String response = sessionService.editSession(editSessionDTO, sessionId, user);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/add")
    public ResponseEntity<String> addNewSession(@RequestBody AddNewSessionDTO addNewSessionDTO,
                                                @RequestParam("instituteId") String instituteId,
                                                @RequestAttribute("user") CustomUserDetails user) {
        String sessionId = sessionService.addNewSession(addNewSessionDTO,instituteId,user);
        return ResponseEntity.ok("Session created successfully with ID: " + sessionId);
    }

    @DeleteMapping("/delete-sessions")
    public ResponseEntity<String> deleteSessions(@RequestBody List<String> sessionIds,
                                                 @RequestHeader(value = "clientId", required = false) String instituteId,
                                                 @RequestAttribute("user") CustomUserDetails user) {
        // The institute is the clientId header: the principal's roles are loaded for exactly it.
        String response = sessionService.deleteSessions(sessionIds, instituteId, user);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/copy-study-material")
    public ResponseEntity<Boolean> copyStudyMaterial(
            @RequestParam String fromPackageSessionId,
            @RequestParam String toPackageSessionId) {

        boolean success = sessionService.copyStudyMaterial(fromPackageSessionId, toPackageSessionId);
        return ResponseEntity.ok(success);
    }
}
