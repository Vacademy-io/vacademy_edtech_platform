package vacademy.io.admin_core_service.features.commerce;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The check shared by the public DTO tests: a holder class may contain only the nested view
 * classes on the allow list, and each of them only the fields listed for it. Adding a field to
 * a public view therefore fails a test until the field is put on the list by hand.
 */
public final class PublicDtoFields {

    /** Names that must never be the name of a public field, whatever a list says. */
    private static final Pattern INTERNAL = Pattern.compile(
            "(?i).*(cost|supplier|institute|taxClass|externalRef|barcode|labelCode|availableSlots|maxSeats"
                    + "|packageSession|locationId|ruleId|margin|createdBy|userId|couponCodeId).*");

    private PublicDtoFields() {
    }

    public static void assertExactly(Class<?> holder, Map<String, Set<String>> allowed) {
        Set<String> found = new TreeSet<>();
        for (Class<?> view : holder.getDeclaredClasses()) {
            if (view.isSynthetic() || view.getSimpleName().endsWith("Builder")) {
                continue;
            }
            found.add(view.getSimpleName());
            Set<String> fields = new LinkedHashSet<>();
            for (Field field : view.getDeclaredFields()) {
                if (field.isSynthetic() || Modifier.isStatic(field.getModifiers())) {
                    continue;
                }
                fields.add(field.getName());
                assertFalse(INTERNAL.matcher(field.getName()).matches(),
                        view.getSimpleName() + "." + field.getName() + " looks like an internal field");
            }
            assertTrue(allowed.containsKey(view.getSimpleName()),
                    view.getSimpleName() + " is a public view that is not on the allow list");
            assertEquals(new TreeSet<>(allowed.get(view.getSimpleName())), new TreeSet<>(fields),
                    "fields of " + view.getSimpleName());
        }
        assertEquals(new TreeSet<>(allowed.keySet()), found, "public views of " + holder.getSimpleName());
    }
}
