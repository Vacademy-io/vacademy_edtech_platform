package vacademy.io.admin_core_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.AnnotatedBeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AssignableTypeFilter;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.SpelQueryContext;

/**
 * Every {@code @Query} string is parsed by Spring Data at start-up, and one
 * unbalanced quote anywhere in it makes the whole service refuse to boot -
 * which no Mockito test notices, because none of them boot the JPA context.
 *
 * <p>This service has already lost a deploy to it: on 2026-09-29 the phrase
 * "the CRM's hottest query" in a SQL comment inside
 * {@code AudienceResponseRepository} crash-looped the new pod 20+ times while
 * the old ReplicaSet kept serving, so the rollout silently stalled. Spring Data
 * reads the raw string for quotes and parameters and does not understand
 * {@code --} comments, so the apostrophe opened a literal that never closed.
 *
 * <p>This walks every repository under the scan root and runs the same quote
 * scan Spring Data does, naming the exact repository and method, so the failure
 * lands here instead of in production. Ported from the assessment_service test
 * of the same name, added after the same bug there.
 */
class RepositoryQueryStringsTest {

        private static final String SCAN_ROOT = "vacademy.io";

        @Test
        void every_declared_query_survives_spring_data_quote_parsing() throws Exception {
                List<String> problems = new ArrayList<>();
                int checked = 0;
                for (Class<?> repository : repositories()) {
                        for (Method method : repository.getDeclaredMethods()) {
                                Query query = method.getAnnotation(Query.class);
                                if (query == null) {
                                        continue;
                                }
                                checked++;
                                check(repository, method, "value", query.value(), problems);
                                check(repository, method, "countQuery", query.countQuery(), problems);
                        }
                }
                assertThat(checked).as("the scan found no @Query methods; the root package is wrong").isPositive();
                assertThat(problems).isEmpty();
        }

        private static void check(Class<?> repository, Method method, String which, String sql, List<String> problems) {
                if (sql == null || sql.isBlank()) {
                        return;
                }
                try {
                        // Same public entry point Spring Data's StringQuery uses; the
                        // QuotationMap inside throws on a quote that never closes.
                        SpelQueryContext.of((index, expression) -> "?" + index, (prefix, name) -> prefix + name)
                                        .parse(sql);
                } catch (IllegalArgumentException ex) {
                        problems.add(repository.getSimpleName() + "#" + method.getName() + " (" + which + "): "
                                        + ex.getMessage().lines().findFirst().orElse(ex.getMessage()));
                }
        }

        private static List<Class<?>> repositories() throws ClassNotFoundException {
                ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(
                                false) {
                        @Override
                        protected boolean isCandidateComponent(AnnotatedBeanDefinition beanDefinition) {
                                // repositories are interfaces; the default scanner only wants concrete classes
                                return beanDefinition.getMetadata().isInterface()
                                                && beanDefinition.getMetadata().isIndependent();
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
