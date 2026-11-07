package vacademy.io.admin_core_service.features.packages.repository;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * SQL contract of the public v2 catalogue search (both branches). Mockito tests never build this
 * SQL, and a wrong edit here changes what every public site lists, so the load-bearing pieces are
 * pinned as text. (Quote and page-clause safety of every query is covered repo-wide by
 * RepositoryQueryStringsTest / RepositoryPagedNativeQueryTest.)
 */
class PackageRepositoryV2SearchQueriesTest {

    private static final String PACKAGE_IDS_CLAUSE =
            "AND (:#{#packageIds == null || #packageIds.isEmpty()} = true OR p.id IN (:packageIds))";
    private static final List<String> V2_QUERIES = List.of("getCatalogPackageDetailV2", "getOpenCatalogPackageDetailV2");

    static Method method(String name) {
        List<Method> found = Arrays.stream(PackageRepository.class.getDeclaredMethods())
                .filter(m -> m.getName().equals(name)).toList();
        assertThat(found).as(name + " declared exactly once").hasSize(1);
        return found.get(0);
    }

    static List<String> paramNames(Method method) {
        return Arrays.stream(method.getParameters())
                .map(p -> p.getAnnotation(Param.class))
                .filter(Objects::nonNull)
                .map(Param::value)
                .toList();
    }

    static String squash(String sql) {
        return sql.replaceAll("\\s+", " ").trim();
    }

    @Test
    @DisplayName("Both v2 queries select p.created_at AS createdAt (search used to lack it)")
    void bothV2QueriesSelectCreatedAt() {
        for (String name : V2_QUERIES) {
            assertThat(method(name).getAnnotation(Query.class).value()).as(name).contains("p.created_at AS createdAt,");
        }
    }

    @Test
    @DisplayName("Both v2 queries AND their count queries apply the optional package_ids filter")
    void packageIdsFilterIsInRowsAndTotals() {
        for (String name : V2_QUERIES) {
            Query query = method(name).getAnnotation(Query.class);
            assertThat(query.value()).as(name + " rows").contains(PACKAGE_IDS_CLAUSE);
            assertThat(query.countQuery()).as(name + " count").contains(PACKAGE_IDS_CLAUSE);
            assertThat(paramNames(method(name))).as(name + " params").contains("packageIds");
        }
    }

    @Test
    @DisplayName("v2 queries keep the catalogue gate and grouping they had")
    void v2GateAndGroupingUnchanged() {
        for (String name : V2_QUERIES) {
            Query query = method(name).getAnnotation(Query.class);
            assertThat(query.value()).contains("p.is_course_published_to_catalaouge = true");
            assertThat(query.countQuery()).contains("SELECT COUNT(DISTINCT ps.id)");
            // created_at is functionally dependent on the grouped primary key p.id: no GROUP BY change
            String groupBy = query.value().substring(query.value().lastIndexOf("GROUP BY"));
            assertThat(groupBy).doesNotContain("created_at");
            assertThat(squash(groupBy)).startsWith("GROUP BY p.id,");
        }
    }
}
