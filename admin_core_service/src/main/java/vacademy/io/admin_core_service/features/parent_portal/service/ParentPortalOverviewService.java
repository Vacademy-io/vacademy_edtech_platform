package vacademy.io.admin_core_service.features.parent_portal.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.core.security.GuardedChild;
import vacademy.io.admin_core_service.core.security.GuardianAccessGuard;
import vacademy.io.admin_core_service.features.certificate.service.CertificateReadService;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceDTO;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.learner_badge.service.LearnerBadgeService;
import vacademy.io.admin_core_service.features.live_session.dto.GroupedSessionsByDateDTO;
import vacademy.io.admin_core_service.features.live_session.dto.StudentAttendanceReportDTO;
import vacademy.io.admin_core_service.features.live_session.service.AttendanceReportService;
import vacademy.io.admin_core_service.features.live_session.service.GetLiveSessionService;
import vacademy.io.admin_core_service.features.live_session.service.LiveSessionAttendanceOnlyModeService;
import vacademy.io.admin_core_service.features.parent_portal.dto.ChildOverviewDTO;
import vacademy.io.admin_core_service.features.parent_portal.dto.ChildReportListItemDTO;
import vacademy.io.admin_core_service.features.parent_portal.dto.ParentChildSummaryDTO;
import vacademy.io.admin_core_service.features.parent_portal.dto.ParentPortalSettingsDTO;
import vacademy.io.admin_core_service.features.student_analysis.client.AssessmentServiceClient;
import vacademy.io.admin_core_service.features.student_analysis.entity.StudentAnalysisProcess;
import vacademy.io.admin_core_service.features.student_analysis.repository.StudentAnalysisProcessRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The child-home overview: cheap counts + module availability, each collector
 * fault-isolated. A collector that throws lands its module in
 * {@code unavailableModules} and leaves its count null — never zero. The six
 * tiles fetch their own LIVE detail; this is the at-a-glance header + the
 * "needs your attention" inputs (pending invoices, latest report).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ParentPortalOverviewService {

    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE;

    private final GuardianAccessGuard guard;
    private final ParentPortalSettingService settingService;
    private final LearnerBadgeService learnerBadgeService;
    private final CertificateReadService certificateReadService;
    private final InvoiceService invoiceService;
    private final StudentAnalysisProcessRepository processRepository;
    private final AttendanceReportService attendanceReportService;
    private final GetLiveSessionService getLiveSessionService;
    private final LiveSessionAttendanceOnlyModeService attendanceOnlyModeService;
    private final AssessmentServiceClient assessmentServiceClient;

    public ChildOverviewDTO overview(CustomUserDetails caller, String childUserId) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        ParentPortalSettingsDTO settings = settingService.requireEnabled(child.instituteId());

        List<String> available = visibleModules(settings);
        List<String> unavailable = new ArrayList<>();

        ChildOverviewDTO.ChildOverviewDTOBuilder b = ChildOverviewDTO.builder()
                .child(ParentChildSummaryDTO.builder()
                        .childUserId(child.childUserId())
                        .fullName(child.fullName())
                        .instituteId(child.instituteId())
                        .build())
                .availableModules(available);

        if (available.contains("badges")) {
            try {
                b.badgeCount(learnerBadgeService.getActiveAwardsForUser(child.childUserId(), child.instituteId()).size());
            } catch (Exception e) {
                markUnavailable("badges", unavailable, e);
            }
        }
        if (available.contains("certificates")) {
            try {
                b.certificateCount(certificateReadService.listForUser(child.childUserId(), child.instituteId()).size());
            } catch (Exception e) {
                markUnavailable("certificates", unavailable, e);
            }
        }
        if (available.contains("payments")) {
            try {
                List<InvoiceDTO> invoices = invoiceService.getInvoicesByUserId(child.childUserId(), child.instituteId());
                b.invoiceCount(invoices.size());
                b.pendingInvoiceCount((int) invoices.stream().filter(this::isPending).count());
            } catch (Exception e) {
                markUnavailable("payments", unavailable, e);
            }
        }
        if (available.contains("reports")) {
            try {
                List<StudentAnalysisProcess> latest = processRepository
                        .findByUserIdAndStatusOrderByCreatedAtDesc(child.childUserId(), "COMPLETED", PageRequest.of(0, 1))
                        .getContent();
                b.reportCount(latest.size());
                if (!latest.isEmpty()) {
                    StudentAnalysisProcess p = latest.get(0);
                    b.latestReport(ChildReportListItemDTO.builder()
                            .processId(p.getId()).name(p.getName())
                            .status(p.getStatus()).createdAt(p.getCreatedAt()).build());
                }
            } catch (Exception e) {
                markUnavailable("reports", unavailable, e);
            }
        }

        // Headline tile numbers. Each fault-isolated: a failure leaves the value null
        // (UI shows a neutral hint), never a wrong zero. Uses the child's primary batch.
        String primaryBatch = child.packageSessionIds().isEmpty() ? null : child.packageSessionIds().get(0);
        if (available.contains("attendance") && primaryBatch != null) {
            try {
                // A full year, not 30 days — a parent's headline attendance should reflect
                // the whole term, and a 30-day window is often empty (no recent sessions).
                StudentAttendanceReportDTO report = attendanceReportService.getStudentReport(
                        child.childUserId(), primaryBatch, LocalDate.now().minusDays(365), LocalDate.now());
                if (report != null) {
                    b.attendancePercent(report.getAttendancePercentage());
                }
            } catch (Exception e) {
                markUnavailable("attendance", unavailable, e);
            }
        }
        // NOTE: courseCompletionPercent is intentionally NOT computed here. Each
        // subject-progress query is a heavy activity-log aggregation, and looping
        // it over every course made the home overview slow. The progress screen
        // fetches per-course progress on its own (lazily), so the home stays fast.
        if (available.contains("liveSessions") && primaryBatch != null) {
            try {
                // Attendance-only institute: only classes marked show_to_learners count.
                List<GroupedSessionsByDateDTO> groups = getLiveSessionService.getLiveAndUpcomingSessionsForUserAndBatch(
                        primaryBatch, child.childUserId(), child.instituteId(), 0, null, null, null, caller,
                        attendanceOnlyModeService.isEnabled(child.instituteId()));
                int count = groups == null ? 0 : groups.stream()
                        .mapToInt(g -> g.getSessions() == null ? 0 : g.getSessions().size())
                        .sum();
                b.upcomingSessionCount(count);
            } catch (Exception e) {
                markUnavailable("liveSessions", unavailable, e);
            }
        }
        if (available.contains("assessments")) {
            try {
                AssessmentServiceClient.AssessmentHistoryResponse hist = assessmentServiceClient
                        .fetchStudentAssessmentHistory(child.childUserId(), child.instituteId(),
                                LocalDate.now().minusMonths(6).format(ISO), LocalDate.now().format(ISO));
                if (hist != null && hist.getAssessments() != null) {
                    b.assessmentCount(hist.getAssessments().size());
                }
            } catch (Exception e) {
                markUnavailable("assessments", unavailable, e);
            }
        }

        b.unavailableModules(unavailable);
        return b.build();
    }

    private boolean isPending(InvoiceDTO inv) {
        String s = inv.getStatus();
        return s != null && !s.equalsIgnoreCase("PAID") && !s.equalsIgnoreCase("CANCELLED")
                && !s.equalsIgnoreCase("VOID");
    }

    private List<String> visibleModules(ParentPortalSettingsDTO settings) {
        List<String> visible = new ArrayList<>();
        Map<String, Boolean> modules = settings.getModules();
        if (modules != null) {
            modules.forEach((k, v) -> {
                if (Boolean.TRUE.equals(v)) visible.add(k);
            });
        }
        return visible;
    }

    private void markUnavailable(String module, List<String> unavailable, Exception e) {
        log.warn("Parent overview module '{}' unavailable: {}", module, e.getMessage());
        unavailable.add(module);
    }
}
