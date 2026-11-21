package vacademy.io.admin_core_service.features.commerce.accounts;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Every accounts audit kind fits {@code commerce_audit.kind} (32 characters) and is spelled once. */
class AccountsAuditKindsTest {

    private static List<Field> constants(boolean references) throws Exception {
        return java.util.Arrays.stream(AccountsAuditKinds.class.getDeclaredFields())
                .filter(f -> Modifier.isStatic(f.getModifiers()) && Modifier.isFinal(f.getModifiers())
                        && f.getType() == String.class && f.getName().startsWith("REF_") == references)
                .toList();
    }

    @Test
    void everyKindIsAtMost32CharactersUniqueAndNamedAsItsValue() throws Exception {
        List<Field> kinds = constants(false);
        assertEquals(36, kinds.size(), "34 kinds of the purchases plan plus the two head kinds");
        Set<String> seen = new HashSet<>();
        for (Field field : kinds) {
            String value = (String) field.get(null);
            assertTrue(value.length() <= 32 && !value.isBlank(), field.getName());
            assertTrue(value.matches("^[A-Z_]+$"), field.getName());
            assertEquals(field.getName(), value);
            assertTrue(seen.add(value), "duplicate kind " + value);
        }
        for (String required : List.of("SUPPLIER_CREATE", "SUPPLIER_EDIT", "SUPPLIER_SENSITIVE_VIEW", "PERIOD_LOCK",
                "PERIOD_UNLOCK", "STAFF_SCOPE_EDIT", "ACCOUNT_HEAD_EDIT", "ACCOUNT_HEADS_SEED")) {
            assertTrue(seen.contains(required), required);
        }
    }

    @Test
    void referenceTypesFitTheColumn() throws Exception {
        Set<String> refs = new HashSet<>();
        for (Field field : constants(true)) {
            String value = (String) field.get(null);
            assertTrue(value.length() <= 32, field.getName());
            refs.add(value);
        }
        assertEquals(Set.of("SUPPLIER", "PERIOD_LOCK", "STAFF", "ACCOUNT_HEAD"), refs);
    }
}
