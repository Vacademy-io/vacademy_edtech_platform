package vacademy.io.admin_core_service.features.commerce.stock.costimport;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;
import java.util.List;

/** Answers of the item-costs import ({@code /stock/standard-costs/import}). */
public final class ItemCostDtos {

    private ItemCostDtos() {
    }

    /** A row error or warning. {@code row} is the spreadsheet row number. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record IssueView(int row, String column, String code, String message, String sku) {
    }

    /**
     * One row of the spot-check list: what the sheet said and the cost it gives.
     * {@code price} and {@code costPerUnit} are per selling unit ({@code unit}, e.g. one metre);
     * {@code cost} and {@code currentCost} are per base unit, as stored ({@code qtyScale} base
     * units make one selling unit; 1 for counted items).
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SpotCheckRow(int row, String sku, String name, BigDecimal price, boolean includesTax,
                               BigDecimal rate, BigDecimal cost, BigDecimal currentCost, String unit, int qtyScale,
                               BigDecimal costPerUnit) {
    }

    /** Tracked, non-archived items that would still have no standard cost after this file. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record MissingAfter(int count, List<String> skus) {
    }

    /**
     * mode=validate. Writes nothing. Lists are capped (errors and warnings at 500); the counts
     * are always exact. {@code token} is what a commit of the same file must send; it covers the
     * file, the plan and each item's current cost, so it changes once any of them changes.
     * {@code taxMode} is the institute's tax mode and {@code taxRule} what "includes tax = yes"
     * did ({@code REMOVE_INCLUDED_TAX} or {@code KEEP_TAX_IN_COST}).
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ValidateResponse(int rows, int ok, int errorCount, List<IssueView> errors, int warningCount,
                                   List<IssueView> warnings, int unchanged, int toChange, BigDecimal sumOld,
                                   BigDecimal sumNew, MissingAfter missingAfter, List<SpotCheckRow> spotCheck,
                                   String token, String taxMode, String taxRule) {
    }

    /**
     * mode=commit. {@code changed} = costs written now; {@code alreadyDone} = changes an earlier
     * commit of this file had written; {@code unchanged} = rows already at their cost.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record CommitResponse(int rows, int changed, int alreadyDone, int unchanged, BigDecimal sumOld,
                                 BigDecimal sumNew, String token) {
    }
}
