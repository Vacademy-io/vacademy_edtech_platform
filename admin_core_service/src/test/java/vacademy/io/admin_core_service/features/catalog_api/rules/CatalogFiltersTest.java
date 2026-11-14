package vacademy.io.admin_core_service.features.catalog_api.rules;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogFilters.Group;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogFilters.Option;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogFilters.PriceChoice;

import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/** The facet engine and row tests of catalog-filters.ts (catalog-filters.test.ts cases). */
class CatalogFiltersTest {

    record Card(String id, List<CatalogRow> rows) {
    }

    static CatalogRow row(String pkg, String level, double price) {
        return CatalogTestData.row(pkg, pkg + "-" + level).level(level).price(price).build();
    }

    static final List<CatalogRow> ROWS_A = List.of(row("a", "Hindi", 0), row("a", "English", 500));
    static final List<CatalogRow> ROWS_B = List.of(row("b", "Hindi", 300));
    static final List<CatalogRow> ROWS_C = List.of(row("c", "English", 0));
    static final List<Card> CARDS = List.of(new Card("a", ROWS_A), new Card("b", ROWS_B), new Card("c", ROWS_C));

    static Group<Card, CatalogRow> language(boolean active, String... levels) {
        return new Group<>("language", active, null, r -> Arrays.asList(levels).contains(r.levelName()));
    }

    static Group<Card, CatalogRow> price(PriceChoice choice) {
        return new Group<>("price", choice != null, null, r -> CatalogFilters.rowMatchesPrice(r, choice));
    }

    static List<String> ids(List<Card> cards) {
        return cards.stream().map(Card::id).toList();
    }

    @Test
    void rowGroupsMustHoldOnTheSameVersion() {
        // "Hindi and Paid" = a paid Hindi version: card a has a free Hindi and a paid English one.
        List<Group<Card, CatalogRow>> groups = List.of(language(true, "Hindi"), price(PriceChoice.PAID));
        assertEquals(List.of("b"), ids(CatalogFilters.apply(CARDS, Card::rows, groups, null)));
        assertEquals(List.of("a", "b"), ids(CatalogFilters.apply(CARDS, Card::rows,
                List.of(language(true, "Hindi")), null)));
        assertEquals(List.of(ROWS_A.get(1)), CatalogFilters.rowsMatching(CARDS.get(0), Card::rows,
                List.of(price(PriceChoice.PAID))));
        assertEquals(ROWS_A, CatalogFilters.rowsMatching(CARDS.get(0), Card::rows, List.of(price(null))));
    }

    @Test
    void optionsAreOredInsideAGroupAndGroupsAnded() {
        Group<Card, CatalogRow> cardGroup = new Group<>("ids", true, c -> Set.of("a", "c").contains(c.id()), null);
        assertEquals(List.of("a", "c"), ids(CatalogFilters.apply(CARDS, Card::rows,
                List.of(language(true, "Hindi", "English"), cardGroup), null)));
        assertEquals(List.of("c"), ids(CatalogFilters.apply(CARDS, Card::rows,
                List.of(cardGroup, price(PriceChoice.FREE), language(true, "English")), null)));
        // except: that group is ignored
        assertEquals(List.of("a", "b", "c"), ids(CatalogFilters.apply(CARDS, Card::rows,
                List.of(cardGroup), "ids")));
    }

    @Test
    void eachGroupIsCountedAgainstTheOtherGroupsOnly() {
        List<Group<Card, CatalogRow>> groups = List.of(language(true, "Hindi"), price(PriceChoice.PAID));
        // Language options, given price=paid only (not given language=Hindi itself):
        Map<String, Integer> langs = CatalogFilters.countOptions(CARDS, Card::rows, groups, "language", List.of(
                new Option<>("hi", null, r -> "Hindi".equals(r.levelName())),
                new Option<>("en", null, r -> "English".equals(r.levelName()))));
        assertEquals(Map.of("hi", 1, "en", 1), langs); // b (paid Hindi); a (paid English)
        // Price options, given language=Hindi only:
        Map<String, Integer> prices = CatalogFilters.countOptions(CARDS, Card::rows, groups, "price", List.of(
                new Option<>("free", null, r -> CatalogFilters.rowMatchesPrice(r, PriceChoice.FREE)),
                new Option<>("paid", null, r -> CatalogFilters.rowMatchesPrice(r, PriceChoice.PAID))));
        assertEquals(Map.of("free", 1, "paid", 1), prices); // a's free Hindi; b's paid Hindi
        // A card option is AND-ed with the other groups.
        Map<String, Integer> cards = CatalogFilters.countOptions(CARDS, Card::rows, groups, "ids", List.of(
                new Option<>("a", c -> c.id().equals("a"), null)));
        assertEquals(0, cards.get("a")); // a has no paid Hindi version
    }

    @Test
    void rememberRunsEachTestOncePerObject() {
        AtomicInteger calls = new AtomicInteger();
        List<Group<Card, CatalogRow>> groups = CatalogFilters.remember(List.of(
                new Group<>("search", true, c -> {
                    calls.incrementAndGet();
                    return true;
                }, null)));
        CatalogFilters.apply(CARDS, Card::rows, groups, null);
        CatalogFilters.countOptions(CARDS, Card::rows, groups, "other", List.of(
                new Option<>("1", c -> true, null), new Option<>("2", c -> true, null)));
        assertEquals(3, calls.get());
    }

    @Test
    void levelsMatchByNameAndTheBuyRentConvention() {
        CatalogRow ebook = row("p", "eBook", 10);
        assertTrue(CatalogFilters.rowMatchesLevels(ebook, List.of()));
        assertTrue(CatalogFilters.rowMatchesLevels(ebook, List.of("ebook")));
        assertTrue(CatalogFilters.rowMatchesLevels(ebook, List.of("Video", " eBook ")));
        assertFalse(CatalogFilters.rowMatchesLevels(ebook, List.of("Video")));
        CatalogRow rent = new CatalogRow("p", "ps", "Book", "default", null, null, "x", 1, null, "INR", null,
                "AVAILABLE", null, null, null, null, null, null, null, List.of(), 0.0, null, null, "RENT", null,
                null, null, null, null, null);
        assertTrue(CatalogFilters.rowMatchesLevels(rent, List.of("Rent")));
        assertFalse(CatalogFilters.rowMatchesLevels(rent, List.of("Buy")));
        assertTrue(CatalogFilters.rowMatchesLevels(row("p", "Buy", 1), List.of("buy")));
    }

    @Test
    void comingSoonVersionsNeverMatchAPrice() {
        CatalogRow soon = CatalogTestData.row("s", "s1").price(0).comingSoon("2026-12-01").build();
        CatalogRow free = row("f", "x", 0);
        CatalogRow paid = row("p", "x", 250);
        assertFalse(CatalogFilters.rowMatchesPrice(soon, PriceChoice.FREE));
        assertFalse(CatalogFilters.rowMatchesPrice(soon, PriceChoice.PAID));
        assertFalse(CatalogFilters.rowInPriceRange(soon, 0.0, 1000.0));
        assertTrue(CatalogFilters.rowMatchesPrice(free, PriceChoice.FREE));
        assertFalse(CatalogFilters.rowMatchesPrice(free, PriceChoice.PAID));
        assertTrue(CatalogFilters.rowMatchesPrice(paid, PriceChoice.PAID));
        assertTrue(CatalogFilters.rowMatchesPrice(paid, PriceChoice.max(250)));
        assertFalse(CatalogFilters.rowMatchesPrice(paid, PriceChoice.max(249.99)));
        // inclusive range, either end optional
        assertTrue(CatalogFilters.rowInPriceRange(paid, 250.0, 250.0));
        assertTrue(CatalogFilters.rowInPriceRange(paid, null, 250.0));
        assertTrue(CatalogFilters.rowInPriceRange(paid, 100.0, null));
        assertFalse(CatalogFilters.rowInPriceRange(paid, 251.0, null));
    }

    @Test
    void pureLanguageLevelsAndSentinels() {
        List<CourseLanguages.Language> langs = CourseLanguages.DEFAULT_LANGUAGES;
        assertTrue(CatalogFilters.isPureLanguageLevel("Hindi", langs));
        assertTrue(CatalogFilters.isPureLanguageLevel("हिन्दी", langs));
        assertFalse(CatalogFilters.isPureLanguageLevel("Beginner Hindi", langs));
        assertFalse(CatalogFilters.isPureLanguageLevel("eBook", langs));
        assertTrue(CatalogFilters.isSentinel("DEFAULT"));
        assertTrue(CatalogFilters.isSentinel(null));
        assertFalse(CatalogFilters.isSentinel("Class 10"));
    }
}
