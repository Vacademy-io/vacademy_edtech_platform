package vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan;

import lombok.Getter;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportRow;

import java.util.ArrayList;
import java.util.List;

/**
 * The rows of one product and what the import will do with them. A plan with an error is
 * never written; the other products of the file are not affected.
 */
@Getter
public final class ProductPlan {

    private final String handle;
    private final List<ImportRow> rows;
    private final List<ImportIssue> issues = new ArrayList<>();

    /** Package id of the product this plan updates; null when the product is new. */
    @Setter
    private String existingPackageId;
    /** What goes to CommerceProductService. Null while the plan has errors. */
    @Setter
    private ProductRequest request;
    /** Media-library file ids for the product gallery, in file order. */
    private final List<String> galleryMediaIds = new ArrayList<>();
    /** Image URLs to queue for the migration tool. Never fetched by the import. */
    private final List<String> imageUrls = new ArrayList<>();
    @Setter
    private int variantsToCreate;
    @Setter
    private int variantsToUpdate;

    public ProductPlan(String handle, List<ImportRow> rows) {
        this.handle = handle;
        this.rows = rows;
    }

    public boolean isCreate() {
        return existingPackageId == null;
    }

    public boolean hasErrors() {
        for (ImportIssue issue : issues) {
            if (issue.isError()) {
                return true;
            }
        }
        return false;
    }

    public int firstRowNumber() {
        return rows.get(0).rowNumber();
    }

    public void error(ImportRow row, ImportColumn column, String code, String message) {
        issues.add(new ImportIssue(row.rowNumber(), column == null ? null : column.header(),
                ImportIssue.ERROR, code, message, handle));
    }

    public void warn(ImportRow row, ImportColumn column, String code, String message) {
        issues.add(new ImportIssue(row.rowNumber(), column == null ? null : column.header(),
                ImportIssue.WARNING, code, message, handle));
    }
}
