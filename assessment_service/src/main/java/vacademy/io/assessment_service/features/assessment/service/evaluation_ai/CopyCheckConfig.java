package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;

/**
 * How the AI checks this paper's copies, set by the admin when copies are sent for
 * checking and kept on the assessment (assessment.copy_check_config, V59):
 * <ul>
 *   <li>{@code subject} / {@code level} - who marks it ("English", "CBSE Class X");</li>
 *   <li>{@code instructions} - the institute's marking instructions for the grader;</li>
 *   <li>{@code language_feedback} - HIGHLIGHT marks spelling and grammar errors with a
 *       correction and deducts nothing; OFF (or unset) leaves them alone.</li>
 * </ul>
 * An assessment without its own instructions / language choice takes the institute's
 * ({@code ASSESSMENT_SETTING.aiCopyCheck}). Sent to ai_service as {@code exam_context};
 * nothing set anywhere = no exam_context, so the request is what it was before.
 */
public final class CopyCheckConfig {

    public static final String HIGHLIGHT = "HIGHLIGHT";
    public static final String OFF = "OFF";
    static final int SUBJECT_CAP = 60;
    static final int LEVEL_CAP = 60;
    static final int INSTRUCTIONS_CAP = 2000;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private CopyCheckConfig() {
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Settings {
        private String subject;
        private String level;
        private String instructions;
        private String languageFeedback;

        boolean isEmpty() {
            return subject == null && level == null && instructions == null && languageFeedback == null;
        }
    }

    /** Trimmed, capped, HIGHLIGHT/OFF only; blanks become null. Never null. */
    public static Settings normalize(Settings in) {
        if (in == null) return new Settings();
        return Settings.builder()
                .subject(line(in.getSubject(), SUBJECT_CAP))
                .level(line(in.getLevel(), LEVEL_CAP))
                .instructions(text(in.getInstructions(), INSTRUCTIONS_CAP))
                .languageFeedback(languageMode(in.getLanguageFeedback()))
                .build();
    }

    /** HIGHLIGHT / OFF, or null for anything else. */
    public static String languageMode(Object value) {
        if (value == null) return null;
        String v = value.toString().trim().toUpperCase();
        return HIGHLIGHT.equals(v) || OFF.equals(v) ? v : null;
    }

    /** The settings kept on the assessment; empty when none or unreadable. */
    public static Settings on(Assessment assessment) {
        return read(assessment == null ? null : assessment.getCopyCheckConfig());
    }

    public static Settings read(String json) {
        if (json == null || json.isBlank()) return new Settings();
        try {
            return normalize(MAPPER.readValue(json, Settings.class));
        } catch (Exception e) {
            return new Settings();
        }
    }

    /** JSON for the column; null when nothing is set. */
    public static String write(Settings settings) {
        Settings s = normalize(settings);
        if (s.isEmpty()) return null;
        try {
            return MAPPER.writeValueAsString(s);
        } catch (Exception e) {
            return null;
        }
    }

    /** True when a batch sent settings and they are not what the assessment holds. */
    public static boolean differs(Assessment assessment, Settings requested) {
        if (assessment == null || requested == null) return false;
        return !Objects.equals(write(requested), write(on(assessment)));
    }

    /**
     * The exam_context for a dashboard copy: the assessment's settings, with the
     * institute's instructions and language choice where the assessment has none.
     * Null when nothing is set, so the grade request is unchanged.
     */
    public static Map<String, Object> examContext(Settings onAssessment, Supplier<Map<String, Object>> instituteDefault) {
        Settings own = normalize(onAssessment);
        String instructions = own.getInstructions();
        String language = own.getLanguageFeedback();
        if ((instructions == null || language == null) && instituteDefault != null) {
            Map<String, Object> defaults = null;
            try {
                defaults = instituteDefault.get();
            } catch (Exception ignored) {
                // the institute default is optional; the assessment's own settings still go
            }
            if (defaults != null) {
                if (instructions == null) instructions = text(asString(defaults.get("instructions")), INSTRUCTIONS_CAP);
                if (language == null) language = languageMode(defaults.get("languageFeedback"));
            }
        }
        Map<String, Object> ctx = new LinkedHashMap<>();
        if (own.getLevel() != null) ctx.put("level", own.getLevel());
        if (own.getSubject() != null) ctx.put("subject", own.getSubject());
        if (instructions != null) ctx.put("instructions", instructions);
        if (HIGHLIGHT.equals(language)) ctx.put("language_feedback", HIGHLIGHT);
        return ctx.isEmpty() ? null : ctx;
    }

    private static String asString(Object value) {
        return value == null ? null : value.toString();
    }

    /** One line of plain text: no control characters, single spaces, capped. */
    private static String line(String value, int cap) {
        if (value == null) return null;
        StringBuilder sb = new StringBuilder(value.length());
        for (char c : value.toCharArray()) sb.append(Character.isISOControl(c) ? ' ' : c);
        String v = sb.toString().trim().replaceAll("\\s+", " ");
        if (v.isEmpty()) return null;
        return v.length() <= cap ? v : v.substring(0, cap).trim();
    }

    /** Free text: line breaks kept, other control characters dropped, capped. */
    private static String text(String value, int cap) {
        if (value == null) return null;
        StringBuilder sb = new StringBuilder(value.length());
        for (char c : value.toCharArray()) {
            if (c == '\n' || !Character.isISOControl(c)) sb.append(c);
        }
        String v = sb.toString().trim();
        if (v.isEmpty()) return null;
        return v.length() <= cap ? v : v.substring(0, cap).trim();
    }
}
