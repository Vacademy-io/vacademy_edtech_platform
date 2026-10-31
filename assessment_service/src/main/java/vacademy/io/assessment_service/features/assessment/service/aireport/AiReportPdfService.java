package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.itextpdf.html2pdf.ConverterProperties;
import com.itextpdf.html2pdf.HtmlConverter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportBrandingDto;

import java.io.ByteArrayOutputStream;
import java.util.Map;

/**
 * One student, one report: the AI report once admin_core has produced it, otherwise the
 * normal report. Every per-student PDF path (learner download, admin download, the AI PDF
 * endpoints) asks this service first; a null answer means "use the normal report".
 *
 * <p>The AI report carries everything the normal one does except the named leaderboard
 * (classmates appear only as counts), so swapping it in loses nothing a student needs.
 */
@Slf4j
@Service
public class AiReportPdfService {

    private final AiReportDataService dataService;
    private final AiReportHtmlBuilderV2 builder;
    private final AiReportFonts fonts;
    private final AdminCoreServiceClient adminCoreServiceClient;
    private final ReportProfileService profileService;
    private final ReportComposer composer;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** The normal report, rendered only when it is needed. */
    @FunctionalInterface
    public interface NormalReport {
        byte[] render() throws Exception;
    }

    @Value("${assessment.ai-report.v2.enabled:true}")
    private boolean enabled;

    public AiReportPdfService(AiReportDataService dataService, AiReportHtmlBuilderV2 builder, AiReportFonts fonts,
                              AdminCoreServiceClient adminCoreServiceClient, ReportProfileService profileService,
                              ReportComposer composer) {
        this.dataService = dataService;
        this.builder = builder;
        this.fonts = fonts;
        this.adminCoreServiceClient = adminCoreServiceClient;
        this.profileService = profileService;
        this.composer = composer;
    }

    /**
     * The one PDF a student gets for an attempt: the AI report when it exists (else the
     * normal report), wrapped in the pages of the assessment's report profile, if any.
     *
     * @param knownProcessedJson the AI analysis when the caller already has it; null to look it up
     * @param normal             renders the normal report; null means "AI report or nothing" (throws)
     */
    public byte[] renderStudentReport(String userId, String assessmentId, String attemptId, String instituteId,
                                      StudentReportOverallDetailDto detail, String knownProcessedJson,
                                      NormalReport normal) throws Exception {
        return renderWithProfile(userId, assessmentId, attemptId, instituteId, detail, knownProcessedJson, normal,
                profileService.resolve(assessmentId, instituteId));
    }

    /** Same as {@link #renderStudentReport} with an explicit profile (null = none), for previews. */
    public byte[] renderWithProfile(String userId, String assessmentId, String attemptId, String instituteId,
                                    StudentReportOverallDetailDto detail, String knownProcessedJson,
                                    NormalReport normal, ReportProfileService.Profile profile) throws Exception {
        boolean wrap = profile != null && profile.hasPages();

        String processed = knownProcessedJson;
        if (processed == null && enabled && userId != null) {
            try {
                processed = adminCoreServiceClient.getProcessedAIReport(userId, assessmentId);
            } catch (Exception e) {
                log.warn("[ai-report] AI analysis lookup failed for attempt {}: {}", attemptId, e.getMessage());
            }
        }

        AiReportModel model = null;
        byte[] core = null;
        if (enabled && processed != null && !processed.isBlank()) {
            try {
                model = dataService.load(userId, assessmentId, attemptId, instituteId,
                        objectMapper.readTree(processed), branding(instituteId), detail);
                if (profile != null && profile.hideQuestionWise()) model = model.toBuilder().hideQuestionWise(true).build();
                core = toPdf(builder.build(model));
            } catch (Exception e) {
                if (normal == null) throw e;
                log.error("[ai-report] AI report failed for attempt {}, using the normal report", attemptId, e);
                model = null;
            }
        }
        if (core == null) {
            if (normal == null) throw new IllegalStateException("No AI report for attempt " + attemptId);
            core = normal.render();
        }
        lastModel.set(model);
        lastProfile.set(profile);
        if (!wrap) return core;
        try {
            if (model == null) {
                model = dataService.load(userId, assessmentId, attemptId, instituteId, null, branding(instituteId), detail);
                lastModel.set(model);
            }
            return composer.compose(profile, model, core);
        } catch (Exception e) {
            log.error("[report-profile] could not add profile {} pages for attempt {}; serving the report alone",
                    profile.id(), attemptId, e);
            return core;
        }
    }

    // The model and profile of the last render on this thread, so notification variables can be
    // built without loading the data twice.
    private final ThreadLocal<AiReportModel> lastModel = new ThreadLocal<>();
    private final ThreadLocal<ReportProfileService.Profile> lastProfile = new ThreadLocal<>();

    /** A rendered report together with the values its notifications fill in. */
    public record Rendered(byte[] pdf, Map<String, String> variables) {
    }

    /** {@link #renderStudentReport} plus the per-student values for the result email / WhatsApp. */
    public Rendered renderWithVariables(String userId, String assessmentId, String attemptId, String instituteId,
                                        StudentReportOverallDetailDto detail, NormalReport normal) throws Exception {
        lastModel.remove();
        lastProfile.remove();
        try {
            byte[] pdf = renderStudentReport(userId, assessmentId, attemptId, instituteId, detail, null, normal);
            return new Rendered(pdf, variables(userId, assessmentId, attemptId, instituteId, detail, lastModel.get(), lastProfile.get()));
        } finally {
            lastModel.remove();
            lastProfile.remove();
        }
    }

    /**
     * The values a result notification can use for one attempt: the same ones report-profile
     * templates use (student_name, score, rank, scholarship_percent, ...), as plain strings.
     * Never throws; an empty map means "only the generic placeholders".
     */
    public Map<String, String> variables(String userId, String assessmentId, String attemptId, String instituteId,
                                         StudentReportOverallDetailDto detail, AiReportModel model,
                                         ReportProfileService.Profile profile) {
        try {
            if (profile == null) profile = profileService.resolve(assessmentId, instituteId);
            if (model == null) {
                model = dataService.load(userId, assessmentId, attemptId, instituteId, null, branding(instituteId), detail);
            }
            Map<String, String> out = new java.util.LinkedHashMap<>();
            composer.context(model, profile).forEach((k, v) -> {
                if (v instanceof String str && !"qr_svg".equals(k)) out.put(k, str);
            });
            out.put("learner_name", out.getOrDefault("student_name", ""));
            return out;
        } catch (Exception e) {
            log.warn("[result-notify] variables unavailable for attempt {}: {}", attemptId, e.getMessage());
            return new java.util.HashMap<>();
        }
    }

    private ReportBrandingDto branding(String instituteId) {
        try {
            ReportBrandingDto b = adminCoreServiceClient.getReportBranding(instituteId);
            if (b != null) return b;
        } catch (Exception e) {
            log.warn("[ai-report] branding unavailable for institute {}: {}", instituteId, e.getMessage());
        }
        return ReportBrandingDto.builder().build();
    }

    private byte[] toPdf(String html) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ConverterProperties props = new ConverterProperties();
        props.setFontProvider(fonts.newProvider());
        HtmlConverter.convertToPdf(html, out, props);
        return out.toByteArray();
    }

    public boolean isEnabled() {
        return enabled;
    }

    /**
     * The AI report PDF when one exists for (user, assessment), else null. Never throws:
     * any failure is logged and answered with null so the caller serves the normal report.
     */
    public byte[] renderIfAvailable(String userId, String assessmentId, String attemptId, String instituteId,
                                    StudentReportOverallDetailDto detail) {
        if (!enabled || userId == null || attemptId == null) return null;
        try {
            String processedJson = adminCoreServiceClient.getProcessedAIReport(userId, assessmentId);
            if (processedJson == null || processedJson.isBlank()) return null;
            return render(processedJson, userId, assessmentId, attemptId, instituteId, detail);
        } catch (Exception e) {
            log.error("[ai-report] could not render the AI report for attempt {}, using the normal report", attemptId, e);
            return null;
        }
    }

    /** Renders a known processed AI report. Throws on failure; callers decide the fallback. */
    public byte[] render(String processedJson, String userId, String assessmentId, String attemptId, String instituteId,
                         StudentReportOverallDetailDto detail) throws Exception {
        ReportBrandingDto branding = null;
        try {
            branding = adminCoreServiceClient.getReportBranding(instituteId);
        } catch (Exception e) {
            log.warn("[ai-report] branding unavailable for institute {}: {}", instituteId, e.getMessage());
        }
        if (branding == null) branding = ReportBrandingDto.builder().build();

        AiReportModel model = dataService.load(userId, assessmentId, attemptId, instituteId,
                objectMapper.readTree(processedJson), branding, detail);
        String html = builder.build(model);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ConverterProperties props = new ConverterProperties();
        props.setFontProvider(fonts.newProvider());
        HtmlConverter.convertToPdf(html, out, props);
        return out.toByteArray();
    }
}
