package vacademy.io.admin_core_service.features.certificate.service;

import lombok.extern.slf4j.Slf4j;
// iText's repackaged Jsoup, not org.jsoup. It ships with itext7-core, which is
// already a declared dependency, and it is the same parser
// InstituteSettingService.processImagesForPdf uses later in this pipeline — so
// the document survives exactly one parse/serialize dialect, not two.
import com.itextpdf.styledxmlparser.jsoup.Jsoup;
import com.itextpdf.styledxmlparser.jsoup.nodes.Document;
import com.itextpdf.styledxmlparser.jsoup.nodes.Element;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Shrinks a certificate field's font until its value fits the box the admin drew.
 *
 * <p><b>The problem.</b> The visual editor positions fields at a fixed size, but
 * the value only exists at issuance. "Alex Sample" and "Bhuvaneshwari
 * Ramachandran" go in the same box. Fields used to be emitted
 * {@code white-space:nowrap; overflow:hidden}, so the long one was sliced — and
 * because the box centres its content, the slice took characters off both ends.
 *
 * <p><b>The fix, in two halves.</b> The serialized template now wraps text and
 * clamps it to the box the admin drew. That alone stops anything overflowing the
 * certificate, but a value needing more lines than the box holds would still be
 * cut. This service closes that gap: it measures the substituted value and steps
 * the font down until it fits — in both directions, since the serializer stamps
 * the box's height as well as its width.
 *
 * <p><b>Why here and not in CSS.</b> There is no CSS that says "shrink to fit",
 * and the PDF renderer runs no JavaScript. The renderer knows the box; only the
 * server knows the value. The serializer therefore stamps the content width onto
 * the element as {@code data-fit-width}, and this reads it back.
 *
 * <p><b>Why widths are estimated rather than measured.</b> Real metrics would
 * mean loading the actual font, which depends on what is installed in the
 * container — and a missing font throwing mid-issuance would cost a learner
 * their certificate to save a few percent of accuracy. The table below is
 * deterministic, testable without a font, and deliberately errs wide: over-
 * estimating shrinks slightly more than needed, which is safe, while under-
 * estimating would let text overflow, which is the bug being fixed.
 */
@Slf4j
@Service
public class CertificateTextFitService {

    /**
     * Line budget for a field whose box height was never recorded — every
     * template saved before {@code data-fit-height} existed. Newer templates
     * get their budget from the box itself; see {@link #linesAllowed}.
     *
     * <p>Matches MAX_TEXT_LINES in serialize-image-template-to-html.ts.
     */
    private static final int MAX_LINES = 2;

    /** Matches TEXT_LINE_HEIGHT in serialize-image-template-to-html.ts. */
    private static final double LINE_HEIGHT = 1.2;

    /**
     * How far the font may shrink, as a fraction of what the admin chose. Past
     * this a name is small enough to look like a mistake rather than a design,
     * so the two-line clamp takes over and clips instead.
     */
    private static final double MIN_SCALE = 0.5;

    /** Absolute floor — below this it is unreadable in print at any scale. */
    private static final double MIN_FONT_PX = 6.0;

    /** Each step is a 6% reduction: fine enough to look deliberate, few enough to be cheap. */
    private static final double STEP = 0.94;

    /** Guards against the width table running slightly narrow on an unusual font. */
    private static final double SAFETY_MARGIN = 1.02;

    private static final double BOLD_WIDTH_FACTOR = 1.05;

    /**
     * Fits every field carrying {@code data-fit-width}. Returns the HTML
     * unchanged — without even parsing it — when there are none, so
     * hand-authored HTML templates and templates saved before this existed
     * follow exactly the path they always did.
     */
    public String fitTemplate(String html) {
        if (!StringUtils.hasText(html)) {
            return html;
        }
        if (!html.contains("data-fit-width")) {
            return repairLegacyFields(html);
        }
        try {
            Document doc = Jsoup.parse(html);
            for (Element element : doc.select("[data-fit-width]")) {
                fitElement(element);
            }
            return doc.html();
        } catch (Exception e) {
            // A layout refinement must never cost a learner their certificate.
            log.warn("Could not fit certificate text to its fields; rendering unfitted", e);
            return html;
        }
    }

    /**
     * Un-slices templates saved before fields learned to wrap.
     *
     * <p>The serializer emits wrapping markup now, but a template is stored as
     * rendered HTML at save time — so every institute that designed a
     * certificate before this change still has {@code white-space:nowrap;
     * overflow:hidden} baked into its fields, and would keep slicing long names
     * until someone happened to re-save. Roughly five hundred institutes were in
     * that position, which is far too many to fix by asking.
     *
     * <p>Repairing at render time fixes all of them without touching their saved
     * settings — the same approach {@code scrubHardcodedDefaultBranding} takes
     * for the branding baked into those same templates.
     *
     * <p>Scoped to visual-editor output via the {@code certificate-canvas}
     * marker. Hand-authored HTML is never touched: an admin who wrote
     * {@code white-space:nowrap} there meant it.
     *
     * <p>These fields have no {@code data-fit-width}, so the font is not shrunk —
     * only the slicing stops. Re-saving the design in the editor upgrades them to
     * the full two-line fit.
     */
    static String repairLegacyFields(String html) {
        if (!StringUtils.hasText(html) || !html.contains("certificate-canvas")
                || !html.contains("white-space:nowrap")) {
            return html;
        }
        try {
            // Replace the exact contiguous pair the old serializer emitted, not
            // each declaration on its own.
            //
            // The clipping has to go with the wrapping: the old markup clipped on
            // the very element that centres the text, so a value that now wraps
            // to two lines would show slivers of both rather than one clean line.
            // Letting it grow past the drawn box is the lesser evil — the width,
            // which is what must not be crossed, is still enforced by the
            // element's own width.
            //
            // But `overflow:hidden` also appears on the .certificate-canvas rule
            // that keeps the background image inside the page, and unpinning that
            // would let the artwork bleed off the certificate. Matching the pair
            // keeps this to inline field styles. (The canvas rule happens to be
            // written `overflow: hidden` with a space, but relying on that would
            // be relying on an accident.)
            String repaired = html.replace(
                    "white-space:nowrap;overflow:hidden",
                    "overflow-wrap:break-word;overflow:visible");
            // Any stragglers whose declaration order differs still get the
            // wrapping fix; their clipping is left alone, which is no worse than
            // today.
            return repaired.replace("white-space:nowrap", "overflow-wrap:break-word");
        } catch (Exception e) {
            log.warn("Could not repair legacy certificate field styles", e);
            return html;
        }
    }

    private void fitElement(Element element) {
        String text = element.text();
        if (!StringUtils.hasText(text)) {
            return;
        }
        double width = parsePositiveDouble(element.attr("data-fit-width"));
        double fontSize = parsePositiveDouble(element.attr("data-fit-size"));
        if (width <= 0 || fontSize <= 0) {
            return;
        }
        // Absent on templates saved before the height was emitted; those keep
        // the flat two-line budget they were designed against.
        double height = parsePositiveDouble(element.attr("data-fit-height"));

        // data-fit-strict: the box height is a hard limit, with no two-line
        // allowance. For layouts where the text sits between printed lines of
        // artwork and spilling past the box would draw over them.
        double fitted = element.hasAttr("data-fit-strict") && height > 0
                ? fitFontSizeStrict(text, width, fontSize, height)
                : fitFontSize(text, width, fontSize, height);
        if (fitted >= fontSize) {
            // Already fits. Leave the style attribute untouched rather than
            // rewriting it to the same value.
            return;
        }
        // data-fit-scale-var: the field's sizes are in design pixels scaled by a
        // CSS variable (a page that resizes with the screen), so the fitted size
        // has to be written in that unit rather than as fixed pixels.
        String scaleVar = element.attr("data-fit-scale-var");
        element.attr("style", isCssVariableName(scaleVar)
                ? replaceFontSize(element.attr("style"), fitted, scaleVar)
                : replaceFontSize(element.attr("style"), fitted));
    }

    /**
     * Largest size at or below {@code fontSizePx} whose wrapped text fits inside
     * {@code heightPx} — at least one line, never the two-line allowance
     * {@link #linesAllowed} grants. The floor still applies, so a value too long
     * for any readable size keeps the floor size rather than vanishing.
     */
    static double fitFontSizeStrict(String text, double widthPx, double fontSizePx, double heightPx) {
        double floor = Math.max(MIN_FONT_PX, fontSizePx * MIN_SCALE);
        double size = fontSizePx;
        while (size > floor) {
            int lines = Math.max(1, (int) Math.floor(heightPx / (size * LINE_HEIGHT) + 0.02));
            if (linesNeeded(text, widthPx, size) <= lines) {
                return size;
            }
            size *= STEP;
        }
        return Math.min(fontSizePx, floor);
    }

    private static boolean isCssVariableName(String name) {
        return name != null && name.matches("--[A-Za-z0-9_-]+");
    }

    /**
     * Largest size at or below {@code fontSizePx} whose wrapped text fits the
     * box, or the floor if none does.
     *
     * <p>Kept for callers (and tests) that only know the width; a box of
     * unknown height falls back to the historical two-line budget.
     */
    static double fitFontSize(String text, double widthPx, double fontSizePx) {
        return fitFontSize(text, widthPx, fontSizePx, 0);
    }

    /**
     * The height-aware fit.
     *
     * <p>Width alone was not enough. The clamp used to be a flat two lines, so a
     * long course title printed its first two lines and had the rest sliced off.
     * Now the box's height raises the line budget — a tall box may take three or
     * four lines at full size — while two lines stay available whatever the box,
     * so wrapping is what absorbs a long value and the font only shrinks when
     * even that is not enough.
     *
     * @param heightPx content height of the box, or 0 when it is not known
     */
    static double fitFontSize(String text, double widthPx, double fontSizePx, double heightPx) {
        double floor = Math.max(MIN_FONT_PX, fontSizePx * MIN_SCALE);
        double size = fontSizePx;
        while (size > floor) {
            if (linesNeeded(text, widthPx, size) <= linesAllowed(heightPx, size)) {
                return size;
            }
            size *= STEP;
        }
        return Math.min(fontSizePx, floor);
    }

    /**
     * Lines the box can show at this font size — at least one, because a box
     * smaller than a single line still has to print something. A height of 0
     * means "not recorded", which keeps the flat {@link #MAX_LINES} budget.
     *
     * <p>The epsilon absorbs sub-pixel rounding: a box drawn at exactly two
     * lines must not be judged to hold 1.99 of them.
     */
    static int linesAllowed(double heightPx, double fontSizePx) {
        if (heightPx <= 0 || fontSizePx <= 0) {
            return MAX_LINES;
        }
        // Never fewer than MAX_LINES. Shrinking is the last resort: a long name
        // set small enough to fit one line reads as a fault on a certificate,
        // where the same name across two lines at the size the design chose
        // reads as the design. A taller box raises the budget further.
        return Math.max(MAX_LINES, (int) Math.floor(heightPx / (fontSizePx * LINE_HEIGHT) + 0.02));
    }

    /**
     * Lines a greedy word-wrap would produce — the same algorithm the renderer
     * uses. A word wider than the whole line is broken across lines rather than
     * counted as one, matching the {@code overflow-wrap:break-word} the
     * serializer emits; without that an unbroken 40-character token would look
     * like it fits on one line and never trigger a shrink.
     */
    static int linesNeeded(String text, double widthPx, double fontSizePx) {
        if (!StringUtils.hasText(text) || widthPx <= 0) {
            return 1;
        }
        double spaceWidth = measure(" ", fontSizePx, false);
        int lines = 1;
        double used = 0;

        for (String word : text.trim().split("\\s+")) {
            if (word.isEmpty()) continue;
            double wordWidth = measure(word, fontSizePx, false);

            if (wordWidth > widthPx) {
                // Too wide for any line: it will be broken mid-word. Start it on
                // a fresh line unless the current one is still empty.
                if (used > 0) {
                    lines++;
                    used = 0;
                }
                int fullLines = (int) Math.floor(wordWidth / widthPx);
                lines += fullLines;
                used = wordWidth - fullLines * widthPx;
                continue;
            }

            double needed = used > 0 ? used + spaceWidth + wordWidth : wordWidth;
            if (needed <= widthPx) {
                used = needed;
            } else {
                lines++;
                used = wordWidth;
            }
        }
        return lines;
    }

    /** Estimated rendered width, in px, of {@code text} at {@code fontSizePx}. */
    static double measure(String text, double fontSizePx, boolean bold) {
        double ems = 0;
        for (int i = 0; i < text.length(); i++) {
            ems += charWidthEm(text.charAt(i));
        }
        return ems * fontSizePx * SAFETY_MARGIN * (bold ? BOLD_WIDTH_FACTOR : 1.0);
    }

    /**
     * Advance width as a fraction of the font size, for a proportional sans face
     * (Arial/Helvetica, what certificate templates overwhelmingly use). Grouped
     * rather than per-glyph: the difference between 'a' and 'e' does not change
     * whether a name needs a third line, but the difference between 'i' and 'W'
     * very much does.
     */
    private static double charWidthEm(char c) {
        switch (c) {
            case 'i': case 'j': case 'l': case 'I': case '.': case ',': case ':':
            case ';': case '\'': case '`': case '|': case '!': case '[': case ']':
            case '(': case ')': case '{': case '}':
                return 0.28;
            case 'f': case 'r': case 't': case ' ': case '-':
                return 0.33;
            case 'm': case 'w': case 'M': case 'W': case '@':
                return 0.85;
            default:
                if (c >= 'A' && c <= 'Z') return 0.67;
                if (c >= '0' && c <= '9') return 0.56;
                if (c >= 'a' && c <= 'z') return 0.55;
                // Anything else — accented Latin, CJK, punctuation not listed —
                // costs a full em. Over-estimating is the safe direction.
                return 1.0;
        }
    }

    /**
     * Swap the {@code font-size} declaration in an inline style. The serializer
     * always writes one, but a template edited by hand might not, so an absent
     * declaration is appended rather than silently dropped.
     */
    static String replaceFontSize(String style, double fontSizePx) {
        return replaceFontSizeWith(style, String.format(java.util.Locale.ROOT, "font-size:%.2fpx", fontSizePx));
    }

    /** As above, written as {@code calc(var(--x) * size)} for a scaled layout. */
    static String replaceFontSize(String style, double fontSize, String cssVariable) {
        return replaceFontSizeWith(style,
                String.format(java.util.Locale.ROOT, "font-size:calc(var(%s) * %.2f)", cssVariable, fontSize));
    }

    private static String replaceFontSizeWith(String style, String size) {
        if (!StringUtils.hasText(style)) {
            return size;
        }
        if (style.matches("(?s).*font-size\\s*:.*")) {
            return style.replaceAll("font-size\\s*:\\s*[^;]*", size);
        }
        return style.endsWith(";") ? style + size : style + ";" + size;
    }

    private static double parsePositiveDouble(String raw) {
        try {
            return StringUtils.hasText(raw) ? Double.parseDouble(raw.trim()) : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }
}
