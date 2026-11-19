package vacademy.io.admin_core_service.features.commerce.report.service;

import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.Column;

import java.util.List;

import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.date;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.integer;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.money;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.percent;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.qty;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.text;

/**
 * Column lists and labels (English and Hindi) of the GST pack. GSTR-1 sheets follow the GST
 * offline tool's column order as far as known; our own tax-amount columns come last.
 */
final class GstColumns {

    private GstColumns() {
    }

    // ------------------------------------------------------------------ shared cells

    static final Column HSN = text("hsn", "HSN", "HSN");
    static final Column RATE = percent("rate", "Rate %", "दर %");
    static final Column TAXABLE = money("taxable_value", "Taxable value", "कर योग्य मूल्य");
    static final Column CGST = money("cgst", "CGST", "CGST");
    static final Column SGST = money("sgst", "SGST", "SGST");
    static final Column IGST = money("igst", "IGST", "IGST");
    static final Column CESS = money("cess", "Cess", "सेस");
    static final Column ROUND_OFF = money("round_off", "Round-off", "राउंड-ऑफ़");
    static final Column CHANNEL = text("channel", "Channel", "चैनल");
    static final Column LOCATION = text("location", "Location", "जगह");
    static final Column PLACE_OF_SUPPLY = text("place_of_supply", "Place of supply", "आपूर्ति का स्थान");
    static final Column BUYER_GSTIN = text("buyer_gstin", "Buyer GSTIN", "ख़रीदार का GSTIN");
    static final Column SELLER_GSTIN = text("seller_gstin", "Seller GSTIN", "विक्रेता का GSTIN");

    // ------------------------------------------------------------------ registers

    static final ReportTable SALES_REGISTER = ReportTable.of(
            text("invoice_number", "Invoice number", "इनवॉइस नंबर"),
            text("paper_bill_number", "Paper bill number", "काग़ज़ी बिल नंबर"),
            date("date", "Date", "तारीख़"),
            text("document_type", "Document type", "दस्तावेज़ का प्रकार"),
            CHANNEL,
            LOCATION,
            text("order_number", "Order number", "ऑर्डर नंबर"),
            text("customer", "Customer", "ग्राहक"),
            BUYER_GSTIN,
            PLACE_OF_SUPPLY,
            HSN,
            RATE,
            TAXABLE,
            CGST,
            SGST,
            IGST,
            CESS,
            ROUND_OFF,
            money("invoice_total", "Invoice total", "इनवॉइस की कुल राशि"),
            money("cancelled_value", "Cancelled invoice value (not counted)", "रद्द इनवॉइस की राशि (गिनी नहीं)"),
            text("payment_mode", "Payment mode", "भुगतान का तरीका"),
            text("status", "Status", "स्थिति"),
            SELLER_GSTIN);

    static final ReportTable CREDIT_NOTES = ReportTable.of(
            text("note_number", "Credit note number", "क्रेडिट नोट नंबर"),
            date("note_date", "Note date", "नोट की तारीख़"),
            text("invoice_number", "Original invoice number", "मूल इनवॉइस नंबर"),
            date("invoice_date", "Original invoice date", "मूल इनवॉइस की तारीख़"),
            text("return_number", "Return number", "वापसी नंबर"),
            BUYER_GSTIN,
            PLACE_OF_SUPPLY,
            HSN,
            RATE,
            qty("quantity", "Quantity", "मात्रा"),
            text("unit", "Unit", "इकाई"),
            text("quantity_text", "Quantity with unit", "इकाई सहित मात्रा"),
            money("rate_per_unit", "Rate per unit", "प्रति इकाई दर"),
            text("rate_text", "Rate per unit (as printed)", "प्रति इकाई दर (छपी हुई)"),
            TAXABLE,
            CGST,
            SGST,
            IGST,
            CESS,
            money("amount", "Line amount", "पंक्ति की राशि"),
            ROUND_OFF,
            money("note_total", "Note total", "नोट की कुल राशि"),
            text("reason", "Reason", "कारण"),
            CHANNEL,
            LOCATION,
            SELLER_GSTIN);

    // ------------------------------------------------------------------ summaries

    static final List<Column> TAX_BY_RATE = List.of(RATE, LOCATION, CHANNEL, TAXABLE, CGST, SGST, IGST, CESS,
            money("total_tax", "Total tax", "कुल टैक्स"));

    static final List<Column> HSN_ROWS = List.of(
            HSN,
            text("description", "Description", "विवरण"),
            text("uqc", "UQC", "UQC"),
            qty("quantity", "Total quantity", "कुल मात्रा"),
            money("total_value", "Total value", "कुल मूल्य"),
            RATE,
            TAXABLE,
            IGST,
            CGST,
            SGST,
            CESS);

    static final List<Column> HSN_ROUND_OFF = List.of(
            text("description", "Description", "विवरण"),
            money("total_value", "Total value", "कुल मूल्य"));

    // ------------------------------------------------------------------ GSTR-1

    private static final Column GSTIN_OF_RECIPIENT = text("gstin_of_recipient", "GSTIN/UIN of Recipient",
            "प्राप्तकर्ता का GSTIN/UIN");
    private static final Column RECEIVER_NAME = text("receiver_name", "Receiver Name", "प्राप्तकर्ता का नाम");
    private static final Column INVOICE_NUMBER = text("invoice_number", "Invoice Number", "इनवॉइस नंबर");
    private static final Column INVOICE_DATE = date("invoice_date", "Invoice date", "इनवॉइस की तारीख़");
    private static final Column INVOICE_VALUE = money("invoice_value", "Invoice Value", "इनवॉइस मूल्य");
    private static final Column POS = text("place_of_supply", "Place Of Supply", "आपूर्ति का स्थान");
    private static final Column REVERSE_CHARGE = text("reverse_charge", "Reverse Charge", "रिवर्स चार्ज");
    private static final Column APPLICABLE_RATE = text("applicable_tax_rate", "Applicable % of Tax Rate",
            "लागू टैक्स दर का %");
    private static final Column INVOICE_TYPE = text("invoice_type", "Invoice Type", "इनवॉइस का प्रकार");
    private static final Column ECOMMERCE_GSTIN = text("ecommerce_gstin", "E-Commerce GSTIN", "ई-कॉमर्स GSTIN");
    private static final Column G_RATE = percent("rate", "Rate", "दर");
    private static final Column G_TAXABLE = money("taxable_value", "Taxable Value", "कर योग्य मूल्य");
    private static final Column G_CESS = money("cess", "Cess Amount", "सेस राशि");
    private static final Column NOTE_NUMBER = text("note_number", "Note Number", "नोट नंबर");
    private static final Column NOTE_DATE = date("note_date", "Note Date", "नोट की तारीख़");
    private static final Column NOTE_TYPE = text("note_type", "Note Type", "नोट का प्रकार");
    private static final Column NOTE_VALUE = money("note_value", "Note Value", "नोट का मूल्य");
    private static final Column ORIGINAL_NUMBER = text("original_invoice_number", "Original invoice number",
            "मूल इनवॉइस नंबर");
    private static final Column ORIGINAL_DATE = date("original_invoice_date", "Original invoice date",
            "मूल इनवॉइस की तारीख़");

    static final List<Column> B2B = List.of(GSTIN_OF_RECIPIENT, RECEIVER_NAME, INVOICE_NUMBER, INVOICE_DATE,
            INVOICE_VALUE, POS, REVERSE_CHARGE, APPLICABLE_RATE, INVOICE_TYPE, ECOMMERCE_GSTIN, G_RATE, G_TAXABLE,
            G_CESS, CGST, SGST, IGST);

    static final List<Column> B2CL = List.of(INVOICE_NUMBER, INVOICE_DATE, INVOICE_VALUE, POS, APPLICABLE_RATE,
            G_RATE, G_TAXABLE, G_CESS, ECOMMERCE_GSTIN, CGST, SGST, IGST);

    static final List<Column> B2CS = List.of(text("type", "Type", "प्रकार"), POS, APPLICABLE_RATE, G_RATE,
            G_TAXABLE, G_CESS, ECOMMERCE_GSTIN, CGST, SGST, IGST);

    static final List<Column> B2CS_NOTES = List.of(NOTE_NUMBER, NOTE_DATE, ORIGINAL_NUMBER, POS, G_RATE,
            G_TAXABLE, G_CESS, CGST, SGST, IGST);

    static final List<Column> CDNR = List.of(GSTIN_OF_RECIPIENT, RECEIVER_NAME, NOTE_NUMBER, NOTE_DATE, NOTE_TYPE,
            POS, REVERSE_CHARGE, text("note_supply_type", "Note Supply Type", "नोट की आपूर्ति का प्रकार"),
            NOTE_VALUE, APPLICABLE_RATE, G_RATE, G_TAXABLE, G_CESS, CGST, SGST, IGST, ORIGINAL_NUMBER,
            ORIGINAL_DATE);

    static final List<Column> CDNUR = List.of(text("ur_type", "UR Type", "UR प्रकार"), NOTE_NUMBER, NOTE_DATE,
            NOTE_TYPE, POS, NOTE_VALUE, APPLICABLE_RATE, G_RATE, G_TAXABLE, G_CESS, CGST, SGST, IGST,
            ORIGINAL_NUMBER, ORIGINAL_DATE);

    static final List<Column> EXEMP = List.of(
            text("description", "Description", "विवरण"),
            money("nil_or_exempt", "0% (nil or exempt)", "0% (शून्य दर या छूट)"),
            money("non_gst", "Non-GST supplies", "GST से बाहर की आपूर्ति"));

    // ------------------------------------------------------------------ documents issued

    static final List<Column> DOCS = List.of(
            text("nature", "Nature of Document", "दस्तावेज़ की प्रकृति"),
            text("document_type", "Document type", "दस्तावेज़ का प्रकार"),
            text("prefix", "Prefix", "प्रीफ़िक्स"),
            text("financial_year", "Financial year", "वित्त वर्ष"),
            LOCATION,
            text("register", "Register", "काउंटर"),
            text("from_number", "Sr. No. From", "क्रम संख्या से"),
            text("to_number", "Sr. No. To", "क्रम संख्या तक"),
            integer("total", "Total Number", "कुल संख्या"),
            integer("cancelled", "Cancelled", "रद्द"),
            integer("net_issued", "Net issued", "कुल जारी"),
            integer("issued_all_time", "Numbers used so far", "अब तक इस्तेमाल नंबर"),
            text("gap", "Gap check", "छूटे नंबर"),
            text("dated_in_other_period", "Dated in another period", "दूसरी अवधि की तारीख़"));

    static final List<Column> BILL_BOOKS = List.of(
            text("prefix", "Book prefix", "किताब का प्रीफ़िक्स"),
            text("financial_year", "Financial year", "वित्त वर्ष"),
            LOCATION,
            text("book_range", "Book pages", "किताब के पन्ने"),
            text("from_page", "First page entered", "पहला दर्ज पन्ना"),
            text("to_page", "Last page entered", "आख़िरी दर्ज पन्ना"),
            integer("total", "Total Number", "कुल संख्या"),
            integer("cancelled", "Cancelled", "रद्द"),
            integer("net_issued", "Net issued", "कुल जारी"),
            integer("not_entered_count", "Pages not entered (count)", "दर्ज न हुए पन्ने (गिनती)"),
            text("not_entered", "Pages not entered", "दर्ज न हुए पन्ने"));
}
