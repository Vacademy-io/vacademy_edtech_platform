package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.common.exceptions.VacademyException;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The FLASHCARDS payload contract ({@code flashcards/v1}).
 *
 * <pre>
 * {"schema":"flashcards/v1",
 *  "cards":[{"id":"c_7k2m9q","front":"Impairment","back":"A problem in body function","hint":"Body level"}],
 *  "settings":{"shuffle":true}}
 * </pre>
 *
 * The server is authoritative; the admin zod schema mirrors these rules exactly.
 * <ul>
 *   <li>1 to 50 cards.</li>
 *   <li>Lengths in UTF-16 units ({@code String.length()}, the same unit as JS
 *       {@code .length}) after normalisation: front 1-200, back 1-500, hint 0-150.</li>
 *   <li>Normalisation: {@code \r\n} and lone {@code \r} become {@code \n}; every
 *       other character JS {@code \s} matches (TAB, VT, FF, NBSP, U+2028/2029, BOM ...)
 *       becomes a space; remaining control characters (C0, DEL, C1) are removed; runs of
 *       spaces collapse to one; the face is then stripped (like JS {@code trim()}).</li>
 *   <li>A face with more than 12 lines is REJECTED, never truncated.</li>
 *   <li>Text is plain text and is never HTML-stripped: {@code 2 < x > 1} and
 *       {@code <b>x</b>} are kept verbatim. Every renderer treats it as text.</li>
 *   <li>Card ids match {@code ^[a-z0-9_-]{1,24}$} and are unique within the task. The
 *       client mints them; the server mints one only when an id is missing, and
 *       rejects a duplicate or malformed id.</li>
 *   <li>Settings: only {@code shuffle} (boolean, default true). Unknown keys - including
 *       the deferred {@code startWith} and {@code frontImageFileId} - are dropped, as
 *       are unknown top-level and card keys.</li>
 * </ul>
 *
 * Pure static functions so the rules are unit-testable without Spring.
 */
public final class FlashcardsPayloadValidator {

    public static final String SCHEMA = "flashcards/v1";
    public static final int MIN_CARDS = 1;
    public static final int MAX_CARDS = 50;
    public static final int MAX_FRONT = 200;
    public static final int MAX_BACK = 500;
    public static final int MAX_HINT = 150;
    public static final int MAX_LINES = 12;
    public static final Pattern ID_PATTERN = Pattern.compile("^[a-z0-9_-]{1,24}$");

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
    private static final Pattern SPACE_RUNS = Pattern.compile(" {2,}");

    private FlashcardsPayloadValidator() {}

    /** One card, already normalised. {@code hint} is never null ("" when absent). */
    public record Card(String id, String front, String back, String hint) {}

    /** A parsed deck. {@code cards} is unmodifiable and in authored order. */
    public record Parsed(List<Card> cards, boolean shuffle) {
        public Parsed {
            cards = cards == null ? List.of() : Collections.unmodifiableList(new ArrayList<>(cards));
        }

        /** The card ids in deck order. */
        public Set<String> cardIds() {
            Set<String> ids = new LinkedHashSet<>();
            for (Card c : cards) ids.add(c.id());
            return ids;
        }

        public int size() {
            return cards.size();
        }
    }

    // ── authoring ────────────────────────────────────────────────────────────

    /**
     * Parse, normalise and validate an authored payload. Throws a
     * {@link VacademyException} whose message is shown to the teacher as-is
     * ("Card 4: back is required").
     */
    public static Parsed parseAndValidate(String payloadJson) {
        if (payloadJson == null || payloadJson.isBlank()) {
            throw new VacademyException("Add at least 1 card");
        }
        JsonNode root;
        try {
            root = MAPPER.readTree(payloadJson);
        } catch (Exception e) {
            throw new VacademyException("The flashcards could not be read. Please re-open the editor and try again.");
        }
        if (root == null || !root.isObject()) {
            throw new VacademyException("The flashcards could not be read. Please re-open the editor and try again.");
        }
        JsonNode schema = root.get("schema");
        if (schema != null && !schema.isNull() && !SCHEMA.equals(schema.asText())) {
            throw new VacademyException("Unsupported flashcards format: " + schema.asText());
        }
        JsonNode cardsNode = root.get("cards");
        if (cardsNode == null || !cardsNode.isArray() || cardsNode.isEmpty()) {
            throw new VacademyException("Add at least 1 card");
        }
        if (cardsNode.size() > MAX_CARDS) {
            throw new VacademyException("Flashcards can have at most " + MAX_CARDS + " cards");
        }

        // First pass: collect every supplied id so a minted id can never collide with
        // one that appears later in the deck.
        Set<String> suppliedIds = new HashSet<>();
        for (JsonNode card : cardsNode) {
            String id = card != null && card.isObject() ? rawId(card) : null;
            if (id != null) suppliedIds.add(id);
        }

        List<Card> cards = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int n = 0;
        for (JsonNode card : cardsNode) {
            n++;
            if (card == null || !card.isObject()) {
                throw new VacademyException("Card " + n + ": front is required");
            }
            String front = normalise(face(card, "front", n));
            String back = normalise(face(card, "back", n));
            String hint = normalise(face(card, "hint", n));

            if (front.isEmpty()) throw new VacademyException("Card " + n + ": front is required");
            if (back.isEmpty()) throw new VacademyException("Card " + n + ": back is required");
            checkLength(n, "front", front, MAX_FRONT);
            checkLength(n, "back", back, MAX_BACK);
            checkLength(n, "hint", hint, MAX_HINT);
            checkLines(n, "front", front);
            checkLines(n, "back", back);
            checkLines(n, "hint", hint);

            String id = rawId(card);
            if (id == null) {
                id = mintId(suppliedIds);
                suppliedIds.add(id);
            } else if (!ID_PATTERN.matcher(id).matches()) {
                throw new VacademyException("Card " + n + ": invalid id");
            }
            if (!seen.add(id)) {
                throw new VacademyException("Card " + n + ": duplicate id");
            }
            cards.add(new Card(id, front, back, hint));
        }
        return new Parsed(cards, readShuffle(root));
    }

    /**
     * The canonical stored form. Stable: parsing its own output (after any key
     * reordering or whitespace change, which jsonb does) yields an equal tree, so it can
     * feed the no-op compare in {@link EngagementItemChangePolicy}. An empty hint is
     * omitted.
     */
    public static String canonicalJson(Parsed parsed, ObjectMapper objectMapper) {
        ObjectMapper om = objectMapper == null ? MAPPER : objectMapper;
        ObjectNode root = om.createObjectNode();
        root.put("schema", SCHEMA);
        ArrayNode cards = root.putArray("cards");
        for (Card c : parsed.cards()) {
            ObjectNode node = cards.addObject();
            node.put("id", c.id());
            node.put("front", c.front());
            node.put("back", c.back());
            if (c.hint() != null && !c.hint().isEmpty()) node.put("hint", c.hint());
        }
        root.putObject("settings").put("shuffle", parsed.shuffle());
        try {
            return om.writeValueAsString(root);
        } catch (Exception e) {
            throw new VacademyException("Could not save the flashcards");
        }
    }

    /** {@code canonicalJson(parseAndValidate(payloadJson))}: validate and canonicalise in one step. */
    public static String canonicalise(String payloadJson, ObjectMapper objectMapper) {
        return canonicalJson(parseAndValidate(payloadJson), objectMapper);
    }

    // ── reading stored decks ─────────────────────────────────────────────────

    /**
     * Read a STORED deck for grading and tracking. Tolerant: never throws. Malformed
     * JSON gives an empty deck; a card with no usable id, or a repeated id, is skipped
     * (it could never be graded); text is returned as stored. The caller decides what an
     * empty deck means (grading rejects it; tracking shows nothing).
     */
    public static Parsed readTrusted(String storedJson) {
        if (storedJson == null || storedJson.isBlank()) return new Parsed(List.of(), true);
        JsonNode root;
        try {
            root = MAPPER.readTree(storedJson);
        } catch (Exception e) {
            return new Parsed(List.of(), true);
        }
        if (root == null || !root.isObject()) return new Parsed(List.of(), true);
        List<Card> cards = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        JsonNode cardsNode = root.get("cards");
        if (cardsNode != null && cardsNode.isArray()) {
            for (JsonNode card : cardsNode) {
                if (card == null || !card.isObject()) continue;
                String id = rawId(card);
                if (id == null || !seen.add(id)) continue;
                cards.add(new Card(id, textOrEmpty(card.get("front")), textOrEmpty(card.get("back")),
                        textOrEmpty(card.get("hint"))));
            }
        }
        return new Parsed(cards, readShuffle(root));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /**
     * Normalise one face: newlines to {@code \n}, every other JS-{@code \s} character
     * to a space, drop the remaining control characters, collapse runs of spaces, strip.
     * Controls are dropped BEFORE spaces collapse, so "a \u0007 b" becomes "a b".
     * Exposed so tests and the client contract share one definition.
     */
    public static String normalise(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        String s = raw.replace("\r\n", "\n").replace('\r', '\n');
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\n') {
                out.append(c);
            } else if (isJsWhitespace(c)) {
                // TAB, VT, FF, NBSP, U+2028/2029, BOM ... : every character JS `\s`
                // matches (so the client's /[^\S\n]+/ agrees) becomes one space.
                out.append(' ');
            } else if (Character.getType(c) == Character.CONTROL) {
                // dropped (C0 and C1 controls, DEL)
            } else {
                out.append(c);
            }
        }
        return SPACE_RUNS.matcher(out).replaceAll(" ").strip();
    }

    /**
     * Exactly the set JavaScript's {@code \s} matches, minus {@code \n} (handled by the
     * caller): the client normaliser uses {@code /[^\S\n]+/}, so both sides treat the
     * same characters as horizontal whitespace.
     */
    private static boolean isJsWhitespace(char c) {
        switch (c) {
            case '\t', '\u000B', '\f', ' ', ' ', ' ', ' ', ' ', ' ', ' ',
                 '　', '﻿' -> {
                return true;
            }
            default -> {
                return c >= ' ' && c <= ' ';
            }
        }
    }

    /** {@code c_} plus 6 base36 characters, unique against {@code taken}. */
    public static String mintId(Set<String> taken) {
        for (int attempt = 0; attempt < 100; attempt++) {
            StringBuilder sb = new StringBuilder("c_");
            for (int i = 0; i < 6; i++) sb.append(BASE36.charAt(RANDOM.nextInt(BASE36.length())));
            String id = sb.toString();
            if (taken == null || !taken.contains(id)) return id;
        }
        throw new VacademyException("Could not assign card ids. Please try again.");
    }

    private static String face(JsonNode card, String field, int n) {
        JsonNode node = card.get(field);
        if (node == null || node.isNull() || node.isMissingNode()) return "";
        if (node.isTextual()) return node.textValue();
        if (node.isValueNode()) return node.asText();
        throw new VacademyException("Card " + n + ": " + field + " must be text");
    }

    private static String rawId(JsonNode card) {
        JsonNode node = card.get("id");
        if (node == null || node.isNull() || !node.isValueNode()) return null;
        String id = node.asText();
        return id == null || id.isBlank() ? null : id.strip();
    }

    private static String textOrEmpty(JsonNode node) {
        if (node == null || node.isNull() || !node.isValueNode()) return "";
        return node.asText();
    }

    private static boolean readShuffle(JsonNode root) {
        JsonNode settings = root.get("settings");
        if (settings == null || !settings.isObject()) return true;
        JsonNode shuffle = settings.get("shuffle");
        return shuffle == null || !shuffle.isBoolean() || shuffle.booleanValue();
    }

    private static void checkLength(int n, String field, String value, int max) {
        if (value.length() > max) {
            throw new VacademyException("Card " + n + ": " + field + " is longer than " + max + " characters");
        }
    }

    private static void checkLines(int n, String field, String value) {
        if (value.isEmpty()) return;
        int lines = 1;
        for (int i = 0; i < value.length(); i++) if (value.charAt(i) == '\n') lines++;
        if (lines > MAX_LINES) {
            throw new VacademyException("Card " + n + ": " + field + " has more than " + MAX_LINES + " lines");
        }
    }
}
