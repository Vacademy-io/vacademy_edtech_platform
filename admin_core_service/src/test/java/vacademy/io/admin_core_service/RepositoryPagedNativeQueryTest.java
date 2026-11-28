package vacademy.io.admin_core_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.hibernate.dialect.DatabaseVersion;
import org.hibernate.dialect.PostgreSQLDialect;
import org.hibernate.dialect.pagination.LimitHandler;
import org.hibernate.query.spi.Limit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.AnnotatedBeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AssignableTypeFilter;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * A paged native query gets its page clause from Hibernate, which appends
 * {@code offset ? rows fetch next ? rows only} at the FIRST semicolon it finds anywhere in
 * the SQL, or at the end when there is none. It does not understand {@code --} comments, so
 * a semicolon in a SQL comment puts the clause inside the comment: the placeholder vanishes,
 * Hibernate still binds a value for it, and every call fails with "The column index is out
 * of range: 98, number of columns: 97".
 *
 * <p>That took down the Manage Payments list on 2026-09-30 ("for it; it drops out" in a
 * comment inside PaymentLogRepository.COMBINED_PAYMENT_ROWS). Nothing noticed: it compiles,
 * it boots, Mockito tests never build the SQL, and the count query has no page clause so the
 * totals kept working. This runs Hibernate's own PostgreSQL limit handler over every paged
 * native query and checks the clause lands at the end.
 */
class RepositoryPagedNativeQueryTest {

    private static final String SCAN_ROOT = "vacademy.io";

    @Test
    void page_clause_lands_at_the_end_of_every_paged_native_query() throws Exception {
        LimitHandler limitHandler = new PostgreSQLDialect(DatabaseVersion.make(16)).getLimitHandler();
        Limit limit = new Limit();
        limit.setFirstRow(20);
        limit.setMaxRows(20);

        List<String> problems = new ArrayList<>();
        int checked = 0;
        for (Class<?> repository : repositories()) {
            for (Method method : repository.getDeclaredMethods()) {
                Query query = method.getAnnotation(Query.class);
                if (query == null || !query.nativeQuery() || query.value().isBlank()) {
                    continue;
                }
                boolean paged = Arrays.stream(method.getParameterTypes()).anyMatch(Pageable.class::isAssignableFrom);
                if (!paged) {
                    continue;
                }
                checked++;
                String sql = query.value();
                String processed = limitHandler.processSql(sql, limit);
                int insertedAt = firstDifference(sql, processed);
                // Only whitespace (or a closing semicolon) may follow the page clause.
                String after = sql.substring(Math.min(insertedAt, sql.length())).strip();
                if (!after.isEmpty() && !after.equals(";")) {
                    int lineStart = sql.lastIndexOf('\n', insertedAt - 1) + 1;
                    int lineEnd = sql.indexOf('\n', insertedAt);
                    String line = sql.substring(lineStart, lineEnd < 0 ? sql.length() : lineEnd).strip();
                    problems.add(repository.getSimpleName() + "#" + method.getName()
                            + ": page clause inserted mid-query, before: " + line);
                }
            }
        }
        assertThat(checked).as("the scan found no paged native queries; the root package is wrong").isPositive();
        assertThat(problems).isEmpty();
    }

    private static int firstDifference(String a, String b) {
        int n = Math.min(a.length(), b.length());
        for (int i = 0; i < n; i++) {
            if (a.charAt(i) != b.charAt(i)) {
                return i;
            }
        }
        return n;
    }

    private static List<Class<?>> repositories() throws ClassNotFoundException {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false) {
            @Override
            protected boolean isCandidateComponent(AnnotatedBeanDefinition beanDefinition) {
                // repositories are interfaces; the default scanner only wants concrete classes
                return beanDefinition.getMetadata().isInterface() && beanDefinition.getMetadata().isIndependent();
            }
        };
        scanner.addIncludeFilter(new AssignableTypeFilter(Repository.class));
        List<Class<?>> found = new ArrayList<>();
        for (var definition : scanner.findCandidateComponents(SCAN_ROOT)) {
            found.add(Class.forName(definition.getBeanClassName()));
        }
        return found;
    }
}
