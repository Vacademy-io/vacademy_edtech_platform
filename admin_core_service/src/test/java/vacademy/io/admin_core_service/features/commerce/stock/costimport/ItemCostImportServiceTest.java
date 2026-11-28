package vacademy.io.admin_core_service.features.commerce.stock.costimport;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostDtos.CommitResponse;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostDtos.IssueView;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostDtos.ValidateResponse;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostVariantReader.VariantRow;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockCostAdjustment;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockCostAdjustmentRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ItemCostImportServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String ACTOR = "user-1";

    private ItemCostVariantReader reader;
    private StockLedgerService ledger;
    private StockCostAdjustmentRepository adjustments;
    private CommerceAuditService audit;
    private PlatformTransactionManager transactions;
    private ItemCostImportService service;
    private List<VariantRow> variants;
    private CommerceTaxSettingService taxSettings;
    private TaxMode taxMode;

    @BeforeEach
    void setUp() {
        reader = mock(ItemCostVariantReader.class);
        ledger = mock(StockLedgerService.class);
        adjustments = mock(StockCostAdjustmentRepository.class);
        audit = mock(CommerceAuditService.class);
        transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenAnswer(i -> new SimpleTransactionStatus());
        when(adjustments.findByInstituteIdAndIdempotencyKey(anyString(), anyString())).thenReturn(Optional.empty());
        variants = new ArrayList<>();
        variants.add(variant("ps-1", "TST-0001", null, null));
        variants.add(variant("ps-2", "TST-0002", "ref-2", null));
        variants.add(variant("ps-3", "TST-0003", "ref-3", new BigDecimal("50.0000")));
        when(reader.variants(INSTITUTE)).thenAnswer(i -> variants);
        taxSettings = mock(CommerceTaxSettingService.class);
        taxMode = TaxMode.REGULAR;
        when(taxSettings.context(INSTITUTE)).thenAnswer(i -> CommerceTaxContext.builder().mode(taxMode).build());
        service = new ItemCostImportService(reader, ledger, adjustments, audit, taxSettings, transactions);
    }

    private static VariantRow variant(String psid, String sku, String ref, BigDecimal standardCost) {
        return new VariantRow(psid, sku, ref, false, true, standardCost, "Sample item " + sku);
    }

    private static byte[] csv(String... lines) {
        return (String.join("\n", lines) + "\n").getBytes(StandardCharsets.UTF_8);
    }

    private static List<String> codes(List<IssueView> issues) {
        return issues.stream().map(IssueView::code).toList();
    }

    @Test
    void theExternalRefWinsOverTheSku() {
        // Row names ref-2 and the SKU of another item: the external ref decides.
        ValidateResponse answer = service.validate(INSTITUTE, "costs.csv", csv(
                "sku,variant_external_ref,purchase_price,includes_tax",
                "TST-0001,ref-2,100,no"));
        assertEquals(0, answer.errorCount());
        assertEquals("TST-0002", answer.spotCheck().get(0).sku());
        // An unknown ref falls back to the SKU.
        answer = service.validate(INSTITUTE, "costs.csv", csv(
                "sku,variant_external_ref,purchase_price,includes_tax",
                "TST-0001,ref-unknown,100,no"));
        assertEquals("TST-0001", answer.spotCheck().get(0).sku());
    }

    @Test
    void anItemNamedTwiceIsADuplicateAndAnUnknownItemIsNotFound() {
        ValidateResponse answer = service.validate(INSTITUTE, "costs.csv", csv(
                "sku,variant_external_ref,purchase_price,includes_tax",
                "TST-0002,,100,no",
                ",ref-2,110,no",
                "TST-9999,,10,no",
                ",ref-9999,10,no"));
        assertEquals(List.of(ItemCostImportService.DUPLICATE, ItemCostImportService.ITEM_NOT_FOUND,
                ItemCostImportService.ITEM_NOT_FOUND), codes(answer.errors()));
        assertEquals(3, answer.errors().get(0).row());
        assertEquals("variant_external_ref", answer.errors().get(2).column());
        assertEquals(4, answer.rows());
        assertEquals(1, answer.ok());
    }

    @Test
    void anExternalRefSharedByTwoItemsIsAmbiguous() {
        variants.add(variant("ps-4", "TST-0004", "ref-2", null));
        ValidateResponse answer = service.validate(INSTITUTE, "costs.csv", csv(
                "variant_external_ref,purchase_price,includes_tax", "ref-2,10,no"));
        assertEquals(List.of(ItemCostImportService.ITEM_AMBIGUOUS), codes(answer.errors()));
    }

    @Test
    void anArchivedItemIsAWarningAndStillSet() {
        variants.set(0, new VariantRow("ps-1", "TST-0001", null, true, true, null, "Old item"));
        ValidateResponse answer = service.validate(INSTITUTE, "costs.csv", csv(
                "sku,purchase_price,includes_tax", "TST-0001,10,no"));
        assertEquals(0, answer.errorCount());
        assertEquals(List.of(ItemCostImportService.ARCHIVED), codes(answer.warnings()));
        assertEquals(1, answer.toChange());
    }

    @Test
    void validateAnswersTheTotalsAndWritesNothing() {
        ValidateResponse answer = service.validate(INSTITUTE, "costs.csv", csv(
                "sku,purchase_price,includes_tax,gst_rate_percent",
                "TST-0001,1180,yes,18",
                "TST-0003,50,no,"));
        assertEquals(2, answer.rows());
        assertEquals(2, answer.ok());
        assertEquals(1, answer.unchanged(), "TST-0003 already costs 50");
        assertEquals(1, answer.toChange());
        assertEquals(new BigDecimal("50.0000"), answer.sumOld());
        assertEquals(new BigDecimal("1050.0000"), answer.sumNew());
        assertEquals(1, answer.missingAfter().count());
        assertEquals(List.of("TST-0002"), answer.missingAfter().skus());
        assertEquals(2, answer.spotCheck().size());
        assertEquals(new BigDecimal("1000.0000"), answer.spotCheck().get(0).cost());
        assertEquals(64, answer.token().length());
        verifyNoInteractions(ledger, adjustments, audit, transactions);
        assertEquals("REGULAR", answer.taxMode());
        assertEquals("REMOVE_INCLUDED_TAX", answer.taxRule());
    }

    // ───────────────────────────────────── X1: the sheet price is per selling unit, the cost per base unit

    @Test
    void aMeasuredItemStoresTheCostOfOneBaseUnit() {
        // Cloth sold by the metre, stock kept in tenths of a metre.
        variants.set(0, new VariantRow("ps-1", "TST-0001", null, false, true, null, "Sample cloth", 10, "MTR", 0));
        byte[] file = csv("sku,purchase_price,includes_tax", "TST-0001,120,no");
        ValidateResponse answer = service.validate(INSTITUTE, "costs.csv", file);
        assertEquals(0, answer.errorCount());
        assertEquals(0, answer.warningCount());
        ItemCostDtos.SpotCheckRow row = answer.spotCheck().get(0);
        assertEquals(new BigDecimal("120"), row.price(), "the sheet price, per metre");
        assertEquals(new BigDecimal("120.0000"), row.costPerUnit(), "cost per metre");
        assertEquals(new BigDecimal("12.0000"), row.cost(), "cost of one tenth of a metre, as stored");
        assertEquals("MTR", row.unit());
        assertEquals(10, row.qtyScale());
        assertEquals(new BigDecimal("12.0000"), answer.sumNew());

        service.commit(INSTITUTE, ACTOR, "costs.csv", file, answer.token());
        ArgumentCaptor<BigDecimal> stored = ArgumentCaptor.forClass(BigDecimal.class);
        verify(ledger).setStandardCost(eq(INSTITUTE), eq("ps-1"), stored.capture(), eq(ACTOR), anyString());
        assertEquals(new BigDecimal("12.0000"), stored.getValue());
        // An opening receipt of 50 m is 500 base units: 500 x 12 = 6,000, not 60,000.
        assertEquals(0, new BigDecimal("6000").compareTo(stored.getValue().multiply(BigDecimal.valueOf(500))));
    }

    @Test
    void aBaseUnitCostThatDoesNotDivideIsRoundedWithAWarningAndZeroIsAnError() {
        variants.set(0, new VariantRow("ps-1", "TST-0001", null, false, true, null, "Sample thread", 1000, "KG", 0));
        variants.set(1, new VariantRow("ps-2", "TST-0002", null, false, true, null, "Sample bead", 1000, "KG", 0));
        ValidateResponse answer = service.validate(INSTITUTE, "costs.csv", csv(
                "sku,purchase_price,includes_tax", "TST-0001,99.99,no", "TST-0002,0.0004,no"));
        assertEquals(List.of(ItemCostImportService.COST_ROUNDED), codes(answer.warnings()));
        assertEquals(new BigDecimal("0.1000"), answer.spotCheck().get(0).cost(), "99.99 / 1000, half up");
        assertEquals(List.of(ItemCostSheet.INVALID_PRICE), codes(answer.errors()), "0.0004 / 1000 rounds to 0");
        assertEquals(3, answer.errors().get(0).row());
    }

    // ───────────────────────────────────── X2: included tax comes out only in REGULAR tax mode

    @Test
    void includedTaxStaysInTheCostOutsideRegularTaxMode() {
        byte[] file = csv("sku,purchase_price,includes_tax,gst_rate_percent", "TST-0001,1180,yes,18",
                "TST-0002,500,no,");
        for (TaxMode mode : List.of(TaxMode.UNREGISTERED, TaxMode.COMPOSITION)) {
            taxMode = mode;
            ValidateResponse answer = service.validate(INSTITUTE, "costs.csv", file);
            assertEquals(mode.name(), answer.taxMode());
            assertEquals("KEEP_TAX_IN_COST", answer.taxRule());
            assertEquals(0, answer.errorCount(), String.valueOf(answer.errors()));
            assertEquals(new BigDecimal("1180.0000"), answer.spotCheck().get(0).cost(), mode + ": tax kept");
            assertEquals(new BigDecimal("500.0000"), answer.spotCheck().get(1).cost());
            assertEquals(List.of(ItemCostImportService.TAX_KEPT_IN_COST), codes(answer.warnings()));
        }
        // No rate is needed when the tax stays in the cost.
        taxMode = TaxMode.UNREGISTERED;
        ValidateResponse noRate = service.validate(INSTITUTE, "costs.csv", csv(
                "sku,purchase_price,includes_tax", "TST-0001,1180,yes"));
        assertEquals(0, noRate.errorCount(), String.valueOf(noRate.errors()));
        assertEquals(new BigDecimal("1180.0000"), noRate.spotCheck().get(0).cost());

        taxMode = TaxMode.REGULAR;
        ValidateResponse regular = service.validate(INSTITUTE, "costs.csv", file);
        assertEquals("REMOVE_INCLUDED_TAX", regular.taxRule());
        assertEquals(new BigDecimal("1000.0000"), regular.spotCheck().get(0).cost(), "REGULAR: tax taken out");
        assertEquals(0, regular.warningCount());
    }

    @Test
    void theSpotCheckIsFiftyRowsAndTheSameForTheSameFile() {
        variants.clear();
        StringBuilder sheet = new StringBuilder("sku,purchase_price,includes_tax\n");
        for (int i = 0; i < 120; i++) {
            String sku = String.format("TST-%04d", i);
            variants.add(variant("ps-" + i, sku, null, null));
            sheet.append(sku).append(",").append(10 + i).append(",no\n");
        }
        byte[] file = sheet.toString().getBytes(StandardCharsets.UTF_8);
        ValidateResponse first = service.validate(INSTITUTE, "costs.csv", file);
        ValidateResponse second = service.validate(INSTITUTE, "costs.csv", file);
        assertEquals(ItemCostImportService.SPOT_CHECK, first.spotCheck().size());
        assertEquals(first.spotCheck(), second.spotCheck());
        Set<Integer> rows = new HashSet<>();
        first.spotCheck().forEach(r -> rows.add(r.row()));
        assertEquals(50, rows.size());
        assertEquals(first.token(), second.token());
    }

    @Test
    void aDifferentTokenIsRefusedWith409AndNothingIsWritten() {
        byte[] file = csv("sku,purchase_price,includes_tax", "TST-0001,10,no");
        String token = service.validate(INSTITUTE, "costs.csv", file).token();
        byte[] other = csv("sku,purchase_price,includes_tax", "TST-0001,11,no");
        ConflictException e = assertThrows(ConflictException.class,
                () -> service.commit(INSTITUTE, ACTOR, "costs.csv", other, token));
        assertTrue(e.getMessage().startsWith("IMPORT_CHANGED"), e.getMessage());
        // The same file in another institute gives another token.
        assertNotEquals(token, ItemCostImportService.token("inst-2", file, List.of()));
        assertThrows(InvalidRequestException.class, () -> service.commit(INSTITUTE, ACTOR, "costs.csv", file, " "));
        verifyNoInteractions(ledger, audit, transactions);
    }

    @Test
    void anItemChangedSinceValidateChangesTheToken() {
        byte[] file = csv("sku,purchase_price,includes_tax", "TST-0002,10,no");
        String token = service.validate(INSTITUTE, "costs.csv", file).token();
        // The SKU now belongs to another variant.
        variants.set(1, variant("ps-9", "TST-0002", null, null));
        assertThrows(ConflictException.class, () -> service.commit(INSTITUTE, ACTOR, "costs.csv", file, token));
        verifyNoInteractions(ledger);
    }

    @Test
    void anyRowErrorBlocksTheCommitWith422() {
        byte[] file = csv("sku,purchase_price,includes_tax", "TST-0001,10,no", "TST-0002,10,");
        String token = service.validate(INSTITUTE, "costs.csv", file).token();
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.commit(INSTITUTE, ACTOR, "costs.csv", file, token));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, e.getStatus());
        assertTrue(e.getMessage().startsWith("IMPORT_HAS_ERRORS"), e.getMessage());
        verifyNoInteractions(ledger, audit, transactions);
    }

    @Test
    void commitSetsEachChangedCostWithTheFileKeyInPackageSessionOrderAndAuditsOnce() {
        byte[] file = csv("sku,purchase_price,includes_tax,gst_rate_percent",
                "TST-0002,105,yes,5",
                "TST-0001,1180,yes,18",
                "TST-0003,50,no,");
        String token = service.validate(INSTITUTE, "costs.csv", file).token();
        CommitResponse answer = service.commit(INSTITUTE, ACTOR, "costs.csv", file, token);

        assertEquals(3, answer.rows());
        assertEquals(2, answer.changed());
        assertEquals(0, answer.alreadyDone());
        assertEquals(1, answer.unchanged());
        String prefix = "ITEMCOST:" + token.substring(0, 16) + ":";
        InOrder order = inOrder(ledger);
        order.verify(ledger).setStandardCost(INSTITUTE, "ps-1", new BigDecimal("1000.0000"), ACTOR, prefix + "ps-1");
        order.verify(ledger).setStandardCost(INSTITUTE, "ps-2", new BigDecimal("100.0000"), ACTOR, prefix + "ps-2");
        verify(ledger, never()).setStandardCost(eq(INSTITUTE), eq("ps-3"), any(), any(), any());
        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(audit, times(1)).record(eq(INSTITUTE), eq(ACTOR), eq("ITEM_COSTS_IMPORT"), eq("STANDARD_COST"),
                eq(null), detail.capture());
        assertTrue(detail.getValue().contains("\"changed\":2"), detail.getValue());
        assertTrue(detail.getValue().contains("\"token\":\"" + token.substring(0, 16) + "\""), detail.getValue());
    }

    @Test
    void twelveHundredAndOneChangesAreThirteenTransactionsOfAtMostAHundred() {
        variants.clear();
        StringBuilder sheet = new StringBuilder("sku,purchase_price,includes_tax\n");
        for (int i = 0; i < 1201; i++) {
            String sku = String.format("TST-%04d", i);
            variants.add(variant(String.format("ps-%04d", i), sku, null, null));
            sheet.append(sku).append(",10,no\n");
        }
        byte[] file = sheet.toString().getBytes(StandardCharsets.UTF_8);
        String token = service.validate(INSTITUTE, "costs.csv", file).token();
        CommitResponse answer = service.commit(INSTITUTE, ACTOR, "costs.csv", file, token);
        assertEquals(1201, answer.changed());
        verify(transactions, times(13)).getTransaction(any());
        verify(transactions, times(13)).commit(any());
        verify(ledger, times(1201)).setStandardCost(eq(INSTITUTE), anyString(), any(), eq(ACTOR), anyString());
    }

    @Test
    void aSecondCommitWhoseKeysExistChangesNothing() {
        byte[] file = csv("sku,purchase_price,includes_tax", "TST-0001,10,no", "TST-0002,20,no");
        String token = service.validate(INSTITUTE, "costs.csv", file).token();
        // The first commit's adjustments are there (the variant read still shows the old cost).
        when(adjustments.findByInstituteIdAndIdempotencyKey(eq(INSTITUTE), anyString()))
                .thenReturn(Optional.of(new StockCostAdjustment()));
        CommitResponse answer = service.commit(INSTITUTE, ACTOR, "costs.csv", file, token);
        assertEquals(0, answer.changed());
        assertEquals(2, answer.alreadyDone());
        verify(adjustments).findByInstituteIdAndIdempotencyKey(INSTITUTE, "ITEMCOST:" + token.substring(0, 16) + ":ps-1");
        verify(adjustments).findByInstituteIdAndIdempotencyKey(INSTITUTE, "ITEMCOST:" + token.substring(0, 16) + ":ps-2");
        verifyNoInteractions(ledger);
    }

    @Test
    void aSecondCommitAfterTheCostsLandedChangesNothingAndAStaleTokenIsRefused() {
        byte[] file = csv("sku,purchase_price,includes_tax", "TST-0001,10,no");
        String token = service.validate(INSTITUTE, "costs.csv", file).token();
        service.commit(INSTITUTE, ACTOR, "costs.csv", file, token);
        variants.set(0, new VariantRow("ps-1", "TST-0001", null, false, true, new BigDecimal("10.0000"),
                "Sample item TST-0001", 1, null, 1));
        String now = service.validate(INSTITUTE, "costs.csv", file).token();
        assertNotEquals(token, now, "the token covers the current cost");
        assertEquals("IMPORT_CHANGED", code(assertThrows(ConflictException.class,
                () -> service.commit(INSTITUTE, ACTOR, "costs.csv", file, token))));
        CommitResponse again = service.commit(INSTITUTE, ACTOR, "costs.csv", file, now);
        assertEquals(0, again.changed());
        assertEquals(1, again.unchanged());
        verify(ledger, times(1)).setStandardCost(any(), any(), any(), any(), any());
    }

    // ───────────────────────────────────── X3: X, then Y, then X again restores X

    /** The variant read after a commit: the cost it set, one more time set. */
    private void landed(String psid, String sku, String cost) {
        for (int i = 0; i < variants.size(); i++) {
            VariantRow v = variants.get(i);
            if (v.packageSessionId().equals(psid)) {
                variants.set(i, new VariantRow(psid, sku, v.externalRef(), false, true, new BigDecimal(cost), v.name(),
                        v.qtyScale(), v.unit(), v.standardSets() + 1));
            }
        }
    }

    @Test
    void fileXThenYThenXAgainSetsXsCostAgain() {
        // The ledger and the key table behave as the database does.
        Set<String> keys = new HashSet<>();
        when(adjustments.findByInstituteIdAndIdempotencyKey(eq(INSTITUTE), anyString()))
                .thenAnswer(i -> keys.contains((String) i.getArgument(1))
                        ? Optional.of(new StockCostAdjustment()) : Optional.empty());
        doAnswer(i -> {
            keys.add(i.getArgument(4));
            landed(i.getArgument(1), "TST-0001", ((BigDecimal) i.getArgument(2)).toPlainString());
            return null;
        }).when(ledger).setStandardCost(eq(INSTITUTE), eq("ps-1"), any(), eq(ACTOR), anyString());
        byte[] x = csv("sku,purchase_price,includes_tax", "TST-0001,100,no");
        byte[] y = csv("sku,purchase_price,includes_tax", "TST-0001,90,no");

        List<String> tokens = new ArrayList<>();
        for (byte[] file : List.of(x, y, x, y, x)) {
            ValidateResponse checked = service.validate(INSTITUTE, "costs.csv", file);
            assertEquals(1, checked.toChange());
            CommitResponse done = service.commit(INSTITUTE, ACTOR, "costs.csv", file, checked.token());
            assertEquals(1, done.changed(), "each switch sets the cost");
            assertEquals(0, done.alreadyDone());
            tokens.add(checked.token());
        }
        assertEquals(new BigDecimal("100.0000"), variants.get(0).standardCost(), "X restored");
        assertEquals(5, new HashSet<>(tokens).size(), "every state gives its own token and keys");
        assertEquals(5, keys.size());
    }

    @Test
    void aFailingSecondBatchStillWritesTheAuditRowWithTheCountsSoFar() {
        variants.clear();
        StringBuilder sheet = new StringBuilder("sku,purchase_price,includes_tax\n");
        for (int i = 0; i < 250; i++) {
            String sku = String.format("TST-%04d", i);
            variants.add(variant(String.format("ps-%04d", i), sku, null, null));
            sheet.append(sku).append(",10,no\n");
        }
        byte[] file = sheet.toString().getBytes(StandardCharsets.UTF_8);
        String token = service.validate(INSTITUTE, "costs.csv", file).token();
        RuntimeException blip = new IllegalStateException("lock timeout");
        doAnswer(i -> {
            throw blip;
        }).when(ledger).setStandardCost(eq(INSTITUTE), eq("ps-0150"), any(), any(), any());

        RuntimeException e = assertThrows(RuntimeException.class,
                () -> service.commit(INSTITUTE, ACTOR, "costs.csv", file, token));
        assertEquals(blip, e, "the batch's own error goes back");
        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(audit, times(1)).record(eq(INSTITUTE), eq(ACTOR), eq("ITEM_COSTS_IMPORT"), eq("STANDARD_COST"),
                eq(null), detail.capture());
        String d = detail.getValue();
        assertTrue(d.contains("\"completed\":false"), d);
        assertTrue(d.contains("\"changed\":100"), "batch 1 committed: " + d);
        assertTrue(d.contains("\"failed_batch\":2"), d);
        assertTrue(d.contains("\"batches\":3"), d);
        verify(transactions, times(1)).commit(any());
        verify(transactions, times(1)).rollback(any());
    }

    // ───────────────────────────────────── X14: one commit per institute at a time

    @Test
    void aSecondCommitWhileOneRunsIsRefusedWith409AndTheLockIsFreedAfter() {
        byte[] file = csv("sku,purchase_price,includes_tax", "TST-0001,10,no");
        String token = service.validate(INSTITUTE, "costs.csv", file).token();
        List<String> inner = new ArrayList<>();
        doAnswer(i -> {
            // While this commit holds the institute, another one (a double click) arrives.
            inner.add(code(assertThrows(ConflictException.class,
                    () -> service.commit(INSTITUTE, ACTOR, "costs.csv", file, token))));
            throw new IllegalStateException("batch fails");
        }).when(ledger).setStandardCost(eq(INSTITUTE), eq("ps-1"), any(), any(), any());
        assertThrows(IllegalStateException.class, () -> service.commit(INSTITUTE, ACTOR, "costs.csv", file, token));
        assertEquals(List.of(ItemCostImportService.IMPORT_RUNNING), inner);

        // Freed after the failure: the retry runs.
        org.mockito.Mockito.reset(ledger);
        CommitResponse retry = service.commit(INSTITUTE, ACTOR, "costs.csv", file, token);
        assertEquals(1, retry.changed());
        assertFalse(inner.isEmpty());
    }

    private static String code(RuntimeException e) {
        String message = e.getMessage();
        return message.contains(":") ? message.substring(0, message.indexOf(':')) : message;
    }
}
