package vacademy.io.admin_core_service.features.admin_activity_logs;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.DefaultParameterNameDiscoverer;
import org.springframework.core.ParameterNameDiscoverer;
import org.springframework.core.type.filter.TypeFilter;
import org.springframework.expression.spel.SpelParseException;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;

import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Compile-time-ish guard for every {@code @Auditable} annotation in the service.
 *
 * <p>The SpEL on these annotations is a string: nothing checks it until an admin
 * performs the action in production, and when it is wrong the aspect swallows
 * the failure (by design — audit must never break a mutation) and writes a row
 * with a null description. A typo therefore ships silently and is only noticed
 * when someone reads the audit log and finds blank sentences.
 *
 * <p>So this test walks every annotated controller method and checks the three
 * things that are statically knowable:
 * <ol>
 *   <li>the expressions <b>parse</b>;</li>
 *   <li>every {@code #variable} they reference is a real parameter of that
 *       method (or one of the aspect-supplied {@code #user} / {@code #result} /
 *       {@code #before});</li>
 *   <li>every {@code @beanName} they call resolves to a class that exists.</li>
 * </ol>
 *
 * <p>What it cannot check is property names inside the expressions
 * ({@code #dto?.campaignName}) — SpEL resolves those reflectively at runtime.
 */
class AuditableAnnotationContractTest {

    private static final String BASE_PACKAGE = "vacademy.io";

    /** Variables the aspect puts into the evaluation context itself. */
    private static final Set<String> ASPECT_PROVIDED = Set.of("user", "result", "before");

    private static final Pattern VARIABLE_REF = Pattern.compile("#([A-Za-z_][A-Za-z0-9_]*)");
    private static final Pattern BEAN_REF = Pattern.compile("@([A-Za-z_][A-Za-z0-9_]*)");
    private static final Pattern ENTITY_TYPE = Pattern.compile("[A-Z][A-Z0-9_]*");

    /**
     * Every class file, interfaces included — a type filter and not
     * {@code AssignableTypeFilter(Object.class)}, which silently skips
     * interfaces and would then miss the Spring Data repositories that
     * {@code captureBefore} expressions call into.
     */
    private static final TypeFilter MATCH_EVERYTHING = (metadataReader, metadataReaderFactory) -> true;

    private final SpelExpressionParser parser = new SpelExpressionParser();
    private final ParameterNameDiscoverer parameterNameDiscoverer = new DefaultParameterNameDiscoverer();

    @Test
    @DisplayName("every @Auditable expression parses, and its #variables and @beans exist")
    void auditableAnnotationsAreWellFormed() {
        List<Method> annotated = findAuditableMethods();
        assertTrue(annotated.size() >= 20,
                "Expected the audit coverage to still be in place, found only " + annotated.size()
                        + " @Auditable methods — did a scan path change?");

        Set<String> beanNames = scanBeanNames();
        List<String> problems = new ArrayList<>();

        for (Method method : annotated) {
            Auditable auditable = method.getAnnotation(Auditable.class);
            String where = method.getDeclaringClass().getSimpleName() + "#" + method.getName();

            if (auditable.entityType().isBlank()) {
                problems.add(where + ": entityType is blank");
            } else if (!ENTITY_TYPE.matcher(auditable.entityType()).matches()) {
                problems.add(where + ": entityType '" + auditable.entityType()
                        + "' must be UPPER_SNAKE_CASE — the UI filters on the exact string");
            }
            if (auditable.action().isBlank() && auditable.actionExpr().isBlank()) {
                problems.add(where + ": neither action nor actionExpr is set — "
                        + "the aspect skips the row because action is NOT NULL");
            }

            Set<String> parameterNames = parameterNamesOf(method);
            checkExpression(auditable.entityIdExpr(), where, "entityIdExpr", parameterNames, beanNames, problems);
            checkExpression(auditable.descriptionExpr(), where, "descriptionExpr", parameterNames, beanNames, problems);
            checkExpression(auditable.captureBefore(), where, "captureBefore", parameterNames, beanNames, problems);
            checkExpression(auditable.actionExpr(), where, "actionExpr", parameterNames, beanNames, problems);
            checkExpression(auditable.conditionExpr(), where, "conditionExpr", parameterNames, beanNames, problems);

            // captureBefore runs before the wrapped call, so #result is not there yet.
            if (auditable.captureBefore().contains("#result")) {
                problems.add(where + ": captureBefore references #result, which is always null "
                        + "before the method runs");
            }
        }

        assertTrue(problems.isEmpty(), "Malformed @Auditable annotations:\n  " + String.join("\n  ", problems));
    }

    /**
     * The read UI filters on the exact {@code entity_type} / {@code action}
     * strings written here, from two hand-maintained lists in
     * {@code ActivityLogFilters.tsx}. Nothing links the two, so for a long time
     * new resources simply could not be filtered — the rows were in the table
     * and invisible from the dropdown. This fails the build instead.
     *
     * <p>Skipped when the frontend is not checked out alongside the service.
     */
    @Test
    @DisplayName("every audited entityType and action is offered by the log UI's filters")
    void filterDropdownsCoverEveryAuditedValue() throws IOException {
        Path filters = Path.of("..", "frontend-admin-dashboard", "src", "routes",
                "admin-activity-logs", "-components", "ActivityLogFilters.tsx");
        assumeTrue(Files.exists(filters), "frontend-admin-dashboard not checked out — skipping");

        String source = Files.readString(filters);
        List<String> missing = new ArrayList<>();

        for (Method method : findAuditableMethods()) {
            Auditable auditable = method.getAnnotation(Auditable.class);
            String where = method.getDeclaringClass().getSimpleName() + "#" + method.getName();

            if (!source.contains("'" + auditable.entityType() + "'")) {
                missing.add(where + ": entityType " + auditable.entityType()
                        + " has no entry in RESOURCE_GROUPS");
            }
            // Only a literal action can be checked — an actionExpr resolves at
            // runtime, and its possible values are not knowable from here.
            if (!auditable.action().isBlank()
                    && !SYNTHETIC_ACTIONS.contains(auditable.action())
                    && !source.contains("'" + auditable.action() + "'")) {
                missing.add(where + ": action " + auditable.action()
                        + " has no entry in ACTIVITY_OPTIONS");
            }
        }

        assertTrue(missing.isEmpty(),
                "The audit log's filter dropdowns are missing values the backend emits.\n"
                        + "Add them to ActivityLogFilters.tsx:\n  "
                        + String.join("\n  ", missing));
    }

    /**
     * Placeholder actions that only exist as the fallback behind an
     * {@code actionExpr} and never describe a real operation, so they would be
     * noise in a filter dropdown.
     */
    private static final Set<String> SYNTHETIC_ACTIONS = Set.of("ACTION");

    private void checkExpression(String expression,
            String where,
            String field,
            Set<String> parameterNames,
            Set<String> beanNames,
            List<String> problems) {
        if (expression == null || expression.isBlank()) {
            return;
        }
        try {
            parser.parseExpression(expression);
        } catch (SpelParseException e) {
            problems.add(where + "." + field + ": does not parse — " + e.getMessage());
            return;
        }

        Matcher variables = VARIABLE_REF.matcher(expression);
        while (variables.find()) {
            String name = variables.group(1);
            if (ASPECT_PROVIDED.contains(name) || parameterNames.contains(name)) {
                continue;
            }
            problems.add(where + "." + field + ": references #" + name
                    + ", which is neither a parameter of the method " + parameterNames
                    + " nor supplied by the aspect " + ASPECT_PROVIDED);
        }

        Matcher beans = BEAN_REF.matcher(expression);
        while (beans.find()) {
            String name = beans.group(1);
            if (!beanNames.contains(name)) {
                problems.add(where + "." + field + ": references bean @" + name + ", "
                        + "and no class named " + Character.toUpperCase(name.charAt(0)) + name.substring(1)
                        + " was found");
            }
        }
    }

    private Set<String> parameterNamesOf(Method method) {
        String[] names = parameterNameDiscoverer.getParameterNames(method);
        return names == null ? Set.of() : new HashSet<>(List.of(names));
    }

    /** Every {@code @Auditable} method reachable from the service's own classes. */
    private List<Method> findAuditableMethods() {
        ClassPathScanningCandidateComponentProvider scanner = new PermissiveScanner();
        scanner.addIncludeFilter(MATCH_EVERYTHING);

        List<Method> methods = new ArrayList<>();
        for (BeanDefinition definition : scanner.findCandidateComponents(BASE_PACKAGE)) {
            Class<?> type = loadOrNull(definition.getBeanClassName());
            if (type == null) {
                continue;
            }
            for (Method method : safeMethods(type)) {
                if (method.isAnnotationPresent(Auditable.class)) {
                    methods.add(method);
                }
            }
        }
        return methods;
    }

    /**
     * Bean names SpEL could resolve, derived from class names the way Spring's
     * default naming strategy does. Interfaces count: Spring Data repositories
     * are referenced from {@code captureBefore} expressions and only exist as
     * interfaces on the classpath.
     */
    private Set<String> scanBeanNames() {
        ClassPathScanningCandidateComponentProvider scanner = new PermissiveScanner();
        scanner.addIncludeFilter(MATCH_EVERYTHING);

        Set<String> names = new HashSet<>();
        for (BeanDefinition definition : scanner.findCandidateComponents(BASE_PACKAGE)) {
            String className = definition.getBeanClassName();
            if (className == null) {
                continue;
            }
            String simpleName = className.substring(className.lastIndexOf('.') + 1);
            if (simpleName.isEmpty()) {
                continue;
            }
            names.add(Character.toLowerCase(simpleName.charAt(0)) + simpleName.substring(1));
        }
        return names;
    }

    private static Method[] safeMethods(Class<?> type) {
        try {
            return type.getDeclaredMethods();
        } catch (Throwable ignored) {
            // A class whose signature references a type missing at test scope.
            return new Method[0];
        }
    }

    private static Class<?> loadOrNull(String className) {
        if (className == null) {
            return null;
        }
        try {
            return Class.forName(className, false, AuditableAnnotationContractTest.class.getClassLoader());
        } catch (Throwable ignored) {
            return null;
        }
    }

    /** Scanner that also yields interfaces and abstract classes. */
    private static final class PermissiveScanner extends ClassPathScanningCandidateComponentProvider {
        private PermissiveScanner() {
            super(false);
        }

        @Override
        protected boolean isCandidateComponent(
                org.springframework.beans.factory.annotation.AnnotatedBeanDefinition beanDefinition) {
            return true;
        }
    }
}
