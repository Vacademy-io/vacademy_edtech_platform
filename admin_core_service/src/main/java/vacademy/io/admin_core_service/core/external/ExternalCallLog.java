package vacademy.io.admin_core_service.core.external;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Every FAILED call admin-core makes to a third party, in {@code external_api_call_log}, so the
 * platform portal lists it with every other failed vendor call. Plivo, Exotel, Airtel, Aavtaar,
 * Razorpay, Meta WhatsApp, WATI, FX rates, workflow HTTP steps and the rest each build their own
 * RestTemplate; each one is passed through {@link #attach} where it is built.
 *
 * <p>Only failures are written (a status of 400 or more, or no answer), and only for outside
 * hosts: our own services, the cluster and private addresses are skipped. A row holds the host,
 * method, first two path segments, status and the exception's class name: never a header,
 * query string, body or credential. The write happens on one background thread with a bounded
 * queue; when the queue is full the row is dropped, so the caller never waits and never fails
 * because of it.
 */
@Component
public class ExternalCallLog {

    private static final Logger log = LoggerFactory.getLogger(ExternalCallLog.class);
    private static final String SOURCE_SERVICE = "admin_core";
    private static final List<String> OWN_SUFFIXES = List.of(".vacademy.io", ".svc", ".svc.cluster.local",
            ".internal", ".local");
    private static final Interceptor INTERCEPTOR = new Interceptor();

    private static volatile ExternalCallLog instance;

    private final JdbcTemplate jdbc;
    private final ThreadPoolExecutor writer = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(500), r -> {
                Thread t = new Thread(r, "external-call-log");
                t.setDaemon(true);
                return t;
            }, new ThreadPoolExecutor.DiscardPolicy());

    public ExternalCallLog(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void register() {
        instance = this;
    }

    /** Adds failure logging to a RestTemplate and returns it, for use where it is built. */
    public static RestTemplate attach(RestTemplate rest) {
        List<ClientHttpRequestInterceptor> list = new ArrayList<>(rest.getInterceptors());
        if (!list.contains(INTERCEPTOR)) {
            list.add(INTERCEPTOR);
            rest.setInterceptors(list);
        }
        return rest;
    }

    static boolean external(String host) {
        String h = host == null ? "" : host.trim().toLowerCase(Locale.ROOT);
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (h.isEmpty() || h.equals("localhost") || !h.contains(".")) return false;
        if (h.equals("vacademy.io")) return false;
        for (String s : OWN_SUFFIXES) {
            if (h.endsWith(s)) return false;
        }
        if (h.matches("[0-9.]+") || h.contains(":")) {
            try {
                InetAddress a = InetAddress.getByName(h);
                return !(a.isSiteLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress());
            } catch (Exception e) {
                return false;
            }
        }
        return true;
    }

    static String operation(String method, String path) {
        StringBuilder op = new StringBuilder(method == null ? "GET" : method).append(" /");
        int taken = 0;
        for (String seg : (path == null ? "" : path).split("/")) {
            if (seg.isBlank()) continue;
            if (taken++ == 2) break;
            if (taken > 1) op.append('/');
            op.append(seg);
        }
        return op.length() > 64 ? op.substring(0, 64) : op.toString();
    }

    void failed(URI uri, String method, Integer status, String reason) {
        if (uri == null || !external(uri.getHost())) return;
        Timestamp at = Timestamp.from(Instant.now());
        String vendor = uri.getHost().toLowerCase(Locale.ROOT);
        String op = operation(method, uri.getPath());
        writer.execute(() -> {
            try {
                jdbc.update("""
                        INSERT INTO external_api_call_log
                            (occurred_at, vendor, source_service, operation, status, http_status, error_message)
                        VALUES (?, ?, ?, ?, 'FAILED', ?, ?)""",
                        at, vendor, SOURCE_SERVICE, op, status, reason);
            } catch (Exception e) {
                log.debug("external call failure not recorded: {}", e.getClass().getSimpleName());
            }
        });
    }

    static final class Interceptor implements ClientHttpRequestInterceptor {
        @Override
        public ClientHttpResponse intercept(HttpRequest request, byte[] body, ClientHttpRequestExecution execution)
                throws IOException {
            ExternalCallLog sink = instance;
            ClientHttpResponse response;
            try {
                response = execution.execute(request, body);
            } catch (IOException | RuntimeException e) {
                if (sink != null) {
                    sink.failed(request.getURI(), request.getMethod().name(), null, e.getClass().getSimpleName());
                }
                throw e;
            }
            try {
                int status = response.getStatusCode().value();
                if (status >= 400 && sink != null) {
                    sink.failed(request.getURI(), request.getMethod().name(), status, null);
                }
            } catch (Exception ignored) {
                // Reading the status must never change what the caller gets.
            }
            return response;
        }
    }
}
