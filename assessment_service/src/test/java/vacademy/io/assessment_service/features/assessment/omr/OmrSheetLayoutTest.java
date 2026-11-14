package vacademy.io.assessment_service.features.assessment.omr;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.omr.layout.OmrSheetLayout;
import vacademy.io.assessment_service.features.assessment.omr.layout.OmrSheetPdfRenderer;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The sheet the PDF prints and the template ai_service reads it with come from one
 * layout. A drift between them is a silently wrong mark on every sheet, so the
 * template numbers are pinned here - they are the same numbers ai_service's
 * tests/test_omr_reader.py draws and reads a filled sheet with.
 */
class OmrSheetLayoutTest {

    private static OmrSheetLayout layout(int digits, List<String> sets, int questions, int options) {
        return OmrSheetLayout.builder().rollDigits(digits).setCodes(sets).printedSetCode(sets.get(0))
                .optionCounts(new ArrayList<>(Collections.nCopies(questions, options))).build();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> block(Map<String, Object> template, String name) {
        return (Map<String, Object>) ((Map<String, Object>) template.get("fieldBlocks")).get(name);
    }

    @Test
    void templateNumbersMatchTheReaderFixture() {
        Map<String, Object> t = layout(5, List.of("A", "B", "C"), 20, 4).toTemplate();
        assertEquals(List.of(1140, 1662), t.get("pageDimensions"));

        Map<String, Object> roll = block(t, "Roll");
        assertEquals(List.of(45, 326), roll.get("origin"));
        assertEquals(List.of("roll1", "roll2", "roll3", "roll4", "roll5"), roll.get("fieldLabels"));
        assertEquals("vertical", roll.get("direction"));
        assertEquals(30.0, (double) roll.get("bubblesGap"), 1e-9);
        assertEquals(39.0, (double) roll.get("labelsGap"), 1e-9);
        assertEquals(List.of(20, 20), roll.get("bubbleDimensions"));

        Map<String, Object> q1 = block(t, "Q1");
        assertEquals(List.of(98, 667), q1.get("origin"));
        assertEquals(List.of("q1"), q1.get("fieldLabels"));
        assertEquals(List.of("A", "B", "C", "D"), q1.get("bubbleValues"));
        assertEquals(List.of(21, 21), q1.get("bubbleDimensions"));

        Map<String, Object> set = block(t, "Set");
        assertEquals(List.of("set"), set.get("fieldLabels"));
        assertEquals(List.of("A", "B", "C"), set.get("bubbleValues"));

        @SuppressWarnings("unchecked")
        Map<String, Object> marker = (Map<String, Object>) ((Map<String, Object>)
                ((List<?>) t.get("preProcessors")).get(0)).get("options");
        assertEquals(19, marker.get("sheetToMarkerWidthRatio"));
        assertEquals("marker.png", marker.get("relativePath"));
    }

    @Test
    void singleSetSheetHasNoSetGrid() {
        OmrSheetLayout l = layout(4, List.of("A"), 10, 4);
        assertFalse(l.hasSetGrid());
        assertNull(block(l.toTemplate(), "Set"));
    }

    @Test
    void largeUpToHundredDenseAbove() {
        assertEquals(OmrSheetLayout.LARGE, layout(6, List.of("A", "B"), 100, 4).getDensity());
        assertEquals(OmrSheetLayout.DENSE, layout(6, List.of("A", "B"), 101, 4).getDensity());
    }

    @Test
    void fullestSheetStaysInsideTheReadableFrame() {
        for (int questions : List.of(1, 37, 100, 101, 163, 200)) {
            OmrSheetLayout l = layout(OmrSheetLayout.MAX_ROLL_DIGITS, List.of("A", "B", "C", "D", "E", "F", "G", "H"),
                    questions, 5);
            assertEquals(questions, l.getQuestions().size());
            for (OmrSheetLayout.QuestionRow q : l.getQuestions()) {
                for (OmrSheetLayout.Bubble b : q.bubbles()) {
                    assertTrue(b.cx() - b.d() / 2 > 14 && b.cx() + b.d() / 2 < 196, "x inside frame: Q" + q.no());
                    assertTrue(b.cy() - b.d() / 2 >= 118 && b.cy() + b.d() / 2 <= 280, "y inside frame: Q" + q.no());
                }
            }
            // No two question rows overlap.
            List<OmrSheetLayout.QuestionRow> rows = l.getQuestions();
            for (int i = 0; i < rows.size(); i++) {
                for (int j = i + 1; j < rows.size(); j++) {
                    OmrSheetLayout.Bubble a = rows.get(i).bubbles().get(0), b = rows.get(j).bubbles().get(0);
                    boolean sameColumn = Math.abs(a.cx() - b.cx()) < 1e-6;
                    if (sameColumn) assertTrue(Math.abs(a.cy() - b.cy()) >= a.d(), "rows overlap");
                }
            }
            Map<String, Object> t = l.toTemplate();
            assertEquals(questions + 2, ((Map<?, ?>) t.get("fieldBlocks")).size());
        }
    }

    @Test
    void refusesWhatCannotBePrinted() {
        assertThrows(IllegalArgumentException.class, () -> layout(0, List.of("A"), 10, 4));
        assertThrows(IllegalArgumentException.class, () -> layout(13, List.of("A"), 10, 4));
        assertThrows(IllegalArgumentException.class, () -> layout(5, List.of("A"), 201, 4));
        assertThrows(IllegalArgumentException.class, () -> layout(5, List.of("A"), 10, 6));
        assertThrows(IllegalArgumentException.class, () -> layout(5, List.of("A"), 10, 1));
    }

    /**
     * Cross-check with the real reader: run with -Domr.fixtureDir=<dir> and this writes
     * the PDF this code prints plus its template; ai_service's
     * tests/test_omr_reader.py::test_java_rendered_sheet (OMR_JAVA_FIXTURE_DIR=<dir>)
     * fills bubbles on that PDF and reads it back.
     */
    @Test
    void writesReaderFixtureWhenAsked() throws Exception {
        String dir = System.getProperty("omr.fixtureDir");
        if (dir == null || dir.isBlank()) return;
        java.nio.file.Path out = java.nio.file.Files.createDirectories(java.nio.file.Path.of(dir));
        List<Integer> options = new ArrayList<>(Collections.nCopies(38, 4));
        options.add(5);
        options.add(2);
        OmrSheetLayout l = OmrSheetLayout.builder().rollDigits(6).setCodes(List.of("A", "B", "C"))
                .printedSetCode("B").optionCounts(options).build();
        com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
        java.nio.file.Files.write(out.resolve("sheet.pdf"),
                OmrSheetPdfRenderer.render(l, new OmrSheetPdfRenderer.SheetText("Unit Test 3 - Physics", "OMR Answer Sheet")));
        java.nio.file.Files.writeString(out.resolve("template.json"), om.writeValueAsString(l.toTemplate()));
        java.nio.file.Files.writeString(out.resolve("reader_layout.json"), om.writeValueAsString(l.readerLayout()));
        java.nio.file.Files.writeString(out.resolve("marker.json"), om.writeValueAsString(OmrSheetLayout.markerSpec()));
    }

    @Test
    void rendersAOnePagePdf() {
        byte[] pdf = OmrSheetPdfRenderer.render(layout(8, List.of("A", "B"), 60, 4),
                new OmrSheetPdfRenderer.SheetText("Class 10 Science विज्ञान Unit Test", "OMR Answer Sheet"));
        assertTrue(pdf.length > 1000);
        assertEquals("%PDF", new String(pdf, 0, 4, StandardCharsets.US_ASCII));
    }
}
