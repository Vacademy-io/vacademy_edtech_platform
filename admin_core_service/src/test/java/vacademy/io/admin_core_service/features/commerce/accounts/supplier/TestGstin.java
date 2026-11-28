package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

/**
 * GSTIN fixtures computed by the test: two state digits, a PAN, an entity character, Z, and the
 * base-36 check character. Never real numbers.
 */
final class TestGstin {

    private static final String ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    private TestGstin() {
    }

    /** A PAN-shaped test value: five letters from {@code letters}, four digits, one letter. */
    static String pan(String letters5, int digits4, char last) {
        return letters5 + String.format("%04d", digits4) + last;
    }

    /** A GSTIN with a correct check character. */
    static String valid(String state, String pan) {
        String first14 = state + pan + "1Z";
        return first14 + check(first14);
    }

    /** The same GSTIN with a wrong check character. */
    static String withWrongCheck(String state, String pan) {
        String good = valid(state, pan);
        char right = good.charAt(14);
        char wrong = ALPHABET.charAt((ALPHABET.indexOf(right) + 1) % 36);
        return good.substring(0, 14) + wrong;
    }

    static char check(String first14) {
        int sum = 0;
        for (int i = 0; i < first14.length(); i++) {
            int product = ALPHABET.indexOf(first14.charAt(i)) * (i % 2 == 0 ? 1 : 2);
            sum += product / 36 + product % 36;
        }
        return ALPHABET.charAt((36 - sum % 36) % 36);
    }
}
