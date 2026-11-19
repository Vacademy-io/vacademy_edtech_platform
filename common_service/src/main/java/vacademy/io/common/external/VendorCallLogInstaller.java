package vacademy.io.common.external;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Points {@link VendorCallLog} at its store when a service starts. admin-core declares a
 * {@link VendorCallLog.Sink} bean that writes the table; every other service has none and posts
 * each failure to admin-core's internal endpoint, signed like every other internal call.
 *
 * <p>Nothing here runs on a request: until a vendor client calls {@link VendorCallLog#failed},
 * this only remembers where failures would go.
 */
@Component
public class VendorCallLogInstaller {

    static final String ROUTE = "/admin-core-service/internal/external-calls/v1/failure";
    private static final Logger log = LoggerFactory.getLogger(VendorCallLogInstaller.class);

    private final ObjectProvider<VendorCallLog.Sink> localSink;
    private final ObjectProvider<InternalClientUtils> internalClient;

    @Value("${spring.application.name:unknown}")
    private String applicationName;

    /** Services name this setting differently; same order as OriginInstituteResolver. */
    @Value("${admin.core.service.baseurl:${admin.core.service.base_url:${ADMIN_CORE_SERVICE_BASE_URL:"
            + "http://admin-core-service.vacademy.svc.cluster.local:8072}}}")
    private String adminCoreBaseUrl;

    public VendorCallLogInstaller(ObjectProvider<VendorCallLog.Sink> localSink,
            ObjectProvider<InternalClientUtils> internalClient) {
        this.localSink = localSink;
        this.internalClient = internalClient;
    }

    /** "notification_service" -> "notification", as the portal names sources. */
    static String sourceName(String applicationName) {
        String name = applicationName == null ? "unknown" : applicationName.trim();
        return name.endsWith("_service") ? name.substring(0, name.length() - "_service".length()) : name;
    }

    @PostConstruct
    void install() {
        try {
            VendorCallLog.Sink sink = localSink.getIfAvailable();
            if (sink == null) {
                InternalClientUtils client = internalClient.getIfAvailable();
                if (client == null || adminCoreBaseUrl == null || adminCoreBaseUrl.isBlank()) {
                    log.info("vendor call failures from {} are not recorded: no route to admin-core", applicationName);
                    return;
                }
                sink = new AdminCoreSink(client, applicationName, adminCoreBaseUrl);
            }
            VendorCallLog.install(sink, sourceName(applicationName));
        } catch (Exception e) {
            // Recording failures is never a reason for a service not to start.
            log.warn("vendor call failures from {} are not recorded: {}", applicationName, e.toString());
        }
    }

    /** Posts one failure to admin-core. A refusal is logged once, so a gap is visible. */
    static final class AdminCoreSink implements VendorCallLog.Sink {
        private final InternalClientUtils client;
        private final String clientName;
        private final String baseUrl;
        private final AtomicBoolean warned = new AtomicBoolean();

        AdminCoreSink(InternalClientUtils client, String clientName, String baseUrl) {
            this.client = client;
            this.clientName = clientName;
            this.baseUrl = baseUrl;
        }

        static Map<String, Object> body(VendorCallLog.Failure f) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("occurredAt", f.at().toString());
            body.put("vendor", f.vendor());
            body.put("sourceService", f.sourceService());
            body.put("operation", f.operation());
            body.put("httpStatus", f.httpStatus());
            body.put("error", f.error());
            body.put("request", f.request());
            body.put("response", f.response());
            return body;
        }

        @Override
        public void write(VendorCallLog.Failure f) {
            try {
                ResponseEntity<String> r = client.makeHmacRequest(clientName, "POST", baseUrl, ROUTE, body(f));
                if (r == null || !r.getStatusCode().is2xxSuccessful()) {
                    refused(String.valueOf(r == null ? null : r.getStatusCode()));
                }
            } catch (Exception e) {
                refused(e.getClass().getSimpleName());
            }
        }

        private void refused(String why) {
            if (warned.compareAndSet(false, true)) {
                log.warn("vendor call failures from {} cannot reach admin-core ({}); they are missing from the "
                        + "health dashboard until this is fixed", clientName, why);
            }
        }
    }
}
