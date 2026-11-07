package vacademy.io.notification_service.features.chat.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.chat.dto.ChatReportResponse;
import vacademy.io.notification_service.features.chat.dto.CreateReportRequest;
import vacademy.io.notification_service.features.chat.dto.ReviewReportRequest;
import vacademy.io.notification_service.features.chat.security.ChatIdentity;
import vacademy.io.notification_service.features.chat.service.ChatReportService;

@RestController
@RequestMapping("/notification-service/v1/chat/reports")
@RequiredArgsConstructor
@Slf4j
@Validated
@CrossOrigin(origins = "*")
public class ChatReportController {

    private final ChatReportService reportService;

    @PostMapping
    public ResponseEntity<ChatReportResponse> createReport(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestBody CreateReportRequest request) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        return ResponseEntity.ok(
                reportService.createReport(id.userId(), id.role(), id.instituteId(), request));
    }

    @GetMapping("/admin")
    public ResponseEntity<Page<ChatReportResponse>> listReports(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        ChatIdentity id = requireAdmin(user, clientId);
        return ResponseEntity.ok(reportService.listReports(id.instituteId(), status, PageRequest.of(page, size)));
    }

    @PatchMapping("/admin/{reportId}")
    public ResponseEntity<ChatReportResponse> reviewReport(
            @PathVariable String reportId,
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestBody ReviewReportRequest request) {
        ChatIdentity id = requireAdmin(user, clientId);
        // Tenant-scope: a report can only be reviewed by an admin of its own institute.
        return ResponseEntity.ok(reportService.reviewReport(reportId, id.userId(), id.instituteId(), request.getStatus()));
    }

    private ChatIdentity requireAdmin(CustomUserDetails user, String clientId) {
        ChatIdentity id = ChatIdentity.from(user, clientId);
        if (!id.isAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ADMIN_REQUIRED");
        }
        return id;
    }
}
