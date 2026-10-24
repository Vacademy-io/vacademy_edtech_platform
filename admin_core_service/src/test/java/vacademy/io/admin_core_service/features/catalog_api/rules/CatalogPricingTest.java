package vacademy.io.admin_core_service.features.catalog_api.rules;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogPricing.Kind;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static vacademy.io.admin_core_service.features.catalog_api.CatalogTestData.row;

/** Cases from catalog-card-view.test.ts (priceStateOf) and catalog-cards.test.ts (price views). */
class CatalogPricingTest {

    @Test
    void priceStateOfTheDisplayedVersion() {
        assertEquals(Kind.FREE, CatalogPricing.priceStateOf(row("p", "a").price(0).build(), true).kind());
        CatalogPricing.PriceState paid = CatalogPricing.priceStateOf(row("p", "a").price(1500).build(), true);
        assertEquals(Kind.AMOUNT, paid.kind());
        assertEquals(1500, paid.amount());
        assertEquals("INR", paid.currency());
        assertEquals(Kind.HIDDEN, CatalogPricing.priceStateOf(row("p", "a").price(1500).build(), false).kind());
        // free stays free even when the site hides prices
        assertEquals(Kind.FREE, CatalogPricing.priceStateOf(row("p", "a").price(0).build(), false).kind());
        assertEquals(Kind.NOT_STARTED,
                CatalogPricing.priceStateOf(row("p", "a").availability("NOT_STARTED").build(), true).kind());
        assertEquals(Kind.CLOSED, CatalogPricing.priceStateOf(row("p", "a").availability("EXPIRED").build(), true).kind());
        CatalogPricing.PriceState soon = CatalogPricing.priceStateOf(row("p", "a").comingSoon("2026-12-01").build(), true);
        assertEquals(Kind.COMING_SOON, soon.kind());
        assertEquals("2026-12-01", soon.launchDate());
        assertEquals("coming_soon", CatalogPricing.availabilityOf(soon));
        // unknown / missing availability is open
        assertEquals(Kind.FREE, CatalogPricing.priceStateOf(row("p", "a").availability(null).build(), true).kind());
    }

    @Test
    void cardPriceViewSaysFromTheCheapestBuyableVersion() {
        CatalogRow hiFree = row("m", "hi").level("Hindi").price(0).build();
        CatalogRow enPaid = row("m", "en").level("English").price(1000).elevated(1500.0).build();
        CatalogRow enCheap = row("m", "en2").level("English 2").price(1000).build();
        CatalogRow closed = row("m", "old").price(200).availability("EXPIRED").build();

        CatalogPricing.CardPriceView v = CatalogPricing.cardPriceView(enPaid, List.of(hiFree, enPaid));
        assertSame(hiFree, v.row());
        assertEquals(0, v.minPrice());
        assertTrue(v.from());
        assertSame(enPaid, CatalogPricing.cardPriceView(hiFree, List.of(enPaid)).row());
        assertSame(enPaid, CatalogPricing.cardPriceView(closed, List.of(closed, enPaid)).row());
        assertNull(CatalogPricing.cardPriceView(closed, List.of(closed)));
        assertSame(enCheap, CatalogPricing.cardPriceView(enCheap, List.of(enPaid, enCheap)).row());
        assertSame(enPaid, CatalogPricing.cardPriceView(hiFree, List.of(enPaid, enCheap)).row());
    }

    @Test
    void editorialPriceRowPrefersTheDisplayedVersionUnlessAPriceSortIsOn() {
        CatalogRow hiFree = row("m", "hi").price(0).build();
        CatalogRow enPaid = row("m", "en").price(551).build();
        List<CatalogRow> rows = List.of(enPaid, hiFree);
        CatalogPricing.CardPriceView view = CatalogPricing.cardPriceView(enPaid, rows);
        assertSame(enPaid, CatalogPricing.editorialPriceRow(enPaid, view, rows, false));
        assertSame(hiFree, CatalogPricing.editorialPriceRow(enPaid, view, rows, true));
        assertNull(CatalogPricing.editorialPriceRow(enPaid, null, rows, false));
    }

    @Test
    void sortPriceLeavesOutVersionsThatCannotBeBoughtNow() {
        assertEquals(1000, CatalogPricing.sortPrice(List.of(
                row("c5", "hi").price(500).availability("EXPIRED").build(),
                row("c5", "en").price(1000).build(),
                row("c5", "x").price(50).availability("NOT_STARTED").build())));
        assertEquals(700, CatalogPricing.sortPrice(List.of(row("a", "a").price(700).availability("INACTIVE").build())));
    }
}
