package vacademy.io.common.auth.apikey;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ApiKeyFormatTest {

    private static final String HEX48 = "0123456789abcdef0123456789abcdef0123456789abcdef";

    @Test
    void acceptsEvaluationAndLegacyLiveKeys() {
        assertTrue(ApiKeyFormat.isWellFormed("vak_eval_" + HEX48));
        assertTrue(ApiKeyFormat.isWellFormed("vak_live_" + HEX48));
    }

    @Test
    void rejectsMalformedInput() {
        assertFalse(ApiKeyFormat.isWellFormed(null));
        assertFalse(ApiKeyFormat.isWellFormed(""));
        assertFalse(ApiKeyFormat.isWellFormed("vak_eval_" + HEX48.substring(1)));        // 47 hex
        assertFalse(ApiKeyFormat.isWellFormed("vak_eval_" + HEX48 + "0"));               // 49 hex
        assertFalse(ApiKeyFormat.isWellFormed("vak_eval_" + HEX48.toUpperCase()));       // uppercase hex
        assertFalse(ApiKeyFormat.isWellFormed("vak_EVAL_" + HEX48));
        assertFalse(ApiKeyFormat.isWellFormed("vak__" + HEX48));
        assertFalse(ApiKeyFormat.isWellFormed("Bearer vak_eval_" + HEX48));
        assertFalse(ApiKeyFormat.isWellFormed("vak_eval_" + HEX48 + "\n"));
        assertFalse(ApiKeyFormat.isWellFormed("vak_eval_" + "g".repeat(48)));
        assertFalse(ApiKeyFormat.isWellFormed("vak_" + "a".repeat(200) + "_" + HEX48));  // over length cap
    }

    @Test
    void sha256HexMatchesKnownVector() {
        // printf 'abc' | shasum -a 256
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", ApiKeyFormat.sha256Hex("abc"));
        String hash = ApiKeyFormat.sha256Hex("vak_eval_" + HEX48);
        assertEquals(64, hash.length());
        assertTrue(hash.matches("[0-9a-f]{64}"));
        assertThrows(IllegalArgumentException.class, () -> ApiKeyFormat.sha256Hex(null));
    }

    @Test
    void generatedKeysAreWellFormedAndDistinct() {
        String a = ApiKeyFormat.generate(ApiKeyFormat.EVALUATION_MARKER);
        String b = ApiKeyFormat.generate(ApiKeyFormat.EVALUATION_MARKER);
        assertTrue(a.startsWith("vak_eval_"));
        assertTrue(ApiKeyFormat.isWellFormed(a));
        assertNotEquals(a, b);
        assertThrows(IllegalArgumentException.class, () -> ApiKeyFormat.generate("Eval"));
        assertThrows(IllegalArgumentException.class, () -> ApiKeyFormat.generate(null));
    }

    @Test
    void displayPrefixIsSixteenCharacters() {
        assertEquals("vak_eval_0123456", ApiKeyFormat.displayPrefix("vak_eval_" + HEX48));
        assertEquals("short", ApiKeyFormat.displayPrefix("short"));
        assertNull(ApiKeyFormat.displayPrefix(null));
    }
}
