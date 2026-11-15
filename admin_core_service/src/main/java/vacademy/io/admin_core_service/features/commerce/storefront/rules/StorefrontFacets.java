package vacademy.io.admin_core_service.features.commerce.storefront.rules;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

/**
 * Filter groups and their counts, as the course facets of the Catalogue API count them: values
 * inside one group are alternatives (OR), groups narrow each other (AND), and the count shown
 * beside an option is taken against every OTHER active group, so picking "red" does not turn
 * the other colours to zero.
 */
public final class StorefrontFacets {

    /** One active filter: a key naming the group and the test an item must pass. */
    public record Group<T>(String key, Predicate<T> test) {
    }

    private StorefrontFacets() {
    }

    /** Items passing every group, except the group named {@code exceptKey} (null = none skipped). */
    public static <T> List<T> apply(List<T> all, List<Group<T>> groups, String exceptKey) {
        List<T> out = new ArrayList<>();
        for (T item : all) {
            boolean ok = true;
            for (Group<T> group : groups) {
                if (group.key().equals(exceptKey)) {
                    continue;
                }
                if (!group.test().test(item)) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                out.add(item);
            }
        }
        return out;
    }

    /**
     * For each option of the group {@code groupKey}: how many items would match if that option
     * were picked, with every other group as it is. Options keep their order.
     */
    public static <T> Map<String, Integer> count(List<T> all, List<Group<T>> groups, String groupKey,
                                                 Map<String, Predicate<T>> options) {
        List<T> pool = apply(all, groups, groupKey);
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Map.Entry<String, Predicate<T>> option : options.entrySet()) {
            int n = 0;
            for (T item : pool) {
                if (option.getValue().test(item)) {
                    n++;
                }
            }
            out.put(option.getKey(), n);
        }
        return out;
    }
}
