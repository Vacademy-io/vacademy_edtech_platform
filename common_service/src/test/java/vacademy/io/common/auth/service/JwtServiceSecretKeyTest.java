package vacademy.io.common.auth.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class JwtServiceSecretKeyTest {

    private static final String LEGACY = "357638792F423F4428472B4B6250655368566D597133743677397A2443264629";
    private static final String ROTATED = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Test
    void unsetFallsBackToLegacyKey() {
        assertEquals(LEGACY, JwtService.resolveSecretKey(null));
        assertEquals(LEGACY, JwtService.resolveSecretKey("   "));
    }

    @Test
    void legacyValueFromEnvIsKept() {
        assertEquals(LEGACY, JwtService.resolveSecretKey(LEGACY + "\n"));
    }

    @Test
    void validEnvKeyIsUsed() {
        assertEquals(ROTATED, JwtService.resolveSecretKey(" " + ROTATED + " "));
    }

    // Set but unusable must fail startup, never quietly keep the public key.
    @Test
    void unusableEnvKeyFailsInsteadOfFallingBack() {
        assertThrows(IllegalStateException.class, () -> JwtService.resolveSecretKey("auto-generated-64-hex"));
        assertThrows(IllegalStateException.class, () -> JwtService.resolveSecretKey("c2hvcnQ="));
        // `openssl rand -hex 16`: valid BASE64 but only 24 bytes.
        assertThrows(IllegalStateException.class, () -> JwtService.resolveSecretKey("0123456789abcdef0123456789abcdef"));
    }
}
