package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportRow;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportSheetWriter;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ParsedImportFile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.EnumMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ImportSheetWriterTest {

    @Test
    void cellsASpreadsheetWouldRunAreMadePlainText() {
        assertEquals("'=HYPERLINK(\"http://x\")", ImportSheetWriter.escapeCell("=HYPERLINK(\"http://x\")"));
        assertEquals("'+91 98765", ImportSheetWriter.escapeCell("+91 98765"));
        assertEquals("'-10% off", ImportSheetWriter.escapeCell("-10% off"));
        assertEquals("'@SUM(A1)", ImportSheetWriter.escapeCell("@SUM(A1)"));
        assertEquals("'\tcmd", ImportSheetWriter.escapeCell("\tcmd"));
        assertEquals("'\rcmd", ImportSheetWriter.escapeCell("\rcmd"));
        assertEquals("खादी कुर्ता", ImportSheetWriter.escapeCell("खादी कुर्ता"));
        assertEquals("1350", ImportSheetWriter.escapeCell("1350"));
        assertEquals("a=b", ImportSheetWriter.escapeCell("a=b"), "only the first character matters");
        assertEquals("", ImportSheetWriter.escapeCell(null));
    }

    @Test
    void aFormulaBehindLeadingBlanksOrInFullWidthSignsIsGuardedTooAndReadsBackUnchanged() {
        for (String value : new String[] {" =cmd|x", "\n=1+1", "  \t@SUM(A1)", "\uFF1DSUM(A1)", "\uFF0B1", "\uFF0D1",
                "\uFF20x", "\u00A0=1"}) {
            String guarded = ImportSheetWriter.escapeCell(value);
            assertEquals("'" + value, guarded, "guarded: " + value.trim());
            assertEquals(value, vacademy.io.admin_core_service.features.commerce.catalogue.importer.file
                    .ImportFileParser.unescape(guarded));
        }
        assertEquals(" plain text", ImportSheetWriter.escapeCell(" plain text"));
        assertEquals("  12", ImportSheetWriter.escapeCell("  12"));
    }

    @Test
    void aWrittenFileHasTheMarkTheHeaderAndGuardedCellsAndReadsBackUnchanged() throws IOException {
        Map<ImportColumn, String> values = new EnumMap<>(ImportColumn.class);
        values.put(ImportColumn.HANDLE, "khadi-kurta");
        values.put(ImportColumn.NAME_HI, "खादी कुर्ता");
        values.put(ImportColumn.NAME_EN, "=cmd|' /C calc'!A0");
        values.put(ImportColumn.BRAND, "@brand");
        values.put(ImportColumn.SKU, "KK-M");
        values.put(ImportColumn.SHORT_DESCRIPTION_EN, "soft, \"hand-spun\"\nand light");

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ImportSheetWriter writer = ImportSheetWriter.csvWithErrors(out)) {
            writer.writeRow(values, "-sku: taken");
            assertEquals(1, writer.rowsWritten());
        }
        byte[] bytes = out.toByteArray();
        assertEquals((byte) 0xEF, bytes[0]);
        assertEquals((byte) 0xBB, bytes[1]);
        assertEquals((byte) 0xBF, bytes[2]);
        String text = new String(bytes, StandardCharsets.UTF_8);
        assertTrue(text.startsWith("﻿handle,external_ref,name_hi,name_en"), text);
        assertTrue(text.contains(",errors\r\n"));
        assertTrue(text.contains("'=cmd|"), "the formula is guarded in the file");
        assertTrue(text.contains("'@brand"));
        assertTrue(text.contains("'-sku: taken"), "the errors column is guarded too");
        assertFalse(text.contains(",=cmd"));

        ParsedImportFile back = new ImportFileParser().parse("out.csv", bytes);
        ImportRow row = back.rows().get(0);
        assertEquals("=cmd|' /C calc'!A0", row.get(ImportColumn.NAME_EN));
        assertEquals("@brand", row.get(ImportColumn.BRAND));
        assertEquals("खादी कुर्ता", row.get(ImportColumn.NAME_HI));
        assertEquals("soft, \"hand-spun\"\nand light", row.get(ImportColumn.SHORT_DESCRIPTION_EN));
    }

    @Test
    void bothTemplatesCarryExactlyTheTemplateHeaderAndNoRows() throws IOException {
        ByteArrayOutputStream csv = new ByteArrayOutputStream();
        ImportSheetWriter.writeTemplateCsv(csv);
        assertEquals("﻿" + String.join(",", ImportColumn.headers()) + "\r\n",
                csv.toString(StandardCharsets.UTF_8));
        assertEquals(0, new ImportFileParser().parse("template.csv", csv.toByteArray()).rows().size());

        ByteArrayOutputStream xlsx = new ByteArrayOutputStream();
        ImportSheetWriter.writeTemplateXlsx(xlsx);
        // The guide sheet with its Hindi examples is the second sheet and is not read as data.
        assertEquals(0, new ImportFileParser().parse("template.xlsx", xlsx.toByteArray()).rows().size());
    }
}
