package vacademy.io.admin_core_service.features.packages.repository;

import jakarta.persistence.QueryHint;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;

import java.lang.reflect.Method;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static vacademy.io.admin_core_service.features.packages.repository.PackageRepositoryV2SearchQueriesTest.method;
import static vacademy.io.admin_core_service.features.packages.repository.PackageRepositoryV2SearchQueriesTest.paramNames;
import static vacademy.io.admin_core_service.features.packages.repository.PackageRepositoryV2SearchQueriesTest.squash;

/**
 * SQL contract of the public popularity query. It aggregates the enrolment table behind an
 * unauthenticated URL, so the pieces that keep it scoped and index-friendly are pinned as text:
 * a wrong edit would put an unscoped aggregate on the production database.
 */
class PackageRepositoryPopularityQueryTest {

    @Test
    @DisplayName("Popularity query: one institute, literal ACTIVE status, real members only, per course")
    void popularityQueryShape() {
        Method method = method("countActiveLearnersPerCatalogPackage");
        Query query = method.getAnnotation(Query.class);
        assertThat(query.nativeQuery()).isTrue();
        String sql = squash(query.value());

        assertThat(sql)
                .startsWith("SELECT ps.package_id AS packageId, COUNT(DISTINCT m.user_id) AS learnerCount")
                .contains("JOIN student_session_institute_group_mapping m ON m.package_session_id = ps.id")
                // literal, so the partial (WHERE status = 'ACTIVE') indexes apply
                .contains("AND m.status = 'ACTIVE'")
                .contains("AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))")
                .contains("AND ps.status IN ('ACTIVE', 'HIDDEN')")
                .contains("WHERE p.status = 'ACTIVE' AND p.is_course_published_to_catalaouge = true")
                .contains("AND EXISTS ( SELECT 1 FROM package_institute pi WHERE pi.package_id = p.id"
                        + " AND pi.institute_id = :instituteId )")
                .endsWith("GROUP BY ps.package_id");
        // the institute is the ONLY bind parameter: no bound statuses (they would defeat the
        // partial indexes) and no way to call it without an institute scope
        assertThat(Pattern.compile("(?<!:):(\\w+)").matcher(sql).results().map(r -> r.group(1)).distinct().toList())
                .containsExactly("instituteId");
        assertThat(paramNames(method)).containsExactly("instituteId");
        // no join to package_institute (a course mapped once per group would be double counted)
        assertThat(sql).doesNotContain("JOIN package_institute");
    }

    @Test
    @DisplayName("Popularity query carries a statement timeout for the small replica pool")
    void popularityQueryHasTimeout() {
        QueryHints hints = method("countActiveLearnersPerCatalogPackage").getAnnotation(QueryHints.class);
        assertThat(hints).isNotNull();
        assertThat(hints.value()).extracting(QueryHint::name).containsExactly("jakarta.persistence.query.timeout");
        assertThat(Integer.parseInt(hints.value()[0].value())).isBetween(1_000, 30_000);
    }
}
