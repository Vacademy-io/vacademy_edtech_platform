package vacademy.io.admin_core_service.features.commerce.stock.costimport;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostDtos.CommitResponse;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostDtos.IssueView;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostDtos.MissingAfter;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostDtos.SpotCheckRow;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostDtos.ValidateResponse;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostSheet.Issue;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostSheet.Row;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostVariantReader.VariantRow;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockCostAdjustmentRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The item-costs import: a sheet of purchase prices becomes each item's standard cost.
 *
 * <p>validate reads the file, resolves every row (variant external ref first, then SKU, inside
 * the institute) and writes nothing. commit does the same work again, refuses when the answer
 * is not the one the caller saw ({@code token}) or when any row has an error, and then sets
 * the standard cost of each item whose cost changes through
 * {@link StockLedgerService#setStandardCost}, 100 items per transaction in package-session
 * order (row locks stay short while a store trades). Each change carries the key
 * {@code ITEMCOST:<token prefix>:<package session>}, so a second commit of the same answer
 * writes nothing.
 *
 * <ul>
 *   <li>The sheet gives a price per selling unit (a metre); the stored cost is per base unit
 *       (a tenth of a metre at qty_scale 10), rounded half up to four decimals.</li>
 *   <li>"Includes tax = yes" takes the tax out only for an institute in REGULAR tax mode; any
 *       other mode keeps it in the cost.</li>
 *   <li>The token covers each item's current cost and how often it was set, so the same file
 *       committed again after another change sets its costs again.</li>
 *   <li>One commit per institute at a time on this pod (409 {@code IMPORT_RUNNING}).</li>
 *   <li>The import audit row is written however the commit ends, with the counts so far.</li>
 * </ul>
 */
@Slf4j
@Service
public class ItemCostImportService {

    static final int CHUNK = 100;
    static final int MAX_ISSUES_SHOWN = 500;
    static final int SPOT_CHECK = 50;
    static final int MISSING_SHOWN = 50;
    static final String KEY_PREFIX = "ITEMCOST:";
    static final String AUDIT_KIND = "ITEM_COSTS_IMPORT";

    public static final String ITEM_NOT_FOUND = "ITEM_NOT_FOUND";
    public static final String ITEM_AMBIGUOUS = "ITEM_AMBIGUOUS";
    public static final String DUPLICATE = "DUPLICATE";
    public static final String ARCHIVED = "ARCHIVED";
    public static final String TAX_KEPT_IN_COST = "TAX_KEPT_IN_COST";
    public static final String COST_ROUNDED = "COST_ROUNDED";
    public static final String IMPORT_RUNNING = "IMPORT_RUNNING";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ItemCostVariantReader variantReader;
    private final StockLedgerService ledger;
    private final StockCostAdjustmentRepository costAdjustmentRepository;
    private final CommerceAuditService auditService;
    private final CommerceTaxSettingService taxSettings;
    private final TransactionTemplate chunkTransaction;
    /** Institutes with a commit running on this pod. */
    private final Set<String> committing = ConcurrentHashMap.newKeySet();

    public ItemCostImportService(ItemCostVariantReader variantReader, StockLedgerService ledger,
                                 StockCostAdjustmentRepository costAdjustmentRepository,
                                 CommerceAuditService auditService, CommerceTaxSettingService taxSettings,
                                 PlatformTransactionManager transactionManager) {
        this.variantReader = variantReader;
        this.ledger = ledger;
        this.costAdjustmentRepository = costAdjustmentRepository;
        this.auditService = auditService;
        this.taxSettings = taxSettings;
        this.chunkTransaction = new TransactionTemplate(transactionManager);
    }

    /** A resolved row: the sheet row, its variant, and the cost of one base unit it sets. */
    record Line(Row row, VariantRow variant, BigDecimal cost) {
        boolean unchanged() {
            return variant.standardCost() != null && variant.standardCost().compareTo(cost) == 0;
        }
    }

    /** Everything validate answers and commit acts on. */
    record Plan(int rows, List<Line> lines, List<IssueView> errors, List<IssueView> warnings,
                List<VariantRow> variants, byte[] fileHash, String token, TaxMode taxMode,
                ItemCostSheet.TaxRule taxRule) {
    }

    /** The rule for "includes tax = yes": only a REGULAR seller takes the tax out of the cost. */
    static ItemCostSheet.TaxRule taxRule(TaxMode mode) {
        return mode == TaxMode.REGULAR ? ItemCostSheet.TaxRule.REMOVE_INCLUDED_TAX
                : ItemCostSheet.TaxRule.KEEP_TAX_IN_COST;
    }

    /** The cost of one base unit: the cost per selling unit over the scale, half up to four decimals. */
    static BigDecimal perBaseUnit(BigDecimal perUnit, int qtyScale) {
        if (qtyScale <= 1) {
            return perUnit.setScale(ItemCostSheet.COST_SCALE, RoundingMode.HALF_UP);
        }
        return perUnit.divide(BigDecimal.valueOf(qtyScale), ItemCostSheet.COST_SCALE, RoundingMode.HALF_UP);
    }

    // ───────────────────────────────────────────────────────────────── validate

    public ValidateResponse validate(String instituteId, String fileName, byte[] content) {
        Plan plan = plan(instituteId, fileName, content);
        int unchanged = 0;
        for (Line line : plan.lines()) {
            if (line.unchanged()) {
                unchanged++;
            }
        }
        return new ValidateResponse(plan.rows(), plan.lines().size(), plan.errors().size(),
                cap(plan.errors()), plan.warnings().size(), cap(plan.warnings()), unchanged,
                plan.lines().size() - unchanged, sumOld(plan.lines()), sumNew(plan.lines()), missingAfter(plan),
                spotCheck(plan), plan.token(), plan.taxMode().name(), plan.taxRule().name());
    }

    // ─────────────────────────────────────────────────────────────────── commit

    public CommitResponse commit(String instituteId, String actorUserId, String fileName, byte[] content,
                                 String token) {
        if (token == null || token.isBlank()) {
            throw new InvalidRequestException("token is required: validate the file first and send its token");
        }
        Plan plan = plan(instituteId, fileName, content);
        if (!plan.token().equals(token.trim())) {
            throw new ConflictException("IMPORT_CHANGED: the file or the items changed since it was validated; "
                    + "validate it again");
        }
        if (!plan.errors().isEmpty()) {
            throw new VacademyException(HttpStatus.UNPROCESSABLE_ENTITY, "IMPORT_HAS_ERRORS: "
                    + plan.errors().size() + " row(s) have errors; fix them and validate again");
        }
        List<Line> changes = new ArrayList<>();
        int unchanged = 0;
        for (Line line : plan.lines()) {
            if (line.unchanged()) {
                unchanged++;
            } else {
                changes.add(line);
            }
        }
        // Package-session order: variant rows are locked in one order (as "Set standard cost" does).
        changes.sort(Comparator.comparing(line -> line.variant().packageSessionId()));
        String keyPrefix = KEY_PREFIX + plan.token().substring(0, 16) + ":";
        BigDecimal sumOld = sumOld(plan.lines());
        BigDecimal sumNew = sumNew(plan.lines());
        int batches = (changes.size() + CHUNK - 1) / CHUNK;
        int[] counts = new int[2]; // changed, already done
        int batch = 0;
        boolean completed = false;
        if (!committing.add(instituteId)) {
            throw new ConflictException(IMPORT_RUNNING + ": an item-costs load of this institute is running; "
                    + "try again when it has finished");
        }
        try {
            for (int from = 0; from < changes.size(); from += CHUNK) {
                batch++;
                List<Line> chunk = changes.subList(from, Math.min(changes.size(), from + CHUNK));
                int[] inBatch = new int[2];
                chunkTransaction.executeWithoutResult(status -> {
                    for (Line line : chunk) {
                        String packageSessionId = line.variant().packageSessionId();
                        String key = keyPrefix + packageSessionId;
                        if (costAdjustmentRepository.findByInstituteIdAndIdempotencyKey(instituteId, key)
                                .isPresent()) {
                            inBatch[1]++;
                            continue;
                        }
                        ledger.setStandardCost(instituteId, packageSessionId, line.cost(), actorUserId, key);
                        inBatch[0]++;
                    }
                });
                // Counted only once the batch's transaction has committed.
                counts[0] += inBatch[0];
                counts[1] += inBatch[1];
            }
            completed = true;
        } finally {
            committing.remove(instituteId);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("rows", plan.rows());
            detail.put("completed", completed);
            detail.put("changed", counts[0]);
            detail.put("already_done", counts[1]);
            detail.put("unchanged", unchanged);
            detail.put("batches", batches);
            if (!completed) {
                detail.put("failed_batch", batch);
            }
            detail.put("sum_old", sumOld.toPlainString());
            detail.put("sum_new", sumNew.toPlainString());
            detail.put("tax_rule", plan.taxRule().name());
            detail.put("token", plan.token().substring(0, 16));
            audit(instituteId, actorUserId, detail, completed);
        }
        return new CommitResponse(plan.rows(), counts[0], counts[1], unchanged, sumOld, sumNew, plan.token());
    }

    /**
     * The import's audit row. After a failed batch a failure to write it is logged and the
     * batch's own error goes back to the caller.
     */
    private void audit(String instituteId, String actorUserId, Map<String, Object> detail, boolean completed) {
        if (completed) {
            auditService.record(instituteId, actorUserId, AUDIT_KIND, "STANDARD_COST", null, json(detail));
            return;
        }
        try {
            auditService.record(instituteId, actorUserId, AUDIT_KIND, "STANDARD_COST", null, json(detail));
        } catch (RuntimeException e) {
            log.error("Item-costs import audit row not written for institute {} after a failed batch: {}",
                    instituteId, e.getMessage(), e);
        }
    }

    // ───────────────────────────────────────────────────────────────── the plan

    Plan plan(String instituteId, String fileName, byte[] content) {
        TaxMode taxMode = taxSettings.context(instituteId).getMode();
        ItemCostSheet.TaxRule taxRule = taxRule(taxMode);
        ItemCostSheet.Parsed parsed = ItemCostSheet.read(ImportFileParser.readTable(fileName, content), taxRule);
        List<VariantRow> variants = variantReader.variants(instituteId);
        Map<String, List<VariantRow>> byRef = new HashMap<>();
        Map<String, VariantRow> bySku = new HashMap<>();
        for (VariantRow variant : variants) {
            if (variant.externalRef() != null && !variant.externalRef().isBlank()) {
                byRef.computeIfAbsent(variant.externalRef().trim(), k -> new ArrayList<>()).add(variant);
            }
            if (variant.sku() != null) {
                bySku.put(variant.sku().trim(), variant);
            }
        }

        Map<Integer, List<Issue>> sheetErrors = new HashMap<>();
        for (Issue issue : parsed.errors()) {
            sheetErrors.computeIfAbsent(issue.row(), k -> new ArrayList<>()).add(issue);
        }
        List<IssueView> errors = new ArrayList<>();
        List<IssueView> warnings = new ArrayList<>();
        List<Line> lines = new ArrayList<>();
        Map<String, Integer> firstRowOf = new HashMap<>();
        for (Row row : parsed.rows()) {
            String label = row.sku() != null ? row.sku() : row.externalRef();
            for (Issue issue : sheetErrors.getOrDefault(row.rowNumber(), List.of())) {
                errors.add(new IssueView(issue.row(), issue.column(), issue.code(), issue.message(), label));
            }
            VariantRow variant = null;
            if (row.sku() != null || row.externalRef() != null) {
                Resolution resolution = resolve(row, byRef, bySku);
                if (resolution.error() != null) {
                    errors.add(resolution.error());
                } else {
                    variant = resolution.variant();
                }
            }
            if (variant == null) {
                continue;
            }
            Integer first = firstRowOf.putIfAbsent(variant.packageSessionId(), row.rowNumber());
            if (first != null) {
                errors.add(new IssueView(row.rowNumber(), column(row), DUPLICATE,
                        "this item is already in row " + first, variant.sku()));
                continue;
            }
            if (variant.archived()) {
                warnings.add(new IssueView(row.rowNumber(), column(row), ARCHIVED,
                        "this item is archived; its cost is still set", variant.sku()));
            }
            if (row.costed() && !sheetErrors.containsKey(row.rowNumber())) {
                BigDecimal cost = perBaseUnit(row.cost(), variant.qtyScale());
                if (cost.signum() <= 0) {
                    errors.add(new IssueView(row.rowNumber(), ItemCostSheet.Column.PURCHASE_PRICE.header(),
                            ItemCostSheet.INVALID_PRICE, "the cost of one base unit (1/" + variant.qtyScale()
                            + " of a " + unitName(variant) + ") rounds to zero", variant.sku()));
                    continue;
                }
                if (cost.multiply(BigDecimal.valueOf(variant.qtyScale())).compareTo(row.cost()) != 0) {
                    warnings.add(new IssueView(row.rowNumber(), ItemCostSheet.Column.PURCHASE_PRICE.header(),
                            COST_ROUNDED, "the cost per " + unitName(variant) + " does not divide into "
                            + variant.qtyScale() + " equal parts; one base unit is stored at "
                            + cost.toPlainString(), variant.sku()));
                }
                if (Boolean.TRUE.equals(row.includesTax()) && taxRule == ItemCostSheet.TaxRule.KEEP_TAX_IN_COST) {
                    warnings.add(new IssueView(row.rowNumber(), ItemCostSheet.Column.INCLUDES_TAX.header(),
                            TAX_KEPT_IN_COST, "the shop is not in regular GST mode, so the tax paid stays in the "
                            + "cost", variant.sku()));
                }
                lines.add(new Line(row, variant, cost));
            }
        }
        errors.sort(Comparator.comparingInt(IssueView::row));
        byte[] fileHash = sha256(content);
        return new Plan(parsed.rows().size(), lines, errors, warnings, variants, fileHash,
                token(instituteId, content, lines), taxMode, taxRule);
    }

    private static String unitName(VariantRow variant) {
        return variant.unit() == null || variant.unit().isBlank() ? "unit" : variant.unit();
    }

    private record Resolution(VariantRow variant, IssueView error) {
    }

    /** External ref first, then SKU (as the product import matches). Never by name. */
    private static Resolution resolve(Row row, Map<String, List<VariantRow>> byRef, Map<String, VariantRow> bySku) {
        if (row.externalRef() != null) {
            List<VariantRow> found = byRef.get(row.externalRef().trim());
            if (found != null && found.size() > 1) {
                return new Resolution(null, new IssueView(row.rowNumber(),
                        ItemCostSheet.Column.VARIANT_EXTERNAL_REF.header(), ITEM_AMBIGUOUS,
                        "more than one item has this external ref; use the sku", row.externalRef()));
            }
            if (found != null) {
                return new Resolution(found.get(0), null);
            }
        }
        if (row.sku() != null) {
            VariantRow variant = bySku.get(row.sku().trim());
            if (variant != null) {
                return new Resolution(variant, null);
            }
        }
        String column = row.externalRef() != null && row.sku() == null
                ? ItemCostSheet.Column.VARIANT_EXTERNAL_REF.header() : ItemCostSheet.Column.SKU.header();
        return new Resolution(null, new IssueView(row.rowNumber(), column, ITEM_NOT_FOUND,
                "no item of this shop has this " + (row.sku() != null ? "sku" : "external ref"),
                row.sku() != null ? row.sku() : row.externalRef()));
    }

    private static String column(Row row) {
        return row.externalRef() != null ? ItemCostSheet.Column.VARIANT_EXTERNAL_REF.header()
                : ItemCostSheet.Column.SKU.header();
    }

    // ─────────────────────────────────────────────────────────────── the answer

    private static List<IssueView> cap(List<IssueView> issues) {
        return issues.size() <= MAX_ISSUES_SHOWN ? issues : List.copyOf(issues.subList(0, MAX_ISSUES_SHOWN));
    }

    static BigDecimal sumOld(List<Line> lines) {
        BigDecimal sum = BigDecimal.ZERO;
        for (Line line : lines) {
            if (line.variant().standardCost() != null) {
                sum = sum.add(line.variant().standardCost());
            }
        }
        return sum.setScale(ItemCostSheet.COST_SCALE, RoundingMode.HALF_UP);
    }

    static BigDecimal sumNew(List<Line> lines) {
        BigDecimal sum = BigDecimal.ZERO;
        for (Line line : lines) {
            sum = sum.add(line.cost());
        }
        return sum.setScale(ItemCostSheet.COST_SCALE, RoundingMode.HALF_UP);
    }

    private static MissingAfter missingAfter(Plan plan) {
        Set<String> covered = new HashSet<>();
        for (Line line : plan.lines()) {
            covered.add(line.variant().packageSessionId());
        }
        List<String> skus = new ArrayList<>();
        for (VariantRow variant : plan.variants()) {
            if (variant.tracked() && !variant.archived()
                    && (variant.standardCost() == null || variant.standardCost().signum() <= 0)
                    && !covered.contains(variant.packageSessionId())) {
                skus.add(variant.sku());
            }
        }
        skus.sort(Comparator.nullsLast(Comparator.naturalOrder()));
        return new MissingAfter(skus.size(), List.copyOf(skus.subList(0, Math.min(MISSING_SHOWN, skus.size()))));
    }

    /** 50 rows picked by a shuffle seeded with the file's hash: the same file gives the same rows. */
    static List<SpotCheckRow> spotCheck(Plan plan) {
        List<Line> pool = new ArrayList<>(plan.lines());
        Collections.shuffle(pool, new Random(ByteBuffer.wrap(plan.fileHash(), 0, 8).getLong()));
        List<Line> picked = new ArrayList<>(pool.subList(0, Math.min(SPOT_CHECK, pool.size())));
        picked.sort(Comparator.comparingInt(line -> line.row().rowNumber()));
        List<SpotCheckRow> out = new ArrayList<>(picked.size());
        for (Line line : picked) {
            Row row = line.row();
            out.add(new SpotCheckRow(row.rowNumber(), line.variant().sku(), line.variant().name(), row.price(),
                    Boolean.TRUE.equals(row.includesTax()), row.rate(), line.cost(), line.variant().standardCost(),
                    line.variant().unit(), line.variant().qtyScale(), row.cost()));
        }
        return out;
    }

    /**
     * SHA-256 hex of the institute, the file and the resolved plan: row, item, new cost, and the
     * item's current cost with the number of times it was set. The current state is in it so that
     * a commit is a no-op only for the state it was validated against: file X, then Y, then X
     * again sets X's costs again (new token, new keys), and a stale validate gets 409.
     */
    static String token(String instituteId, byte[] content, List<Line> lines) {
        MessageDigest digest = digest();
        digest.update(("institute:" + instituteId + "\n").getBytes(StandardCharsets.UTF_8));
        digest.update(("file:" + content.length + "\n").getBytes(StandardCharsets.UTF_8));
        digest.update(content);
        digest.update("\nplan\n".getBytes(StandardCharsets.UTF_8));
        for (Line line : lines) {
            BigDecimal current = line.variant().standardCost();
            digest.update((line.row().rowNumber() + "|" + line.variant().packageSessionId() + "|"
                    + line.cost().toPlainString() + "|" + (current == null ? "-" : current.toPlainString()) + "|"
                    + line.variant().standardSets() + "\n").getBytes(StandardCharsets.UTF_8));
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static byte[] sha256(byte[] content) {
        return digest().digest(content);
    }

    private static MessageDigest digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    private static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("item-costs import: value is not serialisable", e);
        }
    }
}
