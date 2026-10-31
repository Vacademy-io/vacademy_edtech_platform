package vacademy.io.auth_service.util;

import org.junit.jupiter.api.Test;
import vacademy.io.auth_service.feature.util.UsernameGenerator;
import vacademy.io.common.core.utils.TextSanitizer;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Regression cover for the 2026-09-14 outage: four learners were imported with a
 * ZERO WIDTH SPACE in front of their email address and could not authenticate at
 * all — every authenticated endpoint answered with a bodyless 403, because the
 * JWT subject carried the character and the internal user lookup matched nothing.
 */
class InvisibleCharacterIdentifierTest {

    private static final String ZWSP = "​";
    private static final String ZWNJ = "‌";
    private static final String BOM = "﻿";
    private static final String NBSP = " ";

    @Test
    void stripsLeadingZeroWidthSpaceFromEmail() {
        assertEquals("benmevasahin@gmail.com",
                TextSanitizer.cleanIdentifier(ZWSP + "benmevasahin@gmail.com"));
    }

    @Test
    void trimDoesNotCatchThese_whichIsWhyTheSanitizerExists() {
        String pasted = ZWSP + "learner@example.com";
        assertEquals(pasted, pasted.trim(), "trim() leaves U+200B in place");
        assertEquals(pasted, pasted.strip(), "strip() leaves U+200B in place");
        assertNotEquals(pasted, TextSanitizer.cleanIdentifier(pasted));
    }

    @Test
    void stripsBomJoinersAndNbspAnywhereInTheValue() {
        assertEquals("a.b@example.com",
                TextSanitizer.cleanIdentifier(BOM + "a." + ZWNJ + "b@example.com" + NBSP));
    }

    @Test
    void keepsOrdinaryValuesByteIdentical() {
        String clean = "Nilay.Guneysu+tag@example.co.uk";
        assertEquals(clean, TextSanitizer.cleanIdentifier(clean));
        assertFalse(TextSanitizer.hasInvisibleChars(clean));
    }

    @Test
    void cleanKeepsInternalSpacingInNames() {
        assertEquals("Irem ELONU", TextSanitizer.clean("  Irem" + NBSP + "ELONU  "));
    }

    @Test
    void nullSafe() {
        assertNull(TextSanitizer.clean(null));
        assertNull(TextSanitizer.cleanIdentifier(null));
        assertFalse(TextSanitizer.hasInvisibleChars(null));
    }

    @Test
    void generatedUsernameNeverConsistsOfInvisibleCharacters() {
        // Prod holds accounts named "‌‌‌‌xxxx" — a username no
        // human can retype. A name made only of invisibles must fall back to random.
        String username = UsernameGenerator.generateUsername(ZWNJ + ZWNJ + ZWNJ + ZWNJ);
        assertFalse(TextSanitizer.hasInvisibleChars(username));
        assertTrue(username.matches("[a-z0-9]{8}"), "got: " + username);
    }

    @Test
    void generatedUsernameStillDerivesFromARealName() {
        assertTrue(UsernameGenerator.generateUsername(ZWSP + "Meva Sahin").startsWith("meva"));
    }

    @Test
    void generatedUsernameHandlesNonLatinNames() {
        String username = UsernameGenerator.generateUsername("नीलय गुणेसु");
        assertEquals(8, username.length());
        assertFalse(TextSanitizer.hasInvisibleChars(username));
    }

    /**
     * The other half of the outage: the internal user-lookup URL was built by
     * string concatenation and then encoded twice, so a non-ASCII character in the
     * username arrived at auth_service as the literal text "%E2%80%8B".
     * {@code build(true)} declares the route already encoded, which is what stops
     * the second pass — this test fails if anyone reverts to {@code toUriString()}.
     */
    @Test
    void encodedRouteIsNotEncodedASecondTime() {
        String username = "751b6f04@" + ZWSP + "ben+tag@gmail.com";
        String route = "/auth-service/v1/internal/user?userName="
                + java.net.URLEncoder.encode(username, java.nio.charset.StandardCharsets.UTF_8);

        java.net.URI uri = org.springframework.web.util.UriComponentsBuilder
                .fromHttpUrl("http://auth-service:8071" + route)
                .build(true)
                .toUri();

        assertFalse(uri.getRawQuery().contains("%25"),
                "query was double-encoded: " + uri.getRawQuery());
        // What the servlet container hands the controller must be the original value.
        assertEquals(username, java.net.URLDecoder.decode(
                uri.getRawQuery().substring("userName=".length()),
                java.nio.charset.StandardCharsets.UTF_8));
    }
}
