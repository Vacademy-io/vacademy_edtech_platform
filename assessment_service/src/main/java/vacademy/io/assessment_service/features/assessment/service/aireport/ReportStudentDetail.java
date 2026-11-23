package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * One registration answer printed under the student's name on their reports, e.g.
 * "Student Roll Number: 1234". Which fields are printed is chosen per assessment in
 * {@code report_options.student_fields} (see {@link ReportOptions}).
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ReportStudentDetail(String label, String value) {

    static final int MAX_VALUE_LENGTH = 100;

    /** A registration answer as stored: the form field's name and key, and what the student typed. */
    public record Answer(String fieldName, String fieldKey, String answer) {
    }

    /**
     * The chosen fields, in the chosen order, each with the student's answer. A field is matched
     * by its name or key, ignoring case, spaces and punctuation, because a field picked from the
     * institute list ("Student Roll Number", key roll_number_inst_...) is saved on the assessment's
     * form under another key (student_roll_number). Fields the student left blank are skipped.
     */
    public static List<ReportStudentDetail> match(List<String> wanted, List<Answer> answers) {
        List<ReportStudentDetail> out = new ArrayList<>();
        if (wanted == null || wanted.isEmpty() || answers == null || answers.isEmpty()) return out;
        for (String field : wanted) {
            String want = norm(field);
            if (want.isEmpty()) continue;
            for (Answer a : answers) {
                if (a == null) continue;
                if (!want.equals(norm(a.fieldName())) && !want.equals(norm(a.fieldKey()))) continue;
                String value = clean(a.answer());
                if (value.isEmpty()) continue;
                String label = a.fieldName() != null && !a.fieldName().isBlank() ? a.fieldName().trim() : field.trim();
                out.add(new ReportStudentDetail(label, value));
                break;
            }
        }
        return out;
    }

    static String norm(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", "");
    }

    private static String clean(String s) {
        if (s == null) return "";
        String v = s.replaceAll("\\s+", " ").trim();
        return v.length() > MAX_VALUE_LENGTH ? v.substring(0, MAX_VALUE_LENGTH - 1).trim() + "…" : v;
    }
}
