package vacademy.io.admin_core_service.features.commerce.stock.costimport;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.List;

/**
 * Read-only: every shop variant of one institute with what the item-costs import needs to
 * resolve a row and to total the result. Never locks; the costs are written by the stock
 * ledger, which locks the variant row itself.
 */
@Component
public class ItemCostVariantReader {

    /**
     * One variant. {@code archived}: the variant or its product is ARCHIVED. {@code qtyScale}: base
     * units in one selling unit (10 = a tenth of a metre); {@code unit}: the selling unit.
     * {@code standardSets}: how many times its standard cost has been set (append-only history),
     * so the same cost reached twice still reads as a different state.
     */
    public record VariantRow(String packageSessionId, String sku, String externalRef, boolean archived,
                             boolean tracked, BigDecimal standardCost, String name, int qtyScale, String unit,
                             long standardSets) {

        public VariantRow {
            qtyScale = Math.max(1, qtyScale);
        }

        /** A counted item (scale 1, no cost history). */
        public VariantRow(String packageSessionId, String sku, String externalRef, boolean archived,
                          boolean tracked, BigDecimal standardCost, String name) {
            this(packageSessionId, sku, externalRef, archived, tracked, standardCost, name, 1, null, 0);
        }
    }

    // Text blocks would strip trailing spaces: every fragment below starts with a space.
    static final String SQL = "SELECT cv.package_session_id, cv.sku, cv.external_ref, cv.status AS variant_status,"
            + " cp.status AS product_status, cv.stock_policy, cv.standard_cost, cp.qty_scale, cp.unit,"
            + " COALESCE(a.sets, 0) AS standard_sets,"
            + " p.package_name AS product_name, ps.name AS variant_name"
            + " FROM commerce_variant cv"
            + " JOIN commerce_product cp ON cp.package_id = cv.package_id AND cp.institute_id = cv.institute_id"
            + " LEFT JOIN (SELECT package_session_id, COUNT(*) AS sets FROM stock_cost_adjustment"
            + " WHERE institute_id = :instituteId AND reason = 'STANDARD_SET'"
            + " GROUP BY package_session_id) a ON a.package_session_id = cv.package_session_id"
            + " LEFT JOIN package p ON p.id = cv.package_id"
            + " LEFT JOIN package_session ps ON ps.id = cv.package_session_id"
            + " WHERE cv.institute_id = :instituteId"
            + " ORDER BY cv.package_session_id";

    private final NamedParameterJdbcTemplate jdbc;

    public ItemCostVariantReader(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<VariantRow> variants(String instituteId) {
        return jdbc.query(SQL, new MapSqlParameterSource("instituteId", instituteId), (rs, i) -> new VariantRow(
                rs.getString("package_session_id"),
                rs.getString("sku"),
                rs.getString("external_ref"),
                "ARCHIVED".equals(rs.getString("variant_status")) || "ARCHIVED".equals(rs.getString("product_status")),
                "TRACKED".equals(rs.getString("stock_policy")),
                rs.getBigDecimal("standard_cost"),
                name(rs.getString("product_name"), rs.getString("variant_name")),
                rs.getInt("qty_scale"),
                rs.getString("unit"),
                rs.getLong("standard_sets")));
    }

    static String name(String product, String variant) {
        String p = product == null ? "" : product.trim();
        String v = variant == null ? "" : variant.trim();
        if (v.isEmpty() || v.equalsIgnoreCase(p) || "DEFAULT".equalsIgnoreCase(v)) {
            return p;
        }
        return p.isEmpty() ? v : p + " · " + v;
    }
}
