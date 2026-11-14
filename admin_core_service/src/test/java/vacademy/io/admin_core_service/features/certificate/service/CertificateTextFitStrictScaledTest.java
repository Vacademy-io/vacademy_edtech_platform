package vacademy.io.admin_core_service.features.certificate.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The two opt-in fitting attributes used by layouts the default rules do not
 * suit: text placed between printed lines (data-fit-strict) and pages that
 * scale with the screen (data-fit-scale-var).
 */
class CertificateTextFitStrictScaledTest {

    private static final String LONG_NAME = "Bhuvaneshwari Ramachandran Venkataraghavan Iyer";

    private final CertificateTextFitService service = new CertificateTextFitService();

    @Test
    void strictFitStaysInsideAOneLineBox() {
        // 72px tall at 46px holds one line; the default rule would allow two.
        double strict = CertificateTextFitService.fitFontSizeStrict(LONG_NAME, 630, 46, 72);
        double lenient = CertificateTextFitService.fitFontSize(LONG_NAME, 630, 46, 72);

        assertTrue(strict < lenient, "strict " + strict + " should shrink below lenient " + lenient);
        int lines = CertificateTextFitService.linesNeeded(LONG_NAME, 630, strict);
        assertTrue(lines * strict * 1.2 <= 72 + 0.5, "must fit the box height");
    }

    @Test
    void strictFitLeavesAShortValueAlone() {
        assertEquals(46, CertificateTextFitService.fitFontSizeStrict("Alex Sample", 630, 46, 72));
    }

    @Test
    void writesTheFittedSizeInTheScaledUnit() {
        String html = "<div style=\"font-size:calc(var(--u) * 46);color:#000\" data-fit-width=\"630\""
                + " data-fit-height=\"72\" data-fit-size=\"46\" data-fit-strict data-fit-scale-var=\"--u\">"
                + LONG_NAME + "</div>";

        String fitted = service.fitTemplate(html);

        assertTrue(fitted.contains("font-size:calc(var(--u) * "), fitted);
        assertFalse(fitted.contains("calc(var(--u) * 46)"), fitted);
        assertFalse(fitted.contains("px;color"), fitted);
    }

    /** Anything that is not a plain custom property name falls back to pixels. */
    @Test
    void ignoresAnUnsafeScaleVariable() {
        String html = "<div style=\"font-size:46px\" data-fit-width=\"630\" data-fit-height=\"72\""
                + " data-fit-size=\"46\" data-fit-strict data-fit-scale-var=\"--u);background:red\">"
                + LONG_NAME + "</div>";

        String fitted = service.fitTemplate(html);

        // The value never reaches the style, which is written in plain pixels.
        assertFalse(fitted.contains("calc(var("), fitted);
        assertTrue(fitted.matches("(?s).*style=\"font-size:\\d+\\.\\d+px\".*"), fitted);
    }
}
