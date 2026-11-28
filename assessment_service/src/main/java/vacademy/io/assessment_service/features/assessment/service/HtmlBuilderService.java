package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.question_core.util.CbeAnswers;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.QuestionInsightsResponse;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportAnswerReviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.Top3CorrectResponseDto;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.manager.AdminAssessmentGetManager;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.learner_assessment.dto.QuestionStatusDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportBrandingDto;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.service.FileService;

import vacademy.io.assessment_service.features.assessment.dto.LeaderBoardDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.ParticipantsQuestionOverallDetailDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.SectionComparisonDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.SmartLeaderboardDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentComparisonDto;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class HtmlBuilderService {

    @Autowired
    AdminAssessmentGetManager adminAssessmentGetManager;

    @Autowired
    SectionRepository sectionRepository;

    @Autowired
    OptionRepository optionRepository;

    @Autowired
    FileService fileService;

    // Unicode symbols for report icons
    private static final String SYM_CORRECT = "\u2713";     // ✓
    private static final String SYM_INCORRECT = "\u2717";    // ✗
    private static final String SYM_PARTIAL = "\u25CF";      // ●
    private static final String SYM_SKIPPED = "\u25CB";      // ○
    private static final String SYM_TIME = "\u23F1";         // ⏱
    private static final String SYM_RANK = "\u2605";         // ★
    private static final String SYM_PERCENTILE = "\u25C8";   // ◈
    private static final String SYM_SECTION = "\u25B6";      // ▶
    private static final String SYM_STAT = "\u25A0";         // ■
    private static final String SYM_TARGET = "\u25CE";       // ◎
    private static final String SYM_ARROW_UP = "\u25B2";     // ▲
    private static final String SYM_ARROW_DOWN = "\u25BC";   // ▼
    private static final String SYM_TROPHY = "\u265B";       // ♛

    public static String convertToReadableTime(Long timeInSeconds) {
        if (Objects.isNull(timeInSeconds) || timeInSeconds < 0) {
            return "N/A";
        }

        long hours = timeInSeconds / 3600;
        long minutes = (timeInSeconds % 3600) / 60;
        long seconds = timeInSeconds % 60;

        StringBuilder result = new StringBuilder();
        if (hours > 0) {
            result.append(hours).append(" hr ");
        }
        if (minutes > 0) {
            result.append(minutes).append(" min ");
        }
        if (seconds > 0 || result.isEmpty()) { // Always show at least seconds if the input is 0
            result.append(seconds).append(" sec");
        }

        return result.toString().trim();
    }

    public static String calculateEndTime(Date startTime, Long durationInSeconds) {
        if (startTime == null) {
            return "-";
        }
        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

        // Convert Date to LocalDateTime
        LocalDateTime localDateTime = Instant.ofEpochMilli(startTime.getTime())
                .atZone(ZoneId.systemDefault())
                .toLocalDateTime();

        // Add duration in seconds
        LocalDateTime endDateTime = localDateTime.plusSeconds(durationInSeconds != null ? durationInSeconds : 0);

        // Return formatted date and time
        return endDateTime.format(formatter);
    }

    public String getQuestionInsightsHtml(CustomUserDetails user, List<String> sectionIds, String assessmentId,
            String instituteId) {
        StringBuilder html = new StringBuilder();

        html.append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">");
        html.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
        html.append("<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');</style>");
        html.append("<title>Question Insights</title>");
        html.append("<style>");
        html.append("body { font-family: 'Inter', -apple-system, 'Segoe UI', Arial, Helvetica, sans-serif; margin: 0; padding: 0; background: #fff; color: #333; line-height: 1.6; }");
        html.append(".container { max-width: 800px; margin: 0 auto; }");
        html.append(".header { background-color: #FF6B35; color: white; padding: 20px 28px; border-bottom: 3px solid rgba(0,0,0,0.15); }");
        html.append(".section-header { padding: 14px 28px; background-color: #f8f9fc; border-bottom: 2px solid #eee; font-size: 15px; font-weight: 700; color: #333; }");
        html.append(".q-card { padding: 18px 28px; border-bottom: 1px solid #eee; page-break-inside: avoid; }");
        html.append(".q-text { font-size: 14px; font-weight: 700; color: #333; margin-bottom: 10px; }");
        html.append(".correct-box { background-color: #f0fdf4; border-left: 4px solid #2E7D32; padding: 8px 12px; border-radius: 0 6px 6px 0; margin-top: 8px; font-size: 12px; }");
        html.append(".respondent-row { padding: 4px 8px; font-size: 12px; }");
        html.append(".stat-row { margin-top: 10px; }");
        html.append(".footer { padding: 12px 28px; background-color: #f8f9fc; text-align: center; font-size: 10px; color: #999; border-top: 2px solid #eee; }");
        html.append("</style></head><body>");
        html.append("<div class=\"container\">");
        html.append("<div class=\"header\"><div style=\"font-size: 18px; font-weight: 700;\">").append(SYM_STAT).append(" Question Insights Report</div></div>");

        if (!Objects.isNull(sectionIds)) {
            for (String sectionId : sectionIds) {
                Optional<Section> sectionOptional = sectionRepository.findById(sectionId);
                sectionOptional.ifPresent(
                        section -> html.append("<div class=\"section-header\">").append(SYM_SECTION).append(" ").append(section.getName()).append("</div>"));

                QuestionInsightsResponse questionInsightsResponses = adminAssessmentGetManager.createInsights(user,
                        assessmentId, sectionId);
                List<QuestionInsightsResponse.QuestionInsightDto> questionInsightDtos = questionInsightsResponses
                        .getQuestionInsightDto();

                questionInsightDtos.forEach(questionInsight -> {
                    AssessmentQuestionPreviewDto assessmentQuestionPreviewDto = questionInsight
                            .getAssessmentQuestionPreviewDto();

                    html.append("<div class=\"q-card\">");

                    if (!Objects.isNull(assessmentQuestionPreviewDto)) {
                        html.append("<div class=\"q-text\">");
                        html.append(stripHtmlTags(assessmentQuestionPreviewDto.getQuestion().getContent()));
                        html.append("</div>");

                        List<String> correctOptionIds = new ArrayList<>();
                        try {
                            correctOptionIds = QuestionBasedStrategyFactory
                                    .getCorrectOptionIds(assessmentQuestionPreviewDto.getEvaluationJson(),
                                            assessmentQuestionPreviewDto.getQuestionType());
                        } catch (Exception e) {
                            throw new VacademyException("Failed To generate: " + e.getMessage());
                        }

                        List<String> correctOptionText = getTextFromAssessmentPreviewDto(assessmentQuestionPreviewDto,
                                correctOptionIds);
                        correctOptionText.forEach(correctOption -> {
                            html.append("<div class=\"correct-box\">").append(SYM_CORRECT).append(" <strong>Correct:</strong> ")
                                    .append(stripHtmlTags(correctOption)).append("</div>");
                        });

                        // Top 3 respondents
                        List<Top3CorrectResponseDto> top3CorrectResponseDtos = questionInsight
                                .getTop3CorrectResponseDto();
                        if (!Objects.isNull(top3CorrectResponseDtos) && !top3CorrectResponseDtos.isEmpty()) {
                            html.append("<div style=\"margin-top: 8px; font-size: 12px; font-weight: 600; color: #555;\">").append(SYM_TROPHY).append(" Top 3 Quick Correct Responses</div>");
                            String[] medalColors = {"#FFD700", "#C0C0C0", "#CD7F32"};
                            int respIdx = 0;
                            for (Top3CorrectResponseDto top3 : top3CorrectResponseDtos) {
                                String medalColor = respIdx < 3 ? medalColors[respIdx] : "#ddd";
                                html.append("<div class=\"respondent-row\">");
                                html.append("<span style=\"display: inline-block; width: 18px; height: 18px; border-radius: 9px; background-color: ")
                                        .append(medalColor).append("; color: #333; text-align: center; line-height: 18px; font-size: 10px; font-weight: 700;\">")
                                        .append(respIdx + 1).append("</span> ");
                                html.append(escapeHtml(top3.getName())).append(" <span style=\"color: #888;\">").append(SYM_TIME).append(" ")
                                        .append(convertToReadableTime(top3.getTimeTakenInSeconds())).append("</span>");
                                html.append("</div>");
                                respIdx++;
                            }
                        }
                    }

                    // Stats
                    Long totalAttempts = questionInsight.getTotalAttempts();
                    totalAttempts = (totalAttempts != null && totalAttempts > 0) ? totalAttempts : 1;
                    QuestionStatusDto status = questionInsight.getQuestionStatus();

                    long correctAttempt = (status != null && status.getCorrectAttempt() != null) ? status.getCorrectAttempt() : 0;
                    long incorrectAttempt = (status != null && status.getIncorrectAttempt() != null) ? status.getIncorrectAttempt() : 0;
                    long partialCorrectAttempt = (status != null && status.getPartialCorrectAttempt() != null) ? status.getPartialCorrectAttempt() : 0;
                    long skippedAttempt = (questionInsight.getSkipped() != null) ? questionInsight.getSkipped() : 0;

                    double correctPct = (correctAttempt * 100.0) / totalAttempts;
                    double incorrectPct = (incorrectAttempt * 100.0) / totalAttempts;
                    double partialPct = (partialCorrectAttempt * 100.0) / totalAttempts;
                    double skippedPct = (skippedAttempt * 100.0) / totalAttempts;

                    html.append("<div class=\"stat-row\">");
                    html.append("<div style=\"font-size: 11px; color: #888; margin-bottom: 4px;\">").append(SYM_STAT).append(" Total Attempts: <b style=\"color: #333;\">").append(totalAttempts).append("</b></div>");

                    // Stacked percentage bar
                    html.append("<table style=\"width: 100%; border-collapse: collapse; height: 10px;\"><tr>");
                    if (correctPct > 0) html.append("<td style=\"width: ").append(String.format("%.1f", correctPct)).append("%; background-color: #2E7D32; height: 10px;\"></td>");
                    if (partialPct > 0) html.append("<td style=\"width: ").append(String.format("%.1f", partialPct)).append("%; background-color: #F57F17; height: 10px;\"></td>");
                    if (incorrectPct > 0) html.append("<td style=\"width: ").append(String.format("%.1f", incorrectPct)).append("%; background-color: #C62828; height: 10px;\"></td>");
                    if (skippedPct > 0) html.append("<td style=\"width: ").append(String.format("%.1f", skippedPct)).append("%; background-color: #BDBDBD; height: 10px;\"></td>");
                    html.append("</tr></table>");

                    // Stat labels
                    html.append("<table style=\"width: 100%; font-size: 10px; color: #555; margin-top: 4px;\"><tr>");
                    html.append("<td>").append(dot("#2E7D32")).append(SYM_CORRECT).append(" ").append(correctAttempt).append(" (").append(String.format("%.1f", correctPct)).append("%)</td>");
                    html.append("<td>").append(dot("#F57F17")).append(SYM_PARTIAL).append(" ").append(partialCorrectAttempt).append(" (").append(String.format("%.1f", partialPct)).append("%)</td>");
                    html.append("<td>").append(dot("#C62828")).append(SYM_INCORRECT).append(" ").append(incorrectAttempt).append(" (").append(String.format("%.1f", incorrectPct)).append("%)</td>");
                    html.append("<td>").append(dot("#BDBDBD")).append(SYM_SKIPPED).append(" ").append(skippedAttempt).append(" (").append(String.format("%.1f", skippedPct)).append("%)</td>");
                    html.append("</tr></table>");
                    html.append("</div>"); // stat-row

                    html.append("</div>"); // q-card
                });
            }
        }

        // Footer
        html.append("<div class=\"footer\">Generated: ").append(LocalDateTime.now().format(DateTimeFormatter.ofPattern("dd MMM yyyy, HH:mm"))).append("</div>");
        html.append("</div></body></html>");

        return html.toString();
    }

    private List<String> getTextFromAssessmentPreviewDto(AssessmentQuestionPreviewDto assessmentQuestionPreviewDto,
            List<String> correctOptionIds) {
        if (assessmentQuestionPreviewDto == null || assessmentQuestionPreviewDto.getOptionsWithExplanation() == null
                || correctOptionIds == null) {
            return Collections.emptyList(); // Return an empty list if any input is null
        }

        return assessmentQuestionPreviewDto.getOptionsWithExplanation().stream()
                .filter(option -> option != null && correctOptionIds.contains(option.getId())) // Avoid NPE on option
                .map(option -> option.getText() != null ? option.getText().getContent() : null) // Handle null text
                .filter(Objects::nonNull) // Remove null contents
                .collect(Collectors.toList()); // Collect as List
    }

    public String generateStudentReportHtml(String title, StudentReportOverallDetailDto studentReportOverallDetailDto) {
        StringBuilder html = new StringBuilder();

        html.append("<!DOCTYPE html>");
        html.append("<html lang=\"en\">");
        html.append("<head>");
        html.append("<meta charset=\"UTF-8\">");
        html.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
        html.append("<title>Student Assessment Report</title>");
        html.append("<style>");
        html.append("body { font-family: Arial, sans-serif; margin: 5px; background-color: #ffffff; }");
        html.append(
                ".container { background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }");
        html.append(".header { font-size: 20px; font-weight: bold; color: #ff6f00; }");
        html.append(".section { margin-top: 20px; }");
        html.append(".title { font-size: 18px; font-weight: bold; color: #333; }");
        html.append(".info { font-size: 14px; color: #555; }");
        html.append(".score-box { background-color: #fff3e0; padding: 10px; border-radius: 5px; margin-top: 10px; }");
        html.append(".answer-container { display: flex; flex-direction:column; gap:20px }");
        html.append(".answer-box { background-color: #f5f5f5; padding: 10px; border-radius: 5px; margin-top: 10px; }");
        html.append(
                ".correct-marks-box { background-color: #F2FAF6; padding: 5px; border-radius: 3px; color: green; font-weight: bold; }");
        html.append(
                ".incorrect-marks-box { background-color: #FEF2F2; padding: 5px; border-radius: 3px; color: green; font-weight: bold; }");
        html.append(
                ".partial-marks-box { background-color: #FFDD82; padding: 5px; border-radius: 3px; color: green; font-weight: bold; }");
        html.append(
                ".skip-marks-box { background-color: #EEE; padding: 5px; border-radius: 3px; color: green; font-weight: bold; }");
        html.append("</style>");
        html.append("</head>");
        html.append("<body>");
        html.append("<div class=\"container\">");
        html.append("<div class=\"header\">").append(title).append("</div>");
        html.append("<div class=\"section\">");
        if (!Objects.isNull(studentReportOverallDetailDto)
                && !Objects.isNull(studentReportOverallDetailDto.getQuestionOverallDetailDto())) {
            html.append("<div class=\"title\">").append(title).append("</div>");
            html.append("<div class=\"info\">Attempt Date: ")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getStartTime() != null
                            ? studentReportOverallDetailDto.getQuestionOverallDetailDto().getStartTime().toString()
                            : "-")
                    .append(" | Duration: ")
                    .append(convertToReadableTime(
                            studentReportOverallDetailDto.getQuestionOverallDetailDto().getCompletionTimeInSeconds()))
                    .append("</div>");
            html.append("<div class=\"info\">Start Time: ")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getStartTime() != null
                            ? studentReportOverallDetailDto.getQuestionOverallDetailDto().getStartTime().toString()
                            : "-")
                    .append(" | End Time: ")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getStartTime() != null
                            ? calculateEndTime(
                                    studentReportOverallDetailDto.getQuestionOverallDetailDto().getStartTime(),
                                    studentReportOverallDetailDto.getQuestionOverallDetailDto()
                                            .getCompletionTimeInSeconds())
                            : "-")
                    .append("</div>");

            html.append("</div>");
            html.append("<div class=\"section\">");
            html.append("<div class=\"title\">Score Report</div>");
            html.append("<div class=\"score-box\">");

            html.append("<div>Rank: <b>")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getRank())
                    .append("</b></div>");

            html.append("<div>Percentile: <b>")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getPercentile())
                    .append("%</b></div>");

            html.append("<div>Marks: <b>")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getAchievedMarks())
                    .append("</b></div>");

            html.append("<div>Correct Answers: ")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getCorrectAttempt())
                    .append(" (")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getTotalCorrectMarks())
                    .append(")")
                    .append("</div>");

            html.append("<div>Partially Correct: ")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getPartialCorrectAttempt())
                    .append(" (")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getTotalPartialMarks())
                    .append(")")
                    .append("</div>");

            html.append("<div>Wrong Answers: ")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getWrongAttempt())
                    .append(" (")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getTotalIncorrectMarks())
                    .append(")")
                    .append("</div>");

            html.append("<div>Skipped: ")
                    .append(studentReportOverallDetailDto.getQuestionOverallDetailDto().getSkippedCount())
                    .append(" (0)")
                    .append("</div>");

        }
        html.append("</div>");
        html.append("</div>");
        html.append("<div class=\"section\">");
        html.append("<div class=\"title\">Answer Review</div>");
        if (!Objects.isNull(studentReportOverallDetailDto)
                && !Objects.isNull(studentReportOverallDetailDto.getAllSections())) {

            for (Map.Entry<String, List<StudentReportAnswerReviewDto>> entry : studentReportOverallDetailDto
                    .getAllSections().entrySet()) {
                String sectionId = entry.getKey(); // Section Name
                Optional<Section> sectionOptional = sectionRepository.findById(sectionId);
                sectionOptional.ifPresent(
                        section -> html.append("<div class=\"title\">").append(section.getName()).append("</div>"));

                List<StudentReportAnswerReviewDto> reviews = entry.getValue();
                // reviews.sort(Comparator.comparingInt(StudentReportAnswerReviewDto::getQuestionOrder));
                for (StudentReportAnswerReviewDto review : reviews) {
                    html.append("<div class=\"answer-box\">");
                    html.append("<div><b>")
                            .append(review.getQuestionOrder() == null ? "Q" : review.getQuestionOrder())
                            .append(".</b>&nbsp;<b>")
                            .append(review.getQuestionName())
                            .append("</b></div>");

                    if (!Objects.isNull(review.getStudentResponseOptions())
                            && "CODING".equals(review.getQuestionType())) {
                        appendCodingAnswerBlock(html, review.getStudentResponseOptions(),
                                review.getCorrectOptions(), review.getAnswerStatus());
                    } else if (!Objects.isNull(review.getStudentResponseOptions())) {
                        List<String> content = extractResponseContent(review.getStudentResponseOptions(),
                                review.getCorrectOptions());
                        content.forEach(option -> {
                            html.append("<div style=\"margin-top: 5px;\"><b>Student Answer:</b> ").append(option)
                                    .append("</div>");
                        });
                    }

                    if (!Objects.isNull(review.getCorrectOptions()) && !Objects.isNull(review.getAnswerStatus())
                            && !review.getAnswerStatus().equals("CORRECT")) {

                        extractContent(review.getCorrectOptions()).forEach(option -> {
                            html.append("<div style=\"margin-top: 5px;\"><b>Correct Answer:</b> ").append(option)
                                    .append("</div>");
                        });
                    }

                    if (!Objects.isNull(review.getAnswerStatus()) && review.getAnswerStatus().equals("CORRECT")) {
                        html.append("<div class=\"correct-marks-box\">+").append(review.getMark())
                                .append(" Marks</div>");
                    } else if (!Objects.isNull(review.getAnswerStatus())
                            && review.getAnswerStatus().equals("INCORRECT")) {
                        html.append("<div class=\"incorrect-marks-box\">").append(review.getMark())
                                .append(" Marks</div>");
                    } else if (!Objects.isNull(review.getAnswerStatus())
                            && review.getAnswerStatus().equals("PARTIAL_CORRECT")) {
                        html.append("<div class=\"partial-marks-box\">+").append(review.getMark())
                                .append(" Marks</div>");
                    } else if (!Objects.isNull(review.getAnswerStatus())
                            && review.getAnswerStatus().equals("PENDING")) {
                        html.append("<div class=\"skip-marks-box\">").append(review.getMark()).append(" Marks</div>");
                    }
                    html.append("<div>Explanation: ")
                            .append(review.getExplanation() != null ? review.getExplanation() : "-").append("</div>");
                    html.append("<div style=\"color: gray; font-size: 12px; margin-top: 5px;\">⏳ ")
                            .append(convertToReadableTime(review.getTimeTakenInSeconds()))
                            .append("</div>");
                    html.append("</div>");
                }
            }
        }

        html.append("</div>");
        html.append("</div>");
        html.append("</body>");
        html.append("</html>");

        return html.toString();
    }

    /**
     * Rich HTML report with comparison data, attempt summary, and styled answer review.
     * Uses table-based layouts instead of CSS Grid/Flexbox for iText PDF compatibility.
     */
    public String generateStudentReportHtml(String title, StudentReportOverallDetailDto reportDetail,
                                             StudentComparisonDto comparison,
                                             Map<String, Map<String, Double>> optionDistribution) {
        return generateStudentReportHtml(title, reportDetail, comparison, optionDistribution, null);
    }

    public String generateStudentReportHtml(String title, StudentReportOverallDetailDto reportDetail,
                                             StudentComparisonDto comparison,
                                             Map<String, Map<String, Double>> optionDistribution,
                                             ReportBrandingDto branding) {
        if (branding == null) branding = ReportBrandingDto.builder().build();
        String primaryColor = branding.getPrimaryColor() != null ? branding.getPrimaryColor() : "#FF6B35";
        String secondaryColor = branding.getSecondaryColor() != null ? branding.getSecondaryColor() : "#6C5CE7";
        String footerText = branding.getFooterText() != null ? branding.getFooterText()
                : "This report is auto-generated. For queries, contact your institute administrator.";

        StringBuilder html = new StringBuilder();

        // ===== CSS (iText-compatible: tables instead of grid/flex) =====
        html.append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">");
        html.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
        // PR3 (C7): the remote Google Fonts @import here was a synchronous
        // network fetch inside every render — potentially once per PDF, on the
        // hot path of the bulk export worker. 'Inter' now resolves via the
        // FontProvider registered on ConverterProperties (ReportRenderResources /
        // ReportFontProviderHolder) with a standard-font fallback if that
        // registration is unavailable, instead of a runtime HTTP fetch.
        html.append("<title>Student Assessment Report</title>");
        html.append("<style>");
        html.append("body { font-family: 'Inter', -apple-system, 'Segoe UI', Arial, Helvetica, sans-serif; background: #ffffff; color: #333; line-height: 1.6; margin: 0; padding: 0; }");
        html.append(".report-container { max-width: 800px; margin: 0 auto; }");
        html.append(".report-header { background-color: ").append(primaryColor).append("; color: white; padding: 24px 28px; border-bottom: 3px solid rgba(0,0,0,0.15); }");
        html.append(".report-header h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px 0; }");
        html.append(".section { padding: 24px 28px; border-bottom: 1px solid #eee; page-break-inside: avoid; }");
        html.append(".section-title { font-size: 15px; font-weight: 700; color: #333; margin-bottom: 14px; padding-bottom: 6px; border-bottom: 2px solid #f0f0f0; }");
        // Layout table (no borders, used for horizontal cards)
        html.append(".layout-table { width: 100%; border-collapse: separate; border-spacing: 8px; }");
        html.append(".layout-table td { vertical-align: top; }");
        // Score cards
        html.append(".score-card { background-color: #f8f9fc; border-radius: 8px; padding: 14px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }");
        html.append(".score-value { font-size: 24px; font-weight: 800; }");
        html.append(".score-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }");
        // Comparison bars
        html.append(".comp-label { font-size: 12px; color: #888; margin-bottom: 6px; }");
        html.append(".bar-bg { width: 100%; height: 8px; background-color: #e9ecef; border-radius: 4px; }");
        html.append(".bar-fill { height: 8px; border-radius: 4px; }");
        // Attempt stat boxes
        html.append(".stat-correct { background-color: #E8F5E9; color: #2E7D32; }");
        html.append(".stat-wrong { background-color: #FFEBEE; color: #C62828; }");
        html.append(".stat-partial { background-color: #FFF8E1; color: #F57F17; }");
        html.append(".stat-skipped { background-color: #F5F5F5; color: #757575; }");
        html.append(".stat-box { border-radius: 8px; padding: 10px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }");
        html.append(".stat-count { font-size: 22px; font-weight: 800; }");
        html.append(".stat-marks-text { font-size: 11px; margin-top: 2px; }");
        html.append(".stat-label-text { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 3px; }");
        // Data tables
        html.append(".perf-table { width: 100%; border-collapse: collapse; font-size: 12px; }");
        html.append(".perf-table th { background-color: #f8f9fc; padding: 8px 10px; text-align: left; font-weight: 600; color: #555; border-bottom: 2px solid #eee; }");
        html.append(".perf-table td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }");
        html.append(".badge-pass { background-color: #E8F5E9; color: #2E7D32; padding: 2px 10px; font-size: 10px; font-weight: 600; border-radius: 12px; display: inline-block; }");
        html.append(".badge-fail { background-color: #FFEBEE; color: #C62828; padding: 2px 10px; font-size: 10px; font-weight: 600; border-radius: 12px; display: inline-block; }");
        // Distribution bars
        html.append(".dist-table { width: 100%; border-collapse: collapse; }");
        html.append(".dist-table td { text-align: center; vertical-align: bottom; padding: 2px; font-size: 10px; }");
        // Leaderboard
        html.append(".lb-table { width: 100%; border-collapse: collapse; font-size: 12px; }");
        html.append(".lb-table th { background-color: #f8f9fc; padding: 8px 10px; text-align: left; font-weight: 600; color: #555; border-bottom: 2px solid #eee; }");
        html.append(".lb-table td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }");
        html.append(".current-student { background-color: #FFF3E0; font-weight: 600; }");
        // Question cards
        html.append(".question-card { background-color: #fafbfc; border: 1px solid #eee; border-radius: 8px; padding: 14px; margin-bottom: 10px; page-break-inside: avoid; }");
        html.append(".q-correct-badge { background-color: #E8F5E9; color: #2E7D32; padding: 2px 10px; font-size: 10px; font-weight: 600; border-radius: 12px; display: inline-block; }");
        html.append(".q-incorrect-badge { background-color: #FFEBEE; color: #C62828; padding: 2px 10px; font-size: 10px; font-weight: 600; border-radius: 12px; display: inline-block; }");
        html.append(".q-partial-badge { background-color: #FFF8E1; color: #F57F17; padding: 2px 10px; font-size: 10px; font-weight: 600; border-radius: 12px; display: inline-block; }");
        html.append(".q-skipped-badge { background-color: #F5F5F5; color: #757575; padding: 2px 10px; font-size: 10px; font-weight: 600; border-radius: 12px; display: inline-block; }");
        html.append(".q-explanation { background-color: #EDE7F6; padding: 8px 12px; margin-top: 8px; font-size: 12px; color: #4A148C; border-radius: 6px; }");
        html.append(".report-footer { background-color: #f8f9fc; padding: 14px 28px; font-size: 11px; color: #999; }");
        // Watermark CSS
        html.append(".watermark { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; }");
        html.append(".watermark-text { position: absolute; top: 360pt; left: 100pt; font-size: 60px; font-weight: bold; white-space: nowrap; transform: rotate(-35deg); }");
        html.append("</style></head><body>");

        // ===== WATERMARK (fixed div outside container — repeats on every page in iText) =====
        if (Boolean.TRUE.equals(branding.getShowWatermark()) && branding.getWatermarkText() != null && !branding.getWatermarkText().isEmpty()) {
            double opacity = branding.getWatermarkOpacity() != null ? branding.getWatermarkOpacity() : 0.05;
            html.append("<div class=\"watermark\">")
                    .append("<div class=\"watermark-text\" style=\"color: ").append(primaryColor)
                    .append("; opacity: ").append(opacity).append(";\">")
                    .append(escapeHtml(branding.getWatermarkText()))
                    .append("</div></div>");
        }

        html.append("<div class=\"report-container\">");

        ParticipantsQuestionOverallDetailDto detail = reportDetail != null ? reportDetail.getQuestionOverallDetailDto() : null;

        // ===== HEADER =====
        html.append("<div class=\"report-header\">");

        // Logo — resolve file ID to public URL
        String logoUrl = null;
        if (branding.getLogoFileId() != null && !branding.getLogoFileId().isEmpty()) {
            try {
                logoUrl = fileService.getPublicUrlForFileId(branding.getLogoFileId());
            } catch (Exception e) {
                // Logo unavailable, skip
            }
        }

        // Build header: always use table layout with optional logo on left
        String headerHtml = branding.getHeaderHtml();
        html.append("<table style=\"width: 100%;\"><tr>");
        // Logo column (always rendered if available and showLogoInHeader is true)
        if (logoUrl != null && Boolean.TRUE.equals(branding.getShowLogoInHeader())) {
            html.append("<td style=\"width: 50px; vertical-align: middle; padding-right: 12px;\">")
                    .append("<img src=\"").append(logoUrl).append("\" style=\"max-height: 40px; max-width: 40px;\" />")
                    .append("</td>");
        }
        // Content column
        html.append("<td style=\"vertical-align: middle;\">");
        if (headerHtml != null && !headerHtml.isEmpty()) {
            // Custom header — replace placeholders + force white text for visibility
            String resolved = headerHtml
                    .replace("{{assessment_name}}", escapeHtml(title))
                    .replace("color:#666", "color:#E0E0E0")
                    .replace("color: #666", "color: #E0E0E0");
            if (logoUrl != null) {
                resolved = resolved.replace("{{logo_url}}", logoUrl);
            }
            html.append(resolved);
        } else {
            // Default header
            html.append("<div style=\"text-align: center; font-size: 20px; font-weight: 700; color: white;\">")
                    .append(escapeHtml(title)).append("</div>");
            html.append("<div style=\"text-align: center; font-size: 13px; color: #E0E0E0; margin-top: 4px;\">")
                    .append(SYM_STAT).append(" Student Performance Analysis</div>");
        }
        html.append("</td></tr></table>");
        if (detail != null) {
            html.append("<table style=\"margin-top: 12px;\"><tr>");
            html.append("<td style=\"color: white; font-size: 12px; padding-right: 20px;\"><span style=\"opacity: 0.8;\">").append(SYM_TIME).append(" Start Time: </span><b>")
                    .append(detail.getStartTime() != null ? detail.getStartTime().toString() : "-").append("</b></td>");
            html.append("<td style=\"color: white; font-size: 12px;\"><span style=\"opacity: 0.8;\">").append(SYM_TIME).append(" Duration: </span><b>")
                    .append(convertToReadableTime(detail.getCompletionTimeInSeconds())).append("</b></td>");
            html.append("</tr></table>");
        }
        html.append("</div>");

        // ===== SCORE OVERVIEW (horizontal table) =====
        if (detail != null) {
            Double marks = detail.getAchievedMarks();
            Double totalMarks = comparison != null && comparison.getTotalMarks() != null ? comparison.getTotalMarks() : 100.0;
            String grade = calculateGrade(detail.getPercentile());
            String gColor = gradeColor(grade);
            html.append("<div class=\"section\">");
            html.append("<div class=\"section-title\">").append(SYM_STAT).append(" Score Overview</div>");
            html.append("<table class=\"layout-table\"><tr>");
            // Grade
            html.append("<td width=\"20%\"><div class=\"score-card\">");
            html.append("<div style=\"width: 48px; height: 48px; border-radius: 24px; background-color: ").append(gColor)
                    .append("; color: white; text-align: center; line-height: 48px; font-size: 20px; font-weight: 800; margin: 0 auto;\">")
                    .append(grade).append("</div>");
            html.append("<div class=\"score-label\">Grade</div></div></td>");
            // Marks
            html.append("<td width=\"20%\"><div class=\"score-card\">");
            html.append("<div class=\"score-value\" style=\"color: ").append(primaryColor).append(";\">").append(formatNumber(marks)).append("/").append(formatNumber(totalMarks)).append("</div>");
            html.append("<div class=\"score-label\">Marks Obtained</div></div></td>");
            // Rank
            html.append("<td width=\"20%\"><div class=\"score-card\">");
            html.append("<div class=\"score-value\" style=\"color: ").append(secondaryColor).append(";\">").append(SYM_RANK).append(" #").append(detail.getRank() != null ? detail.getRank() : "-").append("</div>");
            html.append("<div class=\"score-label\">Rank</div></div></td>");
            // Percentile
            html.append("<td width=\"20%\"><div class=\"score-card\">");
            html.append("<div class=\"score-value\" style=\"color: #00B894;\">").append(SYM_PERCENTILE).append(" ").append(formatNumber(detail.getPercentile())).append("%</div>");
            html.append("<div class=\"score-label\">Percentile</div></div></td>");
            // Time (only show if time data exists)
            if (detail.getCompletionTimeInSeconds() != null && detail.getCompletionTimeInSeconds() > 0) {
                html.append("<td width=\"20%\"><div class=\"score-card\">");
                html.append("<div class=\"score-value\" style=\"color: #0984E3; font-size: 18px;\">").append(SYM_TIME).append(" ").append(convertToReadableTime(detail.getCompletionTimeInSeconds())).append("</div>");
                html.append("<div class=\"score-label\">Time Taken</div></div></td>");
            }
            html.append("</tr></table>");

            // Pass/Fail indicator (if any section has cutoff)
            if (comparison != null && comparison.getSectionWiseComparison() != null) {
                boolean hasCutoff = comparison.getSectionWiseComparison().stream().anyMatch(s -> s.getCutOffMarks() != null);
                if (hasCutoff) {
                    boolean overallPass = comparison.getSectionWiseComparison().stream()
                            .filter(s -> s.getCutOffMarks() != null)
                            .allMatch(s -> Boolean.TRUE.equals(s.getPassed()));
                    String passBg = overallPass ? "#E8F5E9" : "#FFEBEE";
                    String passColor = overallPass ? "#2E7D32" : "#C62828";
                    String passSymbol = overallPass ? SYM_CORRECT : SYM_INCORRECT;
                    String passText = overallPass ? "PASSED" : "FAILED";
                    html.append("<div style=\"text-align: center; padding: 8px; background-color: ").append(passBg)
                            .append("; border-radius: 6px; margin-top: 8px;\"><span style=\"font-size: 14px; font-weight: 700; color: ")
                            .append(passColor).append(";\">").append(passSymbol).append(" ").append(passText).append("</span></div>");
                }
            }
            html.append("</div>");
        }

        // ===== PERCENTILE BAND VISUAL =====
        if (detail != null && detail.getPercentile() != null) {
            double pctl = detail.getPercentile();
            int quartile; // 0=0-25, 1=25-50, 2=50-75, 3=75-100
            if (pctl >= 75) quartile = 3;
            else if (pctl >= 50) quartile = 2;
            else if (pctl >= 25) quartile = 1;
            else quartile = 0;
            String[] bandColors = {"#FFEBEE", "#FFF8E1", "#E3F2FD", "#E8F5E9"};
            String[] bandBorders = {"#C62828", "#F57F17", "#1565C0", "#2E7D32"};
            String[] bandLabels = {"Bottom 25%", "Below Avg", "Above Avg", "Top 25%"};

            html.append("<div class=\"section\">");
            html.append("<div class=\"section-title\">").append(SYM_PERCENTILE).append(" Your Percentile Position</div>");
            // Band bar
            html.append("<table style=\"width: 100%; border-collapse: collapse;\">");
            // Marker row
            html.append("<tr>");
            for (int q = 0; q < 4; q++) {
                html.append("<td style=\"width: 25%; text-align: center; padding: 2px; font-size: 11px; font-weight: 700; color: ").append(bandBorders[q]).append(";\">");
                if (q == quartile) {
                    html.append(SYM_ARROW_DOWN).append(" ").append(formatNumber(pctl)).append("%");
                }
                html.append("</td>");
            }
            html.append("</tr>");
            // Color band row
            html.append("<tr>");
            for (int q = 0; q < 4; q++) {
                String border = q == quartile ? "border: 2px solid " + bandBorders[q] + ";" : "";
                html.append("<td style=\"width: 25%; height: 18px; background-color: ").append(bandColors[q]).append("; ").append(border).append("\"></td>");
            }
            html.append("</tr>");
            // Label row
            html.append("<tr>");
            for (int q = 0; q < 4; q++) {
                html.append("<td style=\"text-align: center; font-size: 9px; color: #888; padding-top: 4px;\">").append(bandLabels[q]).append("</td>");
            }
            html.append("</tr></table></div>");
        }

        // ===== COMPARISON WITH BATCH (horizontal table with bar simulation) =====
        if (comparison != null) {
            Double studentMarks = safeDouble(comparison.getStudentMarks());
            Double totalMarks = safeDouble(comparison.getTotalMarks());
            Double avgMarks = safeDouble(comparison.getAverageMarks());
            double marksBarPct = totalMarks > 0 ? (studentMarks / totalMarks) * 100 : 0;

            // B: Check if time data is available (null or 0 means manual entry)
            boolean hasTimeData = comparison.getStudentDuration() != null && comparison.getStudentDuration() > 0;
            Long studentDur = hasTimeData ? comparison.getStudentDuration() : 0L;
            Double avgDur = safeDouble(comparison.getAverageDuration());
            double maxDur = Math.max(studentDur, avgDur) > 0 ? Math.max(studentDur, avgDur) * 1.2 : 1;
            double timeBarPct = hasTimeData ? (studentDur / maxDur) * 100 : 0;

            Double studentAcc = safeDouble(comparison.getStudentAccuracy());
            Double classAcc = safeDouble(comparison.getClassAccuracy());

            html.append("<div class=\"section\">");
            html.append("<div class=\"section-title\">").append(SYM_TARGET).append(" Your Performance vs Batch</div>");
            html.append("<table class=\"layout-table\"><tr>");

            // Marks comparison
            html.append("<td width=\"33%\"><div class=\"score-card\">");
            html.append("<div class=\"comp-label\">Marks (You vs Class Avg)</div>");
            appendBarHtml(html, marksBarPct, primaryColor);
            html.append("<table style=\"width:100%; font-size: 11px; margin-top: 4px;\"><tr>");
            html.append("<td style=\"color: ").append(primaryColor).append("; font-weight: 700;\">You: ").append(formatNumber(studentMarks)).append("/").append(formatNumber(totalMarks)).append("</td>");
            html.append("<td style=\"color: #888; text-align: right;\">Avg: ").append(formatNumber(avgMarks)).append("</td>");
            html.append("</tr></table></div></td>");

            // Time comparison (only show if time data exists)
            if (hasTimeData) {
                html.append("<td width=\"33%\"><div class=\"score-card\">");
                html.append("<div class=\"comp-label\">Time Taken (You vs Class Avg)</div>");
                appendBarHtml(html, timeBarPct, "#0984E3");
                html.append("<table style=\"width:100%; font-size: 11px; margin-top: 4px;\"><tr>");
                html.append("<td style=\"color: ").append(primaryColor).append("; font-weight: 700;\">You: ").append(convertToReadableTime(studentDur)).append("</td>");
                html.append("<td style=\"color: #888; text-align: right;\">Avg: ").append(convertToReadableTime(avgDur.longValue())).append("</td>");
                html.append("</tr></table></div></td>");
            }

            // Accuracy comparison
            html.append("<td width=\"33%\"><div class=\"score-card\">");
            html.append("<div class=\"comp-label\">Accuracy (You vs Class Avg)</div>");
            appendBarHtml(html, studentAcc, "#00B894");
            html.append("<table style=\"width:100%; font-size: 11px; margin-top: 4px;\"><tr>");
            html.append("<td style=\"color: ").append(primaryColor).append("; font-weight: 700;\">You: ").append(formatNumber(studentAcc)).append("%</td>");
            html.append("<td style=\"color: #888; text-align: right;\">Avg: ").append(formatNumber(classAcc)).append("%</td>");
            html.append("</tr></table></div></td>");

            html.append("</tr></table>");
            // Summary stats
            html.append("<table style=\"margin-top: 12px; font-size: 12px; color: #555;\"><tr>");
            html.append("<td style=\"padding-right: 20px;\">").append(SYM_ARROW_UP).append(" <b>Highest:</b> ").append(formatNumber(safeDouble(comparison.getHighestMarks()))).append("/").append(formatNumber(totalMarks)).append("</td>");
            html.append("<td style=\"padding-right: 20px;\">").append(SYM_ARROW_DOWN).append(" <b>Lowest:</b> ").append(formatNumber(safeDouble(comparison.getLowestMarks()))).append("/").append(formatNumber(totalMarks)).append("</td>");
            html.append("<td>").append(SYM_STAT).append(" <b>Total Participants:</b> ").append(comparison.getTotalParticipants() != null ? comparison.getTotalParticipants() : 0).append("</td>");
            html.append("</tr></table></div>");
        }

        // ===== ATTEMPT SUMMARY (horizontal table) =====
        if (detail != null) {
            int correct = detail.getCorrectAttempt() != null ? detail.getCorrectAttempt() : 0;
            int wrong = detail.getWrongAttempt() != null ? detail.getWrongAttempt() : 0;
            int partial = detail.getPartialCorrectAttempt() != null ? detail.getPartialCorrectAttempt() : 0;
            int skipped = detail.getSkippedCount() != null ? detail.getSkippedCount() : 0;

            html.append("<div class=\"section\">");
            html.append("<div class=\"section-title\">").append(SYM_STAT).append(" Attempt Summary</div>");
            html.append("<table class=\"layout-table\"><tr>");

            html.append("<td width=\"25%\"><div class=\"stat-box stat-correct\">");
            html.append("<div class=\"stat-count\">").append(dot("#2E7D32")).append(SYM_CORRECT).append(" ").append(correct).append("</div>");
            html.append("<div class=\"stat-marks-text\">+").append(formatNumber(detail.getTotalCorrectMarks())).append(" marks</div>");
            html.append("<div class=\"stat-label-text\">CORRECT</div></div></td>");

            html.append("<td width=\"25%\"><div class=\"stat-box stat-wrong\">");
            html.append("<div class=\"stat-count\">").append(dot("#C62828")).append(SYM_INCORRECT).append(" ").append(wrong).append("</div>");
            html.append("<div class=\"stat-marks-text\">").append(formatNumber(detail.getTotalIncorrectMarks())).append(" marks</div>");
            html.append("<div class=\"stat-label-text\">WRONG</div></div></td>");

            html.append("<td width=\"25%\"><div class=\"stat-box stat-partial\">");
            html.append("<div class=\"stat-count\">").append(dot("#F57F17")).append(SYM_PARTIAL).append(" ").append(partial).append("</div>");
            html.append("<div class=\"stat-marks-text\">+").append(formatNumber(detail.getTotalPartialMarks())).append(" marks</div>");
            html.append("<div class=\"stat-label-text\">PARTIAL</div></div></td>");

            html.append("<td width=\"25%\"><div class=\"stat-box stat-skipped\">");
            html.append("<div class=\"stat-count\">").append(dot("#757575")).append(SYM_SKIPPED).append(" ").append(skipped).append("</div>");
            html.append("<div class=\"stat-marks-text\">0 marks</div>");
            html.append("<div class=\"stat-label-text\">SKIPPED</div></div></td>");

            html.append("</tr></table></div>");
        }

        // ===== TIME ANALYSIS PER QUESTION =====
        if (reportDetail != null && reportDetail.getAllSections() != null) {
            List<Long> qTimes = new ArrayList<>();
            List<String> qLabels = new ArrayList<>();
            List<String> qStatuses = new ArrayList<>();
            for (Map.Entry<String, List<StudentReportAnswerReviewDto>> entry : reportDetail.getAllSections().entrySet()) {
                for (StudentReportAnswerReviewDto review : entry.getValue()) {
                    qLabels.add("Q" + (review.getQuestionOrder() != null ? review.getQuestionOrder() : qTimes.size() + 1));
                    qTimes.add(review.getTimeTakenInSeconds() != null ? review.getTimeTakenInSeconds() : 0L);
                    qStatuses.add(review.getAnswerStatus());
                }
            }
            boolean hasAnyTime = qTimes.stream().anyMatch(t -> t > 0);
            if (hasAnyTime && !qTimes.isEmpty()) {
                long maxTime = qTimes.stream().mapToLong(Long::longValue).max().orElse(1);
                if (maxTime == 0) maxTime = 1;
                long avgTime = (long) qTimes.stream().mapToLong(Long::longValue).average().orElse(0);

                html.append("<div class=\"section\">");
                html.append("<div class=\"section-title\">").append(SYM_TIME).append(" Time per Question</div>");
                html.append("<table class=\"dist-table\">");
                // Time label row
                html.append("<tr>");
                for (int qi = 0; qi < qTimes.size(); qi++) {
                    long t = qTimes.get(qi);
                    html.append("<td style=\"font-size: 8px; color: #888;\">").append(t > 0 ? t + "s" : "").append("</td>");
                }
                html.append("</tr>");
                // Bar row
                html.append("<tr>");
                for (int qi = 0; qi < qTimes.size(); qi++) {
                    int heightPx = (int) Math.max((qTimes.get(qi) * 70) / maxTime, 2);
                    String barColor = getStatusColor(qStatuses.get(qi));
                    html.append("<td style=\"vertical-align: bottom; height: 80px;\">");
                    html.append("<div style=\"width: 80%; margin: 0 auto; height: ").append(heightPx)
                            .append("px; background-color: ").append(barColor).append("; border-radius: 3px 3px 0 0;\"></div>");
                    html.append("</td>");
                }
                html.append("</tr>");
                // Label row
                html.append("<tr>");
                for (int qi = 0; qi < qLabels.size(); qi++) {
                    html.append("<td style=\"font-size: 8px; color: #555; border-top: 1px solid #eee; padding-top: 2px;\">").append(qLabels.get(qi)).append("</td>");
                }
                html.append("</tr></table>");
                // Legend + avg
                html.append("<p style=\"text-align: center; font-size: 10px; color: #888; margin-top: 6px;\">")
                        .append(SYM_TARGET).append(" Avg: ").append(convertToReadableTime(avgTime))
                        .append(" | ").append(dot("#2E7D32")).append("Correct ").append(dot("#C62828")).append("Wrong ")
                        .append(dot("#F57F17")).append("Partial ").append(dot("#BDBDBD")).append("Skipped</p>");
                html.append("</div>");
            }
        }

        // ===== SECTION-WISE PERFORMANCE =====
        if (comparison != null && comparison.getSectionWiseComparison() != null && !comparison.getSectionWiseComparison().isEmpty()) {
            html.append("<div class=\"section\">");
            html.append("<div class=\"section-title\">").append(SYM_SECTION).append(" Section-Wise Performance</div>");
            html.append("<table class=\"perf-table\"><thead><tr>");
            html.append("<th>Section</th><th>Your Marks</th><th>Total</th><th>Class Avg</th><th>Accuracy</th><th>Cut-off</th><th>Status</th>");
            html.append("</tr></thead><tbody>");

            int secRowIdx = 0;
            for (SectionComparisonDto sec : comparison.getSectionWiseComparison()) {
                String rowBg = (secRowIdx % 2 == 1) ? " style=\"background-color: #fafbfc;\"" : "";
                html.append("<tr").append(rowBg).append(">");
                html.append("<td><b>").append(escapeHtml(sec.getSectionName())).append("</b></td>");
                html.append("<td><b>").append(formatNumber(sec.getStudentMarks())).append("</b></td>");
                html.append("<td>").append(formatNumber(sec.getSectionTotalMarks())).append("</td>");
                html.append("<td>").append(formatNumber(sec.getSectionAverageMarks())).append("</td>");
                html.append("<td>").append(formatNumber(sec.getStudentAccuracy())).append("%</td>");
                html.append("<td>").append(sec.getCutOffMarks() != null ? formatNumber(sec.getCutOffMarks()) : "-").append("</td>");
                html.append("<td>");
                if (sec.getCutOffMarks() != null) {
                    html.append(Boolean.TRUE.equals(sec.getPassed())
                            ? "<span class=\"badge-pass\">" + SYM_CORRECT + " PASS</span>"
                            : "<span class=\"badge-fail\">" + SYM_INCORRECT + " FAIL</span>");
                } else {
                    html.append("-");
                }
                html.append("</td></tr>");
                secRowIdx++;
            }
            html.append("</tbody></table></div>");
        }

        // ===== STRENGTH / WEAKNESS SUMMARY =====
        if (comparison != null && comparison.getSectionWiseComparison() != null && comparison.getSectionWiseComparison().size() >= 2) {
            List<SectionComparisonDto> strengths = new ArrayList<>();
            List<SectionComparisonDto> weaknesses = new ArrayList<>();
            for (SectionComparisonDto sec : comparison.getSectionWiseComparison()) {
                if (sec.getStudentAccuracy() != null && sec.getClassAccuracy() != null) {
                    if (sec.getStudentAccuracy() >= sec.getClassAccuracy()) {
                        strengths.add(sec);
                    } else {
                        weaknesses.add(sec);
                    }
                }
            }
            if (!strengths.isEmpty() || !weaknesses.isEmpty()) {
                html.append("<div class=\"section\">");
                html.append("<div class=\"section-title\">").append(SYM_TARGET).append(" Strength &amp; Weakness Analysis</div>");
                html.append("<table class=\"layout-table\"><tr>");
                // Strengths column
                html.append("<td width=\"50%\"><div style=\"border-left: 4px solid #2E7D32; padding: 10px 14px; background-color: #f8fdf9; border-radius: 0 6px 6px 0;\">");
                html.append("<div style=\"font-size: 13px; font-weight: 700; color: #2E7D32; margin-bottom: 8px;\">").append(SYM_ARROW_UP).append(" Strengths</div>");
                if (strengths.isEmpty()) {
                    html.append("<div style=\"font-size: 12px; color: #888;\">-</div>");
                } else {
                    for (SectionComparisonDto s : strengths) {
                        html.append("<div style=\"padding: 3px 0; font-size: 12px;\"><b>").append(escapeHtml(s.getSectionName()))
                                .append("</b> ").append(dot("#2E7D32")).append(" ").append(formatNumber(s.getStudentAccuracy()))
                                .append("% <span style=\"color: #888;\">(class avg: ").append(formatNumber(s.getClassAccuracy())).append("%)</span></div>");
                    }
                }
                html.append("</div></td>");
                // Weaknesses column
                html.append("<td width=\"50%\"><div style=\"border-left: 4px solid #C62828; padding: 10px 14px; background-color: #fef8f8; border-radius: 0 6px 6px 0;\">");
                html.append("<div style=\"font-size: 13px; font-weight: 700; color: #C62828; margin-bottom: 8px;\">").append(SYM_ARROW_DOWN).append(" Areas to Improve</div>");
                if (weaknesses.isEmpty()) {
                    html.append("<div style=\"font-size: 12px; color: #888;\">-</div>");
                } else {
                    for (SectionComparisonDto w : weaknesses) {
                        html.append("<div style=\"padding: 3px 0; font-size: 12px;\"><b>").append(escapeHtml(w.getSectionName()))
                                .append("</b> ").append(dot("#C62828")).append(" ").append(formatNumber(w.getStudentAccuracy()))
                                .append("% <span style=\"color: #888;\">(class avg: ").append(formatNumber(w.getClassAccuracy())).append("%)</span></div>");
                    }
                }
                html.append("</div></td>");
                html.append("</tr></table></div>");
            }
        }

        // ===== MARKS DISTRIBUTION (table-based bar chart) =====
        if (comparison != null && comparison.getMarksDistribution() != null && !comparison.getMarksDistribution().isEmpty()) {
            double maxMark = comparison.getMarksDistribution().stream()
                    .mapToDouble(d -> d.getMarks() != null ? d.getMarks() : 0).max().orElse(100);
            int bucketSize = 10;
            int numBuckets = Math.max((int) Math.ceil((maxMark + 1) / bucketSize), 1);
            int[] bucketCounts = new int[numBuckets];

            Double studentMarksVal = comparison.getStudentMarks();
            int studentBucketIdx = studentMarksVal != null ? (int) (studentMarksVal / bucketSize) : -1;
            if (studentBucketIdx >= numBuckets) studentBucketIdx = numBuckets - 1;

            for (var d : comparison.getMarksDistribution()) {
                double m = d.getMarks() != null ? d.getMarks() : 0;
                int idx = Math.min((int) (m / bucketSize), numBuckets - 1);
                int count = d.getNoOfParticipants() != null ? d.getNoOfParticipants() : 1;
                bucketCounts[idx] += count;
            }

            int maxCount = Arrays.stream(bucketCounts).max().orElse(1);
            if (maxCount == 0) maxCount = 1;

            html.append("<div class=\"section\">");
            html.append("<div class=\"section-title\">").append(SYM_STAT).append(" Marks Distribution</div>");
            // Calculate average bucket for coloring
            Double avgMarksForDist = safeDouble(comparison.getAverageMarks());
            int avgBucketIdx = avgMarksForDist > 0 ? Math.min((int) (avgMarksForDist / bucketSize), numBuckets - 1) : -1;

            // Bar chart using a table: row 1 = counts, row 2 = bars, row 3 = labels
            html.append("<table class=\"dist-table\">");
            // Count row
            html.append("<tr>");
            for (int i = 0; i < numBuckets; i++) {
                String annotation = (i == avgBucketIdx) ? SYM_TARGET : "";
                html.append("<td style=\"font-size: 10px; color: #555;\">").append(bucketCounts[i]).append(annotation).append("</td>");
            }
            html.append("</tr>");
            // Bar row
            html.append("<tr>");
            for (int i = 0; i < numBuckets; i++) {
                int heightPx = Math.max((bucketCounts[i] * 80) / maxCount, 3);
                boolean isStudent = (i == studentBucketIdx);
                boolean isAboveAvg = avgBucketIdx >= 0 && i >= avgBucketIdx;
                String barColor;
                if (isStudent) barColor = primaryColor;
                else if (isAboveAvg) barColor = "#E8E0FC"; // lighter secondary (above-average zone)
                else barColor = "#dfe6e9";
                html.append("<td style=\"vertical-align: bottom; height: 90px;\">");
                html.append("<div style=\"width: 80%; margin: 0 auto; height: ").append(heightPx)
                        .append("px; background-color: ").append(barColor).append("; border-radius: 4px 4px 0 0;\"></div>");
                html.append("</td>");
            }
            html.append("</tr>");
            // Label row
            html.append("<tr>");
            for (int i = 0; i < numBuckets; i++) {
                boolean isStudent = (i == studentBucketIdx);
                html.append("<td style=\"font-size: 9px; color: ").append(isStudent ? primaryColor + "; font-weight: bold;" : "#888;").append("; border-top: 1px solid #eee; padding-top: 2px;\">");
                html.append(i * bucketSize).append("-").append((i + 1) * bucketSize - 1);
                if (isStudent) html.append(" " + SYM_ARROW_DOWN);
                html.append("</td>");
            }
            html.append("</tr></table>");
            html.append("<p style=\"text-align: center; font-size: 10px; color: #888; margin-top: 6px;\">")
                    .append(SYM_ARROW_DOWN).append(" = Your score | ").append(SYM_TARGET).append(" = Class average | Total: ")
                    .append(comparison.getTotalParticipants() != null ? comparison.getTotalParticipants() : 0)
                    .append(" students</p></div>");
        }

        // ===== SMART LEADERBOARD =====
        if (comparison != null && comparison.getLeaderboard() != null) {
            SmartLeaderboardDto lb = comparison.getLeaderboard();
            // Check if any entry has non-zero time to decide whether to show Time column
            boolean hasTimeData = false;
            if (lb.getTopRanks() != null) {
                hasTimeData = lb.getTopRanks().stream().anyMatch(e -> e.getCompletionTimeInSeconds() != null && e.getCompletionTimeInSeconds() > 0);
            }
            if (!hasTimeData && lb.getSurroundingRanks() != null) {
                hasTimeData = lb.getSurroundingRanks().stream().anyMatch(e -> e.getCompletionTimeInSeconds() != null && e.getCompletionTimeInSeconds() > 0);
            }
            int colSpan = hasTimeData ? 5 : 4;

            html.append("<div class=\"section\">");
            html.append("<div class=\"section-title\">").append(SYM_TROPHY).append(" Leaderboard</div>");
            html.append("<table class=\"lb-table\"><thead><tr>");
            html.append("<th>Rank</th><th>Student</th><th>Marks</th>");
            if (hasTimeData) html.append("<th>Time</th>");
            html.append("<th>Percentile</th>");
            html.append("</tr></thead><tbody>");

            if (lb.getTopRanks() != null) {
                for (LeaderBoardDto entry : lb.getTopRanks()) {
                    appendLeaderboardRow(html, entry, detail != null ? detail.getUserId() : null, comparison.getTotalMarks(), hasTimeData, primaryColor);
                }
            }
            if (lb.isHasGap()) {
                html.append("<tr><td colspan=\"").append(colSpan).append("\" style=\"text-align: center; padding: 4px; color: #bbb; font-size: 16px;\">...</td></tr>");
            }
            if (lb.getSurroundingRanks() != null) {
                for (LeaderBoardDto entry : lb.getSurroundingRanks()) {
                    appendLeaderboardRow(html, entry, detail != null ? detail.getUserId() : null, comparison.getTotalMarks(), hasTimeData, primaryColor);
                }
            }
            html.append("</tbody></table>");
            html.append("<p style=\"text-align: center; margin-top: 6px; font-size: 11px; color: #888;\">Your rank: #")
                    .append(lb.getStudentRank() != null ? lb.getStudentRank() : "-")
                    .append(" of ").append(lb.getTotalParticipants() != null ? lb.getTotalParticipants() : 0)
                    .append(" students</p></div>");
        }

        // ===== ANSWER REVIEW =====
        if (reportDetail != null && reportDetail.getAllSections() != null) {
            // Question Progress Strip (all questions at a glance)
            html.append("<div class=\"section\">");
            html.append("<div class=\"section-title\">").append(SYM_SECTION).append(" Answer Review</div>");
            html.append("<table style=\"border-collapse: separate; border-spacing: 3px;\"><tr>");
            for (Map.Entry<String, List<StudentReportAnswerReviewDto>> stripEntry : reportDetail.getAllSections().entrySet()) {
                for (StudentReportAnswerReviewDto r : stripEntry.getValue()) {
                    String sColor = getStatusColor(r.getAnswerStatus());
                    html.append("<td style=\"width: 12px; height: 12px; background-color: ").append(sColor)
                            .append("; border-radius: 2px;\" title=\"Q").append(r.getQuestionOrder() != null ? r.getQuestionOrder() : "").append("\"></td>");
                }
            }
            html.append("</tr></table>");
            html.append("<p style=\"font-size: 10px; color: #888; margin-top: 4px;\">")
                    .append(dot("#2E7D32")).append(SYM_CORRECT).append(" Correct  ")
                    .append(dot("#C62828")).append(SYM_INCORRECT).append(" Wrong  ")
                    .append(dot("#F57F17")).append(SYM_PARTIAL).append(" Partial  ")
                    .append(dot("#BDBDBD")).append(SYM_SKIPPED).append(" Skipped</p>");
            html.append("</div>");

            for (Map.Entry<String, List<StudentReportAnswerReviewDto>> entry : reportDetail.getAllSections().entrySet()) {
                String sectionId = entry.getKey();
                Optional<Section> sectionOpt = sectionRepository.findById(sectionId);
                String sectionName = sectionOpt.map(Section::getName).orElse("Section");

                html.append("<div class=\"section\">");
                html.append("<div class=\"section-title\">").append(SYM_SECTION).append(" ").append(escapeHtml(sectionName)).append("</div>");

                for (StudentReportAnswerReviewDto review : entry.getValue()) {
                    String statusColor = getStatusColor(review.getAnswerStatus());
                    html.append("<div class=\"question-card\" style=\"border-left: 4px solid ").append(statusColor).append(";\">");

                    // Header: question number + status badge
                    String status = review.getAnswerStatus();
                    String badgeClass = getStatusBadgeClass(status);
                    String statusLabel = getStatusLabelText(status);
                    html.append("<table style=\"width: 100%; margin-bottom: 8px;\"><tr>");
                    html.append("<td><b>Q").append(review.getQuestionOrder() != null ? review.getQuestionOrder() : "")
                            .append(". (").append(formatQuestionType(review.getQuestionType())).append(")</b></td>");
                    html.append("<td style=\"text-align: right;\"><span class=\"").append(badgeClass).append("\">").append(statusLabel).append("</span></td>");
                    html.append("</tr></table>");

                    // Question text (strip HTML/KaTeX for PDF)
                    html.append("<p style=\"font-size: 13px; color: #333; margin-bottom: 10px;\">")
                            .append(stripHtmlTags(review.getQuestionName())).append("</p>");

                    // Student answer
                    if (review.getStudentResponseOptions() != null
                            && "CODING".equals(review.getQuestionType())) {
                        appendCodingAnswerBlock(html, review.getStudentResponseOptions(),
                                review.getCorrectOptions(), status);
                    } else if (review.getStudentResponseOptions() != null) {
                        List<String> responses = extractResponseContent(review.getStudentResponseOptions(),
                                review.getCorrectOptions());
                        String answerColor = "CORRECT".equals(status) ? "#2E7D32" : ("INCORRECT".equals(status) ? "#C62828" : "#333");
                        html.append("<table style=\"font-size: 12px; margin-bottom: 4px;\"><tr>");
                        html.append("<td style=\"font-weight: 600; color: #555; width: 120px; vertical-align: top;\">Your Answer:</td>");
                        html.append("<td style=\"color: ").append(answerColor).append(";\">").append(stripHtmlTags(String.join(", ", responses))).append("</td>");
                        html.append("</tr></table>");
                    } else if (review.getMark() != 0) {
                        // C: Direct marks entry — no responseJson but marks were awarded
                        String marksColor = review.getMark() > 0 ? "#2E7D32" : "#C62828";
                        html.append("<table style=\"font-size: 12px; margin-bottom: 4px;\"><tr>");
                        html.append("<td style=\"font-weight: 600; color: #555; width: 120px;\">Your Answer:</td>");
                        html.append("<td style=\"color: ").append(marksColor).append(";\">Marks awarded directly (")
                                .append(formatNumber(review.getMark())).append(")</td></tr></table>");
                    } else if ("PENDING".equals(status) || status == null) {
                        html.append("<table style=\"font-size: 12px; margin-bottom: 4px;\"><tr>");
                        html.append("<td style=\"font-weight: 600; color: #555; width: 120px;\">Your Answer:</td>");
                        html.append("<td style=\"color: #999;\">Not Attempted</td></tr></table>");
                    }

                    // Correct answer (shown when wrong, partial, or skipped)
                    if (review.getCorrectOptions() != null && !"CORRECT".equals(status)) {
                        List<String> correctAnswers = extractContent(review.getCorrectOptions());
                        html.append("<table style=\"font-size: 12px; margin-bottom: 4px;\"><tr>");
                        html.append("<td style=\"font-weight: 600; color: #555; width: 120px; vertical-align: top;\">Correct Answer:</td>");
                        html.append("<td style=\"color: #2E7D32;\">").append(stripHtmlTags(String.join(", ", correctAnswers))).append("</td>");
                        html.append("</tr></table>");
                    }

                    // Option distribution (MCQ questions only)
                    String qType = review.getQuestionType();
                    if (optionDistribution != null && review.getQuestionId() != null
                            && optionDistribution.containsKey(review.getQuestionId())
                            && ("MCQS".equals(qType) || "MCQM".equals(qType) || "TRUE_FALSE".equals(qType))) {
                        Map<String, Double> dist = optionDistribution.get(review.getQuestionId());
                        // Get option texts from correct_options or look up from options
                        html.append("<div style=\"margin-top: 8px; padding: 8px 10px; background-color: #f8f9fc; font-size: 11px;\">");
                        html.append("<b style=\"color: #555;\">How others answered:</b>");
                        html.append("<table style=\"width: 100%; margin-top: 4px; border-collapse: collapse;\">");
                        for (Map.Entry<String, Double> optEntry : dist.entrySet()) {
                            String optId = optEntry.getKey();
                            Double pct = optEntry.getValue();
                            // Try to resolve option text
                            String optText = optId;
                            try {
                                Optional<Option> optOpt = optionRepository.findById(optId);
                                if (optOpt.isPresent() && optOpt.get().getText() != null) {
                                    optText = stripHtmlTags(optOpt.get().getText().getContent());
                                }
                            } catch (Exception ignored) {}
                            // Truncate long option text
                            if (optText.length() > 40) optText = optText.substring(0, 37) + "...";

                            int barWidth = (int) Math.min(pct, 100);
                            html.append("<tr><td style=\"padding: 2px 0; color: #555; width: 45%;\">").append(escapeHtml(optText)).append("</td>");
                            html.append("<td style=\"padding: 2px 4px; width: 40%;\">");
                            html.append("<table style=\"width: 100%; border-collapse: collapse;\"><tr>");
                            if (barWidth > 0) {
                                html.append("<td style=\"width: ").append(barWidth).append("%; height: 6px; background-color: #b0bec5;\"></td>");
                            }
                            if (barWidth < 100) {
                                html.append("<td style=\"width: ").append(100 - barWidth).append("%; height: 6px; background-color: #eceff1;\"></td>");
                            }
                            html.append("</tr></table></td>");
                            html.append("<td style=\"padding: 2px 0; color: #888; text-align: right; width: 15%;\">").append(String.format("%.1f", pct)).append("%</td></tr>");
                        }
                        html.append("</table></div>");
                    }

                    // Marks and time
                    String marksPrefix = "CORRECT".equals(status) || "PARTIAL_CORRECT".equals(status) ? "+" : "";
                    html.append("<p style=\"font-size: 11px; color: #888; margin-top: 8px;\">")
                            .append(marksPrefix).append(formatNumber(review.getMark())).append(" marks");
                    if (review.getTimeTakenInSeconds() != null && review.getTimeTakenInSeconds() > 0) {
                        html.append(" | ").append(SYM_TIME).append(" ").append(convertToReadableTime(review.getTimeTakenInSeconds()));
                    }
                    html.append("</p>");

                    // Explanation
                    if (review.getExplanation() != null && !review.getExplanation().isEmpty()) {
                        html.append("<div class=\"q-explanation\"><b>Explanation:</b> ")
                                .append(stripHtmlTags(review.getExplanation())).append("</div>");
                    }

                    html.append("</div>"); // question-card
                }
                html.append("</div>"); // section
            }
        }

        // ===== FOOTER =====
        html.append("<div style=\"border-top: 2px solid #eee; margin: 0 28px;\"></div>");
        String reportId = generateReportId();
        String generatedAt = LocalDateTime.now().format(DateTimeFormatter.ofPattern("dd MMM yyyy, HH:mm"));
        String footerHtml = branding.getFooterHtml();
        html.append("<div class=\"report-footer\">");
        html.append("<table style=\"width: 100%;\"><tr>");
        html.append("<td style=\"text-align: left;\">");
        if (footerHtml != null && !footerHtml.isEmpty()) {
            html.append(footerHtml.replace("{{assessment_name}}", escapeHtml(title)));
        } else {
            html.append(escapeHtml(footerText));
        }
        html.append("</td>");
        html.append("<td style=\"text-align: right; font-size: 9px; color: #bbb;\">Generated: ").append(generatedAt)
                .append(" | ID: ").append(reportId).append("</td>");
        html.append("</tr></table></div>");
        html.append("</div></body></html>");

        return html.toString();
    }

    /**
     * Renders a simple progress bar using a table (iText-compatible).
     */
    private void appendBarHtml(StringBuilder html, double percentage, String color) {
        int pct = (int) Math.max(Math.min(percentage, 100), 0);
        int remaining = 100 - pct;
        html.append("<table style=\"width: 100%; border-collapse: collapse;\"><tr>");
        if (pct > 0) {
            html.append("<td style=\"width: ").append(pct).append("%; height: 8px; background-color: ").append(color).append(";\"></td>");
        }
        if (remaining > 0) {
            html.append("<td style=\"width: ").append(remaining).append("%; height: 8px; background-color: #e9ecef;\"></td>");
        }
        html.append("</tr></table>");
    }

    private void appendLeaderboardRow(StringBuilder html, LeaderBoardDto entry, String currentUserId, Double totalMarks, boolean showTime, String primaryColor) {
        boolean isCurrent = currentUserId != null && currentUserId.equals(entry.getUserId());
        int rank = entry.getRank() != null ? entry.getRank() : 0;

        String rowStyle = isCurrent ? " class=\"current-student\" style=\"border-left: 4px solid " + primaryColor + ";\"" : "";
        html.append("<tr").append(rowStyle).append(">");
        // Rank with medal for top 3
        html.append("<td>");
        if (rank >= 1 && rank <= 3) {
            String[] medalColors = {"#FFD700", "#C0C0C0", "#CD7F32"};
            html.append("<span style=\"display: inline-block; width: 22px; height: 22px; border-radius: 11px; background-color: ")
                    .append(medalColors[rank - 1]).append("; color: #333; text-align: center; line-height: 22px; font-size: 11px; font-weight: 700;\">")
                    .append(rank).append("</span>");
        } else {
            html.append(rank);
        }
        html.append("</td>");
        html.append("<td>").append(isCurrent ? SYM_SECTION + " " : "").append(escapeHtml(entry.getStudentName()))
                .append(isCurrent ? " <b>(You)</b>" : "").append("</td>");
        html.append("<td><b>").append(formatNumber(entry.getAchievedMarks())).append("</b>")
                .append(totalMarks != null ? "/" + formatNumber(totalMarks) : "").append("</td>");
        if (showTime) {
            html.append("<td>").append(SYM_TIME).append(" ").append(convertToReadableTime(entry.getCompletionTimeInSeconds())).append("</td>");
        }
        html.append("<td>").append(formatNumber(entry.getPercentile())).append("%</td>");
        html.append("</tr>");
    }

    /**
     * Strips HTML/KaTeX/MathML markup to produce plain text safe for iText PDF.
     *
     * Strategy:
     * 1. Extract LaTeX from annotation tags (the authoritative math source).
     * 2. Replace each entire <span class="katex">...</span> block with its LaTeX.
     *    Uses tag-depth counting instead of regex to handle arbitrary nesting.
     * 3. Strip any remaining HTML tags.
     */
    public static String stripHtmlTags(String text) {
        if (text == null || text.isEmpty()) return "";

        // Step 0: Decode HTML entities FIRST so encoded KaTeX becomes real tags
        String decoded = text.replace("&lt;", "<").replace("&gt;", ">")
                .replace("&amp;", "&").replace("&quot;", "\"").replace("&nbsp;", " ");

        // Fast path: no HTML at all
        if (!decoded.contains("<")) return decoded.replaceAll("\\s+", " ").trim();

        // Step 1: Extract LaTeX from data-latex attribute (most reliable source)
        //         e.g. <span class="math-inline" data-latex="p x^{2}+q x">
        List<String> latexList = new ArrayList<>();
        java.util.regex.Pattern dataLatexPattern = java.util.regex.Pattern.compile(
                "data-latex=\"([^\"]*)\"");
        java.util.regex.Matcher dlMatcher = dataLatexPattern.matcher(decoded);
        while (dlMatcher.find()) {
            latexList.add(dlMatcher.group(1).trim());
        }

        // Fallback: extract from <annotation encoding="application/x-tex">
        if (latexList.isEmpty()) {
            java.util.regex.Pattern annotationPattern = java.util.regex.Pattern.compile(
                    "<annotation[^>]*encoding=\"application/x-tex\"[^>]*>([^<]*)</annotation>");
            java.util.regex.Matcher anMatcher = annotationPattern.matcher(decoded);
            while (anMatcher.find()) {
                latexList.add(anMatcher.group(1).trim());
            }
        }

        // Step 2: Replace <span class="math-inline" ...>...</span> blocks with LaTeX text.
        //         These are the outermost wrappers that contain all the KaTeX/MathML content.
        //         Uses tag-depth counting to find the matching </span>.
        StringBuilder out = new StringBuilder();
        int latexIdx = 0;
        int i = 0;
        int len = decoded.length();
        String mathInlineOpen = "<span class=\"math-inline\"";

        while (i < len) {
            int blockStart = decoded.indexOf(mathInlineOpen, i);

            // Also try <span class="katex" as a direct wrapper
            int katexStart = decoded.indexOf("<span class=\"katex\"", i);

            // Use whichever comes first
            int start;
            if (blockStart >= 0 && (katexStart < 0 || blockStart <= katexStart)) {
                start = blockStart;
            } else if (katexStart >= 0) {
                // Only use katex if it's NOT inside a math-inline (i.e., it's a top-level katex)
                start = katexStart;
            } else {
                // No more math blocks — append rest and break
                out.append(decoded, i, len);
                break;
            }

            // Append text before this block
            out.append(decoded, i, start);

            // Find matching </span> by counting span depth
            int tagEnd = decoded.indexOf('>', start);
            if (tagEnd < 0) { out.append(decoded, start, len); break; }

            int depth = 1;
            int pos = tagEnd + 1;
            while (pos < len && depth > 0) {
                int nextOpen = decoded.indexOf("<span", pos);
                int nextClose = decoded.indexOf("</span>", pos);

                if (nextClose < 0) { pos = len; break; }

                if (nextOpen >= 0 && nextOpen < nextClose) {
                    depth++;
                    int nEnd = decoded.indexOf('>', nextOpen);
                    pos = (nEnd >= 0) ? nEnd + 1 : len;
                } else {
                    depth--;
                    pos = nextClose + "</span>".length();
                }
            }

            // Replace entire block with readable LaTeX text
            if (latexIdx < latexList.size()) {
                out.append(" ").append(latexToPlainText(latexList.get(latexIdx))).append(" ");
                latexIdx++;
            }

            i = pos;
        }

        // Step 3: Strip any remaining HTML tags
        String result = out.toString().replaceAll("<[^>]+>", " ");

        // Final cleanup
        result = result.replaceAll("\\s+", " ").trim();
        return result;
    }

    /**
     * Converts LaTeX math notation to readable plain text with Unicode symbols.
     * e.g. x^{2} → x², \frac{3}{y} → 3/y, \sqrt{4} → √4
     */
    private static String latexToPlainText(String latex) {
        if (latex == null || latex.isEmpty()) return "";

        String r = latex;

        // \frac{a}{b} → a/b
        while (r.contains("\\frac{")) {
            int idx = r.indexOf("\\frac{");
            int numStart = idx + 6; // after \frac{
            int numEnd = findMatchingBrace(r, numStart - 1);
            if (numEnd < 0) break;
            String numerator = r.substring(numStart, numEnd);

            // Find denominator {b}
            int denStart = numEnd + 1; // should be '{'
            if (denStart >= r.length() || r.charAt(denStart) != '{') break;
            int denEnd = findMatchingBrace(r, denStart);
            if (denEnd < 0) break;
            String denominator = r.substring(denStart + 1, denEnd);

            r = r.substring(0, idx) + numerator + "/" + denominator + r.substring(denEnd + 1);
        }

        // \sqrt{x} → √(x)
        while (r.contains("\\sqrt{")) {
            int idx = r.indexOf("\\sqrt{");
            int contentStart = idx + 6;
            int contentEnd = findMatchingBrace(r, contentStart - 1);
            if (contentEnd < 0) break;
            String content = r.substring(contentStart, contentEnd);
            r = r.substring(0, idx) + "√(" + content + ")" + r.substring(contentEnd + 1);
        }

        // Superscripts: ^{2} → ² etc, ^{n} → ^n
        Map<String, String> superscripts = new LinkedHashMap<>();
        superscripts.put("0", "⁰"); superscripts.put("1", "¹"); superscripts.put("2", "²");
        superscripts.put("3", "³"); superscripts.put("4", "⁴"); superscripts.put("5", "⁵");
        superscripts.put("6", "⁶"); superscripts.put("7", "⁷"); superscripts.put("8", "⁸");
        superscripts.put("9", "⁹"); superscripts.put("n", "ⁿ"); superscripts.put("i", "ⁱ");

        while (r.contains("^{")) {
            int idx = r.indexOf("^{");
            int end = findMatchingBrace(r, idx + 1);
            if (end < 0) break;
            String exp = r.substring(idx + 2, end);
            // Try to convert each char to superscript Unicode
            StringBuilder sup = new StringBuilder();
            boolean allConverted = true;
            for (char c : exp.toCharArray()) {
                String s = superscripts.get(String.valueOf(c));
                if (s != null) {
                    sup.append(s);
                } else {
                    allConverted = false;
                    break;
                }
            }
            if (allConverted) {
                r = r.substring(0, idx) + sup.toString() + r.substring(end + 1);
            } else {
                r = r.substring(0, idx) + "^(" + exp + ")" + r.substring(end + 1);
            }
        }

        // Simple ^n (no braces) for single digit
        for (Map.Entry<String, String> e : superscripts.entrySet()) {
            r = r.replace("^" + e.getKey(), e.getValue());
        }

        // Subscripts: _{n} → _n
        while (r.contains("_{")) {
            int idx = r.indexOf("_{");
            int end = findMatchingBrace(r, idx + 1);
            if (end < 0) break;
            String sub = r.substring(idx + 2, end);
            r = r.substring(0, idx) + "₍" + sub + "₎" + r.substring(end + 1);
        }

        // Common LaTeX commands → symbols
        r = r.replace("\\times", "×").replace("\\div", "÷").replace("\\pm", "±");
        r = r.replace("\\leq", "≤").replace("\\geq", "≥").replace("\\neq", "≠");
        r = r.replace("\\infty", "∞").replace("\\pi", "π").replace("\\theta", "θ");
        r = r.replace("\\alpha", "α").replace("\\beta", "β").replace("\\gamma", "γ");
        r = r.replace("\\delta", "δ").replace("\\lambda", "λ").replace("\\mu", "μ");
        r = r.replace("\\sigma", "σ").replace("\\omega", "ω").replace("\\phi", "φ");
        r = r.replace("\\rightarrow", "→").replace("\\leftarrow", "←");
        r = r.replace("\\Rightarrow", "⇒").replace("\\Leftarrow", "⇐");
        r = r.replace("\\cdot", "·").replace("\\ldots", "…").replace("\\dots", "…");
        r = r.replace("\\sum", "Σ").replace("\\prod", "Π").replace("\\int", "∫");
        r = r.replace("\\log", "log").replace("\\ln", "ln").replace("\\sin", "sin");
        r = r.replace("\\cos", "cos").replace("\\tan", "tan");

        // Remove remaining \command sequences (e.g. \text{}, \mathrm{}, \left, \right)
        r = r.replaceAll("\\\\(text|mathrm|mathit|mathbf|left|right|Big|big)\\b", "");

        // Remove remaining braces that were just for grouping
        r = r.replace("{", "").replace("}", "");

        // Remove stray backslashes
        r = r.replaceAll("\\\\\\s", " ");
        r = r.replace("\\,", " ").replace("\\;", " ").replace("\\!", "");

        // Clean up whitespace
        r = r.replaceAll("\\s+", " ").trim();

        return r;
    }

    /**
     * Finds the index of the closing '}' that matches the '{' at position openIdx.
     */
    private static int findMatchingBrace(String s, int openIdx) {
        if (openIdx < 0 || openIdx >= s.length() || s.charAt(openIdx) != '{') return -1;
        int depth = 1;
        for (int i = openIdx + 1; i < s.length(); i++) {
            if (s.charAt(i) == '{') depth++;
            else if (s.charAt(i) == '}') { depth--; if (depth == 0) return i; }
        }
        return -1;
    }

    private static String escapeHtml(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static Double safeDouble(Double val) {
        return val != null ? val : 0.0;
    }

    private static String formatNumber(Double val) {
        if (val == null) return "0";
        if (val == Math.floor(val) && !Double.isInfinite(val)) {
            return String.valueOf((int) val.doubleValue());
        }
        return String.format("%.1f", val);
    }

    private static String formatNumber(double val) {
        return formatNumber(Double.valueOf(val));
    }

    /** Public so the v2 report builder ({@link StudentReportHtmlV2Builder}) labels question types identically. */
    public static String formatQuestionType(String type) {
        if (type == null) return "";
        switch (type) {
            case "MCQS": return "MCQ Single";
            case "MCQM": return "MCQ Multiple";
            case "TRUE_FALSE": return "True/False";
            case "NUMERIC": return "Numeric";
            case "ONE_WORD": return "One Word";
            case "LONG_ANSWER": return "Long Answer";
            case "CODING": return "Coding";
            case "CBE_RESPONSE": return "Spreadsheet & Written Response";
            default: return type;
        }
    }

    private static String getStatusBadgeClass(String status) {
        if (status == null) return "q-skipped-badge";
        switch (status) {
            case "CORRECT": return "q-correct-badge";
            case "INCORRECT": return "q-incorrect-badge";
            case "PARTIAL_CORRECT": return "q-partial-badge";
            default: return "q-skipped-badge";
        }
    }

    private static String getStatusLabelText(String status) {
        if (status == null) return SYM_SKIPPED + " SKIPPED";
        switch (status) {
            case "CORRECT": return SYM_CORRECT + " CORRECT";
            case "INCORRECT": return SYM_INCORRECT + " INCORRECT";
            case "PARTIAL_CORRECT": return SYM_PARTIAL + " PARTIAL";
            case "PENDING": return SYM_SKIPPED + " PENDING";
            default: return SYM_SKIPPED + " SKIPPED";
        }
    }

    private static String getStatusColor(String status) {
        if (status == null) return "#BDBDBD";
        switch (status) {
            case "CORRECT": return "#2E7D32";
            case "INCORRECT": return "#C62828";
            case "PARTIAL_CORRECT": return "#F57F17";
            default: return "#BDBDBD";
        }
    }

    private static String calculateGrade(Double percentile) {
        if (percentile == null) return "-";
        if (percentile >= 95) return "A+";
        if (percentile >= 85) return "A";
        if (percentile >= 75) return "B+";
        if (percentile >= 65) return "B";
        if (percentile >= 55) return "C+";
        if (percentile >= 45) return "C";
        if (percentile >= 35) return "D";
        return "F";
    }

    private static String gradeColor(String grade) {
        if (grade == null) return "#333";
        switch (grade) {
            case "A+": case "A": return "#2E7D32";
            case "B+": case "B": return "#1565C0";
            case "C+": case "C": return "#F57F17";
            case "D": return "#E65100";
            default: return "#C62828";
        }
    }

    private static String generateReportId() {
        return "RPT-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    }

    /** Renders an icon as a small CSS colored dot + Unicode symbol for PDF compatibility */
    private static String icon(String symbol, String color) {
        return "<span style=\"color: " + color + "; font-size: 14px;\">" + symbol + "</span>";
    }

    /** Renders a small CSS colored dot (fallback when Unicode may not render) */
    private static String dot(String color) {
        return "<span style=\"display: inline-block; width: 8px; height: 8px; border-radius: 4px; background-color: " + color + "; margin-right: 4px;\"></span>";
    }

    public List<String> extractContent(String jsonString) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(jsonString);
            String type = root.get("type").asText();

            switch (type) {
                case "ONE_WORD":
                    return List.of(root.path("data").path("answer").asText());

                case "NUMERIC":
                    JsonNode nums = root.path("data").path("validAnswers");
                    if (nums.isArray() && !nums.isEmpty())
                        return List.of(nums.get(0).asText());
                    else
                        return new ArrayList<>();

                case "LONG_ANSWER":
                    return List.of(root.path("data").path("answer").path("content").asText());

                case "MCQS":
                case "TRUE_FALSE":
                case "MCQM":
                    JsonNode correctOptionIds = root.path("data").path("correctOptionIds");
                    if (correctOptionIds.isArray()) {
                        List<String> contents = new ArrayList<>();
                        for (JsonNode idNode : correctOptionIds) {
                            String id = idNode.asText();
                            Optional<Option> optionalOption = optionRepository.findById(id);
                            optionalOption.ifPresent(option -> contents.add(
                                    stripHtmlTags(option.getText().getContent())));
                        }
                        return contents;
                    } else
                        return new ArrayList<>();

                case "CODING":
                    // No single "correct answer" — the rubric is the test-case set. Surface a summary.
                    JsonNode tcs = root.path("data").path("testCases");
                    int total = tcs.isArray() ? tcs.size() : 0;
                    int hidden = 0;
                    if (tcs.isArray()) {
                        for (JsonNode tc : tcs) {
                            if (!tc.path("visible").asBoolean(true)) hidden++;
                        }
                    }
                    int visible = total - hidden;
                    return List.of(visible + " visible + " + hidden + " hidden test case(s)");

                case "CBE_RESPONSE": {
                    // Never the solution itself (this JSON may be the learner-safe redaction):
                    // what the answer is marked against, part by part.
                    String parts = CbeAnswers.configSummary(jsonString);
                    return List.of("Marked against the model solution"
                            + (parts.isEmpty() ? "" : " — " + parts));
                }

                default:
                    throw new VacademyException("Unsupported Type");
            }

        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    public List<String> extractResponseContent(String jsonString) {
        return extractResponseContent(jsonString, null);
    }

    /**
     * @param evaluationJson the question's auto_evaluation_json (may be redacted or null);
     *                       a CBE answer uses it for part labels and templates.
     */
    public List<String> extractResponseContent(String jsonString, String evaluationJson) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(jsonString);
            JsonNode responseData = root.path("responseData");
            String type = responseData.path("type").asText();

            switch (type) {
                case "MCQS":
                case "MCQM":
                case "TRUE_FALSE":
                    JsonNode optionIds = responseData.path("optionIds");
                    if (optionIds.isArray()) {
                        List<String> optionContents = new ArrayList<>();
                        for (JsonNode idNode : optionIds) {
                            String id = idNode.asText();
                            Optional<Option> optionalOption = optionRepository.findById(id);
                            optionalOption.ifPresent(option -> optionContents.add(
                                    stripHtmlTags(option.getText().getContent())));
                        }
                        return optionContents;
                    } else
                        return new ArrayList<>();

                case "LONG_ANSWER", "ONE_WORD":
                    return List.of(stripHtmlTags(responseData.path("answer").asText()));

                case "NUMERIC":
                    return List.of(stripHtmlTags(responseData.path("validAnswer").asText()));

                case "CODING": {
                    String language = responseData.path("language").asText("");
                    String verdict = responseData.path("verdict").asText("");
                    double score = responseData.path("score").asDouble(0.0);
                    // Show the graded (hidden, else sample) test-case count.
                    int hTotal = 0, hPassed = 0, sTotal = 0, sPassed = 0;
                    JsonNode results = responseData.path("testCaseResults");
                    if (results.isArray()) {
                        for (JsonNode tc : results) {
                            boolean visible = tc.path("visible").asBoolean(true);
                            boolean testPassed = tc.path("passed").asBoolean(false);
                            if (visible) { sTotal++; if (testPassed) sPassed++; }
                            else { hTotal++; if (testPassed) hPassed++; }
                        }
                    }
                    int gPassed = hTotal > 0 ? hPassed : sPassed;
                    int gTotal = hTotal > 0 ? hTotal : sTotal;
                    if (gTotal == 0) {
                        gPassed = responseData.path("passedCount").asInt(0);
                        gTotal = responseData.path("totalCount").asInt(0);
                    }
                    String summary = (language.isEmpty() ? "" : language + " | ")
                            + (verdict.isEmpty() ? "" : verdict + " | ")
                            + gPassed + "/" + gTotal + " tests"
                            + " | score " + String.format(java.util.Locale.US, "%.2f", score);
                    String source = responseData.path("sourceCode").asText("");
                    if (source.isEmpty()) return List.of(summary);
                    String truncated = source.length() > 500 ? source.substring(0, 500) + "..." : source;
                    return List.of(summary, truncated);
                }

                case "CBE_RESPONSE": {
                    // A short readable summary per part, never the raw sheet JSON.
                    String summary = CbeAnswers.summaryFromResponseJson(jsonString, evaluationJson);
                    if (summary.isBlank()) return List.of("Not answered");
                    return List.of(summary.split("\n"));
                }

                default:
                    throw new VacademyException("Invalid Question Type");
            }

        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    /**
     * Render a CODING question's "Your Answer" block: a one-line summary
     * (language / verdict / tests / score) followed by the submitted source
     * code in a gray monospace pre block. Falls back gracefully if the JSON
     * is missing fields.
     *
     * <p>Public so the v2 report builder ({@link StudentReportHtmlV2Builder})
     * renders coding submissions exactly the same way — this block is the only
     * place a learner sees their submitted source in the PDF.
     */
    public void appendCodingAnswerBlock(StringBuilder html, String responseJson, String correctOptionsJson, String status) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(responseJson);
            JsonNode responseData = root.path("responseData");

            String language = responseData.path("language").asText("");
            String verdict = responseData.path("verdict").asText("");
            int passed = responseData.path("passedCount").asInt(0);
            int totalCount = responseData.path("totalCount").asInt(0);
            double score = responseData.path("score").asDouble(0.0);
            String source = responseData.path("sourceCode").asText("");
            long totalTimeMs = responseData.path("totalTimeMs").asLong(0);
            long peakMemoryKb = responseData.path("peakMemoryKb").asLong(0);

            // Grading is based on the HIDDEN test cases (samples when no hidden
            // exist). Compute the breakdown from the per-test results so the count
            // is consistent with the UI regardless of when the attempt was scored.
            int hiddenTotal = 0, hiddenPassed = 0, sampleTotal = 0, samplePassed = 0;
            JsonNode testCaseResults = responseData.path("testCaseResults");
            if (testCaseResults.isArray()) {
                for (JsonNode tc : testCaseResults) {
                    boolean visible = tc.path("visible").asBoolean(true);
                    boolean testPassed = tc.path("passed").asBoolean(false);
                    if (visible) {
                        sampleTotal++;
                        if (testPassed) samplePassed++;
                    } else {
                        hiddenTotal++;
                        if (testPassed) hiddenPassed++;
                    }
                }
            }
            boolean hasHidden = hiddenTotal > 0;
            int gradedPassed = hasHidden ? hiddenPassed : samplePassed;
            int gradedTotal = hasHidden ? hiddenTotal : sampleTotal;
            String gradedLabel = hasHidden ? "hidden" : "sample";
            // Legacy fallback: no per-test breakdown available, use stored counts.
            if (gradedTotal == 0 && totalCount > 0) {
                gradedPassed = passed;
                gradedTotal = totalCount;
                gradedLabel = "graded";
            }

            // Pull allowed limits from correct_options.data.perRunLimits so we
            // can render measured-vs-allowed alongside the runtime metrics.
            Long allowedTimeMs = null;
            Long allowedMemoryKb = null;
            if (correctOptionsJson != null && !correctOptionsJson.isEmpty()) {
                try {
                    JsonNode correct = mapper.readTree(correctOptionsJson);
                    JsonNode limits = correct.path("data").path("perRunLimits");
                    if (limits.has("cpuSeconds") && !limits.path("cpuSeconds").isNull()) {
                        allowedTimeMs = limits.path("cpuSeconds").asLong() * 1000L;
                    }
                    if (limits.has("memoryKb") && !limits.path("memoryKb").isNull()) {
                        allowedMemoryKb = limits.path("memoryKb").asLong();
                    }
                } catch (Exception ignored) {
                    // Limits unavailable — render measured values only.
                }
            }

            String summaryColor = "CORRECT".equals(status) ? "#2E7D32"
                    : ("INCORRECT".equals(status) ? "#C62828" : "#333");

            // Header row
            html.append("<table style=\"font-size: 12px; margin-bottom: 4px;\"><tr>");
            html.append("<td style=\"font-weight: 600; color: #555; width: 120px; vertical-align: top;\">Your Answer:</td>");
            html.append("<td style=\"color: ").append(summaryColor).append(";\">");
            if (!language.isEmpty()) html.append(escapeHtml(language)).append(" | ");
            if (!verdict.isEmpty()) html.append(escapeHtml(verdict)).append(" | ");
            html.append(gradedPassed).append("/").append(gradedTotal).append(" tests | score ")
                    .append(String.format(java.util.Locale.US, "%.2f", score));
            html.append("</td></tr></table>");

            // Test cases passed breakdown row (graded set = hidden, else samples).
            if (gradedTotal > 0) {
                html.append("<table style=\"font-size: 11px; margin-bottom: 4px; color: #555;\"><tr>");
                html.append("<td style=\"width: 120px;\"></td><td>");
                html.append("<b>Test cases passed:</b> ").append(gradedPassed).append("/").append(gradedTotal)
                        .append(" (").append(gradedLabel).append(")");
                if (hasHidden && sampleTotal > 0) {
                    html.append(" &nbsp; <b>Sample:</b> ").append(samplePassed).append("/").append(sampleTotal);
                }
                html.append("</td></tr></table>");
            }

            // Measured-vs-allowed runtime metrics row.
            boolean hasMeasured = totalTimeMs > 0 || peakMemoryKb > 0;
            boolean hasAllowed = allowedTimeMs != null || allowedMemoryKb != null;
            if (hasMeasured || hasAllowed) {
                html.append("<table style=\"font-size: 11px; margin-bottom: 4px; color: #555;\"><tr>");
                html.append("<td style=\"width: 120px;\"></td><td>");
                html.append("<b>Time taken:</b> ").append(totalTimeMs).append(" ms");
                if (allowedTimeMs != null) {
                    html.append(" / ").append(allowedTimeMs).append(" ms allowed");
                }
                html.append(" &nbsp; ");
                html.append("<b>Memory:</b> ").append(peakMemoryKb).append(" KB");
                if (allowedMemoryKb != null) {
                    html.append(" / ").append(allowedMemoryKb).append(" KB allowed");
                }
                html.append("</td></tr></table>");
            }

            // Source code block (gray rounded box, monospace)
            if (!source.isEmpty()) {
                String truncated = source.length() > 4000 ? source.substring(0, 4000) + "\n... (truncated)" : source;
                html.append("<div style=\"background-color: #f3f4f6; border: 1px solid #e5e7eb; ")
                        .append("border-radius: 6px; padding: 10px 12px; margin-top: 6px; ")
                        .append("font-family: 'Courier New', Courier, monospace; font-size: 11px; ")
                        .append("color: #1f2937; white-space: pre-wrap; word-break: break-word;\">")
                        .append("<pre style=\"margin: 0; padding: 0; font-family: inherit; font-size: inherit; white-space: pre-wrap;\">")
                        .append(escapeHtml(truncated))
                        .append("</pre></div>");
            }
        } catch (Exception e) {
            // Fall back to a simple "Could not render" line so the PDF doesn't blank out.
            html.append("<table style=\"font-size: 12px; margin-bottom: 4px;\"><tr>");
            html.append("<td style=\"font-weight: 600; color: #555; width: 120px;\">Your Answer:</td>");
            html.append("<td style=\"color: #999;\">Could not render coding response</td>");
            html.append("</tr></table>");
        }
    }

    /**
     * Generate comparison sections HTML fragment (Score Overview + Performance vs Batch + Leaderboard)
     * for reuse in both system report and AI report PDFs.
     * Returns the HTML as a string, including necessary CSS styles.
     */
    public String generateComparisonSectionsHtml(StudentComparisonDto comparison, ReportBrandingDto branding) {
        if (comparison == null) return "";
        StringBuilder html = new StringBuilder();
        String primaryColor = branding.getPrimaryColor() != null ? branding.getPrimaryColor() : "#FF6B35";
        String secondaryColor = branding.getSecondaryColor() != null ? branding.getSecondaryColor() : "#6C5CE7";

        // Score Overview (with Grade badge and icons — matching system report)
        Double marks = comparison.getStudentMarks();
        Double totalMarks = comparison.getTotalMarks() != null ? comparison.getTotalMarks() : 100.0;
        String grade = calculateGrade(comparison.getStudentPercentile());
        String gColor = gradeColor(grade);

        html.append("<div class=\"section\">");
        html.append("<div class=\"section-title\">").append(SYM_STAT).append(" Score Overview</div>");
        html.append("<table class=\"layout-table\"><tr>");
        // Grade
        html.append("<td width=\"20%\"><div class=\"score-card\">");
        html.append("<div style=\"width: 48px; height: 48px; border-radius: 24px; background-color: ").append(gColor)
                .append("; color: white; text-align: center; line-height: 48px; font-size: 20px; font-weight: 800; margin: 0 auto;\">")
                .append(grade).append("</div>");
        html.append("<div class=\"score-label\">Grade</div></div></td>");
        // Marks
        html.append("<td width=\"20%\"><div class=\"score-card\">");
        html.append("<div class=\"score-value\" style=\"color: ").append(primaryColor).append(";\">").append(formatNumber(marks)).append("/").append(formatNumber(totalMarks)).append("</div>");
        html.append("<div class=\"score-label\">Marks Obtained</div></div></td>");
        // Rank
        html.append("<td width=\"20%\"><div class=\"score-card\">");
        html.append("<div class=\"score-value\" style=\"color: ").append(secondaryColor).append(";\">").append(SYM_RANK).append(" #").append(comparison.getStudentRank() != null ? comparison.getStudentRank() : "-").append("</div>");
        html.append("<div class=\"score-label\">Rank</div></div></td>");
        // Percentile
        html.append("<td width=\"20%\"><div class=\"score-card\">");
        html.append("<div class=\"score-value\" style=\"color: #00B894;\">").append(SYM_PERCENTILE).append(" ").append(formatNumber(comparison.getStudentPercentile())).append("%</div>");
        html.append("<div class=\"score-label\">Percentile</div></div></td>");
        // Accuracy
        if (comparison.getStudentAccuracy() != null) {
            html.append("<td width=\"20%\"><div class=\"score-card\">");
            html.append("<div class=\"score-value\" style=\"color: #0984E3;\">").append(formatNumber(comparison.getStudentAccuracy())).append("%</div>");
            html.append("<div class=\"score-label\">Accuracy</div></div></td>");
        }
        html.append("</tr></table></div>");

        // Performance vs Batch
        Double studentMarks = safeDouble(comparison.getStudentMarks());
        Double avgMarks = safeDouble(comparison.getAverageMarks());
        double marksBarPct = totalMarks > 0 ? (studentMarks / totalMarks) * 100 : 0;
        boolean hasTimeData = comparison.getStudentDuration() != null && comparison.getStudentDuration() > 0;
        Double studentAcc = safeDouble(comparison.getStudentAccuracy());
        Double classAcc = safeDouble(comparison.getClassAccuracy());

        html.append("<div class=\"section\">");
        html.append("<div class=\"section-title\">").append(SYM_TARGET).append(" Your Performance vs Batch</div>");
        html.append("<table class=\"layout-table\"><tr>");

        html.append("<td width=\"33%\"><div class=\"score-card\">");
        html.append("<div class=\"comp-label\">Marks (You vs Class Avg)</div>");
        appendBarHtml(html, marksBarPct, primaryColor);
        html.append("<table style=\"width:100%; font-size: 11px; margin-top: 4px;\"><tr>");
        html.append("<td style=\"color: ").append(primaryColor).append("; font-weight: 700;\">You: ").append(formatNumber(studentMarks)).append("/").append(formatNumber(totalMarks)).append("</td>");
        html.append("<td style=\"color: #888; text-align: right;\">Avg: ").append(formatNumber(avgMarks)).append("</td>");
        html.append("</tr></table></div></td>");

        if (hasTimeData) {
            Long studentDur = comparison.getStudentDuration();
            Double avgDur = safeDouble(comparison.getAverageDuration());
            double maxDur = Math.max(studentDur, avgDur) > 0 ? Math.max(studentDur, avgDur) * 1.2 : 1;
            double timeBarPct = (studentDur / maxDur) * 100;
            html.append("<td width=\"33%\"><div class=\"score-card\">");
            html.append("<div class=\"comp-label\">Time Taken (You vs Class Avg)</div>");
            appendBarHtml(html, timeBarPct, "#0984E3");
            html.append("<table style=\"width:100%; font-size: 11px; margin-top: 4px;\"><tr>");
            html.append("<td style=\"color: ").append(primaryColor).append("; font-weight: 700;\">You: ").append(convertToReadableTime(studentDur)).append("</td>");
            html.append("<td style=\"color: #888; text-align: right;\">Avg: ").append(convertToReadableTime(avgDur.longValue())).append("</td>");
            html.append("</tr></table></div></td>");
        }

        html.append("<td width=\"33%\"><div class=\"score-card\">");
        html.append("<div class=\"comp-label\">Accuracy (You vs Class Avg)</div>");
        appendBarHtml(html, studentAcc, "#00B894");
        html.append("<table style=\"width:100%; font-size: 11px; margin-top: 4px;\"><tr>");
        html.append("<td style=\"color: ").append(primaryColor).append("; font-weight: 700;\">You: ").append(formatNumber(studentAcc)).append("%</td>");
        html.append("<td style=\"color: #888; text-align: right;\">Avg: ").append(formatNumber(classAcc)).append("%</td>");
        html.append("</tr></table></div></td>");

        html.append("</tr></table>");
        html.append("<table style=\"margin-top: 12px; font-size: 12px; color: #555;\"><tr>");
        html.append("<td style=\"padding-right: 20px;\">").append(SYM_ARROW_UP).append(" <b>Highest:</b> ").append(formatNumber(safeDouble(comparison.getHighestMarks()))).append("/").append(formatNumber(totalMarks)).append("</td>");
        html.append("<td style=\"padding-right: 20px;\">").append(SYM_ARROW_DOWN).append(" <b>Lowest:</b> ").append(formatNumber(safeDouble(comparison.getLowestMarks()))).append("/").append(formatNumber(totalMarks)).append("</td>");
        html.append("<td>").append(SYM_STAT).append(" <b>Total Participants:</b> ").append(comparison.getTotalParticipants() != null ? comparison.getTotalParticipants() : 0).append("</td>");
        html.append("</tr></table></div>");

        // Leaderboard
        if (comparison.getLeaderboard() != null) {
            SmartLeaderboardDto lb = comparison.getLeaderboard();
            boolean lbHasTime = false;
            if (lb.getTopRanks() != null) {
                lbHasTime = lb.getTopRanks().stream().anyMatch(e -> e.getCompletionTimeInSeconds() != null && e.getCompletionTimeInSeconds() > 0);
            }

            html.append("<div class=\"section\">");
            html.append("<div class=\"section-title\">Leaderboard (Your Position)</div>");
            // Find the current student's userId from leaderboard entries by matching rank
            String currentUserId = null;
            Integer studentRank = comparison.getStudentRank();
            if (studentRank != null && lb.getTopRanks() != null) {
                currentUserId = lb.getTopRanks().stream()
                        .filter(e -> studentRank.equals(e.getRank()))
                        .map(LeaderBoardDto::getUserId).findFirst().orElse(null);
            }
            if (currentUserId == null && studentRank != null && lb.getSurroundingRanks() != null) {
                currentUserId = lb.getSurroundingRanks().stream()
                        .filter(e -> studentRank.equals(e.getRank()))
                        .map(LeaderBoardDto::getUserId).findFirst().orElse(null);
            }
            final String resolvedUserId = currentUserId;
            html.append("<table class=\"lb-table\"><thead><tr>");
            html.append("<th>Rank</th><th>Student</th><th>Marks</th>");
            if (lbHasTime) html.append("<th>Time</th>");
            html.append("<th>Percentile</th></tr></thead><tbody>");

            if (lb.getTopRanks() != null) {
                for (LeaderBoardDto entry : lb.getTopRanks()) {
                    appendLeaderboardRow(html, entry, resolvedUserId, comparison.getTotalMarks(), lbHasTime, primaryColor);
                }
            }
            if (lb.isHasGap()) {
                int colspan = lbHasTime ? 5 : 4;
                html.append("<tr><td colspan=\"").append(colspan).append("\" style=\"text-align: center; color: #aaa;\">···</td></tr>");
            }
            if (lb.getSurroundingRanks() != null) {
                for (LeaderBoardDto entry : lb.getSurroundingRanks()) {
                    appendLeaderboardRow(html, entry, resolvedUserId, comparison.getTotalMarks(), lbHasTime, primaryColor);
                }
            }
            html.append("</tbody></table>");
            html.append("<p style=\"text-align: center; font-size: 11px; color: #888; margin-top: 10px;\">Your rank: <b style=\"color: ")
                    .append(secondaryColor).append(";\">#").append(comparison.getStudentRank() != null ? comparison.getStudentRank() : "-")
                    .append("</b> of ").append(comparison.getTotalParticipants() != null ? comparison.getTotalParticipants() : "-").append(" students</p>");
            html.append("</div>");
        }

        return html.toString();
    }
}
