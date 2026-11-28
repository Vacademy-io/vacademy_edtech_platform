package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;

/**
 * How the AI checks this paper's copies, set by the admin when copies are sent for
 * checking and kept on the assessment (assessment.copy_check_config, V59):
 * <ul>
 *   <li>{@code subject} / {@code level} - who marks it ("English", "CBSE Class X");</li>
 *   <li>{@code instructions} - the institute's marking instructions for the grader;</li>
 *   <li>{@code language_feedback} - HIGHLIGHT marks spelling and grammar errors with a
 *       correction and deducts nothing; OFF (or unset) leaves them alone.</li>
 *   <li>{@code deduction_scheme} - the mark-deduction scheme printed on the answer sheet
 *       (symbol, marks, what it covers); the copy is then marked in it and each written
 *       answer scores max minus its deductions. Validated by ai_service
 *       (copy_check/deduction_scheme.py); kept as sent, at most 8 entries.</li>
 *   <li>{@code answer_language} - the language the copies are written in (en, hi, sa, mr, ur,
 *       bn, ta, te, fr, es, de, ar, zh, pa, gu); decides which model reads the handwriting and
 *       how its language is judged (ai_service copy_check/answer_language.py). Unset = as
 *       before.</li>
 * </ul>
 * Instructions and the spelling check belong to each assessment only: a test with no
 * instructions sends none, and a test that made no spelling choice gets HIGHLIGHT (the
 * check is on by default; OFF turns it off). The institute's {@code remarksLanguage}
 * ({@code ASSESSMENT_SETTING.aiCopyCheck}; AUTO = a Hindi or Sanskrit copy gets Hindi
 * remarks, ENGLISH = every copy in English) goes as {@code remarks_language} when it is
 * ENGLISH. Sent to ai_service as {@code exam_context}.
 */
public final class CopyCheckConfig {

    public static final String HIGHLIGHT = "HIGHLIGHT";
    public static final String OFF = "OFF";
    /** {@code ASSESSMENT_SETTING.aiCopyCheck.remarksLanguage}: AUTO (default) or ENGLISH. */
    public static final String REMARKS_AUTO = "AUTO";
    public static final String REMARKS_ENGLISH = "ENGLISH";
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
    // A key this class does not know must not make the whole stored config
    // unreadable (and so silently drop the instructions with it).
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Settings {
        private String subject;
        private String level;
        private String instructions;
        private String languageFeedback;
        private List<Map<String, Object>> deductionScheme;
        private String answerLanguage;

        boolean isEmpty() {
            return subject == null && level == null && instructions == null && languageFeedback == null
                    && deductionScheme == null && answerLanguage == null;
        }
    }

    static final int DEDUCTION_SCHEME_CAP = 8;

    /** The answer languages the dashboard offers (ai_service answer_language.py). */
    static final Set<String> ANSWER_LANGUAGES = Set.of(
            "en", "hi", "sa", "mr", "ur", "bn", "ta", "te", "fr", "es", "de", "ar", "zh", "pa", "gu");

    /** Trimmed, capped, HIGHLIGHT/OFF only; blanks become null. Never null. */
    public static Settings normalize(Settings in) {
        if (in == null) return new Settings();
        return Settings.builder()
                .subject(line(in.getSubject(), SUBJECT_CAP))
                .level(line(in.getLevel(), LEVEL_CAP))
                .instructions(text(in.getInstructions(), INSTRUCTIONS_CAP))
                .languageFeedback(languageMode(in.getLanguageFeedback()))
                .deductionScheme(deductionScheme(in.getDeductionScheme()))
                .answerLanguage(answerLanguage(in.getAnswerLanguage()))
                .build();
    }

    /** The scheme's entries (objects only, at most DEDUCTION_SCHEME_CAP); null when none. */
    static List<Map<String, Object>> deductionScheme(List<Map<String, Object>> in) {
        if (in == null) return null;
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> entry : in) {
            if (entry != null && !entry.isEmpty() && out.size() < DEDUCTION_SCHEME_CAP) {
                out.add(new LinkedHashMap<>(entry));
            }
        }
        return out.isEmpty() ? null : out;
    }

    /** A listed language code, lower-case; null for blank or anything else. */
    public static String answerLanguage(Object value) {
        if (value == null) return null;
        String v = value.toString().trim().toLowerCase();
        return ANSWER_LANGUAGES.contains(v) ? v : null;
    }

    /** HIGHLIGHT / OFF, or null for anything else. */
    public static String languageMode(Object value) {
        if (value == null) return null;
        String v = value.toString().trim().toUpperCase();
        return HIGHLIGHT.equals(v) || OFF.equals(v) ? v : null;
    }

    /** The settings kept on the assessment; empty when none or unreadable. */
    /**
     * The settings with a language the teacher confirmed for one copy in place of
     * the assessment's own; an unknown or blank code leaves them as they are.
     */
    public static Settings withAnswerLanguage(Settings settings, String confirmed) {
        String code = answerLanguage(confirmed);
        Settings s = settings == null ? new Settings() : settings;
        if (code != null) s.setAnswerLanguage(code);
        return s;
    }

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
     * The exam_context for a dashboard copy: the assessment's own settings, the spelling
     * check on unless the assessment turned it off, and the institute's remarks language.
     */
    public static Map<String, Object> examContext(Settings onAssessment, Supplier<Map<String, Object>> instituteDefault) {
        Settings own = normalize(onAssessment);
        String instructions = own.getInstructions();
        // On unless the test turned it off: a copy is checked for spelling and grammar by default.
        String language = own.getLanguageFeedback() == null ? HIGHLIGHT : own.getLanguageFeedback();
        String remarks = null;
        // The remarks language is an institute setting only.
        if (instituteDefault != null) {
            Map<String, Object> defaults = null;
            try {
                defaults = instituteDefault.get();
            } catch (Exception ignored) {
                // the institute default is optional; the assessment's own settings still go
            }
            if (defaults != null) {
                remarks = remarksLanguage(defaults.get("remarksLanguage"));
            }
        }
        Map<String, Object> ctx = new LinkedHashMap<>();
        if (own.getLevel() != null) ctx.put("level", own.getLevel());
        if (own.getSubject() != null) ctx.put("subject", own.getSubject());
        if (instructions != null) ctx.put("instructions", instructions);
        if (HIGHLIGHT.equals(language)) ctx.put("language_feedback", HIGHLIGHT);
        if (own.getDeductionScheme() != null) ctx.put("deduction_scheme", own.getDeductionScheme());
        if (own.getAnswerLanguage() != null) ctx.put("answer_language", own.getAnswerLanguage());
        if (REMARKS_ENGLISH.equals(remarks)) ctx.put("remarks_language", REMARKS_ENGLISH);
        return ctx.isEmpty() ? null : ctx;
    }

    /** AUTO / ENGLISH, or null for anything else (null reads as AUTO). */
    public static String remarksLanguage(Object value) {
        if (value == null) return null;
        String v = value.toString().trim().toUpperCase();
        return REMARKS_AUTO.equals(v) || REMARKS_ENGLISH.equals(v) ? v : null;
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
