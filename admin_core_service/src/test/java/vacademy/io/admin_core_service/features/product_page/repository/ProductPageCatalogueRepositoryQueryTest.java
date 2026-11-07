package vacademy.io.admin_core_service.features.product_page.repository;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * SQL contract of the catalogue sync's query: which bridge row a store page
 * sells each course on. The ranking sets the price every buyer pays and the
 * reason the sync gives for a course it skips. These tests boot no database,
 * so its pieces are pinned as text (the query itself was run on H2 in
 * PostgreSQL mode over seeded scenarios when it changed).
 */
class ProductPageCatalogueRepositoryQueryTest {

    private static String sql() {
        List<Method> found = Arrays.stream(ProductPageCatalogueRepository.class.getDeclaredMethods())
                .filter(m -> m.getName().equals("findCatalogueSessions")).toList();
        assertThat(found).as("findCatalogueSessions declared exactly once").hasSize(1);
        Query query = found.get(0).getAnnotation(Query.class);
        assertThat(query.nativeQuery()).isTrue();
        return query.value().replaceAll("\\s+", " ").trim();
    }

    @Test
    @DisplayName("an open DEFAULT link first, then a closed DEFAULT one, then any other link; newest first within each")
    void rankingPrefersTheDefaultLink() {
        // A closed DEFAULT link outranks a newer promo link, so a course with
        // a default link is reported as closed rather than as having none.
        assertThat(sql()).contains("ROW_NUMBER() OVER ( PARTITION BY ps.id ORDER BY CASE"
                + " WHEN UPPER(TRIM(pei.tag)) = 'DEFAULT'"
                + " AND (pei.status IS NULL OR pei.status = :activeStatus OR LENGTH(TRIM(pei.status)) = 0)"
                + " AND (pei.start_date IS NULL OR pei.start_date <= CURRENT_DATE)"
                + " AND (pei.end_date IS NULL OR pei.end_date >= CURRENT_DATE)"
                + " THEN 0"
                + " WHEN UPPER(TRIM(pei.tag)) = 'DEFAULT' THEN 1"
                + " ELSE 2"
                + " END ASC,"
                + " psli.updated_at DESC NULLS LAST, pp.actual_price ASC NULLS LAST,"
                + " psli.id ASC, pp.id ASC ) AS row_num");
    }

    @Test
    @DisplayName("the chosen row carries its invite whatever the tag or status, and its plan's price")
    void chosenRowColumns() {
        assertThat(sql())
                .contains("LEFT JOIN payment_info pinfo ON pinfo.package_session_id = cs.package_session_id"
                        + " AND pinfo.row_num = 1")
                .contains("LEFT JOIN enroll_invite ei ON ei.id = pinfo.psli_enroll_invite_id")
                .contains("ei.tag AS inviteTag")
                // the planner leaves a free course's currency out of the page's (CatalogueSyncPlanner)
                .contains("pinfo.actual_price AS actualPrice");
    }
}
