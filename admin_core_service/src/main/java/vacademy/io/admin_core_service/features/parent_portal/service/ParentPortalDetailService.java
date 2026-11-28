package vacademy.io.admin_core_service.features.parent_portal.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.GuardedChild;
import vacademy.io.admin_core_service.core.security.GuardianAccessGuard;
import vacademy.io.admin_core_service.features.certificate.dto.IssuedCertificateDTO;
import vacademy.io.admin_core_service.features.certificate.service.CertificateReadService;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceDTO;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.learner_badge.dto.LearnerBadgeDTO;
import vacademy.io.admin_core_service.features.learner_badge.service.LearnerBadgeService;
import vacademy.io.admin_core_service.features.live_session.dto.GroupedSessionsByDateDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerPastSessionsResponseDTO;
import vacademy.io.admin_core_service.features.live_session.dto.StudentAttendanceReportDTO;
import vacademy.io.admin_core_service.features.live_session.service.AttendanceReportService;
import vacademy.io.admin_core_service.features.live_session.service.GetLiveSessionService;
import vacademy.io.admin_core_service.features.live_session.service.LearnerPastSessionService;
import vacademy.io.admin_core_service.features.live_session.service.LiveSessionAttendanceOnlyModeService;
import vacademy.io.admin_core_service.features.learner_reports.dto.LearnerSubjectWiseProgressReportDTO;
import vacademy.io.admin_core_service.features.learner_reports.service.LearnerReportService;
import vacademy.io.admin_core_service.features.learner.dto.StudentInstituteInfoDTO;
import vacademy.io.admin_core_service.features.learner.manager.LearnerInstituteManager;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionListDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LearnerPastSessionDTO;
import vacademy.io.admin_core_service.features.leaderboard.dto.LeaderboardEntryDTO;
import vacademy.io.admin_core_service.features.leaderboard.dto.LeaderboardResponseDTO;
import vacademy.io.admin_core_service.features.leaderboard.service.LeaderboardService;
import vacademy.io.admin_core_service.features.parent_portal.dto.ChildReportListItemDTO;
import vacademy.io.admin_core_service.features.parent_portal.dto.CourseProgressDTO;
import vacademy.io.admin_core_service.features.parent_portal.dto.ParentPointsDTO;
import vacademy.io.admin_core_service.features.student_analysis.client.AssessmentServiceClient;
import vacademy.io.admin_core_service.features.student_analysis.entity.StudentAnalysisProcess;
import vacademy.io.admin_core_service.features.student_analysis.repository.StudentAnalysisProcessRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.institute.dto.PackageSessionDTO;
import org.springframework.data.domain.PageRequest;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * Per-domain reads for one guarded child. Every method: (1) runs the guardian
 * guard on the token-derived caller + the child id, (2) enforces the institute's
 * per-module setting, then (3) delegates to the existing domain service in-process
 * with the child's id. The guard is the only place that decides access.
 *
 * <p>The underlying services accept an explicit userId (they're the same ones that
 * are IDOR-able when called directly); here they are only ever reached AFTER the
 * guard has proven the link, so the child id fed to them is always authorised.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ParentPortalDetailService {

    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE;

    private final GuardianAccessGuard guard;
    private final ParentPortalSettingService settingService;
    private final AttendanceReportService attendanceReportService;
    private final InvoiceService invoiceService;
    private final LearnerBadgeService learnerBadgeService;
    private final CertificateReadService certificateReadService;
    private final GetLiveSessionService getLiveSessionService;
    private final LiveSessionAttendanceOnlyModeService attendanceOnlyModeService;
    private final LearnerPastSessionService learnerPastSessionService;
    private final LearnerReportService learnerReportService;
    private final AssessmentServiceClient assessmentServiceClient;
    private final StudentAnalysisProcessRepository processRepository;
    private final LearnerInstituteManager learnerInstituteManager;
    private final LeaderboardService leaderboardService;

    public StudentAttendanceReportDTO attendance(CustomUserDetails caller, String childUserId,
                                                 String packageSessionId, LocalDate start, LocalDate end) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        settingService.requireModule(child.instituteId(), "attendance");
        String batchId = resolvePackageSession(child, packageSessionId);
        // Default to a full year (not 30 days) so a parent opening attendance sees
        // the term, not an often-empty last month. Callers may still pass a window.
        LocalDate from = start != null ? start : LocalDate.now().minusDays(365);
        LocalDate to = end != null ? end : LocalDate.now();
        return attendanceReportService.getStudentReport(child.childUserId(), batchId, from, to);
    }

    public List<InvoiceDTO> invoices(CustomUserDetails caller, String childUserId) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        settingService.requireModule(child.instituteId(), "payments");
        return invoiceService.getInvoicesByUserId(child.childUserId(), child.instituteId());
    }

    public List<LearnerBadgeDTO> badges(CustomUserDetails caller, String childUserId) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        settingService.requireModule(child.instituteId(), "badges");
        return learnerBadgeService.getActiveAwardsForUser(child.childUserId(), child.instituteId());
    }

    /**
     * The child's engagement points (focused-activity minutes across all courses)
     * and institute-wide rank, from the leaderboard. Fault-isolated — returns
     * zero/null if the leaderboard can't be built (never fails the screen).
     */
    public ParentPointsDTO points(CustomUserDetails caller, String childUserId) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        settingService.requireModule(child.instituteId(), "badges");
        try {
            LeaderboardResponseDTO board = leaderboardService.buildInstituteLeaderboard(
                    child.instituteId(), child.childUserId(), false, 1);
            LeaderboardEntryDTO me = board != null ? board.getCurrentUser() : null;
            return new ParentPointsDTO(me != null ? me.getPoints() : 0, me != null ? me.getRank() : null);
        } catch (Exception e) {
            log.warn("Parent points unavailable for child {}: {}", child.childUserId(), e.getMessage());
            return new ParentPointsDTO(0, null);
        }
    }

    public List<IssuedCertificateDTO> certificates(CustomUserDetails caller, String childUserId) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        settingService.requireModule(child.instituteId(), "certificates");
        return certificateReadService.listForUser(child.childUserId(), child.instituteId());
    }

    /**
     * Upcoming/live sessions across ALL of the child's enrolled courses (unless a
     * specific packageSessionId is asked for). Per-course results are merged into
     * one date-grouped list — a session on the same day from a different course
     * lands under the same date, and the list stays sorted by date.
     */
    public List<GroupedSessionsByDateDTO> upcomingLiveSessions(CustomUserDetails caller, String childUserId,
                                                              String packageSessionId) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        settingService.requireModule(child.instituteId(), "liveSessions");
        // Attendance-only institute: only classes marked show_to_learners are
        // listed (past is gated inside LearnerPastSessionService).
        boolean learnerVisibleOnly = attendanceOnlyModeService.isEnabled(child.instituteId());
        List<String> targets = targetPackageSessions(child, packageSessionId);

        if (targets.size() == 1) {
            return getLiveSessionService.getLiveAndUpcomingSessionsForUserAndBatch(
                    targets.get(0), child.childUserId(), child.instituteId(), 0, null, null, null, caller, learnerVisibleOnly);
        }

        // millis(midnight) -> merged group, TreeMap keeps ascending date order
        Map<Long, GroupedSessionsByDateDTO> byDate = new TreeMap<>();
        // A class shared by two courses, or an unassigned public class (returned
        // for every course), must be listed once.
        Set<String> seenScheduleIds = new HashSet<>();
        for (String psId : targets) {
            List<GroupedSessionsByDateDTO> groups = getLiveSessionService
                    .getLiveAndUpcomingSessionsForUserAndBatch(psId, child.childUserId(), child.instituteId(), 0, null, null, null, caller, learnerVisibleOnly);
            if (groups == null) continue;
            for (GroupedSessionsByDateDTO g : groups) {
                if (g == null || g.getSessions() == null || g.getSessions().isEmpty()) continue;
                List<LiveSessionListDTO> fresh = g.getSessions().stream()
                        .filter(s -> s.getScheduleId() == null || seenScheduleIds.add(s.getScheduleId()))
                        .collect(Collectors.toCollection(ArrayList::new));
                if (fresh.isEmpty()) continue;
                long key = g.getDate() != null ? g.getDate().getTime() : 0L;
                GroupedSessionsByDateDTO merged = byDate.get(key);
                if (merged == null) {
                    byDate.put(key, new GroupedSessionsByDateDTO(g.getDate(), fresh));
                } else {
                    merged.getSessions().addAll(fresh);
                }
            }
        }
        return new ArrayList<>(byDate.values());
    }

    /**
     * Past sessions across ALL of the child's courses (unless a specific
     * packageSessionId is asked for). Each course is queried for the requested
     * page and the results concatenated — the child's whole history, not just the
     * primary course.
     */
    public LearnerPastSessionsResponseDTO pastLiveSessions(CustomUserDetails caller, String childUserId,
                                                           String packageSessionId, int page, Integer size) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        settingService.requireModule(child.instituteId(), "liveSessions");
        List<String> targets = targetPackageSessions(child, packageSessionId);

        if (targets.size() == 1) {
            return learnerPastSessionService.getPastSessions(
                    targets.get(0), child.childUserId(), child.instituteId(), page, size, null, null);
        }

        List<LearnerPastSessionDTO> content = new ArrayList<>();
        Set<String> seenScheduleIds = new HashSet<>();
        LearnerPastSessionsResponseDTO.DisplayFlagsDTO flags = null;
        long totalElements = 0;
        boolean allLast = true;
        for (String psId : targets) {
            LearnerPastSessionsResponseDTO r = learnerPastSessionService.getPastSessions(
                    psId, child.childUserId(), child.instituteId(), page, size, null, null);
            if (r == null) continue;
            if (flags == null) flags = r.getDisplayFlags();
            long duplicates = 0;
            if (r.getContent() != null) {
                for (LearnerPastSessionDTO d : r.getContent()) {
                    // Same class reached through two courses (or an unassigned
                    // public class, returned for every course): list it once.
                    if (d.getScheduleId() == null || seenScheduleIds.add(d.getScheduleId())) {
                        content.add(d);
                    } else {
                        duplicates++;
                    }
                }
            }
            totalElements += r.getTotalElements() - duplicates;
            allLast = allLast && r.isLast();
        }
        return LearnerPastSessionsResponseDTO.builder()
                .displayFlags(flags)
                .content(content)
                .page(page)
                .size(size != null ? size : content.size())
                .totalPages(1)
                .totalElements(totalElements)
                .last(allLast)
                .build();
    }

    /**
     * Subject-wise progress for EVERY course the child is enrolled in (unless a
     * specific packageSessionId is asked for), grouped and labelled per course —
     * so a child in multiple courses sees them all, not just the primary.
     */
    public List<CourseProgressDTO> subjectProgress(CustomUserDetails caller, String childUserId,
                                                    String packageSessionId) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        settingService.requireModule(child.instituteId(), "progress");
        List<String> targets = targetPackageSessions(child, packageSessionId);
        Map<String, String> labels = resolveCourseLabels(child);

        List<CourseProgressDTO> out = new ArrayList<>();
        for (String psId : targets) {
            List<LearnerSubjectWiseProgressReportDTO> subjects =
                    learnerReportService.getSubjectProgressReport(psId, child.childUserId(), caller);
            out.add(CourseProgressDTO.builder()
                    .packageSessionId(psId)
                    .courseName(labels.getOrDefault(psId, ""))
                    .subjects(subjects)
                    .build());
        }
        return out;
    }

    /**
     * Live assessment history for the child (marks/scores). Returns null on a
     * cross-service failure — the caller maps that to "unavailable", NEVER to an
     * empty list ("your child sat no exams" is a wrong answer, not a missing one).
     */
    public AssessmentServiceClient.AssessmentHistoryResponse assessments(CustomUserDetails caller, String childUserId,
                                                                         LocalDate start, LocalDate end) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        settingService.requireModule(child.instituteId(), "assessments");
        LocalDate from = start != null ? start : LocalDate.now().minusMonths(6);
        LocalDate to = end != null ? end : LocalDate.now();
        return assessmentServiceClient.fetchStudentAssessmentHistory(
                child.childUserId(), child.instituteId(), from.format(ISO), to.format(ISO));
    }

    /**
     * Staff-generated AI reports for the child (metadata list only). Parents can't
     * generate; empty = none generated yet, and the frontend shows live scores anyway.
     */
    public List<ChildReportListItemDTO> reports(CustomUserDetails caller, String childUserId, int page, int size) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        settingService.requireModule(child.instituteId(), "reports");
        return processRepository
                .findByUserIdAndStatusOrderByCreatedAtDesc(child.childUserId(), "COMPLETED", PageRequest.of(page, size))
                .stream()
                .map(this::toReportItem)
                .toList();
    }

    private ChildReportListItemDTO toReportItem(StudentAnalysisProcess p) {
        return ChildReportListItemDTO.builder()
                .processId(p.getId())
                .name(p.getName())
                .status(p.getStatus())
                .createdAt(p.getCreatedAt())
                .build();
    }

    /**
     * Sub-resource ownership: a supplied packageSessionId must be one of the child's
     * own enrolments (else the guard would prove parent&rarr;child but not batch&rarr;child).
     * Absent = the child's primary (first) enrolment.
     */
    private String resolvePackageSession(GuardedChild child, String packageSessionId) {
        if (!StringUtils.hasText(packageSessionId)) {
            return child.packageSessionIds().get(0);
        }
        if (!child.packageSessionIds().contains(packageSessionId)) {
            throw new ForbiddenException("Batch does not belong to this child");
        }
        return packageSessionId;
    }

    /**
     * Which of the child's courses to fan out over. A supplied packageSessionId
     * (drill-down) must be one of the child's own enrolments (else 403); absent
     * means every enrolled course — the "all courses" behaviour.
     */
    private List<String> targetPackageSessions(GuardedChild child, String packageSessionId) {
        if (StringUtils.hasText(packageSessionId)) {
            if (!child.packageSessionIds().contains(packageSessionId)) {
                throw new ForbiddenException("Batch does not belong to this child");
            }
            return List.of(packageSessionId);
        }
        return child.packageSessionIds();
    }

    /** packageSessionId -> human batch label, for grouping progress by course. */
    private Map<String, String> resolveCourseLabels(GuardedChild child) {
        Map<String, String> labels = new HashMap<>();
        try {
            StudentInstituteInfoDTO info =
                    learnerInstituteManager.getInstituteDetails(child.instituteId(), child.childUserId(), true);
            List<PackageSessionDTO> pool = (info != null && info.getBatchesForSessions() != null)
                    ? info.getBatchesForSessions()
                    : List.of();
            for (PackageSessionDTO ps : pool) {
                if (ps != null && ps.getId() != null) {
                    labels.put(ps.getId(), batchLabel(ps));
                }
            }
        } catch (Exception e) {
            log.warn("Could not resolve course labels for child {}: {}", child.childUserId(), e.getMessage());
        }
        return labels;
    }

    /** "Level Package (Session)" — same human label idiom the children listing uses; never the raw UUID. */
    private String batchLabel(PackageSessionDTO ps) {
        if (ps == null) {
            return "";
        }
        String level = ps.getLevel() != null ? ps.getLevel().getLevelName() : null;
        String pkg = ps.getPackageDTO() != null ? ps.getPackageDTO().getPackageName() : null;
        String session = ps.getSession() != null ? ps.getSession().getSessionName() : null;

        StringBuilder sb = new StringBuilder();
        if (StringUtils.hasText(level)) sb.append(level);
        if (StringUtils.hasText(pkg)) sb.append(sb.length() > 0 ? " " : "").append(pkg);
        if (StringUtils.hasText(session)) sb.append(" (").append(session).append(")");
        if (sb.length() == 0) {
            return StringUtils.hasText(ps.getName()) ? ps.getName() : "";
        }
        return sb.toString();
    }
}
