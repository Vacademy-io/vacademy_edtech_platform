package vacademy.io.admin_core_service.features.engagement;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementItemRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEnums;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.service.EngagementItemChangePolicy;
import vacademy.io.common.exceptions.VacademyException;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EngagementItemChangePolicyTest {

    private final ObjectMapper om = new ObjectMapper();

    private static final String PAYLOAD =
            "{\"format\":\"MCQ\",\"prompt\":\"<p>2+2?</p>\",\"options\":[{\"id\":\"a\",\"text\":\"3\"},{\"id\":\"b\",\"text\":\"4\"}],\"correctOptionId\":\"b\"}";
    /** Same content, keys reordered — what jsonb hands back. */
    private static final String PAYLOAD_REORDERED =
            "{\"correctOptionId\":\"b\",\"options\":[{\"text\":\"3\",\"id\":\"a\"},{\"text\":\"4\",\"id\":\"b\"}],\"prompt\":\"<p>2+2?</p>\",\"format\":\"MCQ\"}";

    private EngagementItem stored() {
        EngagementItem item = new EngagementItem();
        item.setId("item-1");
        item.setItemType("QUESTION_OF_DAY");
        item.setTitle("Question");
        item.setPayloadJson(PAYLOAD_REORDERED);
        item.setCompletionPoints(10);
        item.setCorrectPoints(20);
        item.setIsRequired(true);
        item.setHideResultUntilReveal(false);
        item.setVersion(1);
        return item;
    }

    private EngagementItemRequest request(String payload) {
        EngagementItemRequest r = new EngagementItemRequest();
        r.setId("item-1");
        r.setItemType("QUESTION_OF_DAY");
        r.setTitle("Question");
        r.setPayloadJson(payload);
        r.setCompletionPoints(10);
        r.setCorrectPoints(20);
        r.setIsRequired(true);
        r.setHideResultUntilReveal(false);
        r.setSortOrder(3);
        return r;
    }

    @Test
    @DisplayName("re-saving an unchanged task (payload keys reordered by jsonb) is not a change")
    void unchangedIsNotAChange() {
        assertFalse(EngagementItemChangePolicy.isLearnerVisibleChange(stored(), request(PAYLOAD), om));
    }

    @Test
    @DisplayName("a title, points or option-text edit is a change")
    void realEditsAreChanges() {
        EngagementItemRequest title = request(PAYLOAD);
        title.setTitle("Better question");
        assertTrue(EngagementItemChangePolicy.isLearnerVisibleChange(stored(), title, om));

        EngagementItemRequest points = request(PAYLOAD);
        points.setCorrectPoints(25);
        assertTrue(EngagementItemChangePolicy.isLearnerVisibleChange(stored(), points, om));

        EngagementItemRequest optionText = request(PAYLOAD.replace("\"text\":\"3\"", "\"text\":\"three\""));
        assertTrue(EngagementItemChangePolicy.isLearnerVisibleChange(stored(), optionText, om));
    }

    @Test
    @DisplayName("after learners answered, fixing option text is allowed")
    void optionTextFixAllowedAfterAnswers() {
        EngagementItemRequest optionText = request(PAYLOAD.replace("\"text\":\"3\"", "\"text\":\"three\""));
        assertDoesNotThrow(() -> EngagementItemChangePolicy.guardAnswerKey(stored(), optionText, 5, om));
    }

    @Test
    @DisplayName("after learners answered, the correct option, the option set, the format and the type are frozen")
    void answerKeyFrozenAfterAnswers() {
        EngagementItemRequest correct = request(PAYLOAD.replace("\"correctOptionId\":\"b\"", "\"correctOptionId\":\"a\""));
        assertThrows(VacademyException.class, () -> EngagementItemChangePolicy.guardAnswerKey(stored(), correct, 1, om));

        EngagementItemRequest newOption = request(PAYLOAD.replace("]", ",{\"id\":\"c\",\"text\":\"5\"}]"));
        assertThrows(VacademyException.class, () -> EngagementItemChangePolicy.guardAnswerKey(stored(), newOption, 1, om));

        EngagementItemRequest format = request(PAYLOAD.replace("\"format\":\"MCQ\"", "\"format\":\"TEXT\""));
        assertThrows(VacademyException.class, () -> EngagementItemChangePolicy.guardAnswerKey(stored(), format, 1, om));

        EngagementItemRequest type = request(PAYLOAD);
        type.setItemType("POLL");
        assertThrows(VacademyException.class, () -> EngagementItemChangePolicy.guardAnswerKey(stored(), type, 1, om));
    }

    @Test
    @DisplayName("before anyone answered, the key may change")
    void keyEditableBeforeAnswers() {
        EngagementItemRequest correct = request(PAYLOAD.replace("\"correctOptionId\":\"b\"", "\"correctOptionId\":\"a\""));
        assertDoesNotThrow(() -> EngagementItemChangePolicy.guardAnswerKey(stored(), correct, 0, om));
    }

    @Test
    @DisplayName("validation: negative points, one-option poll, unmarked MCQ, empty reading, lesson without slide")
    void validation() {
        EngagementItemRequest negative = request(PAYLOAD);
        negative.setCompletionPoints(-5);
        assertThrows(VacademyException.class,
                () -> EngagementItemChangePolicy.validate(EngagementEnums.ItemType.QUESTION_OF_DAY, negative, om));

        EngagementItemRequest poll = request("{\"options\":[{\"id\":\"a\",\"text\":\"yes\"}]}");
        poll.setItemType("POLL");
        assertThrows(VacademyException.class,
                () -> EngagementItemChangePolicy.validate(EngagementEnums.ItemType.POLL, poll, om));

        EngagementItemRequest unmarked = request(PAYLOAD.replace("\"correctOptionId\":\"b\"", "\"correctOptionId\":\"z\""));
        assertThrows(VacademyException.class,
                () -> EngagementItemChangePolicy.validate(EngagementEnums.ItemType.QUESTION_OF_DAY, unmarked, om));

        EngagementItemRequest reading = request(null);
        reading.setItemType("READING_HTML");
        reading.setContentHtml("   ");
        assertThrows(VacademyException.class,
                () -> EngagementItemChangePolicy.validate(EngagementEnums.ItemType.READING_HTML, reading, om));

        EngagementItemRequest lesson = request(null);
        lesson.setItemType("COURSE_SLIDE");
        assertThrows(VacademyException.class,
                () -> EngagementItemChangePolicy.validate(EngagementEnums.ItemType.COURSE_SLIDE, lesson, om));

        EngagementItemRequest written = request("{\"format\":\"TEXT\",\"prompt\":\"<p>Why?</p>\"}");
        assertDoesNotThrow(() -> EngagementItemChangePolicy.validate(EngagementEnums.ItemType.QUESTION_OF_DAY, written, om));
        assertDoesNotThrow(() -> EngagementItemChangePolicy.validate(EngagementEnums.ItemType.QUESTION_OF_DAY, request(PAYLOAD), om));
    }

    // ── FLASHCARDS ───────────────────────────────────────────────────────────

    private static final String DECK =
            "{\"schema\":\"flashcards/v1\",\"cards\":[{\"id\":\"c_1\",\"front\":\"Impairment\",\"back\":\"A problem in body function\",\"hint\":\"Body level\"},"
                    + "{\"id\":\"c_2\",\"front\":\"2 < x > 1\",\"back\":\"<b>x</b>\"}],\"settings\":{\"shuffle\":true}}";
    /** The same deck as jsonb returns it: keys reordered, whitespace changed. */
    private static final String DECK_REORDERED =
            "{ \"settings\": {\"shuffle\": true}, \"cards\": [{\"hint\": \"Body level\", \"back\": \"A problem in body function\", \"front\": \"Impairment\", \"id\": \"c_1\"},"
                    + " {\"back\": \"<b>x</b>\", \"front\": \"2 < x > 1\", \"id\": \"c_2\"}], \"schema\": \"flashcards/v1\" }";

    private EngagementItemRequest flashcardsRequest(String payload) {
        EngagementItemRequest r = new EngagementItemRequest();
        r.setId("deck-1");
        r.setItemType("FLASHCARDS");
        r.setTitle("Key terms");
        r.setPayloadJson(payload);
        r.setCompletionPoints(10);
        r.setIsRequired(true);
        r.setSortOrder(1);
        return r;
    }

    /** A stored deck exactly as a previous save left it (normalised, forced fields applied). */
    private EngagementItem storedDeck() {
        EngagementItemRequest saved = flashcardsRequest(DECK);
        EngagementItemChangePolicy.normalizeRequest(EngagementEnums.ItemType.FLASHCARDS, saved, om);
        EngagementItem item = new EngagementItem();
        item.setId("deck-1");
        item.setItemType("FLASHCARDS");
        item.setTitle(saved.getTitle());
        item.setPayloadJson(DECK_REORDERED);
        item.setCompletionPoints(saved.getCompletionPoints());
        item.setCorrectPoints(saved.getCorrectPoints());
        item.setMaxScore(saved.getMaxScore());
        item.setIsRequired(saved.getIsRequired());
        item.setHideResultUntilReveal(saved.getHideResultUntilReveal());
        item.setVersion(1);
        return item;
    }

    @Test
    @DisplayName("FLASHCARDS: the server forces correctPoints=0, hideResultUntilReveal=false, maxScore=cards, whatever the request says")
    void flashcardsForcedFields() {
        EngagementItemRequest r = flashcardsRequest(DECK);
        r.setCorrectPoints(50);
        r.setHideResultUntilReveal(true);
        r.setMaxScore(99);
        EngagementItemChangePolicy.normalizeRequest(EngagementEnums.ItemType.FLASHCARDS, r, om);
        assertEquals(0, r.getCorrectPoints());
        assertEquals(Boolean.FALSE, r.getHideResultUntilReveal());
        assertEquals(2, r.getMaxScore());
        assertDoesNotThrow(() -> EngagementItemChangePolicy.validate(EngagementEnums.ItemType.FLASHCARDS, r, om));
    }

    @Test
    @DisplayName("FLASHCARDS: normalizeRequest leaves every other type untouched")
    void normalizeIgnoresOtherTypes() {
        EngagementItemRequest r = request(PAYLOAD);
        EngagementItemChangePolicy.normalizeRequest(EngagementEnums.ItemType.QUESTION_OF_DAY, r, om);
        assertEquals(PAYLOAD, r.getPayloadJson());
        assertEquals(20, r.getCorrectPoints());
    }

    @Test
    @DisplayName("FLASHCARDS: re-saving an unchanged deck (reordered keys, extra spaces, different forced values) is not a change")
    void flashcardsUnchangedIsNoOp() {
        EngagementItemRequest resave = flashcardsRequest(DECK.replace("\"Impairment\"", "\"  Impairment \""));
        resave.setCorrectPoints(30);
        resave.setHideResultUntilReveal(true);
        EngagementItemChangePolicy.normalizeRequest(EngagementEnums.ItemType.FLASHCARDS, resave, om);
        assertFalse(EngagementItemChangePolicy.isLearnerVisibleChange(storedDeck(), resave, om));

        // Even a caller that skipped normalizeRequest compares the canonical decks.
        EngagementItemRequest raw = flashcardsRequest(DECK);
        raw.setMaxScore(2);
        assertFalse(EngagementItemChangePolicy.isLearnerVisibleChange(storedDeck(), raw, om));
    }

    @Test
    @DisplayName("FLASHCARDS: a card edit, a new card, or a shuffle change is a change (version bump, same id)")
    void flashcardsEditsAreChanges() {
        EngagementItemRequest edited = flashcardsRequest(DECK.replace("Body level", "Body-level"));
        EngagementItemChangePolicy.normalizeRequest(EngagementEnums.ItemType.FLASHCARDS, edited, om);
        assertTrue(EngagementItemChangePolicy.isLearnerVisibleChange(storedDeck(), edited, om));

        EngagementItemRequest shuffle = flashcardsRequest(DECK.replace("\"shuffle\":true", "\"shuffle\":false"));
        EngagementItemChangePolicy.normalizeRequest(EngagementEnums.ItemType.FLASHCARDS, shuffle, om);
        assertTrue(EngagementItemChangePolicy.isLearnerVisibleChange(storedDeck(), shuffle, om));

        EngagementItemRequest added = flashcardsRequest(DECK.replace("]", ",{\"id\":\"c_3\",\"front\":\"New\",\"back\":\"Card\"}]"));
        EngagementItemChangePolicy.normalizeRequest(EngagementEnums.ItemType.FLASHCARDS, added, om);
        assertEquals(3, added.getMaxScore());
        assertTrue(EngagementItemChangePolicy.isLearnerVisibleChange(storedDeck(), added, om));

        // Card edits stay allowed after learners completed the deck: no answer key.
        assertDoesNotThrow(() -> EngagementItemChangePolicy.guardAnswerKey(storedDeck(), edited, 4, om));
    }

    @Test
    @DisplayName("FLASHCARDS: an invalid deck is rejected with the teacher-facing message")
    void flashcardsInvalidRejected() {
        EngagementItemRequest empty = flashcardsRequest("{\"schema\":\"flashcards/v1\",\"cards\":[]}");
        VacademyException e = assertThrows(VacademyException.class,
                () -> EngagementItemChangePolicy.normalizeRequest(EngagementEnums.ItemType.FLASHCARDS, empty, om));
        assertEquals("Add at least 1 card", e.getMessage());

        // An invalid incoming deck compares as a change, so the save reaches validation.
        EngagementItemRequest broken = flashcardsRequest("{\"cards\":[{\"id\":\"c_1\",\"front\":\"x\"}]}");
        assertTrue(EngagementItemChangePolicy.isLearnerVisibleChange(storedDeck(), broken, om));
        assertThrows(VacademyException.class,
                () -> EngagementItemChangePolicy.validate(EngagementEnums.ItemType.FLASHCARDS, broken, om));

        EngagementItemRequest longTitle = flashcardsRequest(DECK);
        longTitle.setTitle("t".repeat(201));
        assertThrows(VacademyException.class,
                () -> EngagementItemChangePolicy.validate(EngagementEnums.ItemType.FLASHCARDS, longTitle, om));
    }

    @Test
    @DisplayName("FLASHCARDS: converting a GAME to FLASHCARDS is a type change, locked once learners completed it")
    void gameToFlashcardsLockedAfterCompletion() {
        EngagementItem game = new EngagementItem();
        game.setId("deck-1");
        game.setItemType("GAME");
        game.setTitle("Key terms");
        game.setContentHtml("<script>var cards=[]</script>");
        game.setCompletionPoints(10);
        game.setIsRequired(true);

        EngagementItemRequest convert = flashcardsRequest(DECK);
        EngagementItemChangePolicy.normalizeRequest(EngagementEnums.ItemType.FLASHCARDS, convert, om);
        assertTrue(EngagementItemChangePolicy.isLearnerVisibleChange(game, convert, om));
        assertThrows(VacademyException.class,
                () -> EngagementItemChangePolicy.guardAnswerKey(game, convert, 1, om));
        assertDoesNotThrow(() -> EngagementItemChangePolicy.guardAnswerKey(game, convert, 0, om));
    }
}
