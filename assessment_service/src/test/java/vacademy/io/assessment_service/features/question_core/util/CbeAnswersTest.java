package vacademy.io.assessment_service.features.question_core.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

class CbeAnswersTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode json(String s) throws Exception {
        return MAPPER.readTree(s);
    }

    @Test
    void templateCellsAndBlankTextDoNotCountAsAnAnswer() throws Exception {
        JsonNode config = CbeAnswers.configData(CbeConfigRedactorTest.CBE);
        JsonNode templateOnly = json("{\"parts\":{\"p1\":{\"kind\":\"SPREADSHEET\",\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\","
                + "\"cells\":{\"A1\":{\"v\":\"Goodwill\"},\"B2\":{\"v\":\"\"},\"C3\":{\"v\":null}}}]}},"
                + "\"p2\":{\"kind\":\"DOCUMENT\",\"html\":\"<p>&nbsp;</p><p><br></p>\"}}}");
        assertThat(CbeAnswers.isAnswered(templateOnly, config)).isFalse();
        assertThat(CbeAnswers.isAnswered(json("{\"parts\":{}}"), config)).isFalse();
        assertThat(CbeAnswers.isAnswered(null, config)).isFalse();

        JsonNode oneCell = json("{\"parts\":{\"p1\":{\"kind\":\"SPREADSHEET\",\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\","
                + "\"cells\":{\"A1\":{\"v\":\"Goodwill\"},\"B1\":{\"v\":3200,\"f\":\"=B5-B6\"}}}]}}}}");
        assertThat(CbeAnswers.isAnswered(oneCell, config)).isTrue();
        assertThat(CbeAnswers.isAnswered(json("{\"parts\":{\"p2\":{\"kind\":\"DOCUMENT\",\"html\":\"<p>IAS 38</p>\"}}}"), config))
                .isTrue();
    }

    @Test
    void summaryIsShortAndReadable() throws Exception {
        JsonNode config = CbeAnswers.configData(CbeConfigRedactorTest.CBE);
        StringBuilder longText = new StringBuilder("<p>");
        for (int i = 0; i < 200; i++) longText.append("word ");
        longText.append("</p>");
        JsonNode answer = json("{\"parts\":{\"p2\":{\"kind\":\"DOCUMENT\",\"html\":\"" + longText + "\"},"
                + "\"p1\":{\"kind\":\"SPREADSHEET\",\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\",\"cells\":{"
                + "\"A1\":{\"v\":\"Goodwill\"},\"B1\":{\"v\":3200},\"B2\":{\"f\":\"=B1*2\",\"v\":6400}}}]}}}}");
        String summary = CbeAnswers.summary(answer, config);
        String[] lines = summary.split("\n");
        assertThat(lines[0]).isEqualTo("(a) Spreadsheet — 2 cells filled");
        assertThat(lines[1]).startsWith("(b) Document — word word");
        assertThat(lines[1].length()).isLessThanOrEqualTo("(b) Document — ".length() + 501);
        assertThat(summary).doesNotContain("{", "sheets");
    }

    @Test
    void neverThrowsOnGarbage() {
        assertThatCode(() -> {
            assertThat(CbeAnswers.summaryFromResponseJson("not json", "also not")).isEmpty();
            assertThat(CbeAnswers.summaryFromResponseJson(null, null)).isEmpty();
            assertThat(CbeAnswers.configSummary("x")).isEmpty();
            assertThat(CbeAnswers.htmlToText(null)).isEmpty();
        }).doesNotThrowAnyException();
    }

    @Test
    void htmlToTextKeepsLineBreaksListsAndTables() {
        String text = CbeAnswers.htmlToText("<p>Line one</p><p>Line&nbsp;two<br>three</p><ul><li>a</li><li>b</li></ul>"
                + "<table><tr><td>x</td><td>1 &amp; 2</td></tr></table>");
        assertThat(text).isEqualTo("Line one\nLine two\nthree\n- a\n- b\nx | 1 & 2");
    }

    @Test
    void configSummaryNamesPartsWithoutSecrets() {
        assertThat(CbeAnswers.configSummary(CbeConfigRedactorTest.CBE))
                .isEqualTo("(a) Spreadsheet (16 marks); (b) Document (4 marks)");
    }

    /**
     * Shared fixture with the learner app's types.test.ts: a template formula imported with no
     * cached value, which the grid recomputes on load. Opening the question is not answering it.
     */
    private static final String FORMULA_TEMPLATE_CONFIG = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"parts\":["
            + "{\"id\":\"p1\",\"kind\":\"SPREADSHEET\",\"marks\":4,\"template\":{\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\","
            + "\"cells\":{\"A1\":{\"v\":\"Total\"},\"B5\":{\"f\":\"=SUM(B2:B4)\"}}}]}}}]}}";

    @Test
    void aRecomputedTemplateFormulaIsNotAnAnswer() throws Exception {
        JsonNode config = CbeAnswers.configData(FORMULA_TEMPLATE_CONFIG);
        JsonNode opened = json("{\"parts\":{\"p1\":{\"kind\":\"SPREADSHEET\",\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\","
                + "\"cells\":{\"A1\":{\"v\":\"Total\"},\"B5\":{\"f\":\"=sum(B2:B4) \",\"v\":0}}}]}}}}");
        assertThat(CbeAnswers.isAnswered(opened, config)).isFalse();
        assertThat(CbeAnswers.summary(opened, config)).isEqualTo("Part 1 Spreadsheet — 0 cells filled");

        // Typing an input changes the template formula's value; only the input counts.
        JsonNode typed = json("{\"parts\":{\"p1\":{\"kind\":\"SPREADSHEET\",\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\","
                + "\"cells\":{\"A1\":{\"v\":\"Total\"},\"B2\":{\"v\":7},\"B5\":{\"f\":\"=SUM(B2:B4)\",\"v\":7}}}]}}}}");
        assertThat(CbeAnswers.isAnswered(typed, config)).isTrue();
        assertThat(CbeAnswers.summary(typed, config)).isEqualTo("Part 1 Spreadsheet — 1 cell filled");

        // Tabs match by name only (as in the learner app): a renamed tab has no template.
        JsonNode renamed = json("{\"parts\":{\"p1\":{\"kind\":\"SPREADSHEET\",\"sheet\":{\"sheets\":[{\"name\":\"Answer\","
                + "\"cells\":{\"A1\":{\"v\":\"Total\"}}}]}}}}");
        assertThat(CbeAnswers.isAnswered(renamed, config)).isTrue();
    }

    @Test
    void htmlToTextReadsRealTipTapTablesAndLists() {
        String tiptap = "<p>Trial balance</p><table style=\"min-width: 50px\"><colgroup><col><col></colgroup><tbody>"
                + "<tr><th colspan=\"1\" rowspan=\"1\"><p>Account</p></th><th colspan=\"1\" rowspan=\"1\"><p>$000</p></th></tr>"
                + "<tr><td colspan=\"1\" rowspan=\"1\"><p>Cash</p></td><td colspan=\"1\" rowspan=\"1\"><p>1,200</p><p>(restated)</p></td></tr>"
                + "</tbody></table><ul><li><p>First point</p></li><li><p>Second</p><ul><li><p>nested</p></li></ul></li></ul>"
                + "<ol><li><p>Step one</p></li></ol>";
        assertThat(CbeAnswers.htmlToText(tiptap)).isEqualTo(
                "Trial balance\nAccount | $000\nCash | 1,200 (restated)\n- First point\n- Second\n- nested\n- Step one");
    }
}
