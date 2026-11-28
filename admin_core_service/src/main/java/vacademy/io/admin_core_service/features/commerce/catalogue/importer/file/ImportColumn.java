package vacademy.io.admin_core_service.features.commerce.catalogue.importer.file;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The fixed product template, in file order. One row is one variant;
 * rows with the same handle are one product. Product columns are read from the first row of
 * the product that fills them; the other rows leave them blank or repeat the same text.
 *
 * <p>A blank cell leaves the stored value as it is. The file carries no stock and no cost:
 * stock changes only through receipts and adjustments, cost through the stock ledger.
 */
public enum ImportColumn {

    HANDLE("handle", Level.KEY, true,
            "Product slug (letters, digits, single hyphens; Hindi allowed). Rows with the same handle are one product.",
            "khadi-kurta"),
    EXTERNAL_REF("external_ref", Level.PRODUCT, false,
            "Id of the product in the old system. A repeated import updates the product with this id.",
            "woo-14159"),
    NAME_HI("name_hi", Level.PRODUCT, false, "Product name in Hindi.", "खादी कुर्ता"),
    NAME_EN("name_en", Level.PRODUCT, false, "Product name in English.", "Khadi Kurta"),
    SHORT_DESCRIPTION_HI("short_description_hi", Level.PRODUCT, false, "Short description in Hindi.",
            "हाथ से काता हुआ सूती कुर्ता"),
    SHORT_DESCRIPTION_EN("short_description_en", Level.PRODUCT, false, "Short description in English.",
            "Hand-spun cotton kurta"),
    DESCRIPTION_HTML_HI("description_html_hi", Level.PRODUCT, false, "Long description in Hindi (HTML).",
            "<p>शुद्ध खादी</p>"),
    DESCRIPTION_HTML_EN("description_html_en", Level.PRODUCT, false, "Long description in English (HTML).",
            "<p>Pure khadi</p>"),
    BLOCK_CARE_HI("block_care_hi", Level.PRODUCT, false,
            "Care text in Hindi (HTML): the content block \"care\" of the product page. Other blocks of the product are kept.",
            "<p>ठंडे पानी में हाथ से धोएं</p>"),
    BLOCK_CARE_EN("block_care_en", Level.PRODUCT, false, "Care text in English (HTML): the content block \"care\".",
            "<p>Hand wash in cold water</p>"),
    BLOCK_STORY_HI("block_story_hi", Level.PRODUCT, false,
            "Story text in Hindi (HTML): the content block \"story\" of the product page.", "<p>हाथ से बुना हुआ</p>"),
    BLOCK_STORY_EN("block_story_en", Level.PRODUCT, false, "Story text in English (HTML): the content block \"story\".",
            "<p>Woven by hand</p>"),
    BRAND("brand", Level.PRODUCT, false, "Brand.", "Example Brand"),
    COLLECTIONS("collections", Level.PRODUCT, false,
            "Collection paths by slug, parent/child, several separated by |. The list replaces the product's collections.",
            "men/kurtas|new-arrivals"),
    ATTRIBUTES("attributes", Level.PRODUCT, false,
            "Filter values as attribute_code=value_code, several separated by |. The list replaces the product's values.",
            "fabric=khadi|craft=handspun"),
    TAX_CLASS_CODE("tax_class_code", Level.PRODUCT, false, "Code of the tax class.", "garments"),
    HSN("hsn", Level.PRODUCT, false,
            "HSN code. It is stored on the tax class; when filled it must equal the HSN of the tax class.", "6205"),
    STOCK_MODE("stock_mode", Level.PRODUCT, false, "QUANTITY or PIECE (one-of-a-kind pieces).", "QUANTITY"),
    UNIT("unit", Level.PRODUCT, false, "Unit of sale: PCS, MTR, KG ...", "MTR"),
    QTY_SCALE("qty_scale", Level.PRODUCT, false,
            "Measured goods: base units per unit (10 means stock and price count tenths of the unit).", "10"),
    QTY_STEP("qty_step", Level.PRODUCT, false, "Measured goods: smallest step a buyer can add, in base units.", "5"),
    ORIGIN_LOCATION_CODE("origin_location_code", Level.PRODUCT, false,
            "Code of the source location the product comes from.", "WORKSHOP-1"),
    STATUS("status", Level.PRODUCT, false, "DRAFT, ACTIVE or ARCHIVED. A new product is DRAFT when blank.", "DRAFT"),
    IMAGE_MEDIA_IDS("image_media_ids", Level.PRODUCT, false,
            "File ids of images already uploaded to the media library, separated by |. Missing ones are added to the gallery.",
            "a1b2c3d4-0000-1111-2222-333344445555"),
    IMAGE_URLS("image_urls", Level.PRODUCT, false,
            "Image URLs of the old shop, separated by |. They are NOT downloaded by the import; they are queued for the migration tool.",
            "https://old-shop.example/wp-content/uploads/kurta.jpg"),
    OPTION1_NAME("option1_name", Level.PRODUCT, false, "Attribute code of the first option (what varies between variants).",
            "size"),
    OPTION2_NAME("option2_name", Level.PRODUCT, false, "Attribute code of the second option.", "colour"),
    OPTION3_NAME("option3_name", Level.PRODUCT, false, "Attribute code of the third option.", ""),

    VARIANT_EXTERNAL_REF("variant_external_ref", Level.VARIANT, false, "Id of the variant in the old system.",
            "woo-14159-m"),
    SKU("sku", Level.VARIANT, true, "SKU, unique in the shop. Required on every variant row.", "KK-M-WHITE"),
    BARCODE("barcode", Level.VARIANT, false, "Barcode, unique in the shop.", "8901234567890"),
    VARIANT_NAME("variant_name", Level.VARIANT, false, "Name of the variant; the SKU when blank.", "M / White"),
    OPTION1_VALUE("option1_value", Level.VARIANT, false, "Value code of the first option.", "m"),
    OPTION2_VALUE("option2_value", Level.VARIANT, false, "Value code of the second option.", "white"),
    OPTION3_VALUE("option3_value", Level.VARIANT, false, "Value code of the third option.", ""),
    PRICE("price", Level.VARIANT, false,
            "Selling price with tax included, for one unit: one piece, or one metre / kilogram of goods sold by measure "
                    + "(the price of a metre must divide evenly into qty_scale parts, to the paisa).",
            "1350"),
    MRP("mrp", Level.VARIANT, false,
            "MRP for one unit, tax included; not below the price. Blank on a new variant means no MRP; blank on an "
                    + "existing variant keeps the stored MRP.",
            "1500"),
    WEIGHT_GRAMS("weight_grams", Level.VARIANT, false, "Shipping weight in grams.", "250"),
    LENGTH_MM("length_mm", Level.VARIANT, false, "Packed length in mm.", "300"),
    WIDTH_MM("width_mm", Level.VARIANT, false, "Packed width in mm.", "250"),
    HEIGHT_MM("height_mm", Level.VARIANT, false, "Packed height in mm.", "30"),
    STOCK_POLICY("stock_policy", Level.VARIANT, false,
            "TRACKED (default) or UNTRACKED. Cannot be changed on an existing variant.", "TRACKED"),
    LEAD_TIME_DAYS("lead_time_days", Level.VARIANT, false, "Days to make or source the item.", "0"),
    VARIANT_STATUS("variant_status", Level.VARIANT, false, "DRAFT, ACTIVE or ARCHIVED. A new variant is ACTIVE when blank.",
            "ACTIVE"),
    VARIANT_IMAGE_MEDIA_ID("variant_image_media_id", Level.VARIANT, false,
            "File id of the variant's own image in the media library.", "");

    /** KEY is on every row; PRODUCT is read once per product; VARIANT belongs to its row. */
    public enum Level { KEY, PRODUCT, VARIANT }

    /** Header of the extra column in an error-rows file; accepted and ignored on upload. */
    public static final String ERRORS_HEADER = "errors";

    private static final Map<String, ImportColumn> BY_HEADER = new LinkedHashMap<>();
    private static final List<ImportColumn> PRODUCT_COLUMNS = new ArrayList<>();
    private static final List<ImportColumn> VARIANT_COLUMNS = new ArrayList<>();

    static {
        for (ImportColumn column : values()) {
            BY_HEADER.put(column.header, column);
            if (column.level == Level.PRODUCT) {
                PRODUCT_COLUMNS.add(column);
            } else if (column.level == Level.VARIANT) {
                VARIANT_COLUMNS.add(column);
            }
        }
    }

    private final String header;
    private final Level level;
    private final boolean required;
    private final String description;
    private final String example;

    ImportColumn(String header, Level level, boolean required, String description, String example) {
        this.header = header;
        this.level = level;
        this.required = required;
        this.description = description;
        this.example = example;
    }

    public String header() {
        return header;
    }

    public Level level() {
        return level;
    }

    public boolean required() {
        return required;
    }

    public String description() {
        return description;
    }

    public String example() {
        return example;
    }

    /** Content block code to its column, per language: the blocks the template can carry. */
    public static Map<String, ImportColumn> blockColumns(String locale) {
        Map<String, ImportColumn> out = new LinkedHashMap<>();
        if ("hi".equals(locale)) {
            out.put("care", BLOCK_CARE_HI);
            out.put("story", BLOCK_STORY_HI);
        } else if ("en".equals(locale)) {
            out.put("care", BLOCK_CARE_EN);
            out.put("story", BLOCK_STORY_EN);
        }
        return out;
    }

    /** The column with this (already normalised) header, or null. */
    public static ImportColumn byHeader(String header) {
        return BY_HEADER.get(header);
    }

    public static List<ImportColumn> productColumns() {
        return List.copyOf(PRODUCT_COLUMNS);
    }

    public static List<ImportColumn> variantColumns() {
        return List.copyOf(VARIANT_COLUMNS);
    }

    public static List<String> headers() {
        return List.copyOf(BY_HEADER.keySet());
    }
}
