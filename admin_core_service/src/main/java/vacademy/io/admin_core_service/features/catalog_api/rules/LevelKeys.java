package vacademy.io.admin_core_service.features.catalog_api.rules;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Level keys: a course whose LEVEL is named like a stream or category belongs to it, as if it
 * carried that folder's tag (learner {@code -utils/level-key.ts}). Both sides become
 * {@code level:<slug>} entries next to the real tags (a folder's course tag, title and subtitle;
 * a course's level name), so every tag-intersection rule matches them unchanged, and the prefix
 * keeps a level key from ever equalling a real tag. A real tag spelt with the prefix is dropped.
 */
public final class LevelKeys {

    public static final String PREFIX = "level:";

    /** Placeholder level names that never name a place. */
    private static final Set<String> IGNORED = Set.of("default");

    private LevelKeys() {
    }

    /** {@code level:<slug>} of a name, or null for a blank / non-Latin name or a placeholder. */
    public static String levelKey(String name) {
        if (name == null) return null;
        String s = CatalogStreams.toSlug(name);
        return s.isEmpty() || IGNORED.contains(s) ? null : PREFIX + s;
    }

    /** The level keys of several names, unique, in order, without nulls. */
    public static List<String> levelKeys(String... names) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String n : names) {
            String k = levelKey(n);
            if (k != null) out.add(k);
        }
        return new ArrayList<>(out);
    }

    public static boolean isLevelKey(String tag) {
        return tag != null && tag.startsWith(PREFIX);
    }
}
