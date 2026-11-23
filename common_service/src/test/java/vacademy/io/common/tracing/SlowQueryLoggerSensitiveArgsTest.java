package vacademy.io.common.tracing;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import vacademy.io.common.health.service.SlowQueryRegistry;

import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The slow-call line keeps sensitive arguments out of logs: an argument is masked by its parameter
 * name (pin, rawPin, pan, panEncrypted, panHash, or a name holding secret / password / token) and a
 * commerce field-cipher value ({@code cfc1:}) is masked by its shape. Other arguments print as before.
 * Runs the real aspect over a proxied bean with a 0 ms threshold, so every call is logged.
 */
class SlowQueryLoggerSensitiveArgsTest {

    private static final String PIN = "246810";
    private static final String CIPHER_VALUE = "cfc1:k1:AAAAsyntheticCipherValueForTestsOnlyBBBB";
    private static final String HASH = "ab".repeat(32);

    private ListAppender<ILoggingEvent> appender;
    private Logger logbackLogger;

    @BeforeEach
    void captureLog() {
        logbackLogger = (Logger) LoggerFactory.getLogger(SlowQueryLogger.class);
        appender = new ListAppender<>();
        appender.start();
        logbackLogger.addAppender(appender);
    }

    @AfterEach
    void releaseLog() {
        logbackLogger.detachAppender(appender);
    }

    private <T> T proxied(T target) {
        TracingProperties props = new TracingProperties();
        props.setSlowQueryThresholdMs(0);
        props.setCriticalQueryThresholdMs(Long.MAX_VALUE);
        SlowQueryLogger aspect = new SlowQueryLogger();
        setField(aspect, "tracingProperties", props);
        setField(aspect, "slowQueryRegistry", new SlowQueryRegistry());
        AspectJProxyFactory factory = new AspectJProxyFactory(target);
        factory.setProxyTargetClass(true);
        factory.addAspect(aspect);
        return factory.getProxy();
    }

    private static void setField(Object target, String name, Object value) {
        try {
            java.lang.reflect.Field field = target.getClass().getDeclaredField(name);
            field.setAccessible(true);
            field.set(target, value);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    private String logged() {
        return appender.list.stream().map(ILoggingEvent::getFormattedMessage).collect(Collectors.joining("\n"));
    }

    @Test
    void slowServiceCallWithRawPinLogsNoPin() {
        SampleApprovalService service = proxied(new SampleApprovalService());
        service.approve("inst-1", null, "user-1", "user-1", PIN, "PERIOD_UNLOCK");
        service.setPin("inst-1", "user-1", PIN);

        String out = logged();
        assertEquals(2, appender.list.size(), out);
        assertFalse(out.contains(PIN), "the PIN must not be logged");
        assertTrue(out.contains("\"inst-1\"") && out.contains("\"PERIOD_UNLOCK\""), "other arguments still print");
    }

    @Test
    void slowRepositoryCallWithCipherValueAndHashLogsNeither() {
        SampleSecretRepository repository = proxied(new SampleSecretRepository());
        repository.upsert("row-1", "inst-1", "sup-1", CIPHER_VALUE, "k1", HASH, "1234", "user-1");

        String out = logged();
        assertEquals(1, appender.list.size(), out);
        assertFalse(out.contains("cfc1:"), "no cipher value");
        assertFalse(out.contains(HASH.substring(0, 16)), "no keyed-hash prefix");
        assertTrue(out.contains("\"sup-1\""), "other arguments still print");
    }

    @Test
    void cipherValueUnderANeutralNameIsMaskedByShape() {
        SampleSecretRepository repository = proxied(new SampleSecretRepository());
        repository.store(CIPHER_VALUE);
        assertFalse(logged().contains("cfc1:"));
        assertEquals("\"***\"", new SlowQueryLogger().formatArg(CIPHER_VALUE));
    }

    @Test
    void namesHoldingSecretPasswordOrTokenAreMasked() {
        SampleApprovalService service = proxied(new SampleApprovalService());
        service.connect("plain-value-1", "plain-value-2", "plain-value-3", "visible-value");
        String out = logged();
        assertFalse(out.contains("plain-value"), out);
        assertTrue(out.contains("\"visible-value\""), out);
    }
}

/** Matches the service pointcut; parameter names come from the class file (-parameters). */
class SampleApprovalService {
    public String approve(String instituteId, String locationId, String requestedBy, String approverUserId,
                          String rawPin, String action) {
        return "ok";
    }

    public void setPin(String instituteId, String userId, String pin) {
    }

    public void connect(String clientSecret, String dbPassword, String refreshToken, String label) {
    }
}

/** Matches the repository pointcut. */
class SampleSecretRepository {
    public int upsert(String id, String instituteId, String supplierId, String panEncrypted, String keyId,
                      String panHash, String panLast4, String updatedBy) {
        return 1;
    }

    public void store(String value) {
    }
}
