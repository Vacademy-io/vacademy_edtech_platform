package vacademy.io.admin_core_service.features.commerce.catalogue.importer.file;

import java.util.List;

/** What the parser read: the data rows in file order and how many blank rows it skipped. */
public record ParsedImportFile(String format, List<ImportRow> rows, int blankRows) {

    public static final String CSV = "CSV";
    public static final String XLSX = "XLSX";
}
