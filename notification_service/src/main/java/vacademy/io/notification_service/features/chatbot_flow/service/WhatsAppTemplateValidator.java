package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.notification_service.features.chatbot_flow.dto.WhatsAppTemplateDTO;
import vacademy.io.notification_service.features.chatbot_flow.entity.WhatsAppTemplate;
import vacademy.io.notification_service.features.chatbot_flow.exception.WhatsAppTemplateException;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Checks a template against the rules Meta enforces at registration, before we spend a round trip on
 * it.
 *
 * <p>Meta answers almost every content problem with the same opaque {@code (#100) Invalid parameter}
 * — it will not tell you that variable {{3}} has no sample, or that the body ends on a placeholder.
 * Catching those here means the admin gets "Body text cannot end with a variable — add a word after
 * {{2}}" instead of a generic rejection they have to guess at.
 *
 * <p>Deliberately conservative: only rules Meta actually enforces are checked, because a false
 * rejection here blocks a template that would have been approved.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class WhatsAppTemplateValidator {

    /** Meta: lowercase letters, digits and underscores only, up to 512 characters. */
    private static final Pattern NAME_PATTERN = Pattern.compile("^[a-z0-9_]{1,512}$");
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{\\s*(\\d+)\\s*}}");

    private static final Set<String> CATEGORIES = Set.of("MARKETING", "UTILITY", "AUTHENTICATION");
    private static final Set<String> HEADER_TYPES = Set.of("NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT");

    /**
     * Button types whose shape we know well enough to check. Anything else (OTP, FLOW, CATALOG, …)
     * is left alone rather than rejected: sync copies Meta's own buttons into the row verbatim, so a
     * REJECTED template pulled from Meta can legitimately carry a type the builder never creates,
     * and blocking it here would make that template impossible to re-submit.
     */
    private static final Set<String> KNOWN_BUTTON_TYPES = Set.of("QUICK_REPLY", "URL", "PHONE_NUMBER", "COPY_CODE");

    private static final int BODY_MAX = 1024;
    private static final int HEADER_TEXT_MAX = 60;
    private static final int FOOTER_MAX = 60;
    private static final int BUTTON_TEXT_MAX = 25;
    /** Meta's own ceiling. The builder offers 3; a synced template may legitimately have more. */
    private static final int MAX_BUTTONS = 10;

    private final ObjectMapper objectMapper;

    // ==================== Draft-time (permissive) ====================

    /**
     * Only what the row itself needs. A draft is work in progress — the admin must be able to save a
     * half-finished template without being told about missing sample values.
     */
    public void validateForDraft(WhatsAppTemplateDTO dto) {
        if (dto == null) {
            throw WhatsAppTemplateException.invalid("TEMPLATE_EMPTY", null,
                    "No template data was received.", null);
        }
        requireText(dto.getInstituteId(), "instituteId", "MISSING_INSTITUTE",
                "Institute could not be determined for this template.",
                "Reload the page and try again.");
        requireText(dto.getName(), "name", "MISSING_NAME",
                "Template name is required.",
                "Use a short lowercase name such as order_confirmation.");

        validateName(normalizeName(dto.getName()));

        String category = upper(dto.getCategory());
        if (category == null) {
            throw WhatsAppTemplateException.invalid("MISSING_CATEGORY", "category",
                    "Template category is required.",
                    "Pick Marketing, Utility or Authentication.");
        }
        if (!CATEGORIES.contains(category)) {
            throw WhatsAppTemplateException.invalid("INVALID_CATEGORY", "category",
                    "'" + dto.getCategory() + "' is not a valid WhatsApp template category.",
                    "Meta only accepts MARKETING, UTILITY or AUTHENTICATION.");
        }

        String headerType = upper(dto.getHeaderType());
        if (headerType != null && !HEADER_TYPES.contains(headerType)) {
            throw WhatsAppTemplateException.invalid("INVALID_HEADER_TYPE", "headerType",
                    "'" + dto.getHeaderType() + "' is not a valid header type.",
                    "Choose None, Text, Image, Video or Document.");
        }
    }

    // ==================== Submit-time (full) ====================

    /**
     * Everything Meta will check. Collects all problems and reports them together — an admin fixing
     * a template should not have to submit five times to discover five issues.
     */
    public void validateForSubmit(WhatsAppTemplate t) {
        List<String> problems = new ArrayList<>();
        String firstField = null;

        // --- Name / category / language ---
        if (isBlank(t.getName())) {
            problems.add("Template name is required.");
            firstField = firstField == null ? "name" : firstField;
        } else if (!NAME_PATTERN.matcher(t.getName()).matches()) {
            problems.add("Template name '" + t.getName()
                    + "' is invalid — use only lowercase letters, numbers and underscores (max 512 characters).");
            firstField = firstField == null ? "name" : firstField;
        }
        if (isBlank(t.getLanguage())) {
            problems.add("Language is required.");
            firstField = firstField == null ? "language" : firstField;
        }
        String category = upper(t.getCategory());
        if (category == null || !CATEGORIES.contains(category)) {
            problems.add("Category must be MARKETING, UTILITY or AUTHENTICATION.");
            firstField = firstField == null ? "category" : firstField;
        } else if ("AUTHENTICATION".equals(category)) {
            // Meta writes the body of an AUTHENTICATION template itself (the fixed OTP wording) and
            // rejects any BODY component that carries "text" — the builder always sends one. Meta's
            // own error for this is "component of type BODY has unexpected field(s) (text)", which
            // reads nothing like "wrong category", so name the real problem here.
            problems.add("Category is set to Authentication, which Meta reserves for one-time-password "
                    + "templates with a fixed, Meta-written body. A message with your own text — registration "
                    + "confirmations, login credentials, reminders — must use Utility (or Marketing).");
            firstField = firstField == null ? "category" : firstField;
        }

        // --- Body ---
        String body = t.getBodyText();
        if (isBlank(body)) {
            problems.add("Body text is required — this is the message your learners will read.");
            firstField = firstField == null ? "bodyText" : firstField;
        } else {
            if (body.length() > BODY_MAX) {
                problems.add("Body text is " + body.length() + " characters; Meta allows at most " + BODY_MAX + ".");
                firstField = firstField == null ? "bodyText" : firstField;
            }
            List<Integer> indexes = placeholderIndexes(body);
            String sequenceProblem = sequenceProblem(indexes, "Body");
            if (sequenceProblem != null) {
                problems.add(sequenceProblem);
                firstField = firstField == null ? "bodyText" : firstField;
            }
            String trimmed = body.trim();
            if (!indexes.isEmpty()) {
                // Meta rejects a body that opens or closes on a placeholder — there must be static
                // text around it, otherwise the message can render as an empty bubble.
                if (PLACEHOLDER.matcher(trimmed).lookingAt()) {
                    problems.add("Body text cannot start with a variable — put some words before it.");
                    firstField = firstField == null ? "bodyText" : firstField;
                }
                if (endsWithPlaceholder(trimmed)) {
                    problems.add("Body text cannot end with a variable — add a word or punctuation after it.");
                    firstField = firstField == null ? "bodyText" : firstField;
                }

                // Every variable needs a sample value or Meta cannot review the template.
                List<String> samples = readList(t.getBodySampleValues());
                int expected = indexes.stream().mapToInt(Integer::intValue).max().orElse(0);
                if (samples.size() < expected) {
                    problems.add("Body has " + expected + " variable(s) but only " + samples.size()
                            + " sample value(s). Meta needs one example per variable to review the template.");
                    firstField = firstField == null ? "bodySampleValues" : firstField;
                } else {
                    for (int i = 0; i < expected; i++) {
                        if (isBlank(samples.get(i))) {
                            problems.add("Sample value for variable {{" + (i + 1) + "}} is empty.");
                            firstField = firstField == null ? "bodySampleValues" : firstField;
                        }
                    }
                }
            }
        }

        // --- Header ---
        String headerType = upper(t.getHeaderType());
        if (headerType == null) headerType = "NONE";
        if (!HEADER_TYPES.contains(headerType)) {
            problems.add("Header type '" + t.getHeaderType() + "' is not supported.");
            firstField = firstField == null ? "headerType" : firstField;
        } else if ("TEXT".equals(headerType)) {
            String headerText = t.getHeaderText();
            if (isBlank(headerText)) {
                problems.add("Header is set to Text but no header text was entered.");
                firstField = firstField == null ? "headerText" : firstField;
            } else {
                if (headerText.length() > HEADER_TEXT_MAX) {
                    problems.add("Header text is " + headerText.length() + " characters; Meta allows at most "
                            + HEADER_TEXT_MAX + ".");
                    firstField = firstField == null ? "headerText" : firstField;
                }
                List<Integer> headerVars = placeholderIndexes(headerText);
                if (headerVars.size() > 1) {
                    problems.add("A text header can contain at most one variable; this one has "
                            + headerVars.size() + ".");
                    firstField = firstField == null ? "headerText" : firstField;
                } else if (headerVars.size() == 1) {
                    List<String> headerSamples = readList(t.getHeaderSampleValues());
                    if (headerSamples.isEmpty() || isBlank(headerSamples.get(0))) {
                        problems.add("The header variable needs a sample value for Meta to review it.");
                        firstField = firstField == null ? "headerSampleValues" : firstField;
                    }
                }
            }
        } else if (!"NONE".equals(headerType) && isBlank(t.getHeaderSampleUrl())) {
            problems.add("A sample " + headerType.toLowerCase(Locale.ROOT)
                    + " is required for " + headerType.toLowerCase(Locale.ROOT) + "-header templates.");
            firstField = firstField == null ? "headerSampleUrl" : firstField;
        }

        // --- Footer ---
        String footer = t.getFooterText();
        if (!isBlank(footer)) {
            if (footer.length() > FOOTER_MAX) {
                problems.add("Footer is " + footer.length() + " characters; Meta allows at most " + FOOTER_MAX + ".");
                firstField = firstField == null ? "footerText" : firstField;
            }
            if (!placeholderIndexes(footer).isEmpty()) {
                problems.add("Footers cannot contain variables — remove the {{…}} from the footer.");
                firstField = firstField == null ? "footerText" : firstField;
            }
        }

        // --- Buttons ---
        List<WhatsAppTemplateDTO.TemplateButton> buttons = readButtons(t.getButtonsConfig());
        if (buttons.size() > MAX_BUTTONS) {
            problems.add("A template can have at most " + MAX_BUTTONS + " buttons; this one has " + buttons.size() + ".");
            firstField = firstField == null ? "buttons" : firstField;
        }
        int phoneButtons = 0;
        for (int i = 0; i < buttons.size(); i++) {
            WhatsAppTemplateDTO.TemplateButton b = buttons.get(i);
            String label = "Button " + (i + 1);
            String type = upper(b.getType());
            if (type == null) {
                problems.add(label + " has no type.");
                firstField = firstField == null ? "buttons[" + i + "].type" : firstField;
                continue;
            }
            if (!KNOWN_BUTTON_TYPES.contains(type)) {
                // A type we don't model — let Meta rule on it rather than inventing a restriction.
                continue;
            }
            if (isBlank(b.getText())) {
                problems.add(label + " has no label text.");
                firstField = firstField == null ? "buttons[" + i + "].text" : firstField;
            } else if (b.getText().length() > BUTTON_TEXT_MAX) {
                problems.add(label + " label is " + b.getText().length() + " characters; Meta allows at most "
                        + BUTTON_TEXT_MAX + ".");
                firstField = firstField == null ? "buttons[" + i + "].text" : firstField;
            }
            if ("URL".equals(type)) {
                if (isBlank(b.getUrl()) || "https://".equals(b.getUrl().trim())) {
                    problems.add(label + " is a URL button but has no link.");
                    firstField = firstField == null ? "buttons[" + i + "].url" : firstField;
                } else if (!b.getUrl().startsWith("http://") && !b.getUrl().startsWith("https://")) {
                    problems.add(label + " link must start with http:// or https://.");
                    firstField = firstField == null ? "buttons[" + i + "].url" : firstField;
                } else if (!placeholderIndexes(b.getUrl()).isEmpty()
                        && (b.getExample() == null || b.getExample().isEmpty()
                        || isBlank(b.getExample().get(0)))) {
                    problems.add(label + " has a variable in its link, so it needs a sample URL for Meta to review.");
                    firstField = firstField == null ? "buttons[" + i + "].example" : firstField;
                }
            }
            if ("PHONE_NUMBER".equals(type)) {
                phoneButtons++;
                if (isBlank(b.getPhoneNumber())) {
                    problems.add(label + " is a phone button but has no number.");
                    firstField = firstField == null ? "buttons[" + i + "].phoneNumber" : firstField;
                } else if (!b.getPhoneNumber().trim().startsWith("+")) {
                    problems.add(label + " number must be in international format, e.g. +919876543210.");
                    firstField = firstField == null ? "buttons[" + i + "].phoneNumber" : firstField;
                }
            }
        }
        if (phoneButtons > 1) {
            problems.add("Only one phone-number button is allowed per template.");
            firstField = firstField == null ? "buttons" : firstField;
        }

        if (!problems.isEmpty()) {
            throw WhatsAppTemplateException.invalid(
                    "TEMPLATE_VALIDATION_FAILED", firstField,
                    problems.size() == 1
                            ? problems.get(0)
                            : "This template has " + problems.size() + " problems Meta would reject: "
                            + String.join(" ", problems),
                    "Fix these and submit again — nothing has been sent to Meta yet.");
        }
    }

    // ==================== Helpers ====================

    /** Same normalisation the manager applies before persisting, so validation sees the stored name. */
    public String normalizeName(String raw) {
        return raw == null ? null : raw.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_]", "_");
    }

    private void validateName(String normalized) {
        if (normalized == null || normalized.isBlank() || normalized.replace("_", "").isEmpty()) {
            throw WhatsAppTemplateException.invalid("INVALID_NAME", "name",
                    "Template name must contain at least one letter or number.",
                    "Names are lowercased and spaces become underscores, e.g. \"Order Confirmation\" → order_confirmation.");
        }
        if (!NAME_PATTERN.matcher(normalized).matches()) {
            throw WhatsAppTemplateException.invalid("INVALID_NAME", "name",
                    "Template name is too long — Meta allows at most 512 characters.",
                    "Shorten the name and try again.");
        }
    }

    private List<Integer> placeholderIndexes(String text) {
        List<Integer> found = new ArrayList<>();
        if (text == null) return found;
        Matcher m = PLACEHOLDER.matcher(text);
        while (m.find()) {
            try {
                found.add(Integer.parseInt(m.group(1)));
            } catch (NumberFormatException ignored) {
                // {{99999999999}} — treated as an unusable index below via the sequence check.
                found.add(Integer.MAX_VALUE);
            }
        }
        return found;
    }

    /**
     * Meta requires variables numbered 1..N with no gaps. {@code {{1}} … {{3}}} is rejected, and so is
     * a body that starts at {@code {{2}}}.
     */
    private String sequenceProblem(List<Integer> indexes, String where) {
        if (indexes.isEmpty()) return null;
        List<Integer> distinct = indexes.stream().distinct().sorted().toList();
        if (distinct.get(0) != 1) {
            return where + " variables must start at {{1}} — found {{" + distinct.get(0) + "}} first.";
        }
        for (int i = 0; i < distinct.size(); i++) {
            if (distinct.get(i) != i + 1) {
                return where + " variables must be numbered consecutively — {{" + (i + 1)
                        + "}} is missing but {{" + distinct.get(i) + "}} is used.";
            }
        }
        return null;
    }

    private boolean endsWithPlaceholder(String trimmed) {
        Matcher m = PLACEHOLDER.matcher(trimmed);
        int end = -1;
        while (m.find()) end = m.end();
        return end == trimmed.length();
    }

    private List<String> readList(String json) {
        if (isBlank(json)) return List.of();
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private List<WhatsAppTemplateDTO.TemplateButton> readButtons(String json) {
        if (isBlank(json)) return List.of();
        try {
            return objectMapper.readValue(json, new TypeReference<List<WhatsAppTemplateDTO.TemplateButton>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private void requireText(String value, String field, String code, String message, String hint) {
        if (isBlank(value)) {
            throw WhatsAppTemplateException.invalid(code, field, message, hint);
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String upper(String s) {
        return isBlank(s) ? null : s.trim().toUpperCase(Locale.ROOT);
    }
}
