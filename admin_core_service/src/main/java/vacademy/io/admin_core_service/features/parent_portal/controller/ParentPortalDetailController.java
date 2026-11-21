package vacademy.io.admin_core_service.features.parent_portal.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.certificate.dto.IssuedCertificateDTO;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceDTO;
import vacademy.io.admin_core_service.features.learner_badge.dto.LearnerBadgeDTO;
import vacademy.io.admin_core_service.features.live_session.dto.GroupedSessionsByDateDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerPastSessionsResponseDTO;
import vacademy.io.admin_core_service.features.live_session.dto.StudentAttendanceReportDTO;
import vacademy.io.admin_core_service.features.parent_portal.dto.ChildReportListItemDTO;
import vacademy.io.admin_core_service.features.parent_portal.dto.CourseProgressDTO;
import vacademy.io.admin_core_service.features.parent_portal.dto.ParentPointsDTO;
import vacademy.io.admin_core_service.features.parent_portal.service.ParentPortalDetailService;
import vacademy.io.admin_core_service.features.student_analysis.client.AssessmentServiceClient;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;
import java.util.List;

/**
 * Parent-portal per-domain reads. Every {@code {childUserId}} handler delegates
 * to {@link ParentPortalDetailService}, whose first act is the guardian guard —
 * the caller is always {@code @RequestAttribute("user")} (the JWT), never a param.
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/parent-portal/v1/children/{childUserId}")
@RequiredArgsConstructor
public class ParentPortalDetailController {

    private final ParentPortalDetailService detailService;

    @GetMapping("/attendance")
    public ResponseEntity<StudentAttendanceReportDTO> attendance(
            @PathVariable String childUserId,
            @RequestParam(required = false) String packageSessionId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(
                detailService.attendance(user, childUserId, packageSessionId, startDate, endDate));
    }

    @GetMapping("/payments/invoices")
    public ResponseEntity<List<InvoiceDTO>> invoices(
            @PathVariable String childUserId,
            @RequestAttribute("user") CustomUserDetails user) {
        // Parent-facing: drop the admin's internal discount notes.
        return ResponseEntity.ok(detailService.invoices(user, childUserId).stream()
                .map(InvoiceDTO::withoutInternalDiscountNotes)
                .toList());
    }

    @GetMapping("/badges")
    public ResponseEntity<List<LearnerBadgeDTO>> badges(
            @PathVariable String childUserId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(detailService.badges(user, childUserId));
    }

    @GetMapping("/points")
    public ResponseEntity<ParentPointsDTO> points(
            @PathVariable String childUserId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(detailService.points(user, childUserId));
    }

    @GetMapping("/certificates")
    public ResponseEntity<List<IssuedCertificateDTO>> certificates(
            @PathVariable String childUserId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(detailService.certificates(user, childUserId));
    }

    @GetMapping("/live-sessions/upcoming")
    public ResponseEntity<List<GroupedSessionsByDateDTO>> upcomingLiveSessions(
            @PathVariable String childUserId,
            @RequestParam(required = false) String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(detailService.upcomingLiveSessions(user, childUserId, packageSessionId));
    }

    @GetMapping("/live-sessions/past")
    public ResponseEntity<LearnerPastSessionsResponseDTO> pastLiveSessions(
            @PathVariable String childUserId,
            @RequestParam(required = false) String packageSessionId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(required = false) Integer size,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(detailService.pastLiveSessions(user, childUserId, packageSessionId, page, size));
    }

    @GetMapping("/progress/subjects")
    public ResponseEntity<List<CourseProgressDTO>> subjectProgress(
            @PathVariable String childUserId,
            @RequestParam(required = false) String packageSessionId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(detailService.subjectProgress(user, childUserId, packageSessionId));
    }

    @GetMapping("/assessments")
    public ResponseEntity<AssessmentServiceClient.AssessmentHistoryResponse> assessments(
            @PathVariable String childUserId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(detailService.assessments(user, childUserId, startDate, endDate));
    }

    @GetMapping("/reports")
    public ResponseEntity<List<ChildReportListItemDTO>> reports(
            @PathVariable String childUserId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(detailService.reports(user, childUserId, page, size));
    }
}
