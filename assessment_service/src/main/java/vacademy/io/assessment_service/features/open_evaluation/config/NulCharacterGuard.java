package vacademy.io.assessment_service.features.open_evaluation.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.RequestBodyAdviceAdapter;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;

/**
 * Refuses a NUL character (U+0000) anywhere in a partner request body with 422
 * {@code validation_failed} / {@code invalid_characters} naming the JSON field.
 *
 * <p>Postgres stores no 0x00 in text, varchar or jsonb, so a NUL that got past validation
 * failed the transaction at flush as a 500 (live probe 2026-10-02: title, question text,
 * instructions, external_ref, rubric fields, candidate name and external_id). Checking the
 * raw body here covers every {@code @RequestBody} of the partner controllers at once, before
 * any {@code trim()} could silently drop a trailing NUL, and before an {@code Idempotency-Key}
 * is claimed.
 *
 * <p>Cheap on the normal path: a body is parsed a second time only when its bytes contain
 * the JSON escape {@code u0000}. A raw 0x00 byte is not valid JSON and is already a 400
 * {@code malformed_json} from the JSON reader.
 */
@ControllerAdvice(basePackages = "vacademy.io.assessment_service.features.open_evaluation")
public class NulCharacterGuard extends RequestBodyAdviceAdapter {

    public static final String CODE = "invalid_characters";
    private static final byte[] ESCAPE = "u0000".getBytes(StandardCharsets.US_ASCII);
    private static final int MAX_DEPTH = 64;
    private static final char NUL = 0;

    private final ObjectMapper objectMapper;

    public NulCharacterGuard(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public boolean supports(MethodParameter methodParameter, Type targetType,
            Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public HttpInputMessage beforeBodyRead(HttpInputMessage inputMessage, MethodParameter parameter, Type targetType,
            Class<? extends HttpMessageConverter<?>> converterType) throws IOException {
        byte[] body;
        try (InputStream in = inputMessage.getBody()) {
            body = in.readAllBytes();
        }
        reject(body, objectMapper);
        HttpHeaders headers = inputMessage.getHeaders();
        return new HttpInputMessage() {
            @Override
            public InputStream getBody() {
                return new ByteArrayInputStream(body);
            }

            @Override
            public HttpHeaders getHeaders() {
                return headers;
            }
        };
    }

    /** Throws 422 when the JSON body has a NUL in any string value or object key. */
    public static void reject(byte[] body, ObjectMapper mapper) {
        if (body == null || indexOf(body, ESCAPE) < 0) {
            return;
        }
        JsonNode tree;
        try {
            tree = mapper.readTree(body);
        } catch (IOException notJson) {
            return; // left to the JSON reader: 400 malformed_json
        }
        String field = nulField(tree, "", 0);
        if (field != null) {
            String name = field.isEmpty() ? "body" : field;
            throw OpenApiException.validation(name, CODE,
                    name + " contains a NUL character (U+0000), which cannot be stored.");
        }
    }

    /** Path of the first string value or key holding U+0000 ("" for the root), or null. */
    static String nulField(JsonNode node, String path, int depth) {
        if (node == null || depth > MAX_DEPTH) {
            return null;
        }
        if (node.isTextual()) {
            return node.textValue().indexOf(NUL) >= 0 ? path : null;
        }
        if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                String hit = nulField(node.get(i), path + "[" + i + "]", depth + 1);
                if (hit != null) {
                    return hit;
                }
            }
            return null;
        }
        if (node.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> e = fields.next();
                String child = path.isEmpty() ? e.getKey() : path + "." + e.getKey();
                if (e.getKey().indexOf(NUL) >= 0) {
                    return child.replace(String.valueOf(NUL), "\\" + "u0000");
                }
                String hit = nulField(e.getValue(), child, depth + 1);
                if (hit != null) {
                    return hit;
                }
            }
        }
        return null;
    }

    private static int indexOf(byte[] haystack, byte[] needle) {
        outer:
        for (int i = 0; i <= haystack.length - needle.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    continue outer;
                }
            }
            return i;
        }
        return -1;
    }
}
