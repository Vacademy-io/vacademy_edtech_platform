package vacademy.io.admin_core_service.features.workflow.spel;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.expression.MapAccessor;
import org.springframework.core.convert.TypeDescriptor;
import org.springframework.expression.AccessException;
import org.springframework.expression.ConstructorExecutor;
import org.springframework.expression.ConstructorResolver;
import org.springframework.expression.EvaluationContext;
import org.springframework.expression.MethodExecutor;
import org.springframework.expression.PropertyAccessor;
import org.springframework.expression.TypeLocator;
import org.springframework.expression.spel.SpelEvaluationException;
import org.springframework.expression.spel.SpelMessage;
import org.springframework.expression.spel.support.ReflectiveConstructorResolver;
import org.springframework.expression.spel.support.ReflectiveMethodResolver;
import org.springframework.expression.spel.support.ReflectivePropertyAccessor;
import org.springframework.expression.spel.support.StandardEvaluationContext;
import org.springframework.expression.spel.support.StandardTypeLocator;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * What an automation expression may reach. Workflow expressions are written by institute staff
 * (and by the AI drafting assistant), so the evaluation context only exposes the value and
 * date/collection types those expressions actually use:
 * <ul>
 *   <li>{@code T(x)} and {@code new x(...)} resolve only the types listed below; anything else
 *       fails as "type not found".</li>
 *   <li>{@code new} is limited to a smaller set of plain value/collection types.</li>
 *   <li>Method and property access never reaches {@code getClass}, members of {@code Class},
 *       class loaders, reflection, method handles, threads, processes, {@code System},
 *       script engines or naming contexts, nor static members of a type outside the list.</li>
 *   <li>No bean references ({@code @name}): the context has no bean resolver.</li>
 * </ul>
 * Map access ({@code #ctx['a']}, {@code #ctx.a}), variables ({@code #ctx}, {@code #item},
 * {@code #dates}), selection/projection, literals and operators are unchanged.
 *
 * <p>The type list is the set of types saved in real workflows, plus the java.lang value types
 * and the URL codecs the built-in templates and AI drafting rules rely on.
 */
@Slf4j
public final class WorkflowExpressionPolicy {

    private WorkflowExpressionPolicy() {
    }

    /** Types resolvable by {@code T(...)} / {@code new ...}, by exact class name. */
    static final Set<String> ALLOWED_TYPES = Set.of(
            // java.lang value types
            "java.lang.String", "java.lang.StringBuilder", "java.lang.Math",
            "java.lang.Integer", "java.lang.Long", "java.lang.Double", "java.lang.Float",
            "java.lang.Short", "java.lang.Byte", "java.lang.Boolean", "java.lang.Character",
            "java.lang.Number",
            // java.util
            "java.util.Arrays", "java.util.Collections", "java.util.Objects",
            "java.util.List", "java.util.Map", "java.util.Set",
            "java.util.ArrayList", "java.util.LinkedList",
            "java.util.HashMap", "java.util.LinkedHashMap", "java.util.TreeMap",
            "java.util.HashSet", "java.util.LinkedHashSet", "java.util.TreeSet",
            "java.util.Date", "java.util.Calendar", "java.util.UUID", "java.util.Optional",
            "java.util.Locale", "java.util.Base64",
            // text / numbers
            "java.text.SimpleDateFormat", "java.text.DecimalFormat", "java.text.NumberFormat",
            "java.math.BigDecimal", "java.math.BigInteger", "java.math.RoundingMode",
            // JDBC date/time value types (attendance and session nodes write these)
            "java.sql.Date", "java.sql.Time", "java.sql.Timestamp",
            // string codecs
            "java.net.URLEncoder", "java.net.URLDecoder", "java.nio.charset.StandardCharsets",
            "org.springframework.util.StringUtils");

    /** Every public type in these packages (not sub-packages) is allowed. */
    static final Set<String> ALLOWED_PACKAGES = Set.of(
            "java.time", "java.time.format", "java.time.temporal");

    /** Types that {@code new} may construct. */
    static final Set<String> CONSTRUCTIBLE_TYPES = Set.of(
            "java.text.SimpleDateFormat", "java.text.DecimalFormat",
            "java.util.HashSet", "java.util.LinkedHashSet", "java.util.TreeSet",
            "java.util.HashMap", "java.util.LinkedHashMap", "java.util.TreeMap",
            "java.util.ArrayList", "java.util.LinkedList", "java.util.Date",
            "java.lang.StringBuilder", "java.math.BigDecimal", "java.math.BigInteger");

    /** Members of these classes (and their subclasses) are never callable. */
    private static final List<Class<?>> BLOCKED_DECLARING_TYPES = List.of(
            Class.class, ClassLoader.class, Thread.class, ThreadGroup.class, Runtime.class,
            Process.class, ProcessBuilder.class, ProcessHandle.class, System.class,
            Module.class, ModuleLayer.class, StackWalker.class, Package.class,
            java.net.URL.class, java.net.URLConnection.class, java.net.Socket.class,
            java.net.ServerSocket.class, java.net.DatagramSocket.class, java.net.InetAddress.class);

    /** Members declared in these packages are never callable. */
    private static final List<String> BLOCKED_PACKAGE_PREFIXES = List.of(
            "java.lang.reflect.", "java.lang.invoke.", "java.lang.ref.", "java.lang.instrument.",
            "java.lang.management.", "javax.script.", "javax.naming.", "javax.management.",
            "java.io.", "java.nio.file.", "java.nio.channels.", "java.net.http.",
            "sun.", "jdk.internal.", "com.sun.");

    /**
     * Static methods that change JVM-wide state or read system properties: the JVM must keep its
     * default time zone/locale (dates are serialised in UTC), and system properties are not data.
     */
    private static final Set<String> BLOCKED_STATIC_METHODS = Set.of(
            "java.util.Locale#setDefault", "java.util.TimeZone#setDefault",
            "java.lang.Integer#getInteger", "java.lang.Long#getLong", "java.lang.Boolean#getBoolean");

    /**
     * A context with the same shape as before (root object, Map access, {@code #ctx}) but with
     * every type/method/property lookup going through the allow-list.
     *
     * @param workflowId only used to label refusal warnings
     */
    public static StandardEvaluationContext newContext(Map<String, Object> root, String workflowId) {
        StandardEvaluationContext context = new StandardEvaluationContext(root);
        context.setTypeLocator(new AllowListTypeLocator(workflowId));
        List<PropertyAccessor> accessors = new ArrayList<>();
        // Same order as the unrestricted context: Map keys first, then bean properties.
        accessors.add(new MapAccessor());
        accessors.add(new RestrictedPropertyAccessor(workflowId));
        context.setPropertyAccessors(accessors);
        context.setMethodResolvers(new ArrayList<>(List.of(new RestrictedMethodResolver(workflowId))));
        context.setConstructorResolvers(new ArrayList<>(List.of(new RestrictedConstructorResolver(workflowId))));
        // No bean resolver: '@name' references fail.
        return context;
    }

    // ---------------------------------------------------------------- type checks

    /** True when the type name (fully qualified, or a java.lang simple name) is on the list. */
    static boolean isAllowedTypeName(String typeName) {
        if (typeName == null || typeName.isBlank()) {
            return false;
        }
        String name = typeName.trim();
        if (!name.contains(".")) {
            name = "java.lang." + name;
        }
        if (ALLOWED_TYPES.contains(name)) {
            return true;
        }
        int lastDot = name.lastIndexOf('.');
        String pkg = name.substring(0, lastDot);
        String simple = name.substring(lastDot + 1);
        return ALLOWED_PACKAGES.contains(pkg) && !simple.isEmpty() && !simple.contains("$");
    }

    static boolean isAllowedType(Class<?> type) {
        if (type == null) {
            return false;
        }
        if (type.isArray()) {
            return isAllowedType(type.getComponentType());
        }
        if (type.isPrimitive()) {
            return true;
        }
        Package pkg = type.getPackage();
        return ALLOWED_TYPES.contains(type.getName())
                || (pkg != null && ALLOWED_PACKAGES.contains(pkg.getName())
                && java.lang.reflect.Modifier.isPublic(type.getModifiers()));
    }

    /** True when the method may never be invoked from an automation expression. */
    static boolean isBlockedMethod(Method method) {
        if ("getClass".equals(method.getName())) {
            return true;
        }
        Class<?> declaring = method.getDeclaringClass();
        if (isBlockedType(declaring)) {
            return true;
        }
        if (BLOCKED_STATIC_METHODS.contains(declaring.getName() + "#" + method.getName())) {
            return true;
        }
        // A method whose return type is Class/ClassLoader hands out a reflection entry point.
        Class<?> returnType = method.getReturnType();
        return ClassLoader.class.isAssignableFrom(returnType) || isBlockedPackage(returnType);
    }

    static boolean isBlockedType(Class<?> type) {
        for (Class<?> blocked : BLOCKED_DECLARING_TYPES) {
            if (blocked.isAssignableFrom(type)) {
                return true;
            }
        }
        return isBlockedPackage(type);
    }

    private static boolean isBlockedPackage(Class<?> type) {
        String name = type.getName();
        for (String prefix : BLOCKED_PACKAGE_PREFIXES) {
            if (name.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    private static void warnRefused(String what, String name, String workflowId) {
        log.warn("Workflow expression refused {} '{}' (workflowId={})", what, name,
                workflowId != null ? workflowId : "unknown");
    }

    // ---------------------------------------------------------------- extension points

    /** {@code T(x)} / {@code new x()} only resolve allow-listed types; the name is checked before any class loading. */
    static final class AllowListTypeLocator implements TypeLocator {
        private final StandardTypeLocator delegate = new StandardTypeLocator();
        private final String workflowId;

        AllowListTypeLocator(String workflowId) {
            this.workflowId = workflowId;
        }

        @Override
        public Class<?> findType(String typeName) {
            if (!isAllowedTypeName(typeName)) {
                warnRefused("type", typeName, workflowId);
                throw new SpelEvaluationException(SpelMessage.TYPE_NOT_FOUND, typeName);
            }
            Class<?> type = delegate.findType(typeName);
            if (!isAllowedType(type)) {
                warnRefused("type", typeName, workflowId);
                throw new SpelEvaluationException(SpelMessage.TYPE_NOT_FOUND, typeName);
            }
            return type;
        }
    }

    /** {@code new x(...)} only for {@link #CONSTRUCTIBLE_TYPES}. */
    static final class RestrictedConstructorResolver implements ConstructorResolver {
        private final ReflectiveConstructorResolver delegate = new ReflectiveConstructorResolver();
        private final String workflowId;

        RestrictedConstructorResolver(String workflowId) {
            this.workflowId = workflowId;
        }

        @Override
        public ConstructorExecutor resolve(EvaluationContext context, String typeName,
                                           List<TypeDescriptor> argumentTypes) throws AccessException {
            Class<?> type;
            try {
                type = context.getTypeLocator().findType(typeName);
            } catch (Exception e) {
                return null;
            }
            if (type == null || !CONSTRUCTIBLE_TYPES.contains(type.getName())) {
                warnRefused("constructor", typeName, workflowId);
                return null;
            }
            return delegate.resolve(context, typeName, argumentTypes);
        }
    }

    /** Instance/static methods, minus reflection and process/thread/system entry points. */
    static final class RestrictedMethodResolver extends ReflectiveMethodResolver {
        private final String workflowId;

        RestrictedMethodResolver(String workflowId) {
            this.workflowId = workflowId;
        }

        @Override
        public MethodExecutor resolve(EvaluationContext context, Object targetObject, String name,
                                      List<TypeDescriptor> argumentTypes) throws AccessException {
            if (targetObject instanceof Class<?> type && !isAllowedType(type)) {
                warnRefused("static method on type", type.getName() + "." + name, workflowId);
                return null;
            }
            MethodExecutor executor = super.resolve(context, targetObject, name, argumentTypes);
            if (executor == null && targetObject != null && hasBlockedMethodNamed(targetObject, name)) {
                warnRefused("method", name, workflowId);
            }
            return executor;
        }

        /**
         * Also used for the {@code java.lang.Class} methods the parent exposes on a {@code T(x)} target,
         * where {@link #isCandidateForInvocation} is not consulted.
         */
        @Override
        protected Method[] getMethods(Class<?> type) {
            return java.util.Arrays.stream(super.getMethods(type))
                    .filter(m -> !isBlockedMethod(m))
                    .toArray(Method[]::new);
        }

        @Override
        protected boolean isCandidateForInvocation(Method method, Class<?> targetClass) {
            return !isBlockedMethod(method) && super.isCandidateForInvocation(method, targetClass);
        }

        private static boolean hasBlockedMethodNamed(Object target, String name) {
            List<Method> methods = new ArrayList<>(List.of(target.getClass().getMethods()));
            if (target instanceof Class<?>) {
                methods.addAll(List.of(((Class<?>) target).getMethods()));
            }
            for (Method m : methods) {
                if (m.getName().equals(name) && isBlockedMethod(m)) {
                    return true;
                }
            }
            return false;
        }
    }

    /** Bean properties and public fields, with the same member rules as methods. */
    static final class RestrictedPropertyAccessor extends ReflectivePropertyAccessor {
        private final String workflowId;

        RestrictedPropertyAccessor(String workflowId) {
            // Writes stay enabled as before; Map writes go through MapAccessor.
            super(true);
            this.workflowId = workflowId;
        }

        @Override
        public boolean canRead(EvaluationContext context, Object target, String name) throws AccessException {
            if (!targetAllowed(target, name)) {
                return false;
            }
            return super.canRead(context, target, name);
        }

        @Override
        public boolean canWrite(EvaluationContext context, Object target, String name) throws AccessException {
            if (!targetAllowed(target, name)) {
                return false;
            }
            return super.canWrite(context, target, name);
        }

        private boolean targetAllowed(Object target, String name) {
            if (target instanceof Class<?> type && !isAllowedType(type)) {
                warnRefused("static property on type", type.getName() + "." + name, workflowId);
                return false;
            }
            if ("class".equals(name) && !(target instanceof Map)) {
                warnRefused("property", name, workflowId);
                return false;
            }
            if (target != null && isBlockedType(target instanceof Class<?> c ? c : target.getClass())) {
                warnRefused("property on type", name, workflowId);
                return false;
            }
            return true;
        }

        @Override
        protected boolean isCandidateForProperty(Method method, Class<?> targetClass) {
            return !isBlockedMethod(method) && super.isCandidateForProperty(method, targetClass);
        }
    }
}
