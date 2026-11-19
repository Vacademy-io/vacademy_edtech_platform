package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import org.junit.jupiter.api.Test;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SiteRedirectCsvTest {

    private static byte[] utf8(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    private static String refusal(String text) {
        return assertThrows(InvalidRequestException.class, () -> SiteRedirectCsv.parse(utf8(text))).getMessage();
    }

    @Test
    void readsTheColumnsInAnyOrderWithMatchTypeOptional() {
        SiteRedirectCsv.Parsed parsed = SiteRedirectCsv.parse(utf8(
                "﻿Status_Code,from_path,to_path\n301,/a,/p/x\n,,\n410,/b,\n"));
        assertEquals(1, parsed.blankRows());
        assertEquals(List.of(new SiteRedirectCsv.Row(2, "/a", "/p/x", "301", ""),
                new SiteRedirectCsv.Row(4, "/b", "", "410", "")), parsed.rows());

        SiteRedirectCsv.Row withMatch = SiteRedirectCsv.parse(utf8(
                "from_path,to_path,status_code,match_type\n\" /hi \",/,301,PREFIX\n")).rows().get(0);
        assertEquals(new SiteRedirectCsv.Row(2, "/hi", "/", "301", "PREFIX"), withMatch);
    }

    @Test
    void refusesAHeaderThatIsNotTheRedirectColumns() {
        assertTrue(refusal("from_path,to_path\n/a,/b\n").contains("status_code is missing"));
        assertTrue(refusal("from_path,to_path,status_code,notes\n/a,/b,301,x\n").contains("unknown column \"notes\""));
        assertTrue(refusal("from_path,to_path,status_code,from_path\n/a,/b,301,/c\n").contains("appears twice"));
        assertTrue(refusal("from_path,to_path,status_code\n").contains("no data rows"));
        assertTrue(refusal("from_path,to_path,status_code\n/a,/b,301,extra\n").contains("more cells than the header"));
    }

    @Test
    void refusesWhatIsNotAUtf8CsvWithinTheLimits() {
        assertThrows(InvalidRequestException.class, () -> SiteRedirectCsv.parse(new byte[0]));
        byte[] latin1 = "from_path,to_path,status_code\n/café,/b,301\n".getBytes(StandardCharsets.ISO_8859_1);
        assertTrue(assertThrows(InvalidRequestException.class, () -> SiteRedirectCsv.parse(latin1)).getMessage()
                .contains("not UTF-8"));
        assertTrue(refusal("from_path,to_path,status_code\n\"/a,/b,301\n").contains("could not be read"));
        assertTrue(refusal("from_path,to_path,status_code\n/" + "a".repeat(SiteRedirectCsv.MAX_CELL_CHARS) + ",/b,301\n")
                .contains("longer than"));
        byte[] big = new byte[SiteRedirectCsv.MAX_FILE_BYTES + 1];
        assertTrue(assertThrows(InvalidRequestException.class, () -> SiteRedirectCsv.parse(big)).getMessage()
                .contains("larger than 2 MB"));
    }

    @Test
    void takesTwentyThousandRowsAndRefusesOneMore() {
        StringBuilder file = new StringBuilder("from_path,to_path,status_code\n");
        for (int i = 0; i < SiteRedirectCsv.MAX_ROWS; i++) {
            file.append("/o/").append(i).append(",/p/x,301\n");
        }
        assertEquals(SiteRedirectCsv.MAX_ROWS, SiteRedirectCsv.parse(utf8(file.toString())).rows().size());
        file.append("/o/last,/p/x,301\n");
        assertTrue(refusal(file.toString()).contains("more than 20000 rows"));
    }

    @Test
    void theExportIsAFileTheImportTakesBackWithFormulasDisarmed() throws Exception {
        List<SiteRedirectCsv.ExportRow> rows = List.of(
                new SiteRedirectCsv.ExportRow("/hi/product/लाल", "/p/%E0%A4%B2?lang=en", 301, "EXACT"),
                new SiteRedirectCsv.ExportRow("/gone", null, 410, "EXACT"),
                new SiteRedirectCsv.ExportRow("=HYPERLINK(\"x\")", "/a,b", 301, "PREFIX"));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        SiteRedirectCsv.write(out, rows);
        byte[] bytes = out.toByteArray();
        assertArrayEquals(new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF},
                new byte[]{bytes[0], bytes[1], bytes[2]}, "UTF-8 byte-order mark for Excel");
        String text = new String(bytes, StandardCharsets.UTF_8);
        assertTrue(text.startsWith("﻿from_path,to_path,status_code,match_type\r\n"), text);
        assertTrue(text.contains("\"'=HYPERLINK(\"\"x\"\")\""), text);

        List<SiteRedirectCsv.Row> back = SiteRedirectCsv.parse(bytes).rows();
        assertEquals(new SiteRedirectCsv.Row(2, "/hi/product/लाल", "/p/%E0%A4%B2?lang=en", "301", "EXACT"), back.get(0));
        assertEquals(new SiteRedirectCsv.Row(3, "/gone", "", "410", "EXACT"), back.get(1));
        assertEquals(new SiteRedirectCsv.Row(4, "=HYPERLINK(\"x\")", "/a,b", "301", "PREFIX"), back.get(2));
    }
}
