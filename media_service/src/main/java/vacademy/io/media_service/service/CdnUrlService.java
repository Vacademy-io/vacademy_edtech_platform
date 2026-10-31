package vacademy.io.media_service.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.io.ByteArrayOutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Single choke point for building permanent URLs to PUBLIC-bucket objects.
 *
 * <p>When {@code cdn.public-base-url} is set (a CloudFront distribution fronting
 * the public bucket via Origin Access Control), URLs point at the CDN so views
 * are served from edge cache instead of billing S3 data-transfer-out. When the
 * property is blank the legacy raw S3 URL is returned — blanking the env var
 * {@code CDN_PUBLIC_BASE_URL} and redeploying is the rollback lever.
 *
 * <p>Only public, permanent URLs belong here. Private-bucket content (call
 * recordings, PII) keeps using S3 presigned GETs in {@link FileServiceImpl}.
 *
 * <p>The distribution serves the public bucket only, except for the path
 * prefixes in {@code cdn.private-routed-prefixes}, which have their own cache
 * behaviors pointing at the private bucket. There is no fallback from the
 * public bucket to the private one (CloudFront's flat-rate plans don't support
 * origin failover), so a CDN URL works only for an object that is in the public
 * bucket or under one of those prefixes.
 */
@Service
public class CdnUrlService {

    @Value("${cdn.public-base-url:}")
    private String publicBaseUrl;

    @Value("${aws.s3.public-bucket}")
    private String publicBucket;

    /**
     * Key prefixes the distribution routes to the PRIVATE bucket, one cache
     * behavior each (PRIVATE_UPLOAD and ADMIN_UPLOAD also require a signature).
     * Must match the distribution's behaviors.
     */
    @Value("${cdn.private-routed-prefixes:PRIVATE_UPLOAD/,ADMIN_UPLOAD/,BBB_RECORDING/,AI_CALL_RECORDING/}")
    private List<String> privateRoutedPrefixes;

    public boolean isCdnEnabled() {
        return StringUtils.hasText(publicBaseUrl);
    }

    /** True when the distribution serves this key from the private bucket. */
    public boolean isRoutedToPrivateOrigin(String objectKey) {
        if (!StringUtils.hasText(objectKey)) {
            return false;
        }
        String key = objectKey.trim();
        return privateRoutedPrefixes.stream().anyMatch(p -> StringUtils.hasText(p) && key.startsWith(p.trim()));
    }

    /**
     * Permanent URL for an object in the public bucket: CDN when configured,
     * raw S3 otherwise. The key is percent-encoded identically in both cases —
     * CloudFront forwards the encoded path to S3 unchanged, so encoding parity
     * is what keeps the same key resolvable on either host.
     */
    public String publicUrl(String objectKey) {
        return publicUrl(objectKey, publicBucket);
    }

    /**
     * Same as {@link #publicUrl(String)} but with an explicit bucket for the
     * CDN-disabled fallback, for call sites whose pre-CDN behavior served a
     * different bucket's host (e.g. get-public-url historically emitted
     * private-bucket URLs). Keeps the fallback path byte-identical to the
     * legacy URLs, so blanking CDN_PUBLIC_BASE_URL is a true rollback.
     */
    public String publicUrl(String objectKey, String fallbackBucket) {
        String encodedKey = encodeS3Key(objectKey == null ? null : objectKey.trim());
        if (isCdnEnabled()) {
            String base = publicBaseUrl.endsWith("/")
                    ? publicBaseUrl.substring(0, publicBaseUrl.length() - 1)
                    : publicBaseUrl;
            return base + "/" + encodedKey;
        }
        return "https://" + fallbackBucket + ".s3.amazonaws.com/" + encodedKey;
    }

    /**
     * Percent-encodes an S3 object key for safe use in a URL path while keeping
     * the '/' separators intact. URLEncoder targets form encoding, so spaces come
     * back as '+'; we convert those to '%20' for a valid path segment.
     *
     * <p>Each segment is first percent-decoded once (see {@link #safePercentDecode})
     * and then encoded once. This makes the method idempotent: legacy keys that were
     * stored already URL-encoded (e.g. a file name "(90%_mgp_b3)" persisted as
     * "(90%25_mgp_b3)") collapse back to the real S3 object key before re-encoding,
     * so we no longer double-encode '%' into '%2525' and produce a 404 URL. A clean,
     * unencoded key passes through unchanged.
     */
    public String encodeS3Key(String objectKey) {
        if (!StringUtils.hasText(objectKey)) {
            return objectKey;
        }
        String[] segments = objectKey.split("/", -1);
        StringBuilder encoded = new StringBuilder();
        for (int i = 0; i < segments.length; i++) {
            if (i > 0) {
                encoded.append("/");
            }
            encoded.append(URLEncoder.encode(safePercentDecode(segments[i]), StandardCharsets.UTF_8)
                    .replace("+", "%20"));
        }
        return encoded.toString();
    }

    /**
     * Percent-decodes a single path segment, decoding only valid {@code %XX} hex
     * escapes (UTF-8 multibyte sequences included). Unlike {@link java.net.URLDecoder},
     * a literal '+' is preserved instead of becoming a space, and a stray '%' that is
     * not followed by two hex digits is kept verbatim instead of throwing. This lets
     * {@link #encodeS3Key} safely run decode-then-encode on keys that may or may not
     * already be encoded.
     */
    private String safePercentDecode(String segment) {
        if (segment == null || segment.indexOf('%') < 0) {
            return segment; // nothing to decode; keep '+' and everything else verbatim
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(segment.length());
        for (int i = 0; i < segment.length(); i++) {
            char ch = segment.charAt(i);
            if (ch == '%' && i + 2 < segment.length()
                    && isHex(segment.charAt(i + 1)) && isHex(segment.charAt(i + 2))) {
                out.write((Character.digit(segment.charAt(i + 1), 16) << 4)
                        + Character.digit(segment.charAt(i + 2), 16));
                i += 2;
            } else {
                byte[] bytes = String.valueOf(ch).getBytes(StandardCharsets.UTF_8);
                out.write(bytes, 0, bytes.length);
            }
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private boolean isHex(char c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    }
}
