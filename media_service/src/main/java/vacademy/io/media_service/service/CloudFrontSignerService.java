package vacademy.io.media_service.service;

import com.amazonaws.auth.PEM;
import com.amazonaws.services.cloudfront.CloudFrontUrlSigner;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.Date;

/**
 * CloudFront signed URLs for PRIVATE-bucket content (class recordings, private
 * uploads) — the CDN analog of an S3 presigned GET: expiring, unguessable, and
 * validated at the edge against a trusted key group, but served from edge cache
 * so repeat views stop billing S3 data-transfer-out.
 *
 * <p>Disabled unless ALL of {@code cdn.private-base-url},
 * {@code cdn.private.key-pair-id} and {@code cdn.private.private-key-b64} are
 * set and the key parses. When disabled — or if signing ever throws — callers
 * fall back to the S3 presigned URL exactly as before, so enabling/misconfiguring
 * this can never break current users. Blanking CDN_PRIVATE_BASE_URL is the
 * rollback lever.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class CloudFrontSignerService {

    /** Base URL of the CloudFront distribution fronting the private bucket. */
    @Value("${cdn.private-base-url:}")
    private String privateBaseUrl;

    /** Public-key ID from CloudFront Key management (starts with "K..."). */
    @Value("${cdn.private.key-pair-id:}")
    private String keyPairId;

    /**
     * RSA private key matching the CloudFront public key. Accepts either the
     * raw PEM text or (preferred for env vars) the PEM/DER base64-encoded into
     * a single line. PKCS#1 ("BEGIN RSA PRIVATE KEY") and PKCS#8
     * ("BEGIN PRIVATE KEY") both parse.
     */
    @Value("${cdn.private.private-key-b64:}")
    private String privateKeyB64;

    private final CdnUrlService cdnUrlService;

    private PrivateKey privateKey; // null = signing disabled

    @PostConstruct
    void init() {
        if (!StringUtils.hasText(privateBaseUrl) || !StringUtils.hasText(keyPairId)
                || !StringUtils.hasText(privateKeyB64)) {
            log.info("Private-CDN signing disabled (cdn.private-* not fully configured); "
                    + "private files keep using S3 presigned URLs");
            return;
        }
        try {
            privateKey = loadKey(privateKeyB64.trim());
            log.info("Private-CDN signing enabled for {} (key pair {})", privateBaseUrl, keyPairId);
        } catch (Exception e) {
            privateKey = null;
            log.error("Private-CDN signing DISABLED — could not load private key ({}). "
                    + "Falling back to S3 presigned URLs.", e.getMessage());
        }
    }

    private static PrivateKey loadKey(String configured) throws Exception {
        if (configured.startsWith("-----BEGIN")) {
            return PEM.readPrivateKey(new ByteArrayInputStream(configured.getBytes(StandardCharsets.UTF_8)));
        }
        byte[] decoded = Base64.getMimeDecoder().decode(configured);
        String asText = new String(decoded, StandardCharsets.UTF_8);
        if (asText.contains("-----BEGIN")) {
            return PEM.readPrivateKey(new ByteArrayInputStream(decoded));
        }
        // Raw DER, PKCS#8
        return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(decoded));
    }

    public boolean isEnabled() {
        return privateKey != null;
    }

    /**
     * True when a signed CDN URL for this key reaches the private bucket: signing is
     * configured AND the distribution routes the key's prefix to the private origin.
     * Any other private key would hit the public bucket and 404, so callers must fall
     * back to an S3 presigned URL for it.
     */
    public boolean canSign(String objectKey) {
        return isEnabled() && cdnUrlService.isRoutedToPrivateOrigin(objectKey);
    }

    /**
     * Signed CDN URL for a private object, valid until {@code expiresAt}.
     * Canned policy → the signature rides as query params, which the cache
     * policy excludes from the cache key, so every viewer's differently-signed
     * URL still hits the same cached object at the edge.
     */
    public String signedUrl(String objectKey, Date expiresAt) {
        String base = privateBaseUrl.endsWith("/")
                ? privateBaseUrl.substring(0, privateBaseUrl.length() - 1)
                : privateBaseUrl;
        String resourceUrl = base + "/" + cdnUrlService.encodeS3Key(objectKey.trim());
        return CloudFrontUrlSigner.getSignedURLWithCannedPolicy(resourceUrl, keyPairId, privateKey, expiresAt);
    }
}
