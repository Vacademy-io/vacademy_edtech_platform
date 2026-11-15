package vacademy.io.admin_core_service.features.commerce.document.pdf;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;

/**
 * Draws a commerce document (invoice, bill of supply, credit note; later the delivery challan,
 * debit note and payment voucher of other work packages) from well-formed XHTML to an A4 PDF.
 *
 * <p>It is separate from the course invoice renderer on purpose: commerce templates are written
 * by this code, so they need no clean-up pass, and they must not go through that renderer's
 * forced-font rule.
 *
 * <p>FOLLOW-UP (not built): Hindi. openhtmltopdf does not shape Devanagari, so a
 * Devanagari word in a product name or an address prints as boxes today. The planned fix is
 * {@code DevanagariOutlineInliner} (each Devanagari run replaced by an inline SVG outline, drawn
 * by the Batik SVG drawer registered here, with Noto Sans Devanagari bundled) plus an
 * image-comparison test, first run on the production image. Until it ships, commerce PDFs are
 * English and callers pass English text.
 */
@Slf4j
@Component
public class CommercePdfRenderer {

    static final String FONT_FAMILY = "DejaVu Sans";
    private static final String FONT_RESOURCE = "/fonts/DejaVuSans.ttf";
    private static final boolean FONT_AVAILABLE = CommercePdfRenderer.class.getResource(FONT_RESOURCE) != null;

    /** Whether the bundled Unicode font is present; without it the rupee sign cannot be printed. */
    public static boolean unicodeFontAvailable() {
        return FONT_AVAILABLE;
    }

    /** @param xhtml a complete, well-formed XHTML document */
    public byte[] render(String xhtml) {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFastMode();
            if (FONT_AVAILABLE) {
                builder.useFont(() -> CommercePdfRenderer.class.getResourceAsStream(FONT_RESOURCE), FONT_FAMILY);
            }
            builder.withHtmlContent(xhtml, "file:///");
            builder.useDefaultPageSize(210f, 297f, PdfRendererBuilder.PageSizeUnits.MM);
            builder.toStream(out);
            builder.run();
            return out.toByteArray();
        } catch (Exception e) {
            throw new IllegalStateException("commerce document could not be drawn as a PDF: " + e.getMessage(), e);
        }
    }
}
