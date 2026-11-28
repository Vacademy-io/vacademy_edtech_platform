package vacademy.io.admin_core_service.features.commerce.pos.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSessionService;
import vacademy.io.common.auth.model.CustomUserDetails;

/** Counter sessions: open, current, detail, list, bills, cash in and out, close. */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/pos")
public class PosSessionController {

    private final PosSessionService sessionService;

    public PosSessionController(PosSessionService sessionService) {
        this.sessionService = sessionService;
    }

    @PostMapping("/sessions")
    public ResponseEntity<PosDtos.SessionView> open(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.SessionOpenRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        PosSessionService.Saved saved = sessionService.open(user, instituteId, request);
        return ResponseEntity.status(saved.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(saved.session());
    }

    @GetMapping("/registers/{registerId}/session")
    public ResponseEntity<PosDtos.CurrentSessionAnswer> current(
            @PathVariable("registerId") String registerId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(sessionService.current(user, instituteId, registerId));
    }

    @GetMapping("/sessions/{sessionId}")
    public ResponseEntity<PosDtos.SessionView> detail(
            @PathVariable("sessionId") String sessionId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(sessionService.detail(user, instituteId, sessionId));
    }

    @GetMapping("/sessions")
    public ResponseEntity<PosDtos.SessionsPage> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "registerId", required = false) String registerId,
            @RequestParam(value = "locationId", required = false) String locationId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "to", required = false) String to,
            @RequestParam(value = "page", required = false) Integer page,
            @RequestParam(value = "pageSize", required = false) Integer pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(sessionService.list(user, instituteId, registerId, locationId, status, from, to,
                page, pageSize));
    }

    @GetMapping("/sessions/{sessionId}/sales")
    public ResponseEntity<PosDtos.SalesPage> sales(
            @PathVariable("sessionId") String sessionId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "page", required = false) Integer page,
            @RequestParam(value = "pageSize", required = false) Integer pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(sessionService.sales(user, instituteId, sessionId, page, pageSize));
    }

    @PostMapping("/sessions/{sessionId}/cash-movements")
    public ResponseEntity<PosDtos.SessionView> cashMovement(
            @PathVariable("sessionId") String sessionId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.CashMovementRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(sessionService.cashMovement(user, instituteId, sessionId, request).session());
    }

    @PostMapping("/sessions/{sessionId}/close")
    public ResponseEntity<PosDtos.SessionView> close(
            @PathVariable("sessionId") String sessionId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.SessionCloseRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(sessionService.close(user, instituteId, sessionId, request).session());
    }
}
