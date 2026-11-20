package vacademy.io.admin_core_service.features.commerce.stock.costimport;

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

/**
 * The item-costs import: a sheet of purchase prices becomes each item's standard cost.
 *
 * <p>validate reads the file, resolves every row (variant external ref first, then SKU, inside
 * the institute) and writes nothing. commit does the same work again, refuses when the answer
 * is not the one the caller saw ({@code token}) or when any row has an error, and then sets
 * the standard cost of each item whose cost changes through
 * {@link StockLedgerService#setStandardCost}, 500 items per transaction in package-session
 * order. Each change carries the key {@code ITEMCOST:<token prefix>:<package session>}, so a
 * second commit of the same file writes nothing.
 */
@Service
public class ItemCostImportService {

    static final int CHUNK = 500;
    static final int MAX_ISSUES_SHOWN = 500;
    static final int SPOT_CHECK = 50;
    static final int MISSING_SHOWN = 50;
    static final String KEY_PREFIX = "ITEMCOST:";
    static final String AUDIT_KIND = "ITEM_COSTS_IMPORT";

    public static final String ITEM_NOT_FOUND = "ITEM_NOT_FOUND";
    public static final String ITEM_AMBIGUOUS = "ITEM_AMBIGUOUS";
    public static final String DUPLICATE = "DUPLICATE";
    public static final String ARCHIVED = "ARCHIVED";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ItemCostVariantReader variantReader;
    private final StockLedgerService ledger;
    private final StockCostAdjustmentRepository costAdjustmentRepository;
    private final CommerceAuditService auditService;
    private final TransactionTemplate chunkTransaction;

    public ItemCostImportService(ItemCostVariantReader variantReader, StockLedgerService ledger,
                                 StockCostAdjustmentRepository costAdjustmentRepository,
                                 CommerceAuditService auditService, PlatformTransactionManager transactionManager) {
        this.variantReader = variantReader;
        this.ledger = ledger;
        this.costAdjustmentRepository = costAdjustmentRepository;
        this.auditService = auditService;
        this.chunkTransaction = new TransactionTemplate(transactionManager);
    }

    /** A resolved row: the sheet row, its variant, and the cost it sets. */
    record Line(Row row, VariantRow variant) {
        BigDecimal cost() {
            return row.cost();
        }

        boolean unchanged() {
            return variant.standardCost() != null && variant.standardCost().compareTo(row.cost()) == 0;
        }
    }

    /** Everything validate answers and commit acts on. */
    record Plan(int rows, List<Line> lines, List<IssueView> errors, List<IssueView> warnings,
                List<VariantRow> variants, byte[] fileHash, String token) {
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
                spotCheck(plan), plan.token());
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
        int[] counts = new int[2]; // changed, already done
        for (int from = 0; from < changes.size(); from += CHUNK) {
            List<Line> chunk = changes.subList(from, Math.min(changes.size(), from + CHUNK));
            chunkTransaction.executeWithoutResult(status -> {
                for (Line line : chunk) {
                    String packageSessionId = line.variant().packageSessionId();
                    String key = keyPrefix + packageSessionId;
                    if (costAdjustmentRepository.findByInstituteIdAndIdempotencyKey(instituteId, key).isPresent()) {
                        counts[1]++;
                        continue;
                    }
                    ledger.setStandardCost(instituteId, packageSessionId, line.cost(), actorUserId, key);
                    counts[0]++;
                }
            });
        }
        BigDecimal sumOld = sumOld(plan.lines());
        BigDecimal sumNew = sumNew(plan.lines());
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("rows", plan.rows());
        detail.put("changed", counts[0]);
        detail.put("already_done", counts[1]);
        detail.put("unchanged", unchanged);
        detail.put("sum_old", sumOld.toPlainString());
        detail.put("sum_new", sumNew.toPlainString());
        detail.put("token", plan.token().substring(0, 16));
        auditService.record(instituteId, actorUserId, AUDIT_KIND, "STANDARD_COST", null, json(detail));
        return new CommitResponse(plan.rows(), counts[0], counts[1], unchanged, sumOld, sumNew, plan.token());
    }

    // ───────────────────────────────────────────────────────────────── the plan

    Plan plan(String instituteId, String fileName, byte[] content) {
        ItemCostSheet.Parsed parsed = ItemCostSheet.read(ImportFileParser.readTable(fileName, content));
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
                lines.add(new Line(row, variant));
            }
        }
        errors.sort(Comparator.comparingInt(IssueView::row));
        byte[] fileHash = sha256(content);
        return new Plan(parsed.rows().size(), lines, errors, warnings, variants, fileHash,
                token(instituteId, content, lines));
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
            if (variant.tracked() && !variant.archived() && variant.standardCost() == null
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
                    Boolean.TRUE.equals(row.includesTax()), row.rate(), row.cost(), line.variant().standardCost()));
        }
        return out;
    }

    /** SHA-256 hex of the institute, the file and the resolved plan (row, item, cost). */
    static String token(String instituteId, byte[] content, List<Line> lines) {
        MessageDigest digest = digest();
        digest.update(("institute:" + instituteId + "\n").getBytes(StandardCharsets.UTF_8));
        digest.update(("file:" + content.length + "\n").getBytes(StandardCharsets.UTF_8));
        digest.update(content);
        digest.update("\nplan\n".getBytes(StandardCharsets.UTF_8));
        for (Line line : lines) {
            digest.update((line.row().rowNumber() + "|" + line.variant().packageSessionId() + "|"
                    + line.cost().toPlainString() + "\n").getBytes(StandardCharsets.UTF_8));
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
