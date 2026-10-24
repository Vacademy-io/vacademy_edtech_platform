package vacademy.io.common.testsupport;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.ByteArrayOutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Consumer;

/**
 * Minimal servlet request/response doubles built on {@link Proxy}: common_service has no
 * spring-test on its test classpath. Only the methods the filters under test call are
 * implemented; everything else returns a neutral default.
 */
public final class ServletFakes {

    private ServletFakes() {
    }

    public static final class FakeRequest {
        public final Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        public final Map<String, Object> attributes = new HashMap<>();
        public String uri = "/";
        public String method = "GET";
        public String queryString;

        public FakeRequest(String method, String uri) {
            this.method = method;
            this.uri = uri;
        }

        public FakeRequest header(String name, String value) {
            headers.put(name, value);
            return this;
        }

        public HttpServletRequest proxy() {
            return (HttpServletRequest) Proxy.newProxyInstance(
                    ServletFakes.class.getClassLoader(),
                    new Class<?>[] { HttpServletRequest.class },
                    (p, m, args) -> switch (m.getName()) {
                        case "getRequestURI" -> uri;
                        case "getMethod" -> method;
                        case "getQueryString" -> queryString;
                        case "getHeader" -> headers.get((String) args[0]);
                        case "getAttribute" -> attributes.get((String) args[0]);
                        case "setAttribute" -> {
                            attributes.put((String) args[0], args[1]);
                            yield null;
                        }
                        case "removeAttribute" -> {
                            attributes.remove((String) args[0]);
                            yield null;
                        }
                        case "getAttributeNames" -> Collections.enumeration(attributes.keySet());
                        case "getDispatcherType" -> DispatcherType.REQUEST;
                        case "getRemoteAddr" -> "127.0.0.1";
                        case "isAsyncStarted" -> false;
                        case "hashCode" -> System.identityHashCode(p);
                        case "equals" -> p == args[0];
                        case "toString" -> "FakeRequest " + method + " " + uri;
                        default -> neutral(m.getReturnType());
                    });
        }
    }

    public static final class FakeResponse {
        public final Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        public final ByteArrayOutputStream body = new ByteArrayOutputStream();
        public int status = 200;
        public String contentType;
        public boolean committed;

        public String bodyText() {
            return body.toString(StandardCharsets.UTF_8);
        }

        public HttpServletResponse proxy() {
            ServletOutputStream out = new ServletOutputStream() {
                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setWriteListener(WriteListener writeListener) {
                }

                @Override
                public void write(int b) {
                    body.write(b);
                }
            };
            PrintWriter writer = new PrintWriter(new OutputStreamWriter(body, StandardCharsets.UTF_8), true);
            return (HttpServletResponse) Proxy.newProxyInstance(
                    ServletFakes.class.getClassLoader(),
                    new Class<?>[] { HttpServletResponse.class },
                    (p, m, args) -> switch (m.getName()) {
                        case "setStatus" -> {
                            status = (Integer) args[0];
                            yield null;
                        }
                        case "getStatus" -> status;
                        case "setHeader", "addHeader" -> {
                            headers.put((String) args[0], (String) args[1]);
                            yield null;
                        }
                        case "getHeader" -> headers.get((String) args[0]);
                        case "containsHeader" -> headers.containsKey((String) args[0]);
                        case "setContentType" -> {
                            contentType = (String) args[0];
                            yield null;
                        }
                        case "getContentType" -> contentType;
                        case "getOutputStream" -> out;
                        case "getWriter" -> writer;
                        case "isCommitted" -> committed;
                        case "flushBuffer" -> {
                            committed = true;
                            yield null;
                        }
                        case "getLocale" -> Locale.ROOT;
                        case "hashCode" -> System.identityHashCode(p);
                        case "equals" -> p == args[0];
                        case "toString" -> "FakeResponse " + status;
                        default -> neutral(m.getReturnType());
                    });
        }
    }

    /** A chain that records whether it ran and lets the test observe state inside it. */
    public static final class RecordingChain implements FilterChain {
        public boolean called;
        private final Consumer<ServletRequest> inside;

        public RecordingChain() {
            this(r -> {
            });
        }

        public RecordingChain(Consumer<ServletRequest> inside) {
            this.inside = inside;
        }

        @Override
        public void doFilter(ServletRequest request, ServletResponse response) {
            called = true;
            inside.accept(request);
        }
    }

    private static Object neutral(Class<?> type) {
        if (type == boolean.class) {
            return false;
        }
        if (type == int.class) {
            return 0;
        }
        if (type == long.class) {
            return 0L;
        }
        return null;
    }
}
