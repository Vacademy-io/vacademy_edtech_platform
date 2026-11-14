package vacademy.io.admin_core_service.features.catalog_api.website;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * {@link TxtLookup} over DNS-over-HTTPS JSON: Cloudflare first, Google when Cloudflare fails or
 * has no TXT record at the name (its negative cache may still hold an NXDOMAIN from a Verify
 * clicked before the record was added). 5 s connect and 5 s response timeout per resolver, no
 * redirects, fixed resolver URLs; the queried name is always
 * {@code _vacademy-verification.<normalised host>}.
 */
@Slf4j
@Component
public class DohTxtLookup implements TxtLookup {

    static final String CLOUDFLARE = "https://cloudflare-dns.com/dns-query";
    static final String GOOGLE = "https://dns.google/resolve";
    private static final Duration TIMEOUT = Duration.ofSeconds(5);
    private static final int TYPE_TXT = 16;
    private static final int MAX_BODY_CHARS = 64 * 1024;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(TIMEOUT)
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @Override
    public Result lookupVerificationRecord(String host) {
        // Re-normalise: whatever the caller passed, only the verification name is ever queried.
        String name = WebsiteHosts.verificationRecordName(WebsiteHosts.normalize(host));
        Result first = query(CLOUDFLARE, name);
        if (!first.failed() && !first.values().isEmpty()) {
            return first;
        }
        Result second = query(GOOGLE, name);
        if (second.failed()) {
            return first.failed() ? Result.failure(first.error() + "; " + second.error()) : first;
        }
        return second;
    }

    private Result query(String resolver, String name) {
        String url = resolver + "?name=" + URLEncoder.encode(name, StandardCharsets.UTF_8) + "&type=TXT";
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(TIMEOUT)
                    .header("accept", "application/dns-json")
                    .GET()
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                return Result.failure(resolverName(resolver) + " answered HTTP " + response.statusCode());
            }
            String body = response.body();
            if (body == null || body.length() > MAX_BODY_CHARS) {
                return Result.failure(resolverName(resolver) + " sent an unusable answer");
            }
            return parseDohJson(body, resolverName(resolver));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Result.failure(resolverName(resolver) + " lookup interrupted");
        } catch (Exception e) {
            log.info("website-verify: DoH {} failed for {}: {}", resolverName(resolver), name, e.toString());
            return Result.failure(resolverName(resolver) + " did not answer in time");
        }
    }

    /**
     * Parses a DoH JSON answer. Status 0 (NOERROR) and 3 (NXDOMAIN) are answers; anything else
     * (SERVFAIL, REFUSED, …) is a failure. Only type-16 answers are read (a CNAME chain also
     * lists type-5 entries).
     */
    static Result parseDohJson(String body, String resolver) {
        JsonNode root;
        try {
            root = MAPPER.readTree(body);
        } catch (Exception e) {
            return Result.failure(resolver + " sent invalid JSON");
        }
        if (root == null || !root.isObject()) {
            return Result.failure(resolver + " sent invalid JSON");
        }
        int status = root.path("Status").asInt(-1);
        if (status == 3) {
            return Result.found(List.of());
        }
        if (status != 0) {
            return Result.failure(resolver + " answered DNS status " + status);
        }
        List<String> values = new ArrayList<>();
        JsonNode answers = root.path("Answer");
        if (answers.isArray()) {
            for (JsonNode a : answers) {
                if (a.path("type").asInt() == TYPE_TXT && a.hasNonNull("data")) {
                    values.add(joinTxtData(a.get("data").asText()));
                }
            }
        }
        return Result.found(values);
    }

    /**
     * One TXT record's text. DoH resolvers render it as one or more quoted character-strings
     * ({@code "abc" "def"}; long values are split at 255 bytes) with {@code \"} and {@code \\}
     * escapes; the pieces are joined. Unquoted data (some resolvers) is returned trimmed.
     */
    static String joinTxtData(String data) {
        if (data == null) {
            return "";
        }
        String s = data.trim();
        if (!s.startsWith("\"")) {
            return s;
        }
        StringBuilder out = new StringBuilder();
        boolean inQuotes = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (inQuotes) {
                if (c == '\\' && i + 1 < s.length()) {
                    out.append(s.charAt(++i));
                } else if (c == '"') {
                    inQuotes = false;
                } else {
                    out.append(c);
                }
            } else if (c == '"') {
                inQuotes = true;
            }
            // Whitespace between quoted pieces is not part of the value.
        }
        return out.toString();
    }

    private static String resolverName(String resolver) {
        return resolver.equals(CLOUDFLARE) ? "Cloudflare DNS" : "Google DNS";
    }
}
