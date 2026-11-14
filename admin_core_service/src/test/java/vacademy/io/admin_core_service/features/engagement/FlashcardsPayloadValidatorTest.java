package vacademy.io.admin_core_service.features.engagement;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.service.FlashcardsPayloadValidator;
import vacademy.io.admin_core_service.features.engagement.service.FlashcardsPayloadValidator.Card;
import vacademy.io.admin_core_service.features.engagement.service.FlashcardsPayloadValidator.Parsed;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The flashcards/v1 authoring contract (flashcards spec B1 / B7). */
class FlashcardsPayloadValidatorTest {

    private final ObjectMapper om = new ObjectMapper();

    private String deck(int n) {
        ObjectNode root = om.createObjectNode();
        root.put("schema", "flashcards/v1");
        ArrayNode cards = root.putArray("cards");
        for (int i = 1; i <= n; i++) {
            ObjectNode c = cards.addObject();
            c.put("id", "c_" + i);
            c.put("front", "Front " + i);
            c.put("back", "Back " + i);
        }
        root.putObject("settings").put("shuffle", true);
        return root.toString();
    }

    private String oneCard(String front, String back, String hint) throws Exception {
        ObjectNode root = om.createObjectNode();
        ObjectNode c = root.putArray("cards").addObject();
        c.put("id", "c_1");
        c.put("front", front);
        c.put("back", back);
        if (hint != null) c.put("hint", hint);
        return om.writeValueAsString(root);
    }

    private String message(Runnable r) {
        return assertThrows(VacademyException.class, r::run).getMessage();
    }

    @Test
    @DisplayName("0 and 51 cards are rejected; 1 and 50 are accepted")
    void cardCount() {
        assertEquals("Add at least 1 card", message(() -> FlashcardsPayloadValidator.parseAndValidate(deck(0))));
        assertEquals("Add at least 1 card", message(() -> FlashcardsPayloadValidator.parseAndValidate(null)));
        assertEquals("Add at least 1 card", message(() -> FlashcardsPayloadValidator.parseAndValidate("{}")));
        assertEquals("Flashcards can have at most 50 cards",
                message(() -> FlashcardsPayloadValidator.parseAndValidate(deck(51))));
        assertEquals(1, FlashcardsPayloadValidator.parseAndValidate(deck(1)).size());
        assertEquals(50, FlashcardsPayloadValidator.parseAndValidate(deck(50)).size());
    }

    @Test
    @DisplayName("over-length faces are rejected at the UTF-16 limit, not before")
    void lengths() throws Exception {
        String front200 = "a".repeat(200);
        FlashcardsPayloadValidator.parseAndValidate(oneCard(front200, "b".repeat(500), "h".repeat(150)));

        assertEquals("Card 1: front is longer than 200 characters",
                message(() -> parse(oneCardUnchecked("a".repeat(201), "b", null))));
        assertEquals("Card 1: back is longer than 500 characters",
                message(() -> parse(oneCardUnchecked("a", "b".repeat(501), null))));
        assertEquals("Card 1: hint is longer than 150 characters",
                message(() -> parse(oneCardUnchecked("a", "b", "h".repeat(151)))));

        // An emoji is 2 UTF-16 units, as in JS .length: 100 of them fill the front.
        String hundredEmoji = "😀".repeat(100);
        FlashcardsPayloadValidator.parseAndValidate(oneCard(hundredEmoji, "b", null));
        assertThrows(VacademyException.class,
                () -> parse(oneCardUnchecked(hundredEmoji + "x", "b", null)));
    }

    @Test
    @DisplayName("a 13-line face is rejected, 12 lines are fine")
    void lines() throws Exception {
        String twelve = String.join("\n", List.of("1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"));
        FlashcardsPayloadValidator.parseAndValidate(oneCard("front", twelve, null));
        assertEquals("Card 1: back has more than 12 lines",
                message(() -> parse(oneCardUnchecked("front", twelve + "\n13", null))));
    }

    @Test
    @DisplayName("a blank back or front is rejected with the card number")
    void blankFaces() throws Exception {
        String twoCards = "{\"cards\":[{\"id\":\"a\",\"front\":\"x\",\"back\":\"y\"},"
                + "{\"id\":\"b\",\"front\":\"x2\",\"back\":\"   \"}]}";
        assertEquals("Card 2: back is required", message(() -> parse(twoCards)));
        assertEquals("Card 1: front is required", message(() -> parse(oneCardUnchecked("\n\t ", "y", null))));
        assertEquals("Card 1: front is required",
                message(() -> parse("{\"cards\":[{\"id\":\"a\",\"back\":\"y\"}]}")));
    }

    @Test
    @DisplayName("angle brackets and tags are kept verbatim, never HTML-stripped")
    void noHtmlStripping() throws Exception {
        Parsed p = FlashcardsPayloadValidator.parseAndValidate(oneCard("2 < x > 1", "<b>x</b>", "a && b"));
        Card c = p.cards().get(0);
        assertEquals("2 < x > 1", c.front());
        assertEquals("<b>x</b>", c.back());
        assertEquals("a && b", c.hint());
    }

    @Test
    @DisplayName("control characters are removed, \\n kept, CRLF normalised, horizontal whitespace collapsed")
    void normalisation() throws Exception {
        Parsed p = FlashcardsPayloadValidator.parseAndValidate(
                oneCard("  a\u0000b\u0007  c\t\td  ", "line1\r\nline2\rline3\u001B", null));
        Card c = p.cards().get(0);
        assertEquals("ab c d", c.front());
        assertEquals("line1\nline2\nline3", c.back());
        assertEquals("", c.hint());
        assertEquals("x y", FlashcardsPayloadValidator.normalise("x   y"));
    }

    @Test
    @DisplayName("every JS whitespace character becomes a space (client parity); C1 controls are dropped before spaces collapse")
    void normalisationMatchesClientWhitespace() {
        assertEquals("a b c d e f g", FlashcardsPayloadValidator.normalise(
                "a\u000Bb\fc d e　f﻿g"));
        assertEquals("a b", FlashcardsPayloadValidator.normalise("﻿ a \u0007 b  "));
        assertEquals("ab", FlashcardsPayloadValidator.normalise("a\u0085\u009Fb"));
        // U+2028 is not a line break for the 12-line rule: it becomes a space.
        assertEquals("1 2 3", FlashcardsPayloadValidator.normalise("1 2 3"));
        // Format characters that are not whitespace (the ZWJ inside an emoji) are kept.
        String womanTechnologist = "👩‍💻";
        assertEquals(womanTechnologist, FlashcardsPayloadValidator.normalise(womanTechnologist));
    }

    @Test
    @DisplayName("a missing id is minted; an existing id is kept; minted ids match the id pattern")
    void ids() {
        Parsed p = FlashcardsPayloadValidator.parseAndValidate(
                "{\"cards\":[{\"front\":\"f1\",\"back\":\"b1\"},{\"id\":\"keep_me\",\"front\":\"f2\",\"back\":\"b2\"},"
                        + "{\"id\":\"  \",\"front\":\"f3\",\"back\":\"b3\"}]}");
        assertEquals("keep_me", p.cards().get(1).id());
        String minted = p.cards().get(0).id();
        assertTrue(FlashcardsPayloadValidator.ID_PATTERN.matcher(minted).matches(), minted);
        assertTrue(minted.startsWith("c_") && minted.length() == 8, minted);
        assertNotEquals(minted, p.cards().get(2).id());
        assertEquals(3, p.cardIds().size());
    }

    @Test
    @DisplayName("a duplicate id is rejected, and a malformed id is rejected")
    void duplicateAndMalformedIds() {
        assertEquals("Card 2: duplicate id", message(() -> parse(
                "{\"cards\":[{\"id\":\"a\",\"front\":\"x\",\"back\":\"y\"},{\"id\":\"a\",\"front\":\"x2\",\"back\":\"y2\"}]}")));
        assertEquals("Card 1: invalid id", message(() -> parse(
                "{\"cards\":[{\"id\":\"Upper Case\",\"front\":\"x\",\"back\":\"y\"}]}")));
        assertEquals("Card 1: invalid id", message(() -> parse(
                "{\"cards\":[{\"id\":\"" + "a".repeat(25) + "\",\"front\":\"x\",\"back\":\"y\"}]}")));
    }

    @Test
    @DisplayName("unknown settings (startWith, frontImageFileId) and unknown keys are dropped; shuffle defaults to true")
    void unknownKeysDropped() throws Exception {
        String payload = "{\"schema\":\"flashcards/v1\",\"extra\":1,"
                + "\"cards\":[{\"id\":\"a\",\"front\":\"x\",\"back\":\"y\",\"frontImageFileId\":\"f\",\"score\":9}],"
                + "\"settings\":{\"shuffle\":false,\"startWith\":\"back\",\"frontImageFileId\":\"f\"}}";
        JsonNode canonical = om.readTree(FlashcardsPayloadValidator.canonicalise(payload, om));
        assertEquals(om.readTree("{\"schema\":\"flashcards/v1\",\"cards\":[{\"id\":\"a\",\"front\":\"x\",\"back\":\"y\"}],"
                + "\"settings\":{\"shuffle\":false}}"), canonical);

        assertTrue(FlashcardsPayloadValidator.parseAndValidate(
                "{\"cards\":[{\"id\":\"a\",\"front\":\"x\",\"back\":\"y\"}]}").shuffle());
        assertTrue(FlashcardsPayloadValidator.parseAndValidate(
                "{\"cards\":[{\"id\":\"a\",\"front\":\"x\",\"back\":\"y\"}],\"settings\":{\"shuffle\":\"no\"}}").shuffle());
    }

    @Test
    @DisplayName("an unknown schema version and unreadable JSON are rejected")
    void badEnvelope() {
        assertThrows(VacademyException.class, () -> parse(
                "{\"schema\":\"flashcards/v2\",\"cards\":[{\"id\":\"a\",\"front\":\"x\",\"back\":\"y\"}]}"));
        assertThrows(VacademyException.class, () -> parse("{not json"));
        assertThrows(VacademyException.class, () -> parse("[1,2]"));
        assertEquals("Card 1: front must be text",
                message(() -> parse("{\"cards\":[{\"id\":\"a\",\"front\":{\"x\":1},\"back\":\"y\"}]}")));
    }

    @Test
    @DisplayName("canonical output is stable: re-read after key reordering and whitespace changes it is readTree-equal")
    void canonicalStability() throws Exception {
        String payload = "{\"schema\":\"flashcards/v1\",\"cards\":[{\"id\":\"a\",\"front\":\" Front  one \",\"back\":\"Back\",\"hint\":\"h\"},"
                + "{\"id\":\"b\",\"front\":\"Two\",\"back\":\"B2\",\"hint\":\"\"}],\"settings\":{\"shuffle\":true}}";
        String canonical = FlashcardsPayloadValidator.canonicalise(payload, om);

        // What jsonb hands back: keys reordered, whitespace added.
        String roundTripped = "{ \"settings\" : { \"shuffle\" : true },\n  \"cards\" : [ "
                + "{ \"hint\" : \"h\", \"back\" : \"Back\", \"front\" : \"Front one\", \"id\" : \"a\" },"
                + "{ \"back\" : \"B2\", \"id\" : \"b\", \"front\" : \"Two\" } ], \"schema\" : \"flashcards/v1\" }";
        assertEquals(om.readTree(canonical), om.readTree(roundTripped));
        // Canonicalising the canonical form again changes nothing.
        assertEquals(om.readTree(canonical),
                om.readTree(FlashcardsPayloadValidator.canonicalise(roundTripped, om)));
        // An empty hint is omitted.
        assertFalse(om.readTree(canonical).get("cards").get(1).has("hint"));
    }

    @Test
    @DisplayName("readTrusted is tolerant: never throws, skips cards without a usable or unique id")
    void readTrusted() {
        assertEquals(0, FlashcardsPayloadValidator.readTrusted(null).size());
        assertEquals(0, FlashcardsPayloadValidator.readTrusted("{broken").size());
        assertEquals(0, FlashcardsPayloadValidator.readTrusted("\"a string\"").size());
        Parsed p = FlashcardsPayloadValidator.readTrusted(
                "{\"cards\":[{\"id\":\"a\",\"front\":\"x\",\"back\":\"y\"},{\"front\":\"no id\"},"
                        + "{\"id\":\"a\",\"front\":\"dup\"},7,{\"id\":\"b\",\"front\":\"f\",\"back\":\"g\",\"hint\":\"h\"}],"
                        + "\"settings\":{\"shuffle\":false}}");
        assertEquals(Set.of("a", "b"), p.cardIds());
        assertEquals("x", p.cards().get(0).front());
        assertEquals("h", p.cards().get(1).hint());
        assertFalse(p.shuffle());
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static Parsed parse(String json) {
        return FlashcardsPayloadValidator.parseAndValidate(json);
    }

    private String oneCardUnchecked(String front, String back, String hint) {
        try {
            return oneCard(front, back, hint);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
