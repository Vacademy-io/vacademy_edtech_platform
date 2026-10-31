package vacademy.io.admin_core_service.features.parent_portal.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.core.security.GuardedChild;
import vacademy.io.admin_core_service.core.security.GuardianAccessGuard;
import vacademy.io.admin_core_service.features.parent_portal.client.AiServiceCompletionClient;
import vacademy.io.admin_core_service.features.certificate.service.CertificateReadService;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceDTO;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.leaderboard.dto.LeaderboardEntryDTO;
import vacademy.io.admin_core_service.features.leaderboard.dto.LeaderboardResponseDTO;
import vacademy.io.admin_core_service.features.leaderboard.service.LeaderboardService;
import vacademy.io.admin_core_service.features.learner_badge.service.LearnerBadgeService;
import vacademy.io.admin_core_service.features.learner_reports.dto.LearnerSubjectWiseProgressReportDTO;
import vacademy.io.admin_core_service.features.learner_reports.service.LearnerReportService;
import vacademy.io.admin_core_service.features.live_session.dto.GroupedSessionsByDateDTO;
import vacademy.io.admin_core_service.features.live_session.dto.ScheduleDetailDTO;
import vacademy.io.admin_core_service.features.live_session.dto.StudentAttendanceReportDTO;
import vacademy.io.admin_core_service.features.live_session.service.AttendanceReportService;
import vacademy.io.admin_core_service.features.live_session.service.GetLiveSessionService;
import vacademy.io.admin_core_service.features.live_session.service.LiveSessionAttendanceOnlyModeService;
import vacademy.io.admin_core_service.features.student_analysis.client.AssessmentServiceClient;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * The parent AI assistant. Answers a free-form parent question about their
 * <em>guarded</em> child.
 *
 * <p><b>Reuses the existing chatbot path.</b> The LLM call itself goes through the
 * shared {@link ChatbotAiService} (the same OpenRouter/{@code LLMService} the rest
 * of the app uses) — this service only adds the parent-specific, safety-critical
 * part: run the guardian guard, then assemble a plain-text snapshot of ONLY that
 * one child's data and pass it as the system prompt. The LLM is given NO tools, so
 * it can never reach any other student's data.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ParentAssistantService {

    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE;

    private static final String SYSTEM_PROMPT = """
            You are a warm, encouraging school assistant helping a parent understand and support their
            child's school life. Use the data below about the child to answer the parent's question.
            You MAY give short, practical, encouraging suggestions grounded in that data — for example,
            point to a weaker subject or lower attendance and suggest a small next step. This is expected
            when a parent asks how to help or how their child can improve; do not just refuse.
            Do NOT invent specific facts, numbers, marks, or events that are not in the data. If a whole
            topic has no data at all, say so briefly and suggest the relevant section (Attendance, Tests,
            Fees, Rewards, Progress, Classes). Refer to the child by their first name. Keep answers to 1-4
            short, plain-language sentences with no jargon.
            LANGUAGE RULE — decide the reply language ONLY from the wording of the question itself,
            never from the child's name, the data below, or any earlier question:
            - Question written entirely in English words and grammar → reply in ENGLISH, even when
              the names and data are Indian. Example: "Do I have to pay any fee?" → English reply.
            - Question containing actual Hindi words — in Devanagari, or Hindi words typed in Latin
              letters (e.g. "kya", "hai", "kaisa", "nahi", "bacche", "kal") → reply in Hindi using
              the Devanagari script (देवनागरी), never romanised Hinglish, so it reads well and is
              pronounced correctly when spoken aloud. Example: "kya fees baki hai?" → हिंदी में उत्तर।
            - Any other language → mirror that language.
            This applies to EVERY reply, including redirects, declines, and off-topic or
            general-knowledge questions.
            """;

    private final GuardianAccessGuard guard;
    private final ParentPortalSettingService settingService;
    private final AttendanceReportService attendanceReportService;
    private final InvoiceService invoiceService;
    private final LearnerBadgeService learnerBadgeService;
    private final AssessmentServiceClient assessmentServiceClient;
    private final LearnerReportService learnerReportService;
    private final GetLiveSessionService getLiveSessionService;
    private final LiveSessionAttendanceOnlyModeService attendanceOnlyModeService;
    private final CertificateReadService certificateReadService;
    private final LeaderboardService leaderboardService;
    private final AiServiceCompletionClient aiServiceCompletionClient;

    /**
     * Optional override, blank by default: ai_service then resolves the 'parent_assistant'
     * row in ai_model_defaults (GLM by default). Note ai_service only honours a body model
     * from platform staff, so this is effectively an operator escape hatch.
     */
    @Value("${parent.assistant.model:}")
    private String model;

    /**
     * @return the assistant's answer, or {@code null} if the LLM is unavailable
     *         (ai_service unreachable / no key configured there / upstream error) —
     *         the caller then falls back to the on-device preset answers.
     */
    public String answer(CustomUserDetails caller, String childUserId, String question) {
        GuardedChild child = guard.requireLinkedChild(caller, childUserId);
        settingService.requireEnabled(child.instituteId());

        String context = buildContext(caller, child);
        String prompt = SYSTEM_PROMPT
                + "\nToday's date: " + LocalDate.now().format(ISO)
                + "\n\nDATA:\n" + context
                + "\n\nParent's question: " + question
                + "\n\nAnswer:";

        // The LLM key lives ONLY in ai_service; this returns null when the
        // completion is unavailable, and the caller falls back to preset answers.
        String override = model == null || model.isBlank() ? null : model.trim();
        return aiServiceCompletionClient.complete(prompt, override, child.instituteId(), caller.getUserId());
    }

    /** Assemble a compact, plain-text snapshot of the guarded child's data for the prompt. */
    private String buildContext(CustomUserDetails caller, GuardedChild child) {
        StringBuilder sb = new StringBuilder();
        sb.append("Child first name: ").append(firstName(child.fullName())).append('\n');

        String primaryBatch = child.packageSessionIds().isEmpty() ? null : child.packageSessionIds().get(0);

        // Course progress by subject — so "what is his progress?" / "how can he
        // improve?" are answerable and can point to weaker subjects.
        if (primaryBatch != null) {
            try {
                List<LearnerSubjectWiseProgressReportDTO> subjects =
                        learnerReportService.getSubjectProgressReport(primaryBatch, child.childUserId(), caller);
                if (subjects != null && !subjects.isEmpty()) {
                    sb.append("Course progress by subject:\n");
                    for (LearnerSubjectWiseProgressReportDTO subject : subjects) {
                        sb.append("- ").append(subject.getSubjectName() != null ? subject.getSubjectName() : "Subject")
                                .append(": ").append(Math.round(avgModuleCompletion(subject))).append("% complete\n");
                    }
                }
            } catch (Exception e) {
                log.debug("[ParentAssistant] progress context unavailable: {}", e.getMessage());
            }
        }

        // Attendance (a full year) — % plus the recent classes with present/absent,
        // so "did my child attend today?" is answerable against today's date.
        if (primaryBatch != null) {
            try {
                StudentAttendanceReportDTO att = attendanceReportService.getStudentReport(
                        child.childUserId(), primaryBatch, LocalDate.now().minusDays(365), LocalDate.now());
                if (att != null) {
                    List<ScheduleDetailDTO> schedules = att.getSchedules();
                    Integer dayWise = dayWiseAttendancePercent(schedules);
                    if (dayWise != null) {
                        // Day-wise, matching what the parent/student apps display —
                        // NOT the raw session-wise report percentage.
                        sb.append("Attendance: ").append(dayWise).append("% present.\n");
                    }
                    if (schedules != null && !schedules.isEmpty()) {
                        LocalDateTime nowDt = LocalDateTime.now();
                        // Classes that have NOT started yet are excluded — they are
                        // listed under "Upcoming classes" and must never be described
                        // as absent or not-marked.
                        sb.append("Recent classes (most recent first; classes that have not started yet are excluded):\n");
                        schedules.stream()
                                .filter(s -> hasStarted(s, nowDt))
                                .sorted((a, b) -> nullSafe(b.getMeetingDate()).compareTo(nullSafe(a.getMeetingDate())))
                                .limit(15)
                                .forEach(s -> sb.append("- ")
                                        .append(s.getMeetingDate() != null ? s.getMeetingDate() : "?")
                                        .append(": ").append(s.getAttendanceStatus() != null ? s.getAttendanceStatus() : "Not marked")
                                        .append(s.getSessionTitle() != null ? " (" + s.getSessionTitle() + ")" : "")
                                        .append('\n'));
                    }
                }
            } catch (Exception e) {
                log.debug("[ParentAssistant] attendance context unavailable: {}", e.getMessage());
            }
        }

        // Upcoming classes — "does my child have class tomorrow?"
        // Attendance-only institutes: only classes marked show_to_learners.
        if (primaryBatch != null) {
            try {
                List<GroupedSessionsByDateDTO> groups = getLiveSessionService
                        .getLiveAndUpcomingSessionsForUserAndBatch(primaryBatch, child.childUserId(), child.instituteId(), 0, null, null, null, caller,
                                attendanceOnlyModeService.isEnabled(child.instituteId()));
                if (groups != null && !groups.isEmpty()) {
                    sb.append("Upcoming classes:\n");
                    groups.stream().limit(6).forEach(g -> {
                        if (g.getSessions() == null) return;
                        g.getSessions().forEach(s -> sb.append("- ")
                                .append(g.getDate() != null ? g.getDate() : "")
                                .append(s.getStartTime() != null ? " " + s.getStartTime() : "")
                                .append(" ").append(s.getTitle() != null ? s.getTitle()
                                        : (s.getSubject() != null ? s.getSubject() : "Class"))
                                .append('\n'));
                    });
                }
            } catch (Exception e) {
                log.debug("[ParentAssistant] upcoming classes context unavailable: {}", e.getMessage());
            }
        }

        // Fees — count + pending amounts / due dates
        try {
            List<InvoiceDTO> invoices = invoiceService.getInvoicesByUserId(child.childUserId(), child.instituteId());
            long pending = invoices.stream().filter(this::isPending).count();
            sb.append("Fees: ").append(pending).append(" payment(s) pending of ")
                    .append(invoices.size()).append(" total.\n");
            invoices.stream().filter(this::isPending).limit(5).forEach(inv -> sb.append("- Due: ")
                    .append(inv.getCurrency() != null ? inv.getCurrency() + " " : "")
                    .append(inv.getTotalAmount() != null ? inv.getTotalAmount() : "?")
                    .append(inv.getDueDate() != null ? " by " + inv.getDueDate().toLocalDate() : "")
                    .append('\n'));
        } catch (Exception e) {
            log.debug("[ParentAssistant] fees context unavailable: {}", e.getMessage());
        }

        // Rewards — badges + certificates + engagement points/rank
        try {
            int badges = learnerBadgeService.getActiveAwardsForUser(child.childUserId(), child.instituteId()).size();
            sb.append("Rewards: ").append(badges).append(" badge(s) earned.\n");
        } catch (Exception e) {
            log.debug("[ParentAssistant] rewards context unavailable: {}", e.getMessage());
        }
        try {
            int certs = certificateReadService.listForUser(child.childUserId(), child.instituteId()).size();
            sb.append("Certificates earned: ").append(certs).append(".\n");
        } catch (Exception e) {
            log.debug("[ParentAssistant] certificates context unavailable: {}", e.getMessage());
        }
        try {
            LeaderboardResponseDTO board = leaderboardService.buildInstituteLeaderboard(
                    child.instituteId(), child.childUserId(), false, 1);
            LeaderboardEntryDTO me = board != null ? board.getCurrentUser() : null;
            if (me != null) {
                sb.append("Focused learning time: ").append(me.getPoints()).append(" minutes");
                if (me.getRank() != null) sb.append("; class rank ").append(me.getRank());
                sb.append(".\n");
            }
        } catch (Exception e) {
            log.debug("[ParentAssistant] points context unavailable: {}", e.getMessage());
        }

        // Tests — recent scores
        try {
            AssessmentServiceClient.AssessmentHistoryResponse hist = assessmentServiceClient
                    .fetchStudentAssessmentHistory(child.childUserId(), child.instituteId(),
                            LocalDate.now().minusMonths(6).format(ISO), LocalDate.now().format(ISO));
            if (hist != null && hist.getAssessments() != null && !hist.getAssessments().isEmpty()) {
                sb.append("Tests taken: ").append(hist.getAssessments().size()).append(". Recent:\n");
                hist.getAssessments().stream().limit(10).forEach(a -> {
                    sb.append("- ").append(a.getName() != null ? a.getName() : "Test");
                    if (a.getDate() != null) sb.append(" (").append(a.getDate()).append(")");
                    sb.append(": ");
                    if (a.getMarks() != null && a.getTotalMarks() != null) {
                        sb.append(fmt(a.getMarks())).append('/').append(fmt(a.getTotalMarks()));
                    }
                    if (a.getPercentage() != null) sb.append(" (").append(Math.round(a.getPercentage())).append("%)");
                    sb.append('\n');
                });
            } else {
                sb.append("Tests taken: none recorded yet.\n");
            }
        } catch (Exception e) {
            log.debug("[ParentAssistant] tests context unavailable: {}", e.getMessage());
        }

        return sb.toString();
    }

    private boolean isPending(InvoiceDTO inv) {
        String s = inv.getStatus();
        return s != null && !s.equalsIgnoreCase("PAID") && !s.equalsIgnoreCase("CANCELLED")
                && !s.equalsIgnoreCase("VOID");
    }

    private double avgModuleCompletion(LearnerSubjectWiseProgressReportDTO subject) {
        if (subject.getModules() == null || subject.getModules().isEmpty()) return 0;
        double sum = 0;
        int n = 0;
        for (LearnerSubjectWiseProgressReportDTO.ModuleProgressDTO m : subject.getModules()) {
            if (m.getCompletionPercentage() != null) {
                sum += m.getCompletionPercentage();
                n++;
            }
        }
        return n == 0 ? 0 : sum / n;
    }

    private String firstName(String full) {
        if (full == null || full.isBlank()) return "the child";
        return full.trim().split("\\s+")[0];
    }

    private String fmt(Double d) {
        if (d == null) return "";
        return d == Math.floor(d) ? String.valueOf(d.longValue()) : String.valueOf(d);
    }

    private String nullSafe(java.time.LocalDate d) {
        return d != null ? d.toString() : "";
    }

    /** A schedule has started once its date + start time is not in the future. */
    private static boolean hasStarted(ScheduleDetailDTO s, LocalDateTime now) {
        if (s.getMeetingDate() == null) return true;
        LocalTime t = s.getStartTime() != null ? s.getStartTime() : LocalTime.MIN;
        return !LocalDateTime.of(s.getMeetingDate(), t).isAfter(now);
    }

    /**
     * Day-wise attendance %, matching the apps' computeAttendanceStats: multiple
     * classes in one day count as ONE day, PRESENT if any class that day was
     * attended; a day whose unattended classes have not started yet is skipped
     * entirely (in progress ≠ absent); UNMARKED days count in the denominator.
     * Returns null when no day is countable.
     */
    private static Integer dayWiseAttendancePercent(List<ScheduleDetailDTO> schedules) {
        if (schedules == null || schedules.isEmpty()) return null;
        LocalDateTime now = LocalDateTime.now();
        Map<LocalDate, List<ScheduleDetailDTO>> byDay = schedules.stream()
                .filter(s -> s.getMeetingDate() != null)
                .collect(Collectors.groupingBy(ScheduleDetailDTO::getMeetingDate));
        int present = 0;
        int counted = 0;
        for (List<ScheduleDetailDTO> day : byDay.values()) {
            boolean anyPresent = day.stream()
                    .anyMatch(s -> "PRESENT".equalsIgnoreCase(s.getAttendanceStatus()));
            if (anyPresent) {
                present++;
                counted++;
                continue;
            }
            boolean anyNotStarted = day.stream().anyMatch(s -> !hasStarted(s, now)
                    && (s.getAttendanceStatus() == null
                            || "UNMARKED".equalsIgnoreCase(s.getAttendanceStatus())));
            if (anyNotStarted) continue; // day still upcoming / in progress — not absent
            counted++;
        }
        if (counted == 0) return null;
        return (int) Math.round(present * 100.0 / counted);
    }
}
