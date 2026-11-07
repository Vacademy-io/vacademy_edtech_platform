package vacademy.io.admin_core_service.features.institute_api.service;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ApiKeySecretsTest {

    @Test
    void newKeyIsVakEvalPlus48LowercaseHex() {
        String key = ApiKeySecrets.newEvaluationKey();
        assertTrue(key.matches("^vak_eval_[0-9a-f]{48}$"), key);
        // Also passes the generic format the common ApiKeyFormat will check (spec 6.1).
        assertTrue(key.matches("^vak_[a-z]+_[0-9a-f]{48}$"), key);
    }

    @Test
    void keysAreUnique() {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 1000; i++) {
            assertTrue(seen.add(ApiKeySecrets.newEvaluationKey()));
        }
    }

    @Test
    void sha256HexMatchesKnownVector() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                ApiKeySecrets.sha256Hex("abc"));
        assertEquals(64, ApiKeySecrets.sha256Hex(ApiKeySecrets.newEvaluationKey()).length());
    }

    @Test
    void displayPrefixIsFirst16Chars() {
        String key = "vak_eval_0123456789abcdef0123456789abcdef0123456789abcdef";
        assertEquals("vak_eval_0123456", ApiKeySecrets.displayPrefix(key));
    }

    @Test
    void normalizeHashFoldsCaseAndRejectsMalformed() {
        String h = ApiKeySecrets.sha256Hex("abc");
        assertEquals(h, ApiKeySecrets.normalizeHash(h.toUpperCase()));
        assertEquals(h, ApiKeySecrets.normalizeHash("  " + h + " "));
        assertNull(ApiKeySecrets.normalizeHash(null));
        assertNull(ApiKeySecrets.normalizeHash(""));
        assertNull(ApiKeySecrets.normalizeHash(h.substring(1)));
        assertNull(ApiKeySecrets.normalizeHash("vak_eval_" + h.substring(0, 48)));
        assertNull(ApiKeySecrets.normalizeHash(h.substring(1) + "g"));
    }
}
