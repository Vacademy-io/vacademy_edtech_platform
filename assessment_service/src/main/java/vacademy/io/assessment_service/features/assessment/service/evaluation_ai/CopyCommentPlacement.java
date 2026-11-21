package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import vacademy.io.assessment_service.features.assessment.entity.Assessment;

import java.util.function.Supplier;

/**
 * Where the teacher's remarks go on an AI-checked copy.
 * <ul>
 *   <li>{@code INSIDE} (default) - written on the copy itself;</li>
 *   <li>{@code OUTSIDE} - marks on the copy, remarks in a Teacher Comments panel beside it.</li>
 * </ul>
 * The choice made when copies are sent for checking is kept on the assessment; an
 * assessment with none uses the institute's default (Settings, Assessment), and an
 * institute with none gets the usual copy.
 */
public final class CopyCommentPlacement {

    public static final String INSIDE = "INSIDE";
    public static final String OUTSIDE = "OUTSIDE";

    private CopyCommentPlacement() {
    }

    /** INSIDE / OUTSIDE, or null for anything else. */
    public static String normalize(String value) {
        if (value == null) return null;
        String v = value.trim().toUpperCase();
        return INSIDE.equals(v) || OUTSIDE.equals(v) ? v : null;
    }

    /** The assessment's own choice: INSIDE, OUTSIDE, or null when it has none. */
    public static String chosenOn(Assessment assessment) {
        return assessment == null ? null : normalize(assessment.getCopyCommentPlacement());
    }

    /**
     * What the copy is rendered with, as sent to ai_service: OUTSIDE, or null for the
     * usual copy. The institute default is only asked for when the assessment has no
     * choice of its own; any failure there means the usual copy.
     */
    public static String effective(String onAssessment, Supplier<String> instituteDefault) {
        String chosen = normalize(onAssessment);
        if (chosen == null && instituteDefault != null) {
            try {
                chosen = normalize(instituteDefault.get());
            } catch (Exception e) {
                chosen = null;
            }
        }
        return OUTSIDE.equals(chosen) ? OUTSIDE : null;
    }

    /** The choice sent with a batch when it differs from what the assessment holds; null = nothing to store. */
    public static String changed(Assessment assessment, String requested) {
        String v = normalize(requested);
        if (assessment == null || v == null) return null;
        return v.equals(chosenOn(assessment)) ? null : v;
    }
}
