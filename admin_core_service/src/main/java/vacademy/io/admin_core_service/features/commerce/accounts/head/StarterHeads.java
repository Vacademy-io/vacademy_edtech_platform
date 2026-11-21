package vacademy.io.admin_core_service.features.commerce.accounts.head;

import java.util.List;

/**
 * The neutral starter list of account heads every institute gets on its first heads call. Each
 * institute may rename them, reorder them and add its own; system heads keep their nature and
 * status because later postings look them up by code.
 */
public final class StarterHeads {

    /** One starter head. {@code expenseKind} only for EXPENSE. */
    public record Starter(String code, String nature, String expenseKind, boolean capital, boolean system,
                          int position, String en, String hi) {
    }

    public static final List<Starter> ALL = List.of(
            new Starter("RENT", "EXPENSE", "INDIRECT", false, false, 10, "Rent", "किराया"),
            new Starter("ELECTRICITY", "EXPENSE", "INDIRECT", false, false, 20, "Electricity", "बिजली"),
            new Starter("FREIGHT_AND_COURIER", "EXPENSE", "DIRECT", false, false, 30, "Freight and courier",
                    "भाड़ा और कूरियर"),
            new Starter("PACKAGING", "EXPENSE", "INDIRECT", false, false, 40, "Packaging", "पैकिंग"),
            new Starter("WAGES", "EXPENSE", "DIRECT", false, false, 50, "Wages", "मज़दूरी"),
            new Starter("SALARIES", "EXPENSE", "INDIRECT", false, false, 60, "Salaries", "वेतन"),
            new Starter("TRAVEL", "EXPENSE", "INDIRECT", false, false, 70, "Travel", "यात्रा"),
            new Starter("REPAIRS", "EXPENSE", "INDIRECT", false, false, 80, "Repairs and maintenance",
                    "मरम्मत और रखरखाव"),
            new Starter("BANK_CHARGES", "EXPENSE", "INDIRECT", false, false, 90, "Bank charges", "बैंक शुल्क"),
            new Starter("OFFICE", "EXPENSE", "INDIRECT", false, false, 100, "Office expenses", "कार्यालय खर्च"),
            new Starter("OTHER_EXPENSE", "EXPENSE", "INDIRECT", false, false, 110, "Other expenses", "अन्य खर्च"),
            new Starter("GATEWAY_CHARGES", "EXPENSE", "INDIRECT", false, true, 120, "Payment gateway charges",
                    "पेमेंट गेटवे शुल्क"),
            new Starter("COURIER_CHARGES", "EXPENSE", "INDIRECT", false, true, 130, "Courier charges", "कूरियर शुल्क"),
            new Starter("CASH_SHORT_OVER", "EXPENSE", "INDIRECT", false, true, 140, "Cash short or over",
                    "नकद कम या ज़्यादा"),
            new Starter("OTHER_INCOME", "INCOME", null, false, false, 200, "Other income", "अन्य आय"),
            new Starter("INTEREST_RECEIVED", "INCOME", null, false, false, 210, "Interest received", "प्राप्त ब्याज"),
            new Starter("SETTLEMENT_DISCOUNT", "INCOME", null, false, true, 220, "Settlement discount", "निपटान छूट"),
            new Starter("DEPOSITS_GIVEN", "ASSET", null, false, false, 300, "Deposits given", "दी गई जमा राशि"),
            new Starter("STAFF_ADVANCES", "ASSET", null, false, false, 310, "Staff advances", "कर्मचारी अग्रिम"),
            new Starter("EQUIPMENT", "ASSET", null, true, false, 320, "Equipment", "उपकरण"),
            new Starter("LOANS", "LIABILITY", null, false, false, 400, "Loans", "ऋण"),
            new Starter("OWNER_FUNDS", "LIABILITY", null, false, false, 410, "Owner's funds", "मालिक की पूंजी"),
            new Starter("TDS_PAYABLE", "STATUTORY", null, false, true, 500, "TDS payable", "देय टीडीएस"),
            new Starter("GST_PAID", "STATUTORY", null, false, true, 510, "GST paid", "चुकाया गया जीएसटी"),
            new Starter("RCM_TAX_PAID", "STATUTORY", null, false, true, 520, "Tax paid under reverse charge",
                    "रिवर्स चार्ज पर चुकाया गया कर"));

    /** The 25 starter codes. */
    public static final List<String> CODES = ALL.stream().map(Starter::code).toList();

    private StarterHeads() {
    }
}
