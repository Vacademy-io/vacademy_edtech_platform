package vacademy.io.common.logging;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Masks sensitive keys in a JSON-shaped object tree (Maps, Lists, primitives, the shapes
 * Jackson's {@code convertValue} produces) before it is written to an audit log.
 *
 * <p>Key names match case-insensitively and ignoring {@code -} and {@code _}, so
 * {@code X-API-Key}, {@code x_api_key} and {@code xApiKey} are one name.
 *
 * <p>Not a bean here: admin_core exposes it as its own {@code PayloadRedactor} component
 * (a subclass), and a second bean of the same simple name in the shared
 * {@code vacademy.io.*} scan would clash. Other services can instantiate it directly or
 * use {@link #shared()}.
 */
public class PayloadRedactor {

    public static final String MASK = "***";

    /** Before normalisation; see {@link #normalize(String)}. */
    private static final List<String> DEFAULT_SENSITIVE_KEYS = List.of(
            "password",
            "pwd",
            "secret",
            "token",
            "accesstoken",
            "refreshtoken",
            "apikey",
            "api_key",
            "otp",
            "pin",
            "cvv",
            "cardnumber",
            "card_number",
            "cardno",
            "ssn",
            "aadhaar",
            "aadhar",
            "authorization",
            // Public API (credentials and signing material partners or we send)
            "x-api-key",
            "webhook_secret",
            "signing_secret",
            "client_secret",
            "signature");

    private static final PayloadRedactor SHARED = new PayloadRedactor();

    private final Set<String> sensitiveKeys;

    public PayloadRedactor() {
        this(Collections.emptySet());
    }

    /** Default names plus {@code extraKeys}. */
    public PayloadRedactor(Collection<String> extraKeys) {
        Set<String> keys = new HashSet<>();
        for (String key : DEFAULT_SENSITIVE_KEYS) {
            keys.add(normalize(key));
        }
        if (extraKeys != null) {
            for (String key : extraKeys) {
                if (key != null) {
                    keys.add(normalize(key));
                }
            }
        }
        this.sensitiveKeys = Collections.unmodifiableSet(keys);
    }

    /** A stateless default instance. */
    public static PayloadRedactor shared() {
        return SHARED;
    }

    /** A redacted copy of {@code input}; the input is not modified. */
    public Object redact(Object input) {
        return redactInternal(input);
    }

    public boolean isSensitive(String key) {
        return key != null && sensitiveKeys.contains(normalize(key));
    }

    private Object redactInternal(Object node) {
        if (node == null) {
            return null;
        }
        if (node instanceof Map<?, ?> map) {
            Map<String, Object> copy = new LinkedHashMap<>(map.size());
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                if (isSensitive(key)) {
                    copy.put(key, MASK);
                } else {
                    copy.put(key, redactInternal(entry.getValue()));
                }
            }
            return copy;
        }
        if (node instanceof Collection<?> col) {
            List<Object> copy = new ArrayList<>(col.size());
            for (Object item : col) {
                copy.add(redactInternal(item));
            }
            return copy;
        }
        return node;
    }

    private static String normalize(String key) {
        return key.toLowerCase(Locale.ROOT).replace("-", "").replace("_", "");
    }
}
