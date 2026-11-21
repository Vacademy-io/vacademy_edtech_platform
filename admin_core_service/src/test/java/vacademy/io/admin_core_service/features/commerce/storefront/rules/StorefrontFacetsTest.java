package vacademy.io.admin_core_service.features.commerce.storefront.rules;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Facet counting: OR inside a group, AND across groups, counts taken against the other groups. */
class StorefrontFacetsTest {

    record Item(String colour, String fabric) {
    }

    private static final List<Item> ITEMS = List.of(
            new Item("red", "cotton"), new Item("red", "silk"), new Item("blue", "silk"),
            new Item("green", "cotton"), new Item("blue", "cotton"));

    private static Map<String, Predicate<Item>> colourOptions() {
        Map<String, Predicate<Item>> options = new LinkedHashMap<>();
        for (String colour : List.of("red", "blue", "green", "black")) {
            options.put(colour, item -> item.colour().equals(colour));
        }
        return options;
    }

    @Test
    void anOptionIsCountedAgainstTheOtherGroupsAndNotAgainstItsOwn() {
        List<StorefrontFacets.Group<Item>> groups = List.of(
                new StorefrontFacets.Group<>("colour", item -> item.colour().equals("red")),
                new StorefrontFacets.Group<>("fabric", item -> item.fabric().equals("cotton")));

        Map<String, Integer> colours = StorefrontFacets.count(ITEMS, groups, "colour", colourOptions());

        // Picking red must not turn the other colours to zero: each count is "cotton and that colour".
        assertEquals(Map.of("red", 1, "blue", 1, "green", 1, "black", 0), colours);
        assertEquals(List.of("red", "blue", "green", "black"), List.copyOf(colours.keySet()));
    }

    @Test
    void theOwnGroupOfAFacetNarrowsEveryOtherFacet() {
        List<StorefrontFacets.Group<Item>> groups = List.of(
                new StorefrontFacets.Group<>("colour", item -> item.colour().equals("red")));
        Map<String, Predicate<Item>> fabrics = new LinkedHashMap<>();
        fabrics.put("cotton", item -> item.fabric().equals("cotton"));
        fabrics.put("silk", item -> item.fabric().equals("silk"));

        assertEquals(Map.of("cotton", 1, "silk", 1), StorefrontFacets.count(ITEMS, groups, "fabric", fabrics));
    }

    @Test
    void withNoFilterEveryOptionCountsTheWholeList() {
        assertEquals(Map.of("red", 2, "blue", 2, "green", 1, "black", 0),
                StorefrontFacets.count(ITEMS, List.of(), "colour", colourOptions()));
    }

    @Test
    void applyKeepsItemsThatPassEveryGroupExceptTheSkippedOne() {
        List<StorefrontFacets.Group<Item>> groups = List.of(
                new StorefrontFacets.Group<>("colour", item -> item.colour().equals("blue")),
                new StorefrontFacets.Group<>("fabric", item -> item.fabric().equals("silk")));

        assertEquals(List.of(new Item("blue", "silk")), StorefrontFacets.apply(ITEMS, groups, null));
        assertEquals(List.of(new Item("red", "silk"), new Item("blue", "silk")),
                StorefrontFacets.apply(ITEMS, groups, "colour"));
    }
}
