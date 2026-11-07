package vacademy.io.assessment_service.features.assessment.service;

import com.itextpdf.html2pdf.ConverterProperties;
import com.itextpdf.html2pdf.HtmlConverter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.dto.LeaderBoardDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.render.ReportRenderResources;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportClassContext;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentComparisonDto;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * HTML -> PDF for the standard branded student report. Nothing else: no I/O
 * beyond iText's own conversion, no transaction, no state mutation, no email.
 * Lifted out of AssessmentParticipantsManager's release loop (PR2) so the
 * release flow, the bulk report export worker (PR4), and any future caller
 * share one render path instead of duplicating it.
 *
 * The 4-arg overload consuming {@code ReportRenderResources} (shared
 * ConverterProperties/FontProvider, prebuilt CSS) is added in PR3; this 3-arg
 * overload keeps working unchanged by building a default resources value
 * internally at that point.
 *
 * <p>Report v2: when {@code assessment.report.v2.enabled} is true (default),
 * the HTML comes from {@link StudentReportHtmlV2Builder} — enriched with
 * class analytics from {@link StudentReportAnalyticsService} and the
 * assessment's evaluation type / schedule (fetched here, since neither is on
 * the DTO chain). Any v2 failure falls back to the legacy
 * {@link HtmlBuilderService} output so a release/export batch never dies on
 * the new path.
 */
@Slf4j
@Service
public class ReportPdfRenderService {

    @Autowired
    private HtmlBuilderService htmlBuilderService;

    @Autowired
    private StudentReportHtmlV2Builder studentReportHtmlV2Builder;

    /** Report option: an assessment's profile can hide every per-question item. */
    @Autowired
    private vacademy.io.assessment_service.features.assessment.service.aireport.ReportProfileService reportProfileService;

    @Autowired
    private StudentReportAnalyticsService studentReportAnalyticsService;

    @Autowired
    private AssessmentRepository assessmentRepository;

    @Autowired
    private StudentAttemptRepository studentAttemptRepository;

    @Value("${assessment.report.v2.enabled:true}")
    private boolean reportV2Enabled;

    public byte[] render(StudentReportOverallDetailDto detail, StudentComparisonDto comparison, ReportClassContext ctx) {
        return renderInternal(detail, comparison, ctx, null);
    }

    /**
     * PR3 overload: renders using a per-job {@link ReportRenderResources}
     * (shared FontProvider, no remote font fetch — plan C7) instead of a
     * fresh default {@code ConverterProperties} per call. Used by the PR4
     * bulk-export worker; the 3-arg overload above is unchanged so existing
     * callers (release flow, per-student admin download) keep working as-is.
     */
    public byte[] render(StudentReportOverallDetailDto detail, StudentComparisonDto comparison,
                          ReportClassContext ctx, ReportRenderResources resources) {
        return renderInternal(detail, comparison, ctx, resources);
    }

    private byte[] renderInternal(StudentReportOverallDetailDto detail, StudentComparisonDto comparison,
                                   ReportClassContext ctx, ReportRenderResources resources) {
        String html = buildHtml(detail, comparison, ctx);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ConverterProperties props = resources != null ? resources.getConverterProperties() : new ConverterProperties();
        HtmlConverter.convertToPdf(html, out, props);
        return out.toByteArray();
    }

    private String buildHtml(StudentReportOverallDetailDto detail, StudentComparisonDto comparison,
                              ReportClassContext ctx) {
        if (reportV2Enabled) {
            try {
                return buildV2Html(detail, comparison, ctx);
            } catch (Exception e) {
                log.warn("[report-v2] Falling back to legacy report builder for assessment {}: {}",
                        ctx.getAssessmentId(), e.getMessage(), e);
            }
        }
        return htmlBuilderService.generateStudentReportHtml(
                ctx.getAssessmentName(), detail, comparison, ctx.getOptionDistribution(), ctx.getBranding());
    }

    private String buildV2Html(StudentReportOverallDetailDto detail, StudentComparisonDto comparison,
                                ReportClassContext ctx) {
        Assessment assessment = ctx.getAssessmentId() != null
                ? assessmentRepository.findById(ctx.getAssessmentId()).orElse(null)
                : null;
        String evaluationType = assessment != null ? assessment.getEvaluationType() : null;
        boolean autoEvaluated = !"MANUAL".equalsIgnoreCase(evaluationType);

        String attemptId = detail != null && detail.getQuestionOverallDetailDto() != null
                ? detail.getQuestionOverallDetailDto().getAttemptId()
                : null;
        Double totalMarks = comparison != null && comparison.getTotalMarks() != null
                ? comparison.getTotalMarks()
                : ctx.getTotalMarks();

        StudentReportAnalyticsService.StudentReportAnalytics analytics = studentReportAnalyticsService.compute(
                ctx.getAssessmentId(), ctx.getInstituteId(), attemptId,
                ctx.getFullLeaderboard(), detail, totalMarks, autoEvaluated);

        // The registration is the authoritative identity block (participant
        // name, login/enrollment username, email) — the leaderboard name is
        // only a fallback. ManyToOne registration is EAGER, so this is safe
        // outside a transaction.
        AssessmentUserRegistration registration = attemptId != null
                ? studentAttemptRepository.findById(attemptId).map(StudentAttempt::getRegistration).orElse(null)
                : null;
        String studentName = registration != null && registration.getParticipantName() != null
                && !registration.getParticipantName().isBlank()
                ? registration.getParticipantName()
                : resolveStudentName(ctx.getFullLeaderboard(), attemptId);

        return studentReportHtmlV2Builder.build(StudentReportHtmlV2Builder.Input.builder()
                .assessmentName(ctx.getAssessmentName())
                .reportDetail(detail)
                .comparison(comparison)
                .branding(ctx.getBranding())
                .evaluationType(evaluationType)
                .examDate(assessment != null ? assessment.getBoundStartTime() : null)
                .assessmentDurationMinutes(assessment != null ? assessment.getDuration() : null)
                .studentName(studentName)
                .registrationUsername(registration != null ? registration.getUsername() : null)
                .userEmail(registration != null ? registration.getUserEmail() : null)
                .fullLeaderboard(ctx.getFullLeaderboard())
                .sections(ctx.getSections())
                .analytics(analytics)
                .hideQuestionWise(ctx.getAssessmentId() != null && ctx.getInstituteId() != null
                        && reportProfileService.hideQuestionWise(ctx.getAssessmentId(), ctx.getInstituteId()))
                .build());
    }

    /** The student's display name only exists on the cohort leaderboard rows — match by attempt id. */
    private String resolveStudentName(List<LeaderBoardDto> leaderboard, String attemptId) {
        if (leaderboard == null || attemptId == null) {
            return null;
        }
        return leaderboard.stream()
                .filter(row -> row != null && attemptId.equals(row.getAttemptId()))
                .map(LeaderBoardDto::getStudentName)
                .filter(name -> name != null && !name.isBlank())
                .findFirst()
                .orElse(null);
    }
}
