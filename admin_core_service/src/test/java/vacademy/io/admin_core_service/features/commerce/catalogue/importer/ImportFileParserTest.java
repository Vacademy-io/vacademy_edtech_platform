package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportRow;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ParsedImportFile;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.SAMPLE_CSV;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.utf8;

class ImportFileParserTest {

    private final ImportFileParser parser = new ImportFileParser();

    @Test
    void csvWithHindiAndEnglishIsReadCellByCell() {
        ParsedImportFile file = parser.parse("products.csv", utf8("﻿" + SAMPLE_CSV));

        assertEquals(ParsedImportFile.CSV, file.format());
        assertEquals(3, file.rows().size());
        assertEquals(1, file.blankRows(), "the blank line between the products; the last line break is no row");

        ImportRow kurta = file.rows().get(0);
        assertEquals(2, kurta.rowNumber());
        assertEquals("khadi-kurta", kurta.get(ImportColumn.HANDLE));
        assertEquals("खादी कुर्ता", kurta.get(ImportColumn.NAME_HI));
        assertEquals("Khadi Kurta", kurta.get(ImportColumn.NAME_EN));
        assertEquals("हाथ से काता, हाथ से बुना", kurta.get(ImportColumn.SHORT_DESCRIPTION_HI));
        assertEquals("<p>Pure khadi</p>\n<p>Hand spun</p>", kurta.get(ImportColumn.DESCRIPTION_HTML_EN));
        assertEquals("8901234567890", kurta.get(ImportColumn.BARCODE));
        assertEquals("1350", kurta.get(ImportColumn.PRICE));

        ImportRow large = file.rows().get(1);
        assertEquals(3, large.rowNumber());
        assertNull(large.get(ImportColumn.NAME_HI));
        assertEquals("1350.50", large.get(ImportColumn.PRICE));

        // The blank line before it is row 4, so the saree is row 5 as the spreadsheet shows it.
        ImportRow saree = file.rows().get(2);
        assertEquals(5, saree.rowNumber());
        assertEquals("सूती-साड़ी", saree.get(ImportColumn.HANDLE));
        assertEquals("सूती साड़ी", saree.get(ImportColumn.NAME_HI));
    }

    @Test
    void xlsxWithHindiAndNumbersIsReadLikeTheCsv() throws IOException {
        byte[] workbook;
        try (XSSFWorkbook book = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = book.createSheet("products");
            Row header = sheet.createRow(0);
            String[] headers = {"Handle", "name_hi", "name_en", "sku", "barcode", "price", "weight_grams"};
            for (int i = 0; i < headers.length; i++) {
                header.createCell(i).setCellValue(headers[i]);
            }
            Row first = sheet.createRow(1);
            first.createCell(0).setCellValue("khadi-kurta");
            first.createCell(1).setCellValue("खादी कुर्ता");
            first.createCell(2).setCellValue("Khadi Kurta");
            first.createCell(3).setCellValue("KK-M");
            first.createCell(4).setCellValue(8901234567890d);
            first.createCell(5).setCellValue(1350.5d);
            first.createCell(6).setCellValue(250d);
            // Row 3 is left out by the sheet; row 4 has a gap in the middle.
            Row second = sheet.createRow(3);
            second.createCell(0).setCellValue("khadi-kurta");
            second.createCell(3).setCellValue("KK-L");
            second.createCell(5).setCellValue(1350d);
            book.createSheet("guide").createRow(0).createCell(0).setCellValue("not read");
            book.write(out);
            workbook = out.toByteArray();
        }

        ParsedImportFile file = parser.parse("products.XLSX", workbook);

        assertEquals(ParsedImportFile.XLSX, file.format());
        assertEquals(2, file.rows().size());
        ImportRow first = file.rows().get(0);
        assertEquals(2, first.rowNumber());
        assertEquals("खादी कुर्ता", first.get(ImportColumn.NAME_HI));
        assertEquals("8901234567890", first.get(ImportColumn.BARCODE), "a barcode stays plain digits");
        assertEquals("1350.5", first.get(ImportColumn.PRICE));
        assertEquals("250", first.get(ImportColumn.WEIGHT_GRAMS));
        ImportRow second = file.rows().get(1);
        assertEquals(4, second.rowNumber());
        assertEquals("KK-L", second.get(ImportColumn.SKU));
        assertNull(second.get(ImportColumn.NAME_HI));
        assertEquals("1350", second.get(ImportColumn.PRICE));
    }

    @Test
    void theErrorsColumnOfAnErrorRowsFileIsIgnored() {
        ParsedImportFile file = parser.parse("fixed.csv", utf8("handle,sku,errors\nkurta,KK-1,sku: was wrong\n"));
        assertEquals(1, file.rows().size());
        assertEquals("KK-1", file.rows().get(0).get(ImportColumn.SKU));
    }

    @Test
    void aGuardedCellComesBackWithoutItsApostrophe() {
        ParsedImportFile file = parser.parse("a.csv", utf8("handle,sku,name_en,brand\nkurta,KK-1,'=Offer,'Plain\n"));
        assertEquals("=Offer", file.rows().get(0).get(ImportColumn.NAME_EN));
        assertEquals("'Plain", file.rows().get(0).get(ImportColumn.BRAND), "only a guarded cell is changed");
    }

    @Test
    void headerProblemsAreRefused() {
        assertMessage("not in the template", () -> parser.parse("a.csv", utf8("handle,sku,colour\nk,s,red\n")));
        assertMessage("no \"sku\" column", () -> parser.parse("a.csv", utf8("handle,name_en\nk,Kurta\n")));
        assertMessage("no \"handle\" column", () -> parser.parse("a.csv", utf8("sku,name_en\ns,Kurta\n")));
        assertMessage("appears twice", () -> parser.parse("a.csv", utf8("handle,sku,SKU\nk,s,s\n")));
        assertMessage("empty", () -> parser.parse("a.csv", utf8("\n\n")));
    }

    @Test
    void wrongTypeOrEncodingIsRefused() {
        assertMessage("only .csv", () -> parser.parse("products.xls", utf8("handle,sku\n")));
        assertMessage("only .csv", () -> parser.parse(null, utf8("handle,sku\n")));
        assertMessage("not an Excel workbook", () -> parser.parse("products.xlsx", utf8("handle,sku\n")));
        assertMessage("not a text file", () -> parser.parse("products.csv", new byte[] {'P', 'K', 3, 4, 0, 0}));
        // A Latin-1 e-acute is a lone 0xE9 byte, which is not valid UTF-8.
        byte[] latin = "handle,sku,name_en\nk,s,café\n".getBytes(StandardCharsets.ISO_8859_1);
        assertMessage("not UTF-8", () -> parser.parse("products.csv", latin));
        assertMessage("could not be read as an Excel workbook",
                () -> parser.parse("products.xlsx", new byte[] {'P', 'K', 3, 4, 1, 2, 3, 4, 5, 6}));
    }

    @Test
    void sizeAndRowCapsAreEnforced() {
        assertMessage("larger than 5 MB",
                () -> parser.parse("big.csv", new byte[ImportLimits.MAX_FILE_BYTES + 1]));
        assertMessage("empty", () -> parser.parse("none.csv", new byte[0]));

        StringBuilder atCap = new StringBuilder("handle,sku\n");
        for (int i = 0; i < ImportLimits.MAX_ROWS; i++) {
            atCap.append("p").append(i).append(",S").append(i).append('\n');
        }
        assertEquals(ImportLimits.MAX_ROWS, parser.parse("cap.csv", utf8(atCap.toString())).rows().size());

        String overCap = atCap + "one-more,S-more\n";
        assertMessage("more than " + ImportLimits.MAX_ROWS + " rows", () -> parser.parse("over.csv", utf8(overCap)));
    }

    /**
     * A workbook-shaped archive whose parts unpack to about 60 MB from under 2 MB, inside the
     * hundredfold expansion the workbook reader itself allows.
     */
    private static byte[] archiveThatUnpacksLarge() throws IOException {
        java.util.Random random = new java.util.Random(7);
        byte[] block = new byte[64 * 1024];
        byte[] noise = new byte[1_500];
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (java.util.zip.ZipOutputStream zip = new java.util.zip.ZipOutputStream(out)) {
            for (String part : new String[] {"[Content_Types].xml", "xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"}) {
                zip.putNextEntry(new java.util.zip.ZipEntry(part));
                for (int i = 0; i < 320; i++) {
                    random.nextBytes(noise);
                    System.arraycopy(noise, 0, block, 0, noise.length);
                    zip.write(block);
                }
                zip.closeEntry();
            }
        }
        return out.toByteArray();
    }

    @Test
    void aWorkbookThatUnpacksToTensOfMegabytesIsRefusedBeforeItIsOpened() throws IOException {
        byte[] archive = archiveThatUnpacksLarge();
        assertTrue(archive.length < ImportLimits.MAX_FILE_BYTES, "the upload itself is under the cap: " + archive.length);
        assertTrue(archive.length * 100L > 60L * 1024 * 1024, "and inside the expansion the reader allows");

        Runtime runtime = Runtime.getRuntime();
        System.gc();
        long before = runtime.totalMemory() - runtime.freeMemory();
        assertMessage("too large once unpacked", () -> parser.parse("products.xlsx", archive));
        long after = runtime.totalMemory() - runtime.freeMemory();

        // Counted while unpacking into nothing: the parts were never held in memory.
        assertTrue(after - before < 30L * 1024 * 1024, "heap grew by " + (after - before));
    }

    @Test
    void anArchiveWithHundredsOfPartsIsRefused() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (java.util.zip.ZipOutputStream zip = new java.util.zip.ZipOutputStream(out)) {
            for (int i = 0; i <= ImportLimits.MAX_XLSX_PARTS; i++) {
                zip.putNextEntry(new java.util.zip.ZipEntry("xl/part" + i + ".xml"));
                zip.write('x');
                zip.closeEntry();
            }
        }
        assertMessage("too large once unpacked", () -> parser.parse("products.xlsx", out.toByteArray()));
    }

    @Test
    void readTableGivesTheSameCellsAsParseForCsvAndXlsx() throws IOException {
        String csv = "\uFEFFhandle,name_en,sku,barcode,price\ntest-shirt,Test Shirt,TST-0001,8901234567890,1350.50\n"
                + "\ntest-shirt,,TST-0002,,1350\n";
        java.util.List<java.util.List<String>> table = ImportFileParser.readTable("costs.csv", utf8(csv));
        ParsedImportFile parsed = parser.parse("costs.csv", utf8(csv));
        assertEquals(4, table.size(), "blank rows keep their place");
        assertEquals(java.util.List.of("handle", "name_en", "sku", "barcode", "price"), table.get(0));
        assertEquals(parsed.rows().get(0).get(ImportColumn.SKU), table.get(1).get(2));
        assertEquals(parsed.rows().get(0).get(ImportColumn.PRICE), table.get(1).get(4));
        assertEquals(parsed.rows().get(1).get(ImportColumn.SKU), table.get(3).get(2));
        assertEquals(parsed.rows().get(1).rowNumber(), 4);

        byte[] workbook;
        try (XSSFWorkbook book = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = book.createSheet("products");
            String[] headers = {"handle", "name_en", "sku", "barcode", "price"};
            Row header = sheet.createRow(0);
            for (int i = 0; i < headers.length; i++) {
                header.createCell(i).setCellValue(headers[i]);
            }
            Row first = sheet.createRow(1);
            first.createCell(0).setCellValue("test-shirt");
            first.createCell(2).setCellValue("TST-0001");
            first.createCell(3).setCellValue(8901234567890d);
            first.createCell(4).setCellValue(1350.5d);
            book.write(out);
            workbook = out.toByteArray();
        }
        java.util.List<java.util.List<String>> xlsx = ImportFileParser.readTable("costs.xlsx", workbook);
        ParsedImportFile parsedXlsx = parser.parse("costs.xlsx", workbook);
        assertEquals(parsedXlsx.rows().get(0).get(ImportColumn.SKU), xlsx.get(1).get(2));
        assertEquals(parsedXlsx.rows().get(0).get(ImportColumn.BARCODE), xlsx.get(1).get(3));
        assertEquals("1350.5", xlsx.get(1).get(4));
        assertNull(xlsx.get(1).get(1), "a cell the sheet leaves out stays blank");

        assertMessage("empty", () -> ImportFileParser.readTable("costs.csv", new byte[0]));
        assertMessage("only .csv", () -> ImportFileParser.readTable("costs.txt", utf8("sku\n")));
        assertMessage("larger than", () -> ImportFileParser.readTable("costs.csv",
                new byte[ImportLimits.MAX_FILE_BYTES + 1]));
    }

    private static void assertMessage(String part, org.junit.jupiter.api.function.Executable call) {
        InvalidRequestException e = assertThrows(InvalidRequestException.class, call);
        assertTrue(e.getMessage().contains(part), e.getMessage());
    }
}
