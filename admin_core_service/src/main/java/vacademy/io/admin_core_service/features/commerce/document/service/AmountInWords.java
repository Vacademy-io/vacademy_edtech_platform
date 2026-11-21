package vacademy.io.admin_core_service.features.commerce.document.service;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** An amount in English words in the Indian numbering system (thousand, lakh, crore). */
public final class AmountInWords {

    private static final String[] ONES = {"", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
            "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
            "Eighteen", "Nineteen"};
    private static final String[] TENS = {"", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy",
            "Eighty", "Ninety"};

    private AmountInWords() {
    }

    /** For example 1234.50 gives "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only". */
    public static String rupees(BigDecimal amount) {
        if (amount == null) {
            return "";
        }
        BigDecimal value = amount.abs().setScale(2, RoundingMode.HALF_UP);
        long rupees = value.longValue();
        int paise = value.subtract(BigDecimal.valueOf(rupees)).movePointRight(2).intValueExact();
        StringBuilder out = new StringBuilder("Rupees ");
        out.append(rupees == 0 ? "Zero" : words(rupees));
        if (paise > 0) {
            out.append(" and ").append(belowHundred(paise)).append(" Paise");
        }
        return out.append(" Only").toString();
    }

    private static String words(long number) {
        StringBuilder out = new StringBuilder();
        long crore = number / 10_000_000;
        number %= 10_000_000;
        if (crore > 0) {
            out.append(words(crore)).append(" Crore ");
        }
        int lakh = (int) (number / 100_000);
        number %= 100_000;
        if (lakh > 0) {
            out.append(belowHundred(lakh)).append(" Lakh ");
        }
        int thousand = (int) (number / 1_000);
        number %= 1_000;
        if (thousand > 0) {
            out.append(belowHundred(thousand)).append(" Thousand ");
        }
        int hundred = (int) (number / 100);
        number %= 100;
        if (hundred > 0) {
            out.append(ONES[hundred]).append(" Hundred ");
        }
        if (number > 0) {
            out.append(belowHundred((int) number));
        }
        return out.toString().trim();
    }

    private static String belowHundred(int number) {
        if (number < 20) {
            return ONES[number];
        }
        String tens = TENS[number / 10];
        return number % 10 == 0 ? tens : tens + " " + ONES[number % 10];
    }
}
