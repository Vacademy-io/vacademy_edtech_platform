package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementItemRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEnums;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashSet;
import java.util.Objects;
import java.util.Set;

/**
 * What an edit to an existing task is allowed to do, and whether it changes anything.
 *
 * The composer re-sends every task on every save. The old rule retired and re-issued
 * any task that had an attempt under a new id, changed or not — so a no-op save made
 * learners' completions vanish, let them earn the points again, and reset tracking to
 * zero. A save now only touches a task when something a learner would see changed,
 * and then versions it in place under the same id.
 *
 * Pure functions, so the rules are unit-testable without Spring.
 */
public final class EngagementItemChangePolicy {

    static final String ANSWER_KEY_LOCKED =
            "Learners have already answered this question, so its answer key can't change. "
                    + "Add a new task instead.";

    static final String TYPE_LOCKED =
            "Learners have already completed this task, so its type can't change. "
                    + "Add a new task instead.";

    private static final int MAX_POINTS = 1000;
    /** Longest task title a FLASHCARDS deck accepts (UTF-16 units, same as the zod schema). */
    static final int MAX_FLASHCARDS_TITLE = 200;

    private EngagementItemChangePolicy() {}

    /**
     * Bring an authoring request into its stored shape BEFORE it is compared or written,
     * so a re-save of an unchanged task compares equal to what is stored.
     *
     * FLASHCARDS: the payload is validated and replaced by its canonical form
     * (FlashcardsPayloadValidator), and the server-forced fields are applied — request
     * values are ignored: correctPoints=0, hideResultUntilReveal=false,
     * maxScore=cards.size(). (isVerifiable=false is set where the item is written.)
     * Every other type is left untouched.
     *
     * Throws VacademyException with a teacher-facing message when the deck is invalid.
     */
    public static void normalizeRequest(EngagementEnums.ItemType type, EngagementItemRequest request,
                                        ObjectMapper objectMapper) {
        if (type != EngagementEnums.ItemType.FLASHCARDS) return;
        FlashcardsPayloadValidator.Parsed deck =
                FlashcardsPayloadValidator.parseAndValidate(request.getPayloadJson());
        request.setItemType(EngagementEnums.ItemType.FLASHCARDS.name());
        request.setPayloadJson(FlashcardsPayloadValidator.canonicalJson(deck, objectMapper));
        request.setCorrectPoints(0);
        request.setHideResultUntilReveal(false);
        request.setMaxScore(deck.size());
    }

    /** True when the request differs from the stored task in anything a learner sees or is graded on. */
    public static boolean isLearnerVisibleChange(EngagementItem existing, EngagementItemRequest request,
                                                 ObjectMapper objectMapper) {
        String requestedType = request.getItemType() == null ? null : request.getItemType().toUpperCase();
        String requestedTitle = request.getTitle() == null ? requestedType : request.getTitle();
        boolean bothFlashcards = EngagementEnums.ItemType.FLASHCARDS.name().equals(existing.getItemType())
                && EngagementEnums.ItemType.FLASHCARDS.name().equals(requestedType);
        boolean payloadChanged = bothFlashcards
                ? !sameFlashcards(existing.getPayloadJson(), request.getPayloadJson(), objectMapper)
                : !sameJson(existing.getPayloadJson(), request.getPayloadJson(), objectMapper);
        return !Objects.equals(existing.getItemType(), requestedType)
                || !Objects.equals(existing.getTitle(), requestedTitle)
                || !Objects.equals(blankToNull(existing.getContentHtml()), blankToNull(request.getContentHtml()))
                || !Objects.equals(blankToNull(existing.getSlideId()), blankToNull(request.getSlideId()))
                || !Objects.equals(blankToNull(existing.getQuestionId()), blankToNull(request.getQuestionId()))
                || nz(existing.getCompletionPoints()) != nz(request.getCompletionPoints())
                || nz(existing.getCorrectPoints()) != nz(request.getCorrectPoints())
                || !Objects.equals(existing.getMaxScore(), request.getMaxScore())
                || Boolean.TRUE.equals(existing.getIsRequired()) != Boolean.TRUE.equals(request.getIsRequired())
                || Boolean.TRUE.equals(existing.getHideResultUntilReveal())
                        != Boolean.TRUE.equals(request.getHideResultUntilReveal())
                || payloadChanged;
    }

    /**
     * Once learners have answered, the parts of a question they were graded against
     * are frozen: type, format, the correct option, and which options exist. Option
     * TEXT can still be fixed (a typo), which is what teachers actually need.
     */
    public static void guardAnswerKey(EngagementItem existing, EngagementItemRequest request,
                                      long completedAttempts, ObjectMapper objectMapper) {
        if (completedAttempts <= 0) return;
        String requestedType = request.getItemType() == null ? null : request.getItemType().toUpperCase();
        if (!Objects.equals(existing.getItemType(), requestedType)) {
            // Includes converting a legacy GAME deck to FLASHCARDS: completions were
            // earned against the old type, so the conversion needs a new task.
            throw new VacademyException(TYPE_LOCKED);
        }
        JsonNode before = readTree(existing.getPayloadJson(), objectMapper);
        JsonNode after = readTree(request.getPayloadJson(), objectMapper);
        if (!Objects.equals(text(before, "format", "MCQ"), text(after, "format", "MCQ"))
                || !Objects.equals(text(before, "correctOptionId", null), text(after, "correctOptionId", null))
                || !optionIds(before).equals(optionIds(after))) {
            throw new VacademyException(ANSWER_KEY_LOCKED);
        }
    }

    /**
     * Minimal write-time validation. Runs only when a task is created or actually
     * changed, so an unrelated edit never trips over an old row.
     */
    public static void validate(EngagementEnums.ItemType type, EngagementItemRequest request,
                                ObjectMapper objectMapper) {
        checkPoints("Completion points", request.getCompletionPoints());
        checkPoints("Bonus points", request.getCorrectPoints());
        JsonNode payload = readTree(request.getPayloadJson(), objectMapper);
        switch (type) {
            case READING_HTML, VISUAL_NOTE, GAME -> {
                if (request.getContentHtml() == null || request.getContentHtml().isBlank()) {
                    throw new VacademyException("\"" + safeTitle(request) + "\" has no content yet.");
                }
            }
            case COURSE_SLIDE -> {
                if (request.getSlideId() == null || request.getSlideId().isBlank()) {
                    throw new VacademyException("Pick the lesson for \"" + safeTitle(request) + "\".");
                }
            }
            case POLL -> {
                if (optionIds(payload).size() < 2) {
                    throw new VacademyException("The poll \"" + safeTitle(request) + "\" needs at least two options.");
                }
            }
            case FLASHCARDS -> {
                if (request.getTitle() != null && request.getTitle().strip().length() > MAX_FLASHCARDS_TITLE) {
                    throw new VacademyException("A task title can be at most " + MAX_FLASHCARDS_TITLE
                            + " characters.");
                }
                // Idempotent on an already-canonical payload; re-checked here so a caller
                // that skipped normalizeRequest still cannot store an invalid deck.
                FlashcardsPayloadValidator.parseAndValidate(request.getPayloadJson());
            }
            case QUESTION_OF_DAY -> {
                if ("MCQ".equals(text(payload, "format", "MCQ"))) {
                    Set<String> ids = optionIds(payload);
                    if (ids.size() < 2) {
                        throw new VacademyException("The question \"" + safeTitle(request) + "\" needs at least two options.");
                    }
                    String correct = text(payload, "correctOptionId", null);
                    if (correct == null || !ids.contains(correct)) {
                        throw new VacademyException("Mark the correct option for \"" + safeTitle(request) + "\".");
                    }
                }
            }
            default -> { }
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static void checkPoints(String label, Integer value) {
        if (value == null) return;
        if (value < 0 || value > MAX_POINTS) {
            throw new VacademyException(label + " must be between 0 and " + MAX_POINTS + ".");
        }
    }

    /** jsonb reorders keys on write, so compare parsed trees, never strings. */
    static boolean sameJson(String a, String b, ObjectMapper objectMapper) {
        if (blankToNull(a) == null && blankToNull(b) == null) return true;
        if (blankToNull(a) == null || blankToNull(b) == null) return false;
        JsonNode ta = readTree(a, objectMapper);
        JsonNode tb = readTree(b, objectMapper);
        if (ta == null || tb == null) return Objects.equals(a, b);
        return ta.equals(tb);
    }

    /**
     * Two FLASHCARDS payloads are the same deck when their canonical forms are equal.
     * The stored side is read tolerantly; an incoming payload that does not validate
     * counts as a change, so the save goes on to validation and fails with a message.
     */
    static boolean sameFlashcards(String stored, String incoming, ObjectMapper objectMapper) {
        String canonicalIncoming;
        try {
            canonicalIncoming = FlashcardsPayloadValidator.canonicalise(incoming, objectMapper);
        } catch (VacademyException e) {
            return false;
        }
        String canonicalStored = FlashcardsPayloadValidator.canonicalJson(
                FlashcardsPayloadValidator.readTrusted(stored), objectMapper);
        return sameJson(canonicalStored, canonicalIncoming, objectMapper);
    }

    private static JsonNode readTree(String json, ObjectMapper objectMapper) {
        if (json == null || json.isBlank()) return null;
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private static String text(JsonNode node, String field, String fallback) {
        if (node == null || !node.hasNonNull(field)) return fallback;
        String value = node.get(field).asText();
        return value.isBlank() ? fallback : value;
    }

    private static Set<String> optionIds(JsonNode payload) {
        Set<String> ids = new HashSet<>();
        if (payload == null || !payload.has("options") || !payload.get("options").isArray()) return ids;
        for (JsonNode option : payload.get("options")) {
            if (option.hasNonNull("id") && !option.get("id").asText().isBlank()) ids.add(option.get("id").asText());
        }
        return ids;
    }

    private static String safeTitle(EngagementItemRequest request) {
        return request.getTitle() == null || request.getTitle().isBlank() ? "Untitled task" : request.getTitle();
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    private static int nz(Integer v) {
        return v == null ? 0 : v;
    }
}
