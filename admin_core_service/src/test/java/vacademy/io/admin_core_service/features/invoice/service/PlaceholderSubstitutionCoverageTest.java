package vacademy.io.admin_core_service.features.invoice.service;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A placeholder offered to template authors but never substituted renders as a literal
 * "{{token}}" on a live PDF. That already happened once with {{discount_amount}}, so the
 * registry and the substitution code are checked against each other here.
 */
class PlaceholderSubstitutionCoverageTest {

    private static final Path SERVICE = Path.of(
            "src/main/java/vacademy/io/admin_core_service/features/invoice/service/InvoiceService.java");

    @Test
    @DisplayName("every placeholder the editor offers is actually substituted")
    void everyRegisteredPlaceholderIsSubstituted() throws IOException {
        String src = Files.readString(SERVICE);

        List<String> registered = new ArrayList<>();
        Matcher reg = Pattern.compile("PLACEHOLDER_META\\.put\\(\"([a-z_0-9]+)\"").matcher(src);
        while (reg.find()) {
            registered.add(reg.group(1));
        }
        assertTrue(registered.size() > 20, "expected the placeholder registry to be found, got " + registered.size());

        List<String> missing = new ArrayList<>();
        for (String key : registered) {
            if (!src.contains("replace(\"{{" + key + "}}\"")) {
                missing.add(key);
            }
        }
        assertTrue(missing.isEmpty(),
                "these placeholders are offered to template authors but never substituted, so they "
                        + "would print literally on the PDF: " + missing);
    }

    @Test
    @DisplayName("the receipt placeholders are registered so an admin can edit and override them")
    void receiptPlaceholdersAreRegistered() throws IOException {
        String src = Files.readString(SERVICE);
        for (String key : List.of("course_name", "course_code", "user_mobile", "course_fees", "total_fees",
                "previous_paid", "fees_paid_now", "total_fees_due", "total_amount_paid",
                "next_installment_amount", "next_installment_date", "amount_in_words")) {
            assertTrue(src.contains("PLACEHOLDER_META.put(\"" + key + "\""),
                    key + " must be in the registry or the template editor will not offer it");
        }
    }

    @Test
    @DisplayName("an editable placeholder also passes the override whitelist, or the edit vanishes")
    void editablePlaceholdersAreWhitelisted() throws IOException {
        String src = Files.readString(SERVICE);

        // sanitizeOverrides drops any key outside EDITABLE_OVERRIDE_KEYS, so a placeholder marked
        // editable but left off that list gives an admin an input box that does nothing.
        Matcher whitelist = Pattern.compile(
                "EDITABLE_OVERRIDE_KEYS = Set\\.of\\((.*?)\\);", Pattern.DOTALL).matcher(src);
        assertTrue(whitelist.find(), "expected to find EDITABLE_OVERRIDE_KEYS");
        String allowed = whitelist.group(1);

        List<String> editableButDropped = new ArrayList<>();
        Matcher reg = Pattern.compile(
                "PLACEHOLDER_META\\.put\\(\"([a-z_0-9]+)\",\\s*\\n?\\s*new PlaceholderMeta\\("
                        + "\"[^\"]*\",\\s*\"RECEIPT\",\\s*(true|false)").matcher(src);
        while (reg.find()) {
            if ("true".equals(reg.group(2)) && !allowed.contains("\"" + reg.group(1) + "\"")) {
                editableButDropped.add(reg.group(1));
            }
        }
        assertTrue(editableButDropped.isEmpty(),
                "these receipt placeholders are editable in the UI but are not in "
                        + "EDITABLE_OVERRIDE_KEYS, so sanitizeOverrides would silently discard the "
                        + "admin edit: " + editableButDropped);
    }

    @Test
    @DisplayName("receipt amounts are read-only, like the other money placeholders")
    void receiptAmountsAreNotEditable() throws IOException {
        String src = Files.readString(SERVICE);
        // A receipt whose figures can be retyped is a receipt that can contradict the ledger.
        for (String key : List.of("course_fees", "total_fees", "previous_paid", "fees_paid_now",
                "total_fees_due", "total_amount_paid", "next_installment_amount", "amount_in_words")) {
            Matcher m = Pattern.compile("PLACEHOLDER_META\\.put\\(\"" + key
                    + "\",\\s*\\n?\\s*new PlaceholderMeta\\(\"[^\"]*\",\\s*\"RECEIPT\",\\s*(true|false)")
                    .matcher(src);
            assertTrue(m.find(), key + " should be registered");
            assertTrue("false".equals(m.group(1)), key + " must not be admin-editable");
        }
    }
}
