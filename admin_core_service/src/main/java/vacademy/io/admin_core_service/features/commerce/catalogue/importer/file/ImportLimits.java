package vacademy.io.admin_core_service.features.commerce.catalogue.importer.file;

/** Caps of the product import and export. */
public final class ImportLimits {

    /** Largest upload, in bytes. */
    public static final int MAX_FILE_BYTES = 5 * 1024 * 1024;
    /** Most data rows (variants) in one file. */
    public static final int MAX_ROWS = 5000;
    /** Longest cell; a spreadsheet cell holds 32,767 characters, a CSV cell may hold more. */
    public static final int MAX_CELL_CHARS = 100_000;
    /** Most rows of one product. */
    public static final int MAX_ROWS_PER_PRODUCT = 200;
    /** Most variant rows one export writes. */
    public static final int MAX_EXPORT_ROWS = 20_000;
    /** Most product ids an "export selected" call may name. */
    public static final int MAX_EXPORT_IDS = 500;
    /** Most issues kept on a job or returned by a validation. The count is always exact. */
    public static final int MAX_ISSUES = 1000;
    /** Most images of one product row. */
    public static final int MAX_IMAGES_PER_PRODUCT = 30;

    /**
     * Most bytes an .xlsx upload may hold once unpacked, all parts together. The workbook
     * reader keeps every part in memory, and the upload cap alone does not bound that: a
     * workbook is a zip archive and 5 MB of it can unpack to hundreds of megabytes.
     */
    public static final long MAX_XLSX_UNPACKED_BYTES = 48L * 1024 * 1024;
    /** Most parts (zip entries) of an .xlsx upload; a workbook from the template has about a dozen. */
    public static final int MAX_XLSX_PARTS = 200;
    /** Most characters of all cells of one sheet together. */
    public static final long MAX_SHEET_CHARS = 40_000_000L;
    /** Workbooks read at the same time on one pod; a third waits. */
    public static final int MAX_CONCURRENT_XLSX = 2;
    /** How long a workbook waits for its turn before the upload is refused. */
    public static final int XLSX_WAIT_SECONDS = 20;

    private ImportLimits() {
    }
}
