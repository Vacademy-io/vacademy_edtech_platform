package vacademy.io.assessment_service.features.open_evaluation.result;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Submission {@code error.code} (spec 8.3) from what the engine stored on a FAILED run.
 *
 * <p>ai_service's own code arrives as a {@code "code: message"} prefix (the callback stores
 * it that way, and the dispatcher writes its refusals the same way); older rows are matched
 * on the engine's fixed messages. The partner gets a fixed message per code, never the raw
 * engine text (it can carry internal ids).
 */
public final class FailureCodes {

    public static final String COPY_UNREADABLE = "copy_unreadable";
    public static final String LANGUAGE_NOT_SUPPORTED = "language_not_supported";
    public static final String FILE_MISSING = "file_missing";
    public static final String FILE_UNAVAILABLE = "file_unavailable";
    public static final String NO_GRADABLE_QUESTIONS = "no_gradable_questions";
    public static final String TIMED_OUT = "timed_out";
    public static final String CANCELLED = "cancelled";
    public static final String INSUFFICIENT_CREDITS = "insufficient_credits";
    public static final String ENGINE_UNAVAILABLE = "engine_unavailable";
    public static final String IDENTIFY_FAILED = "identify_failed";

    static final Map<String, String> MESSAGES = new LinkedHashMap<>();

    static {
        MESSAGES.put(COPY_UNREADABLE, "The answer sheet could not be read reliably. Rescan it and submit again.");
        MESSAGES.put(LANGUAGE_NOT_SUPPORTED, "The answers are in Hindi (Devanagari). Only English is supported in v1.");
        MESSAGES.put(FILE_MISSING, "The submission has no answer sheet to grade.");
        MESSAGES.put(FILE_UNAVAILABLE, "The answer sheet could not be fetched from storage. Re-evaluate to retry.");
        MESSAGES.put(NO_GRADABLE_QUESTIONS, "The exam has no question the AI can grade.");
        MESSAGES.put(TIMED_OUT, "Grading timed out. Re-evaluate to retry.");
        MESSAGES.put(CANCELLED, "Grading was cancelled.");
        MESSAGES.put(INSUFFICIENT_CREDITS, "Not enough AI credits when the copy reached the front of the queue.");
        MESSAGES.put(ENGINE_UNAVAILABLE, "The evaluation engine failed on this copy. Re-evaluate to retry.");
        MESSAGES.put(IDENTIFY_FAILED, "The copy could not be matched to a candidate.");
    }

    private static final Pattern PREFIX = Pattern.compile("^([a-z][a-z0-9_]{0,63}):");

    private FailureCodes() {
    }

    /** The public code for a failed run. Never null. */
    public static String code(String errorMessage, String currentStep) {
        if (errorMessage != null) {
            Matcher m = PREFIX.matcher(errorMessage.trim());
            if (m.find() && MESSAGES.containsKey(m.group(1))) {
                return m.group(1);
            }
        }
        if (currentStep != null) {
            String step = currentStep.toUpperCase(Locale.ROOT);
            if ("INSUFFICIENT_CREDITS".equals(step)) {
                return INSUFFICIENT_CREDITS;
            }
            if ("RESULT_RELEASED".equals(step)) {
                return CANCELLED;
            }
        }
        String text = errorMessage == null ? "" : errorMessage.toLowerCase(Locale.ROOT);
        if (text.contains("could not be read reliably") || text.contains("unreadable")) {
            return COPY_UNREADABLE;
        }
        if (text.contains("devanagari") || text.contains("language_not_supported")) {
            return LANGUAGE_NOT_SUPPORTED;
        }
        if (text.contains("timed out")) {
            return TIMED_OUT;
        }
        if (text.contains("no file_id") || text.contains("attempt_data missing")) {
            return FILE_MISSING;
        }
        if (text.contains("did not return a url")) {
            return FILE_UNAVAILABLE;
        }
        if (text.contains("no questions found") || text.contains("nothing for the ai to grade")
                || text.contains("no digitised questions")) {
            return NO_GRADABLE_QUESTIONS;
        }
        if (text.contains("insufficient_credits") || text.contains("not enough ai credits")) {
            return INSUFFICIENT_CREDITS;
        }
        if (text.contains("cancel")) {
            return CANCELLED;
        }
        return ENGINE_UNAVAILABLE;
    }

    public static String message(String code) {
        return MESSAGES.getOrDefault(code, MESSAGES.get(ENGINE_UNAVAILABLE));
    }

    /** {@code {"code","message"}}. */
    public static Map<String, Object> error(String errorMessage, String currentStep) {
        String code = code(errorMessage, currentStep);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("code", code);
        out.put("message", message(code));
        return out;
    }
}
