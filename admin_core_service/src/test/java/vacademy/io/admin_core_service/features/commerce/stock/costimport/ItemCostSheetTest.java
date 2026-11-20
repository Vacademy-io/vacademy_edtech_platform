package vacademy.io.admin_core_service.features.commerce.stock.costimport;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostSheet.Issue;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostSheet.Parsed;
import vacademy.io.admin_core_service.features.commerce.stock.costimport.ItemCostSheet.Row;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ItemCostSheetTest {

    private static final List<String> HEADER = List.of("sku", "purchase_price", "includes_tax", "gst_rate_percent");

    private static List<List<String>> table(List<String> header, List<String>... rows) {
        List<List<String>> table = new ArrayList<>();
        table.add(header);
        table.addAll(Arrays.asList(rows));
        return table;
    }

    private static Parsed one(String price, String includesTax, String rate) {
        return ItemCostSheet.read(table(HEADER, Arrays.asList("TST-0001", price, includesTax, rate)));
    }

    private static List<String> codes(Parsed parsed) {
        return parsed.errors().stream().map(Issue::code).toList();
    }

    @Test
    void theHeaderIsTheFirstRowWithSkuOrExternalRefAndRowsAboveAreIgnored() {
        List<List<String>> table = new ArrayList<>();
        table.add(List.of("Item costs for Test Store"));
        table.add(List.of());
        table.add(List.of("Variant External Ref", "Purchase Price", "includes-tax", "note"));
        table.add(Arrays.asList("ref-1", "100", "no", "checked"));
        Parsed parsed = ItemCostSheet.read(table);
        assertEquals(1, parsed.rows().size());
        Row row = parsed.rows().get(0);
        assertEquals(4, row.rowNumber(), "the spreadsheet row number");
        assertEquals("ref-1", row.externalRef());
        assertNull(row.sku());
        assertEquals(new BigDecimal("100.0000"), row.cost());
        assertTrue(parsed.errors().isEmpty());
    }

    @Test
    void anUnknownHeaderIsRefused() {
        InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> ItemCostSheet.read(
                table(List.of("sku", "purchase_price", "includes_tax", "mrp"))));
        assertTrue(e.getMessage().contains("not in the template: mrp"), e.getMessage());
    }

    @Test
    void aSheetWithoutAKeyColumnOrWithoutTheTaxColumnIsRefused() {
        assertThrows(InvalidRequestException.class, () -> ItemCostSheet.read(
                table(List.of("item", "purchase_price"))));
        InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> ItemCostSheet.read(
                table(List.of("sku", "purchase_price"))));
        assertTrue(e.getMessage().contains("includes_tax"), e.getMessage());
        assertThrows(InvalidRequestException.class, () -> ItemCostSheet.read(
                table(List.of("sku", "sku", "purchase_price", "includes_tax"))));
    }

    @Test
    void includesTaxBlankIsAnErrorWithNoDefault() {
        Parsed parsed = one("100", null, null);
        assertEquals(List.of(ItemCostSheet.REQUIRED), codes(parsed));
        assertEquals("includes_tax", parsed.errors().get(0).column());
        assertFalse(parsed.rows().get(0).costed());
        assertEquals(List.of(ItemCostSheet.INVALID_INCLUDES_TAX), codes(one("100", "maybe", null)));
    }

    @Test
    void yesWithoutARateIsAnError() {
        Parsed parsed = one("100", "yes", null);
        assertEquals(List.of(ItemCostSheet.RATE_REQUIRED), codes(parsed));
        assertFalse(parsed.rows().get(0).costed());
    }

    @Test
    void taxIsTakenOutOfAPriceThatIncludesIt() {
        assertEquals(new BigDecimal("1000.0000"), one("1180", "yes", "18").rows().get(0).cost());
        assertEquals(new BigDecimal("100.0000"), one("105", "YES", "5").rows().get(0).cost());
        assertEquals(new BigDecimal("89.2768"), one("99.99", "yes", "12").rows().get(0).cost());
        assertEquals(new BigDecimal("250.0000"), one("250", "yes", "0").rows().get(0).cost());
    }

    @Test
    void aPriceWithoutTaxIsTheCostAndAnyValidRateIsIgnored() {
        assertEquals(new BigDecimal("99.9900"), one("99.99", "no", null).rows().get(0).cost());
        assertEquals(new BigDecimal("1180.0000"), one("1180", "no", "18").rows().get(0).cost());
    }

    @Test
    void moreThanFourDecimalsIsAnError() {
        assertEquals(List.of(ItemCostSheet.TOO_MANY_DECIMALS), codes(one("10.12345", "no", null)));
        // Trailing zeros are not decimals.
        assertTrue(codes(one("10.123400", "no", null)).isEmpty());
    }

    @Test
    void zeroNegativeBlankAndNonNumbersAreErrors() {
        assertEquals(List.of(ItemCostSheet.INVALID_PRICE), codes(one("0", "no", null)));
        assertEquals(List.of(ItemCostSheet.INVALID_PRICE), codes(one("-5", "no", null)));
        assertEquals(List.of(ItemCostSheet.REQUIRED), codes(one(null, "no", null)));
        assertEquals(List.of(ItemCostSheet.INVALID_NUMBER), codes(one("1,180", "no", null)));
        assertEquals(List.of(ItemCostSheet.INVALID_NUMBER), codes(one("1e3", "no", null)));
        assertEquals(List.of(ItemCostSheet.INVALID_PRICE), codes(one("100000000", "no", null)));
        assertTrue(codes(one("99999999.9999", "no", null)).isEmpty());
    }

    @Test
    void theRateIsFromZeroToFortyWithTwoDecimals() {
        assertEquals(List.of(ItemCostSheet.INVALID_RATE), codes(one("100", "yes", "41")));
        assertEquals(List.of(ItemCostSheet.INVALID_RATE), codes(one("100", "yes", "-1")));
        assertEquals(List.of(ItemCostSheet.INVALID_RATE), codes(one("100", "yes", "5.125")));
        assertEquals(List.of(ItemCostSheet.INVALID_NUMBER), codes(one("100", "yes", "18%")));
        assertTrue(codes(one("100", "yes", "40")).isEmpty());
        assertTrue(codes(one("100", "yes", "2.5")).isEmpty());
    }

    @Test
    void aRowNeedsSkuOrExternalRefAndBlankOrNoteOnlyRowsAreSkipped() {
        List<String> header = List.of("sku", "variant_external_ref", "purchase_price", "includes_tax", "note");
        Parsed parsed = ItemCostSheet.read(table(header,
                Arrays.asList(null, "", "100", "no", null),
                Arrays.asList("", "", "", "", "just a note"),
                Arrays.asList(null, null, null, null, null),
                Arrays.asList("TST-0002", "", "50", "no", "")));
        assertEquals(2, parsed.rows().size());
        assertEquals(2, parsed.blankRows());
        assertEquals(List.of(ItemCostSheet.ITEM_KEY_MISSING), codes(parsed));
        assertEquals(2, parsed.errors().get(0).row());
    }

    @Test
    void moreThanFiveThousandDataRowsIsRefused() {
        List<List<String>> table = new ArrayList<>();
        table.add(HEADER);
        for (int i = 0; i <= ItemCostSheet.MAX_ROWS; i++) {
            table.add(List.of("TST-" + i, "10", "no"));
        }
        assertThrows(InvalidRequestException.class, () -> ItemCostSheet.read(table));
    }
}
