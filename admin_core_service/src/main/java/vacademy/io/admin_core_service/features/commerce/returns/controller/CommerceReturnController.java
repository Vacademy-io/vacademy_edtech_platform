package vacademy.io.admin_core_service.features.commerce.returns.controller;

import org.springframework.format.annotation.DateTimeFormat;
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
import vacademy.io.admin_core_service.features.commerce.returns.dto.ReturnDtos;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceReturnService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;

/**
 * Returns of delivered goods ({@code /commerce/v1/returns}), created by staff. Who may do what
 * is checked by the service (feature, role, the return's location, then the state under the lock).
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/returns")
public class CommerceReturnController {

    private final CommerceReturnService returnService;

    public CommerceReturnController(CommerceReturnService returnService) {
        this.returnService = returnService;
    }

    @PostMapping("/preview")
    public ResponseEntity<ReturnDtos.ReturnPreview> preview(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) ReturnDtos.CreateReturnRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(returnService.preview(user, instituteId, request));
    }

    @PostMapping
    public ResponseEntity<ReturnDtos.ReturnView> create(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) ReturnDtos.CreateReturnRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        ReturnDtos.ReturnView view = returnService.create(user, instituteId, request);
        return ResponseEntity.status(Boolean.TRUE.equals(view.getReplayed()) ? HttpStatus.OK : HttpStatus.CREATED)
                .body(view);
    }

    @GetMapping
    public ResponseEntity<ReturnDtos.ReturnPage> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "order_id", required = false) String orderId,
            @RequestParam(value = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(value = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "pageSize", defaultValue = "20") int pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(returnService.list(user, instituteId, status, orderId, from, to, page, pageSize));
    }

    @GetMapping("/{returnId}")
    public ResponseEntity<ReturnDtos.ReturnView> get(
            @PathVariable("returnId") String returnId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(returnService.get(user, instituteId, returnId));
    }

    @PostMapping("/{returnId}/approve")
    public ResponseEntity<ReturnDtos.ReturnView> approve(
            @PathVariable("returnId") String returnId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) ReturnDtos.ApproveRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(returnService.approve(user, instituteId, returnId, request));
    }

    @PostMapping("/{returnId}/reject")
    public ResponseEntity<ReturnDtos.ReturnView> reject(
            @PathVariable("returnId") String returnId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) ReturnDtos.RejectRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(returnService.reject(user, instituteId, returnId, request));
    }

    @PostMapping("/{returnId}/receive")
    public ResponseEntity<ReturnDtos.ReturnView> receive(
            @PathVariable("returnId") String returnId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) ReturnDtos.ReceiveRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(returnService.receive(user, instituteId, returnId, request));
    }
}
