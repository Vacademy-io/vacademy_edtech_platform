package vacademy.io.assessment_service.features.assessment.omr.layout;

import com.itextpdf.io.font.constants.StandardFonts;
import com.itextpdf.kernel.colors.Color;
import com.itextpdf.kernel.colors.DeviceGray;
import com.itextpdf.kernel.font.PdfFont;
import com.itextpdf.kernel.font.PdfFontFactory;
import com.itextpdf.kernel.geom.PageSize;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.kernel.pdf.canvas.PdfCanvas;
import vacademy.io.assessment_service.features.assessment.omr.layout.OmrSheetLayout.Bubble;
import vacademy.io.assessment_service.features.assessment.omr.layout.OmrSheetLayout.QuestionRow;
import vacademy.io.assessment_service.features.assessment.omr.layout.OmrSheetLayout.Rect;

import java.io.ByteArrayOutputStream;
import java.io.IOException;

/**
 * Draws an {@link OmrSheetLayout} as a one-page A4 PDF.
 *
 * <p>Only the layout's numbers decide where anything the reader looks at goes; this
 * class adds the human parts (title, labels, instructions). The bubbles are vector
 * circles with a light outline and a light letter inside, so an empty bubble stays
 * close to white for the reader and a filled one is unmistakably dark.
 *
 * <p>Text is Helvetica (WinAnsi). A title in a script Helvetica cannot draw (e.g.
 * Devanagari) is reduced to its Latin part, or to "OMR Answer Sheet": the sheet is a
 * form, and the question paper itself - rendered by the dashboard - carries the name.
 */
public final class OmrSheetPdfRenderer {

    private static final double PT_PER_MM = 72.0 / 25.4;
    private static final Color INK = new DeviceGray(0f);
    private static final Color GUIDE = new DeviceGray(0.45f);
    private static final Color LETTER = new DeviceGray(0.6f);

    private OmrSheetPdfRenderer() {
    }

    public record SheetText(String title, String subtitle) {
    }

    public static byte[] render(OmrSheetLayout layout, SheetText text) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (PdfDocument pdf = new PdfDocument(new PdfWriter(out))) {
            pdf.setDefaultPageSize(PageSize.A4);
            PdfCanvas c = new PdfCanvas(pdf.addNewPage());
            PdfFont regular = PdfFontFactory.createFont(StandardFonts.HELVETICA);
            PdfFont bold = PdfFontFactory.createFont(StandardFonts.HELVETICA_BOLD);

            drawMarkers(c);
            fillRect(c, OmrSheetLayout.ORIENTATION_BAR);

            // Header
            // Lengths keep the header left of the set box (x < 160 mm).
            text(c, bold, 12, 40, 21, latin(text.title(), "OMR Answer Sheet", 44));
            text(c, regular, 8.5, 40, 27, latin(text.subtitle(), "", 60));
            if (layout.getPrintedSetCode() != null && layout.getSetCodes().size() > 1) {
                // Kept well clear of the top-right marker (x >= 196, y <= 14): anything
                // touching a marker blurs the shape the reader matches.
                strokeRect(c, new Rect(160, 17, 28, 16), 0.8);
                centred(c, regular, 7, 174, 21.5, "SET");
                centred(c, bold, 20, 174, 30.5, layout.getPrintedSetCode());
            }

            // Name box: written by the student, cropped for the reviewer, never read.
            text(c, bold, 8, OmrSheetLayout.NAME_BOX.x(), OmrSheetLayout.NAME_BOX.y() - 1.5, "Student name");
            strokeRect(c, OmrSheetLayout.NAME_BOX, 0.6);

            drawRoll(c, regular, bold, layout);
            if (layout.hasSetGrid()) drawSet(c, regular, bold, layout);
            drawInstructions(c, regular, bold, layout);
            drawQuestions(c, regular, layout);

            // Footer above the bottom markers (they start at y = 283) and left of the
            // spot the orientation check expects to be blank (x 176-190, y 281.5-284.5).
            text(c, regular, 6.5, 18, 281.5, "Layout v" + OmrSheetLayout.LAYOUT_VERSION
                    + (layout.getPrintedSetCode() != null ? "  |  Set " + layout.getPrintedSetCode() : "")
                    + "  |  Print at 100% (actual size). Do not fold, staple or write near the black squares.");
        } catch (IOException e) {
            throw new IllegalStateException("Could not draw the OMR sheet: " + e.getMessage(), e);
        }
        return out.toByteArray();
    }

    // ------------------------------------------------------------------ parts

    private static void drawMarkers(PdfCanvas c) {
        for (double[] centre : OmrSheetLayout.markerCentres()) {
            double x = centre[0], y = centre[1];
            square(c, x, y, OmrSheetLayout.MARKER_OUTER, INK);
            square(c, x, y, OmrSheetLayout.MARKER_INNER, new DeviceGray(1f));
            square(c, x, y, OmrSheetLayout.MARKER_CORE, INK);
        }
    }

    private static void drawRoll(PdfCanvas c, PdfFont regular, PdfFont bold, OmrSheetLayout layout) {
        double x0 = OmrSheetLayout.ROLL_X0;
        double width = OmrSheetLayout.ROLL_COL_PITCH * layout.getRollDigits();
        text(c, bold, 8, x0, OmrSheetLayout.ROLL_WRITE_Y - 1.5,
                "Roll / Enrollment No. (" + layout.getRollDigits() + " digits, start from the left)");
        for (int col = 0; col < layout.getRollDigits(); col++) {
            double bx = x0 + OmrSheetLayout.ROLL_COL_PITCH * col + 0.5;
            strokeRect(c, new Rect(bx, OmrSheetLayout.ROLL_WRITE_Y, OmrSheetLayout.ROLL_COL_PITCH - 1,
                    OmrSheetLayout.ROLL_WRITE_H), 0.5);
            for (Bubble b : layout.getRollColumns().get(col)) {
                bubble(c, regular, b);
            }
        }
        // Frame around the grid so a student sees one block of columns.
        strokeRect(c, new Rect(x0 - 1, OmrSheetLayout.ROLL_WRITE_Y - 0.8, width + 2,
                OmrSheetLayout.ROLL_ROW0_Y + 9 * OmrSheetLayout.ROLL_ROW_PITCH + 3.5 - OmrSheetLayout.ROLL_WRITE_Y), 0.3);
    }

    private static void drawSet(PdfCanvas c, PdfFont regular, PdfFont bold, OmrSheetLayout layout) {
        text(c, bold, 8, OmrSheetLayout.SET_X0, OmrSheetLayout.SET_ROW_Y - 5.5, "Set (fill the set printed on your paper)");
        for (Bubble b : layout.getSetBubbles()) {
            bubble(c, regular, b);
        }
    }

    private static void drawInstructions(PdfCanvas c, PdfFont regular, PdfFont bold, OmrSheetLayout layout) {
        double x = OmrSheetLayout.SET_X0;
        double y = 76;
        strokeRect(c, new Rect(x - 1.5, y - 4.5, 69.5, 41), 0.3);
        text(c, bold, 8, x, y, "How to fill this sheet");
        String[] lines = {
                "1. Use a dark blue / black ball pen or an HB pencil.",
                "2. Fill the bubble completely, dark and inside the circle.",
                "   Do not tick, cross or half-fill a bubble.",
                "3. Fill only ONE bubble per question.",
                "   Two filled bubbles = question not attempted.",
                "4. Write your roll number in the boxes and fill",
                "   the matching bubble below every digit.",
                layout.hasSetGrid() ? "5. Fill the bubble of your paper's set." : "5. Write your name in the name box.",
        };
        double ly = y + 4.6;
        for (String line : lines) {
            text(c, regular, 7, x, ly, line);
            ly += 4.1;
        }
    }

    private static void drawQuestions(PdfCanvas c, PdfFont regular, OmrSheetLayout layout) {
        double size = OmrSheetLayout.LARGE.equals(layout.getDensity()) ? 8 : 6.5;
        for (QuestionRow q : layout.getQuestions()) {
            String label = String.valueOf(q.no());
            double w = regular.getWidth(label, (float) size) / PT_PER_MM;
            text(c, regular, size, q.labelRightX() - w, q.cy() + size * 0.35 / PT_PER_MM, label);
            for (Bubble b : q.bubbles()) {
                bubble(c, regular, b);
            }
        }
    }

    // ------------------------------------------------------------- primitives

    private static double px(double xMm) {
        return xMm * PT_PER_MM;
    }

    /** PDF y grows upwards from the bottom; layout y grows downwards from the top. */
    private static double py(double yMm) {
        return (OmrSheetLayout.PAGE_H - yMm) * PT_PER_MM;
    }

    private static void bubble(PdfCanvas c, PdfFont font, Bubble b) {
        c.saveState();
        c.setStrokeColor(GUIDE).setLineWidth(0.6f);
        c.circle(px(b.cx()), py(b.cy()), b.d() / 2 * PT_PER_MM).stroke();
        c.restoreState();
        double size = Math.max(5, b.d() * 1.55);
        double w = font.getWidth(b.value(), (float) size) / PT_PER_MM;
        c.saveState();
        c.setFillColor(LETTER);
        c.beginText().setFontAndSize(font, (float) size)
                .moveText(px(b.cx() - w / 2), py(b.cy() + size * 0.34 / PT_PER_MM))
                .showText(b.value()).endText();
        c.restoreState();
    }

    private static void square(PdfCanvas c, double cx, double cy, double side, Color color) {
        c.saveState();
        c.setFillColor(color);
        c.rectangle(px(cx - side / 2), py(cy + side / 2), side * PT_PER_MM, side * PT_PER_MM).fill();
        c.restoreState();
    }

    private static void fillRect(PdfCanvas c, Rect r) {
        c.saveState();
        c.setFillColor(INK);
        c.rectangle(px(r.x()), py(r.y() + r.h()), r.w() * PT_PER_MM, r.h() * PT_PER_MM).fill();
        c.restoreState();
    }

    private static void strokeRect(PdfCanvas c, Rect r, double lineWidth) {
        c.saveState();
        c.setStrokeColor(GUIDE).setLineWidth((float) lineWidth);
        c.rectangle(px(r.x()), py(r.y() + r.h()), r.w() * PT_PER_MM, r.h() * PT_PER_MM).stroke();
        c.restoreState();
    }

    /** Text with its baseline at (xMm, yMm). */
    private static void text(PdfCanvas c, PdfFont font, double size, double xMm, double yMm, String s) {
        if (s == null || s.isEmpty()) return;
        c.beginText().setFontAndSize(font, (float) size).moveText(px(xMm), py(yMm)).showText(s).endText();
    }

    private static void centred(PdfCanvas c, PdfFont font, double size, double cxMm, double yMm, String s) {
        double w = font.getWidth(s, (float) size) / PT_PER_MM;
        text(c, font, size, cxMm - w / 2, yMm, s);
    }

    /** Keep what Helvetica (WinAnsi) can draw; fall back when nothing readable is left. */
    static String latin(String s, String fallback, int maxChars) {
        if (s == null) return fallback;
        StringBuilder b = new StringBuilder();
        for (char ch : s.toCharArray()) {
            if ((ch >= 0x20 && ch <= 0x7E) || (ch >= 0xA0 && ch <= 0xFF)) b.append(ch);
            else if (Character.isWhitespace(ch)) b.append(' ');
        }
        String clean = b.toString().replaceAll("\\s+", " ").trim();
        if (clean.replaceAll("[^A-Za-z0-9]", "").isEmpty()) return fallback;
        return clean.length() > maxChars ? clean.substring(0, maxChars - 3) + "..." : clean;
    }
}
