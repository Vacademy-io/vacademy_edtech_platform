package vacademy.io.common.external;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * The build guard behind "no failed vendor call goes unrecorded": each service's test runs
 * {@link #unrecorded(Path)} over its sources and fails on any file that talks to an integrated
 * vendor (names one of its hosts, reads its address from a setting, or uses its SDK) without
 * calling {@link VendorCallLog#failed}.
 *
 * <p>A file that names a vendor but makes no call itself (a DTO, a constants class, a client
 * whose failures another class records) says so in a comment:
 * {@code // vendor-call-log: recorded in PlivoHttpClient}.
 */
public final class VendorCallCoverage {

    public static final String MARKER = "vendor-call-log:";

    private static final Pattern HOST = Pattern.compile("(?i)[a-z0-9-]+(?:\\.[a-z0-9-]+)+");
    private static final Pattern BLOCK_COMMENT = Pattern.compile("(?s)/\\*.*?\\*/");
    private static final Pattern LINE_COMMENT = Pattern.compile("(?m)(^|[^:\"])//.*$");

    /** Vendor SDKs that make the HTTP calls themselves. */
    private static final List<String> SDK_IMPORTS = List.of(
            "import com.razorpay.", "import com.stripe.", "import com.google.firebase.messaging.",
            "import com.amazonaws.services.simpleemail.", "import software.amazon.awssdk.services.ses.",
            "import software.amazon.awssdk.services.sesv2.", "import org.springframework.mail.javamail.");

    /**
     * Vendors whose address comes from configuration: a {@code @Value} key naming one of these
     * and an address ("telephony.plivo.base-url", "meta.whatsapp.api.base.url") marks a client.
     */
    private static final java.util.Set<String> VENDOR_WORDS = java.util.Set.of(
            "plivo", "exotel", "aavtaar", "airtel", "vonage", "razorpay", "cashfree", "stripe", "phonepe",
            "paypal", "eway", "wati", "whatsapp", "meta", "facebook", "zoom", "zoho", "google", "youtube",
            "firebase", "github", "cloudflare", "fx", "openrouter", "isoquant", "sarvam", "anthropic", "openai",
            "gemini", "mathpix", "docconverter", "cloudconvert", "serper", "fal", "runpod", "deepseek",
            "pexels", "pixabay");
    private static final java.util.Set<String> ADDRESS_WORDS = java.util.Set.of(
            "url", "uri", "base", "baseurl", "endpoint", "host", "api");
    /** Our own addresses a vendor sends people or events back to, not the vendor's. */
    private static final java.util.Set<String> OWN_ADDRESS_WORDS = java.util.Set.of(
            "redirect", "callback", "return", "webhook", "frontend");
    private static final Pattern VALUE_KEY = Pattern.compile("@Value\\(\"\\$\\{([A-Za-z0-9._-]+)");

    private VendorCallCoverage() {
    }

    /** Files under {@code root} (a service's src/main/java) that call a vendor and record nothing. */
    public static List<String> unrecorded(Path root) throws IOException {
        List<String> out = new ArrayList<>();
        try (Stream<Path> files = Files.walk(root)) {
            for (Path p : (Iterable<Path>) files.filter(f -> f.toString().endsWith(".java"))::iterator) {
                String src = Files.readString(p, StandardCharsets.UTF_8);
                String why = vendorUse(src);
                if (why != null && !records(src)) out.add(root.relativize(p) + " (" + why + ")");
            }
        }
        return out;
    }

    /** True when the file records failures, or says why it does not need to. */
    static boolean records(String src) {
        return src.contains("VendorCallLog.failed(") || src.contains(MARKER);
    }

    /** What makes this file a vendor client: a vendor host or SDK; null when it is not one. */
    static String vendorUse(String src) {
        String code = LINE_COMMENT.matcher(BLOCK_COMMENT.matcher(src).replaceAll("")).replaceAll("$1");
        for (String sdk : SDK_IMPORTS) {
            if (code.contains(sdk)) return sdk.substring("import ".length(), sdk.length() - 1);
        }
        if (code.contains("package vacademy.io.common.external;")) return null;
        Matcher k = VALUE_KEY.matcher(code);
        while (k.find()) {
            List<String> parts = List.of(k.group(1).toLowerCase(java.util.Locale.ROOT).split("[._-]"));
            if (parts.stream().anyMatch(VENDOR_WORDS::contains) && parts.stream().anyMatch(ADDRESS_WORDS::contains)
                    && parts.stream().noneMatch(OWN_ADDRESS_WORDS::contains)) {
                return "${" + k.group(1) + "}";
            }
        }
        // Anywhere in the code, not only inside "...": pairing quotes breaks on a '"' char literal.
        Matcher h = HOST.matcher(code);
        while (h.find()) {
            if (IntegratedVendors.isIntegrated(h.group())) return h.group();
        }
        return null;
    }
}
