package vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The products of one file, in the order their first rows appear. */
public record ImportPlan(List<ProductPlan> products) {

    public int rowsTotal() {
        return products.stream().mapToInt(p -> p.getRows().size()).sum();
    }

    public int productsToCreate() {
        return (int) products.stream().filter(p -> !p.hasErrors() && p.isCreate()).count();
    }

    public int productsToUpdate() {
        return (int) products.stream().filter(p -> !p.hasErrors() && !p.isCreate()).count();
    }

    public int variantsToCreate() {
        return products.stream().filter(p -> !p.hasErrors()).mapToInt(ProductPlan::getVariantsToCreate).sum();
    }

    public int variantsToUpdate() {
        return products.stream().filter(p -> !p.hasErrors()).mapToInt(ProductPlan::getVariantsToUpdate).sum();
    }

    /** Every row of a product with an error: the product is not written, so none of its rows are. */
    public Set<Integer> blockedRows() {
        Set<Integer> rows = new LinkedHashSet<>();
        for (ProductPlan product : products) {
            if (product.hasErrors()) {
                product.getRows().forEach(r -> rows.add(r.rowNumber()));
            }
        }
        return rows;
    }

    public List<ImportIssue> issues() {
        List<ImportIssue> all = new ArrayList<>();
        products.forEach(p -> all.addAll(p.getIssues()));
        return all;
    }

    /** Messages by row, errors and warnings, for the error-rows file. */
    public Map<Integer, List<String>> messagesByRow() {
        return messagesByRow(issues());
    }

    public static Map<Integer, List<String>> messagesByRow(List<ImportIssue> issues) {
        Map<Integer, List<String>> out = new LinkedHashMap<>();
        for (ImportIssue issue : issues) {
            String text = (issue.getColumn() == null ? "" : issue.getColumn() + ": ") + issue.getMessage();
            out.computeIfAbsent(issue.getRow(), k -> new ArrayList<>()).add(text);
        }
        return out;
    }
}
