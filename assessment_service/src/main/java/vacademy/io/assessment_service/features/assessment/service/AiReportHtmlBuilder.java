package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportBrandingDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentComparisonDto;

/**
 * Builds HTML for AI assessment report PDF generation.
 * Light theme with vibrant colors for a student-friendly look.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AiReportHtmlBuilder {

    private final ObjectMapper objectMapper;
    private final AiReportChartGenerator chartGenerator;
    private final ReportBrandingHelper brandingHelper;
    private final HtmlBuilderService htmlBuilderService;

    // ── Vibrant colors ──
    private static final String GREEN = "#00d68f";
    private static final String RED = "#ff6b6b";
    private static final String YELLOW = "#feca57";
    private static final String BLUE = "#54a0ff";
    private static final String PURPLE = "#6c5ce7";
    private static final String ORANGE = "#ff9f43";
    private static final String CYAN = "#48dbfb";
    private static final String PINK = "#ff6b9d";
    private static final String TEXT = "#1a1a2e";
    private static final String TEXT_DIM = "#555";
    private static final String TEXT_MUTED = "#888";
    private static final String BG_CARD = "#ffffff";
    private static final String BG_SUBTLE = "#f7f8fc";
    private static final String BORDER = "#e8eaf0";

    private static final String[] BLOOM_LEVELS = {"remember", "understand", "apply", "analyze", "evaluate", "create"};
    private static final String[] BLOOM_NAMES = {"Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"};
    private static final String[] BLOOM_COLORS = {GREEN, BLUE, PURPLE, YELLOW, ORANGE, RED};

    public String generateAiReportHtml(String assessmentName, String processedJson, ReportBrandingDto branding, StudentComparisonDto comparison) {
        return generateAiReportHtml(assessmentName, processedJson, branding, comparison,
                vacademy.io.assessment_service.features.assessment.service.aireport.ReportOptions.ALL);
    }

    /** Same report, leaving out the answers the assessment's report options hide. */
    public String generateAiReportHtml(String assessmentName, String processedJson, ReportBrandingDto branding, StudentComparisonDto comparison,
                                       vacademy.io.assessment_service.features.assessment.service.aireport.ReportOptions options) {
        if (options == null) options = vacademy.io.assessment_service.features.assessment.service.aireport.ReportOptions.ALL;
        StringBuilder html = new StringBuilder();
        if (branding == null) branding = ReportBrandingDto.builder().build();
        String accent = branding.getPrimaryColor() != null ? branding.getPrimaryColor() : PURPLE;

        html.append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">");
        html.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
        html.append("<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');</style>");
        html.append("<style>");
        appendStyles(html, accent);
        html.append("</style></head><body>");
        html.append("<div class=\"report-container\">");

        try {
            JsonNode report = objectMapper.readTree(processedJson);

            // Header with logo via shared branding helper
            String logoUrl = brandingHelper.resolveLogoUrl(branding);
            html.append(brandingHelper.buildHeaderHtml(branding, assessmentName, "Personalized Performance Analysis", accent, logoUrl));
            html.append("<div class=\"container\">");

            // Score Overview + You vs Class + Leaderboard — reuse from system report
            if (comparison != null) {
                html.append(htmlBuilderService.generateComparisonSectionsHtml(comparison, branding));
            }

            appendMarkdownSection(html, "Performance Analysis", "\u25A0", PURPLE, textOrEmpty(report, "performance_analysis"));
            if (report.has("confidence_estimation")) appendConfidence(html, report.get("confidence_estimation"));
            if (report.has("topic_analysis") && report.get("topic_analysis").isArray()) appendTopics(html, report.get("topic_analysis"));
            if (report.has("strengths") || report.has("weaknesses")) appendStrengthsWeaknesses(html, report);
            if (report.has("blooms_taxonomy")) appendBlooms(html, report.get("blooms_taxonomy"));
            if (report.has("misconception_analysis") && report.get("misconception_analysis").isArray()) appendMisconceptions(html, report.get("misconception_analysis"), options);
            if (report.has("behavioral_insights")) appendBehavioral(html, report.get("behavioral_insights"));
            if (report.has("recommended_learning_path") && report.get("recommended_learning_path").isArray()) appendLearningPath(html, report.get("recommended_learning_path"), accent);
            appendMarkdownSection(html, "Areas of Improvement", "\u25B6", YELLOW, textOrEmpty(report, "areas_of_improvement"));
            appendMarkdownSection(html, "Improvement Path", "\u25B6", GREEN, textOrEmpty(report, "improvement_path"));
            if (report.has("flashcards") && report.get("flashcards").isArray()) appendFlashcards(html, report.get("flashcards"), accent);

            html.append("</div>");
        } catch (Exception e) {
            log.error("Error building AI report HTML", e);
            html.append("<p style=\"color:red;\">Error generating report.</p>");
        }

        // Footer via shared branding helper
        html.append(brandingHelper.buildFooterHtml(branding, assessmentName));

        html.append("</div>"); // close report-container
        html.append("</body></html>");
        return html.toString();
    }

    private void appendStyles(StringBuilder html, String accent) {
        // Same font + base styles as system report (font import is in separate style tag above)
        html.append("body { font-family: 'Inter', -apple-system, 'Segoe UI', Arial, Helvetica, sans-serif; background: #ffffff; color: #333; line-height: 1.6; margin: 0; padding: 0; }");
        html.append(".report-container { max-width: 800px; margin: 0 auto; }");
        html.append(".report-header { background-color: ").append(accent).append("; color: white; padding: 24px 28px; border-bottom: 3px solid rgba(0,0,0,0.15); }");
        html.append(".report-header h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px 0; }");
        // Section (same as system report)
        html.append(".section { padding: 24px 28px; border-bottom: 1px solid #eee; page-break-inside: avoid; }");
        html.append(".section-title { font-size: 15px; font-weight: 700; color: #333; margin-bottom: 14px; padding-bottom: 6px; border-bottom: 2px solid #f0f0f0; }");
        // Layout table
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
        // Leaderboard
        html.append(".lb-table { width: 100%; border-collapse: collapse; font-size: 12px; }");
        html.append(".lb-table th { background-color: #f8f9fc; padding: 8px 10px; text-align: left; font-weight: 600; color: #555; border-bottom: 2px solid #eee; }");
        html.append(".lb-table td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }");
        html.append(".current-student { background-color: #FFF3E0; font-weight: 600; }");
        // AI-specific card (uses .section styling)
        html.append(".card { padding: 24px 28px; border-bottom: 1px solid #eee; page-break-inside: avoid; }");
        html.append(".card-title { font-size: 15px; font-weight: 700; color: #333; }");
        html.append(".label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #888; font-weight: 600; }");
        html.append(".mono { font-weight: 700; }");
        // Topic table
        html.append(".topic-table { width: 100%; border-collapse: collapse; font-size: 12px; }");
        html.append(".topic-table th { background-color: #f8f9fc; padding: 8px; text-align: left; font-weight: 600; color: #555; border-bottom: 2px solid #eee; }");
        html.append(".topic-table td { padding: 8px; border-bottom: 1px solid #f0f0f0; }");
    }

    // Header is now rendered via ReportBrandingHelper.buildHeaderHtml()

    // ── MARKDOWN SECTION ──
    private void appendMarkdownSection(StringBuilder html, String title, String icon, String accent, String content) {
        if (content == null || content.isEmpty()) return;
        html.append("<div class=\"section\">");
        appendCardTitle(html, title, icon, accent);
        html.append("<div style=\"font-size:12px; color:").append(TEXT_DIM).append("; line-height:1.7;\">")
                .append(mdToHtml(content)).append("</div></div>");
    }

    // ── CONFIDENCE ──
    private void appendConfidence(StringBuilder html, JsonNode ce) {
        int conf = ce.has("overall_confidence") ? ce.get("overall_confidence").asInt() : 0;
        String confColor = conf >= 70 ? GREEN : conf >= 40 ? ORANGE : RED;

        html.append("<div class=\"section\">");
        appendCardTitle(html, "Confidence Estimation", "\u25CE", ORANGE);
        html.append("<p style=\"font-size: 11px; color: #888; margin: -8px 0 12px 0;\">Estimated confidence based on response time, answer patterns, and question difficulty.</p>");

        html.append("<table style=\"width:100%;\"><tr>");
        html.append("<td style=\"width:90px; text-align:center; vertical-align:middle;\">");
        html.append("<div class=\"mono\" style=\"font-size:36px; color:").append(confColor).append(";\">").append(conf).append("%</div>");
        html.append("<div class=\"label\">Confidence</div></td>");
        html.append("<td style=\"padding-left:16px; vertical-align:top;\">");
        confRow(html, GREEN, "High confidence & correct", ce, "high_confidence_correct");
        confRow(html, RED, "High confidence but wrong", ce, "high_confidence_wrong");
        confRow(html, ORANGE, "Low confidence but correct", ce, "low_confidence_correct");
        confRow(html, TEXT_MUTED, "Likely guessed", ce, "guessed_correct");
        html.append("</td></tr></table>");

        if (ce.has("insight") && !ce.get("insight").asText().isEmpty()) {
            html.append("<div style=\"margin-top:12px; font-size:11px; color:").append(TEXT_DIM).append("; padding:10px; background:")
                    .append(BG_SUBTLE).append("; border-radius:8px; border-left:3px solid ").append(PURPLE).append(";\">")
                    .append("<b style=\"color:").append(PURPLE).append(";\">Insight: </b>")
                    .append(esc(ce.get("insight").asText())).append("</div>");
        }

        if (ce.has("per_question") && ce.get("per_question").isObject()) {
            try {
                java.util.LinkedHashMap<String, Integer> qConf = new java.util.LinkedHashMap<>();
                ce.get("per_question").fields().forEachRemaining(e -> qConf.put(e.getKey(), e.getValue().asInt()));
                if (!qConf.isEmpty()) {
                    String gridImg = chartGenerator.generateConfidenceGrid(qConf);
                    if (gridImg != null) {
                        html.append("<div style=\"margin-top:14px; text-align:center;\">")
                                .append("<div class=\"label\" style=\"margin-bottom:8px;\">Estimated Confidence Per Question</div>")
                                .append("<img src=\"").append(gridImg).append("\" style=\"max-width:460px;\" /></div>");
                    }
                }
            } catch (Exception e) {
                log.warn("Confidence grid failed: {}", e.getMessage());
            }
        }
        html.append("</div>");
    }

    private void confRow(StringBuilder html, String color, String label, JsonNode ce, String field) {
        int val = ce.has(field) ? ce.get(field).asInt() : 0;
        html.append("<div style=\"padding:5px 0; border-bottom:1px solid ").append(BORDER).append("; font-size:12px;\">");
        html.append("<table style=\"width:100%;\"><tr><td style=\"color:").append(TEXT_DIM).append(";\">")
                .append("<span style=\"display:inline-block; width:8px; height:8px; border-radius:50%; background:").append(color).append("; margin-right:6px;\"></span>")
                .append(label).append("</td><td style=\"text-align:right;\"><b class=\"mono\" style=\"color:").append(color).append(";\">").append(val).append("</b></td></tr></table>");
        html.append("</div>");
    }

    // ── TOPIC ANALYSIS ──
    private void appendTopics(StringBuilder html, JsonNode topics) {
        html.append("<div class=\"section\">");
        appendCardTitle(html, "Topic Analysis", "\u25B6", CYAN);
        html.append("<p style=\"font-size: 11px; color: #888; margin: -8px 0 12px 0;\">How you performed across different topics covered in this assessment.</p>");

        try {
            java.util.LinkedHashMap<String, Double> accs = new java.util.LinkedHashMap<>();
            for (JsonNode t : topics) {
                String topic = t.has("topic") ? t.get("topic").asText() : "";
                if (!topic.isEmpty()) accs.put(topic, t.has("accuracy") ? t.get("accuracy").asDouble() : 0);
            }
            if (accs.size() >= 3) {
                String img = chartGenerator.generateRadarChart(accs);
                if (img != null) {
                    html.append("<div style=\"text-align:center; margin-bottom:14px;\">")
                            .append("<img src=\"").append(img).append("\" style=\"max-width:400px;\" /></div>");
                }
            }
        } catch (Exception e) {
            log.warn("Radar chart failed: {}", e.getMessage());
        }

        html.append("<table style=\"width:100%; border-collapse:collapse; font-size:12px;\"><thead><tr>");
        for (String h : new String[]{"Topic", "Qs", "Correct", "Accuracy", "Time", "Mastery"}) {
            html.append("<th style=\"padding:8px; text-align:").append("Topic".equals(h) ? "left" : "center")
                    .append("; font-size:10px; text-transform:uppercase; letter-spacing:1px; color:").append(TEXT_MUTED)
                    .append("; font-weight:600; border-bottom:2px solid ").append(BORDER).append(";\">").append(h).append("</th>");
        }
        html.append("</tr></thead><tbody>");
        for (JsonNode t : topics) {
            String mastery = t.has("mastery_level") ? t.get("mastery_level").asText() : "Developing";
            int acc = t.has("accuracy") ? t.get("accuracy").asInt() : 0;
            String accColor = acc >= 70 ? GREEN : acc >= 40 ? ORANGE : RED;
            String mColor = mastery.equals("Expert") ? GREEN : mastery.equals("Proficient") ? BLUE : mastery.equals("Developing") ? YELLOW : RED;

            html.append("<tr style=\"border-bottom:1px solid ").append(BORDER).append(";\">");
            html.append("<td style=\"padding:10px; font-weight:600;\">").append(esc(t.has("topic") ? t.get("topic").asText() : "")).append("</td>");
            html.append("<td style=\"padding:10px; text-align:center;\">").append(t.has("questions_count") ? t.get("questions_count").asInt() : 0).append("</td>");
            html.append("<td style=\"padding:10px; text-align:center;\">").append(t.has("correct") ? t.get("correct").asInt() : 0).append("</td>");
            html.append("<td style=\"padding:10px; text-align:center;\"><span class=\"mono\" style=\"color:").append(accColor).append(";\">").append(acc).append("%</span></td>");
            html.append("<td style=\"padding:10px; text-align:center; color:").append(TEXT_MUTED).append(";\">").append(t.has("avg_time_seconds") ? t.get("avg_time_seconds").asInt() : 0).append("s</td>");
            html.append("<td style=\"padding:10px; text-align:center;\"><span style=\"padding:3px 10px; border-radius:12px; font-size:10px; font-weight:700; background:")
                    .append(tint(mColor, 0.1)).append("; color:").append(mColor).append(";\">").append(mastery).append("</span></td>");
            html.append("</tr>");
        }
        html.append("</tbody></table></div>");
    }

    // ── STRENGTHS & WEAKNESSES ──
    private void appendStrengthsWeaknesses(StringBuilder html, JsonNode report) {
        html.append("<table style=\"width:100%; margin-bottom:16px;\"><tr>");
        html.append("<td style=\"width:50%; vertical-align:top; padding-right:8px;\"><div class=\"card\">");
        appendCardTitle(html, "Strengths", "\u2713", GREEN);
        if (report.has("strengths")) report.get("strengths").fields().forEachRemaining(e -> {
            int s = e.getValue().asInt(); if (s > 0) appendColorBar(html, e.getKey(), s, GREEN);
        });
        html.append("</div></td>");
        html.append("<td style=\"width:50%; vertical-align:top; padding-left:8px;\"><div class=\"card\">");
        appendCardTitle(html, "Weaknesses", "\u2717", RED);
        if (report.has("weaknesses")) report.get("weaknesses").fields().forEachRemaining(e -> {
            int s = e.getValue().asInt(); if (s > 0) appendColorBar(html, e.getKey(), s, RED);
        });
        html.append("</div></td></tr></table>");
    }

    private void appendColorBar(StringBuilder html, String label, int pct, String color) {
        html.append("<div style=\"margin-bottom:10px;\">")
                .append("<table style=\"width:100%; font-size:11px; margin-bottom:3px;\"><tr>")
                .append("<td style=\"color:").append(TEXT_DIM).append(";\">").append(esc(label)).append("</td>")
                .append("<td style=\"text-align:right;\"><span class=\"mono\" style=\"color:").append(color).append(";\">").append(pct).append("%</span></td>")
                .append("</tr></table>")
                .append("<div style=\"height:8px; background:#f0f0f0; border-radius:4px;\">")
                .append("<div style=\"height:100%; width:").append(pct).append("%; background:").append(color).append("; border-radius:4px;\"></div>")
                .append("</div></div>");
    }

    // ── BLOOM'S TAXONOMY ──
    private void appendBlooms(StringBuilder html, JsonNode blooms) {
        java.util.LinkedHashMap<String, int[]> data = new java.util.LinkedHashMap<>();
        blooms.fields().forEachRemaining(e -> {
            String key = e.getKey().toLowerCase();
            JsonNode v = e.getValue();
            int total = v.has("total") ? v.get("total").asInt() : 0;
            int correct = v.has("correct") ? v.get("correct").asInt() : 0;
            if (total > 0) data.put(key, new int[]{correct, total});
        });
        if (data.isEmpty()) return;

        html.append("<div class=\"section\">");
        appendCardTitle(html, "Bloom's Taxonomy \u2014 Cognitive Level Performance", "\u25C8", BLUE);
        html.append("<p style=\"font-size: 11px; color: #888; margin: -8px 0 12px 0;\">How you performed at different thinking levels \u2014 from basic recall to higher-order analysis and problem solving.</p>");

        try {
            java.util.LinkedHashMap<String, Double> chartData = new java.util.LinkedHashMap<>();
            for (String l : BLOOM_LEVELS) {
                int[] d = data.get(l);
                chartData.put(l, d != null ? Math.round((float) d[0] / d[1] * 100.0) : 0.0);
            }
            String img = chartGenerator.generateBloomsBarChart(chartData);
            if (img != null) {
                html.append("<div style=\"text-align:center; margin-bottom:16px;\">")
                        .append("<img src=\"").append(img).append("\" style=\"max-width:460px;\" /></div>");
            }
        } catch (Exception e) {
            log.warn("Bloom's chart failed: {}", e.getMessage());
        }

        html.append("<div class=\"label\" style=\"margin-bottom:10px;\">Performance by Cognitive Level</div>");
        for (int i = 0; i < BLOOM_LEVELS.length; i++) {
            int[] d = data.get(BLOOM_LEVELS[i]);
            if (d == null) continue;
            int pct = Math.round((float) d[0] / d[1] * 100);
            html.append("<table style=\"width:100%; margin-bottom:8px;\"><tr>");
            html.append("<td style=\"width:80px; font-size:11px; font-weight:600; color:").append(TEXT_DIM).append("; text-align:right; padding-right:10px; vertical-align:middle;\">")
                    .append(BLOOM_NAMES[i]).append("</td>");
            html.append("<td style=\"vertical-align:middle;\"><div style=\"height:26px; background:#f0f0f0; border-radius:6px; overflow:hidden;\">")
                    .append("<div style=\"height:100%; width:").append(Math.max(pct, 4)).append("%; background:").append(BLOOM_COLORS[i])
                    .append("; border-radius:6px; padding-left:8px; font-size:11px; color:white; font-weight:700; line-height:26px;\">")
                    .append(pct).append("%</div></div></td>");
            html.append("<td style=\"width:45px; text-align:right; font-size:10px; color:").append(TEXT_MUTED).append("; padding-left:6px; vertical-align:middle;\">")
                    .append(d[0]).append("/").append(d[1]).append("</td>");
            html.append("</tr></table>");
        }
        html.append("</div>");
    }

    // ── MISCONCEPTIONS ──
    private void appendMisconceptions(StringBuilder html, JsonNode items,
                                      vacademy.io.assessment_service.features.assessment.service.aireport.ReportOptions options) {
        boolean yours = options.showQuestionWise() && options.showYourAnswer();
        boolean right = options.showQuestionWise() && options.showCorrectAnswer();
        html.append("<div class=\"section\">");
        appendCardTitle(html, "Misconception Analysis", "\u25CF", RED);
        html.append("<p style=\"font-size: 11px; color: #888; margin: -8px 0 12px 0;\">Questions you got wrong and the specific conceptual errors behind each mistake.</p>");
        for (JsonNode m : items) {
            html.append("<div style=\"border:1px solid ").append(tint(RED, 0.2)).append("; border-radius:10px; padding:14px; margin-bottom:10px; background:").append(tint(RED, 0.05)).append(";\">");
            html.append("<div style=\"font-weight:600; font-size:13px; margin-bottom:6px;\">").append(esc(textOrEmpty(m, "question_summary"))).append("</div>");
            if (yours || right) {
                html.append("<table style=\"font-size:11px; margin-bottom:8px;\"><tr>");
                if (yours) {
                    html.append("<td style=\"color:").append(RED).append("; padding-right:16px;\"><b>Your Answer:</b> ").append(esc(textOrEmpty(m, "student_answer"))).append("</td>");
                }
                if (right) {
                    html.append("<td style=\"color:").append(GREEN).append(";\"><b>Correct:</b> ").append(esc(textOrEmpty(m, "correct_answer"))).append("</td>");
                }
                html.append("</tr></table>");
            }
            html.append("<div style=\"font-size:11px; color:").append(TEXT_DIM).append("; padding:8px; background:").append(tint(ORANGE, 0.08)).append("; border-radius:6px; border-left:3px solid ").append(ORANGE).append("; margin-bottom:4px;\">")
                    .append("<b style=\"color:").append(ORANGE).append(";\">Misconception: </b>").append(esc(textOrEmpty(m, "misconception"))).append("</div>");
            html.append("<div style=\"font-size:11px; color:").append(BLUE).append(";\">").append(esc(textOrEmpty(m, "remediation"))).append("</div>");
            html.append("</div>");
        }
        html.append("</div>");
    }

    // ── BEHAVIORAL INSIGHTS ──
    private void appendBehavioral(StringBuilder html, JsonNode bi) {
        String[][] cards = {
                {"time_management", "⏱️ Time Management", BLUE},
                {"fatigue_indicator", "😴 Fatigue Indicator", RED},
                {"difficulty_response", "📈 Difficulty Response", ORANGE},
                {"skip_pattern", "⏭️ Skip Pattern", TEXT_MUTED},
        };
        html.append("<div class=\"section\">");
        appendCardTitle(html, "Behavioral Insights", "\u25A0", PURPLE);
        html.append("<table style=\"width:100%;\"><tr>");
        int col = 0;
        for (String[] c : cards) {
            if (!bi.has(c[0]) || bi.get(c[0]).asText().isEmpty()) continue;
            if (col > 0 && col % 2 == 0) html.append("</tr><tr>");
            html.append("<td style=\"width:50%; vertical-align:top; padding:4px;\">")
                    .append("<div style=\"padding:14px; background:").append(BG_SUBTLE).append("; border-radius:10px; border-left:4px solid ").append(c[2]).append(";\">")
                    .append("<div style=\"font-size:10px; font-weight:700; color:").append(c[2]).append("; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;\">").append(c[1]).append("</div>")
                    .append("<div style=\"font-size:12px; color:").append(TEXT_DIM).append("; line-height:1.5;\">").append(esc(bi.get(c[0]).asText())).append("</div>")
                    .append("</div></td>");
            col++;
        }
        if (col % 2 != 0) html.append("<td></td>");
        html.append("</tr></table></div>");
    }

    // ── LEARNING PATH ──
    private void appendLearningPath(StringBuilder html, JsonNode steps, String accent) {
        html.append("<div class=\"section\">");
        appendCardTitle(html, "Recommended Learning Path", "\u25B6", GREEN);
        for (JsonNode step : steps) {
            int priority = step.has("priority") ? step.get("priority").asInt() : 0;
            html.append("<table style=\"width:100%; margin-bottom:14px;\"><tr>");
            html.append("<td style=\"width:36px; vertical-align:top;\"><div style=\"width:30px; height:30px; border-radius:50%; background:")
                    .append(accent).append("; color:white; text-align:center; line-height:30px; font-weight:700; font-size:14px;\">")
                    .append(priority).append("</div></td>");
            html.append("<td style=\"vertical-align:top; padding-left:10px;\">");
            html.append("<div style=\"font-weight:700; font-size:13px;\">").append(esc(textOrEmpty(step, "topic"))).append("</div>");
            html.append("<div style=\"font-size:11px; color:").append(TEXT_MUTED).append("; margin-top:2px;\">").append(esc(textOrEmpty(step, "current_level")))
                    .append(" → ").append(esc(textOrEmpty(step, "target_level"))).append("</div>");
            html.append("<div style=\"font-size:12px; color:").append(TEXT_DIM).append("; margin-top:4px; line-height:1.5;\">").append(esc(textOrEmpty(step, "suggestion"))).append("</div>");
            html.append("<div style=\"font-size:10px; color:").append(CYAN).append("; font-weight:700; margin-top:4px;\">").append(esc(textOrEmpty(step, "estimated_time"))).append("</div>");
            html.append("</td></tr></table>");
        }
        html.append("</div>");
    }

    // ── FLASHCARDS ──
    private void appendFlashcards(StringBuilder html, JsonNode flashcards, String accent) {
        html.append("<div class=\"section\">");
        appendCardTitle(html, "Flashcards", "\u25A0", PINK);
        html.append("<table style=\"width:100%; border-collapse:separate; border-spacing:6px;\">");
        int col = 0;
        for (JsonNode fc : flashcards) {
            if (col % 2 == 0) html.append("<tr>");
            html.append("<td style=\"width:50%; vertical-align:top;\">")
                    .append("<div style=\"border:1px solid ").append(BORDER).append("; border-radius:10px; overflow:hidden;\">")
                    .append("<div style=\"padding:12px; background:").append(BG_SUBTLE).append("; font-weight:600; font-size:12px;\">").append(esc(textOrEmpty(fc, "front"))).append("</div>")
                    .append("<div style=\"padding:12px; font-size:12px; color:").append(TEXT_DIM).append("; border-top:1px solid ").append(BORDER).append(";\">").append(esc(textOrEmpty(fc, "back"))).append("</div>")
                    .append("</div></td>");
            col++;
            if (col % 2 == 0) html.append("</tr>");
        }
        if (col % 2 != 0) html.append("<td></td></tr>");
        html.append("</table></div>");
    }

    // ── HELPERS ──
    private void appendCardTitle(StringBuilder html, String title, String icon, String accent) {
        // Use system report's section-title style with Unicode symbol (matching the system report exactly)
        html.append("<div class=\"section-title\">").append(icon).append(" ").append(esc(title)).append("</div>");
    }

    private static String mdToHtml(String md) {
        if (md == null || md.isEmpty()) return "";
        String t = esc(md);
        t = t.replaceAll("(?m)^### (.+)$", "<div style=\"font-size:13px; font-weight:700; margin:10px 0 4px;\">$1</div>");
        t = t.replaceAll("(?m)^## (.+)$", "<div style=\"font-size:14px; font-weight:700; margin:12px 0 6px;\">$1</div>");
        t = t.replaceAll("\\*\\*(.+?)\\*\\*", "<b>$1</b>");
        t = t.replaceAll("\\*(.+?)\\*", "<i>$1</i>");
        t = t.replaceAll("(?m)^(\\d+)\\.\\s+(.+)$", "<div style=\"margin:4px 0 4px 16px;\"><b>$1.</b> $2</div>");
        t = t.replaceAll("(?m)^[-•]\\s+(.+)$", "<div style=\"margin:4px 0 4px 16px;\">• $1</div>");
        t = t.replace("\\n", "<br/>").replace("\n", "<br/>");
        return t;
    }

    private static String textOrEmpty(JsonNode node, String field) {
        return node != null && node.has(field) ? node.get(field).asText("") : "";
    }

    private static String esc(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    /**
     * Create a light tint of a hex color by blending with white.
     * iText doesn't support 8-digit hex (#rrggbbaa) or rgba(), so we pre-compute solid tints.
     * @param hex 7-char hex like "#ff6b6b"
     * @param alpha 0.0-1.0 (0.1 = very light tint)
     */
    private static String tint(String hex, double alpha) {
        try {
            int r = Integer.parseInt(hex.substring(1, 3), 16);
            int g = Integer.parseInt(hex.substring(3, 5), 16);
            int b = Integer.parseInt(hex.substring(5, 7), 16);
            r = (int) (r * alpha + 255 * (1 - alpha));
            g = (int) (g * alpha + 255 * (1 - alpha));
            b = (int) (b * alpha + 255 * (1 - alpha));
            return String.format("#%02x%02x%02x", Math.min(r, 255), Math.min(g, 255), Math.min(b, 255));
        } catch (Exception e) {
            return "#f0f0f0";
        }
    }
}
