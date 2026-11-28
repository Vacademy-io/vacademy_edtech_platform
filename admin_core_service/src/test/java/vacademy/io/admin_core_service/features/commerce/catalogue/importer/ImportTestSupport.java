package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportRow;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData;

import java.nio.charset.StandardCharsets;

/** Sample files and reference data shared by the importer tests. */
final class ImportTestSupport {

    static final String INSTITUTE = "inst-1";

    /** A kurta in two sizes (Hindi and English text, a comma and a line break in a cell) and a plain saree. */
    static final String SAMPLE_CSV = String.join("\r\n",
            "handle,external_ref,name_hi,name_en,short_description_hi,description_html_en,collections,attributes,"
                    + "tax_class_code,hsn,status,image_media_ids,image_urls,option1_name,sku,option1_value,price,mrp,"
                    + "weight_grams,barcode",
            "khadi-kurta,woo-1,खादी कुर्ता,Khadi Kurta,\"हाथ से काता, हाथ से बुना\",\"<p>Pure khadi</p>\n<p>Hand spun</p>\","
                    + "men/kurtas|new-arrivals,fabric=khadi,garments,6205,DRAFT,media-1|media-2,"
                    + "https://old-shop.example/a.jpg,size,KK-M,m,1350,1500,250,8901234567890",
            "khadi-kurta,,,,,,,,,,,,,,KK-L,l,1350.50,1500,260,",
            "",
            "सूती-साड़ी,woo-2,सूती साड़ी,,,,,,,,,,,,SS-1,,999,,,",
            "");

    private ImportTestSupport() {
    }

    static byte[] utf8(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    /** What the sample needs: a tax class, a source location, two attributes and three collections. */
    static ImportReferenceData reference() {
        return new ImportReferenceData()
                .addTaxClass("tax-1", "garments", "6205", "ACTIVE")
                .addLocation("loc-1", "WORKSHOP1", true)
                .addLocation("loc-2", "SHOP", false)
                .addAttribute("attr-size", "size")
                .addValue("val-m", "attr-size", "m")
                .addValue("val-l", "attr-size", "l")
                .addAttribute("attr-fabric", "fabric")
                .addValue("val-khadi", "attr-fabric", "khadi")
                .addCollection("col-men", null, "men")
                .addCollection("col-kurtas", "col-men", "kurtas")
                .addCollection("col-new", null, "new-arrivals");
    }

    static ImportRow row(int number, Object... columnsAndValues) {
        ImportRow row = new ImportRow(number);
        for (int i = 0; i < columnsAndValues.length; i += 2) {
            row.set((ImportColumn) columnsAndValues[i], (String) columnsAndValues[i + 1]);
        }
        return row;
    }
}
