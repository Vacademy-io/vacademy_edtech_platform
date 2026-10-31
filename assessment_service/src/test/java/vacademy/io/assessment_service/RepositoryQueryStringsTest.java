package vacademy.io.assessment_service;

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
 * unbalanced quote anywhere in it makes the whole service refuse to boot —
 * which no Mockito test notices. On 2026-09-20 an apostrophe in a SQL comment
 * ("the learner's own list") inside {@code StudentAttemptRepository} did exactly
 * that: Spring Data reads the raw string for quotes and parameters and does not
 * understand {@code --} comments, so the pod crash-looped while every unit test
 * was green. This walks the same repositories the shared config enables and
 * runs the same quote scan Spring Data does, so the failure lands here instead.
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
