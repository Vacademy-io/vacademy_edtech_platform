package vacademy.io.admin_core_service.features.certificate.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateVerificationDto;
import vacademy.io.admin_core_service.features.certificate.service.CertificateVerificationService;

/**
 * Unauthenticated certificate verification — what a scanned QR resolves to.
 *
 * <p>Lives under {@code /admin-core-service/open/**}, the established permitAll
 * prefix (see {@code PublicBookingController}). <b>Adding a path here without
 * adding it to the permitAll list in ApplicationSecurityConfig means it stays
 * behind JWT and every scan hits a login wall.</b>
 *
 * <p>Security posture, since this is reachable by anyone:
 * <ul>
 *   <li>The credential, not the number, is what proves anything. Certificate
 *       numbers are sequential, so number-only lookup would be enumerable.
 *       Either credential is accepted: the QR's long token ({@code ?t=}) or the
 *       barcode's short code ({@code ?c=}).</li>
 *   <li>A bad credential and a non-existent number both return the same 404, so
 *       probing cannot distinguish "wrong token" from "no such certificate".</li>
 *   <li>The response carries no file id, no learner id, and only a masked name.</li>
 * </ul>
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/certificate")
@RequiredArgsConstructor
public class PublicCertificateVerificationController {

    private final CertificateVerificationService verificationService;

    /**
     * The document is <b>admin-authored HTML served on this API's own origin</b> —
     * the only place in this service that returns HTML to a browser at all.
     * Everywhere else a certificate template goes to a PDF, which cannot execute
     * anything.
     *
     * <p>Without a policy, an institute admin could put a {@code <script>} in
     * their verification document and have it run, unauthenticated, on the API
     * origin for every person who scans one of their certificates. That turns
     * "can edit my institute's settings" into "can run script against the host
     * that issues everyone's tokens".
     *
     * <p>So: no scripts, no frames, no form posts, no network of its own. Inline
     * styles and images stay, because they are the entire design — a certificate
     * document is inline CSS plus artwork, and blocking those would render a
     * blank page.
     *
     * <p>Framing is allowed from anywhere. The learner portal that shows this
     * document in an iframe is the institute's own domain — never this API's
     * origin, and there is no fixed list of them — so {@code 'self'} made every
     * browser refuse the frame. There is nothing on the page to click (no script,
     * no form, no link target), so being framed cannot be turned into a
     * clickjack. The matching X-Frame-Options exemption is in
     * ApplicationSecurityConfig.
     */
    private static final String DOCUMENT_CSP = String.join("; ",
            "default-src 'none'",
            "img-src 'self' data: https:",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data: https:",
            "form-action 'none'",
            "base-uri 'none'",
            "frame-ancestors *");

    /**
     * @param certificateId the human-readable number from the certificate
     * @param t             the QR's long token
     * @param c             the barcode's short code; supply either, not both
     */
    @GetMapping("/verify/{certificateId}")
    public ResponseEntity<CertificateVerificationDto> verify(
            @PathVariable String certificateId,
            @RequestParam(name = "t", required = false) String t,
            @RequestParam(name = "c", required = false) String c) {

        // Whichever arrived. verify() tries the value as both credentials, so a
        // scanner app that drops it in the "wrong" parameter still resolves.
        String credential = t != null && !t.isBlank() ? t : c;

        return verificationService.verify(certificateId, credential)
                .map(ResponseEntity::ok)
                // Same response for a wrong token and an unknown number — an
                // attacker must not be able to confirm a number exists.
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(CertificateVerificationDto.builder().valid(false).build()));
    }

    /**
     * Verify from a raw scanned or pasted string, so a barcode scan — which
     * yields text, not a URL a phone can open — has somewhere to go. Also backs
     * the manual-entry box for someone reading a printed certificate.
     *
     * @param q whatever the scanner produced: a verification URL, {@code NUM*CODE},
     *          or a bare short code. A bare certificate number is deliberately
     *          not enough and returns the same 404 as an unknown one.
     */
    @GetMapping("/verify")
    public ResponseEntity<CertificateVerificationDto> verifyScanned(
            @RequestParam(name = "q", required = false) String q) {

        return verificationService.verifyScanned(q)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(CertificateVerificationDto.builder().valid(false).build()));
    }

    /**
     * The institute's designed verification document, tokens filled in.
     *
     * <p>Reached when {@code /verify} answered {@code verificationMode=DOCUMENT}.
     * Guarded by the same credential rule as {@code /verify} — the document names
     * a learner, so a bare certificate number must never fetch it, and an unknown
     * number is answered identically to a wrong credential.
     *
     * <p>Returns HTML rather than JSON because the reader's browser renders it
     * directly. An uploaded PDF never reaches here: it is served straight from
     * media, and {@code /verify} hands out that URL instead.
     */
    @GetMapping(value = "/verify/{certificateId}/document", produces = "text/html; charset=UTF-8")
    public ResponseEntity<String> verificationDocument(
            @PathVariable String certificateId,
            @RequestParam(name = "t", required = false) String t,
            @RequestParam(name = "c", required = false) String c) {

        String credential = t != null && !t.isBlank() ? t : c;

        return verificationService.renderVerificationDocument(certificateId, credential)
                .map(html -> ResponseEntity.ok()
                        .header("Content-Security-Policy", DOCUMENT_CSP)
                        // Without this a browser may sniff past the declared type
                        // and treat the body as something more dangerous.
                        .header("X-Content-Type-Options", "nosniff")
                        // Nothing here is per-user beyond the credential already in
                        // the URL, but it names a learner, so keep it out of shared
                        // caches.
                        .header("Cache-Control", "private, max-age=0, no-store")
                        .body(html))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).build());
    }
}
