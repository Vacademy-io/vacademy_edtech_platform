package vacademy.io.admin_core_service.features.commerce.catalogue.importer.file;

import java.util.EnumMap;
import java.util.Map;

/** One data row of an import file. Values are trimmed; a blank cell is absent. */
public final class ImportRow {

    private final int rowNumber;
    private final Map<ImportColumn, String> values = new EnumMap<>(ImportColumn.class);

    /** rowNumber is the row in the spreadsheet, the header being row 1. */
    public ImportRow(int rowNumber) {
        this.rowNumber = rowNumber;
    }

    public int rowNumber() {
        return rowNumber;
    }

    public String get(ImportColumn column) {
        return values.get(column);
    }

    public ImportRow set(ImportColumn column, String value) {
        if (value == null || value.isBlank()) {
            values.remove(column);
        } else {
            values.put(column, value.trim());
        }
        return this;
    }

    public boolean isBlank() {
        return values.isEmpty();
    }

    /** True when the row describes a variant; false for a row that carries product columns only. */
    public boolean hasVariantCells() {
        for (ImportColumn column : ImportColumn.variantColumns()) {
            if (values.containsKey(column)) {
                return true;
            }
        }
        return false;
    }
}
