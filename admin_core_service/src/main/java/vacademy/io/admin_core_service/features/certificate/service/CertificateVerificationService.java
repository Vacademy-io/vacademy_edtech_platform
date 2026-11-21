package vacademy.io.admin_core_service.features.certificate.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.certificate.dto.CertificateVerificationDto;
import vacademy.io.admin_core_service.features.certificate.entity.IssuedCertificate;
import vacademy.io.admin_core_service.features.certificate.repository.IssuedCertificateRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Optional;

/**
 * Public certificate verification: turning a scanned QR into a page that proves
 * a certificate is genuine, without a login.
 *
 * <p><b>Why a token.</b> Certificate numbers are sequential and human-readable
 * by design ({@code EDU2026001}, {@code EDU2026002}…). A public lookup keyed on
 * the number alone would be trivially enumerable — one certificate would let
 * anyone walk the sequence and harvest every learner name and course in the
 * institute. So each certificate carries a random 128-bit token, and the public
 * endpoint requires the number <em>and</em> the token.
 *
 * <p><b>Two credentials, one rule.</b> The QR carries the full 128-bit token in
 * a URL. A barcode cannot — Code 128 spends ~11 modules per character, so the
 * token would need a barcode ~76mm wide to stay scannable. Barcodes therefore
 * carry a 10-character {@link #newShortCode() short code} instead. Both are
 * accepted; neither the number alone nor a wrong credential resolves anything.
 *
 * <p><b>What is disclosed.</b> Deliberately minimal, because anyone holding the
 * link can see it: institute, course, issue date, and the learner's name
 * <em>masked</em>. Enough for an employer to confirm a claim; not enough to be
 * worth scraping. The file id is never exposed — {@code media-service} can turn
 * any file id into a permanent, non-expiring public URL.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CertificateVerificationService {

    private final IssuedCertificateRepository issuedCertificateRepository;
    private final InstituteRepository instituteRepository;
    private final AuthService authService;

    /**
     * Shrinks long values to their boxes on the verification document, the same
     * way issued certificates are fitted. Stateless, so built here rather than
     * injected — an initialised final field stays out of the generated
     * constructor that the verification tests call directly.
     */
    private final CertificateTextFitService textFitService = new CertificateTextFitService();
    /**
     * Deliberately NOT a constructor dependency.
     *
     * <p>{@code @RequiredArgsConstructor} only takes final fields, so making this
     * final would widen the generated constructor and break every existing caller
     * — three verification tests construct this service directly with three
     * arguments. Field injection keeps that constructor exactly as it was, and
     * this is only needed for the one optional path that serves an uploaded PDF.
     *
     * <p>Consequently it can be null (in those tests, or if the bean is absent),
     * so every use must be null-guarded.
     */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private vacademy.io.admin_core_service.features.media_service.service.MediaService mediaService;

    /** Shared: ObjectMapper is thread-safe once configured, and these are read-only parses. */
    private static final com.fasterxml.jackson.databind.ObjectMapper OBJECT_MAPPER =
            new com.fasterxml.jackson.databind.ObjectMapper();

    static final String PAGE_MODE = "PAGE";
    static final String DOCUMENT_MODE = "DOCUMENT";
    static final String PDF_DOCUMENT = "PDF";

    private static final SecureRandom RANDOM = new SecureRandom();
    /** 16 bytes → 128 bits, url-safe base64 → 22 chars. Not guessable. */
    private static final int TOKEN_BYTES = 16;

    /**
     * Crockford base32, which drops I, L, O and U. The short code is printed in
     * a human-readable form beside the barcode and gets read aloud and retyped,
     * so an alphabet where 1/I/l and 0/O are distinct matters more here than the
     * two bits per character it costs.
     */
    private static final char[] SHORT_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toCharArray();
    /** 10 chars × 5 bits = 50 bits. See the class javadoc for why that's enough. */
    private static final int SHORT_CODE_LENGTH = 10;

    /**
     * Separator between the number and the short code inside a barcode payload.
     * {@code *} is in Code 128's character set, is not produced by any numbering
     * pattern ({@link CertificateNumberService} emits {@code -}, {@code /} and
     * {@code _}), and survives a copy-paste out of a scanner app unmangled.
     */
    public static final String BARCODE_SEPARATOR = "*";

    public String newVerificationToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** The barcode's credential — see {@link #newVerificationToken()} for the QR's. */
    public String newShortCode() {
        StringBuilder out = new StringBuilder(SHORT_CODE_LENGTH);
        for (int i = 0; i < SHORT_CODE_LENGTH; i++) {
            out.append(SHORT_CODE_ALPHABET[RANDOM.nextInt(SHORT_CODE_ALPHABET.length)]);
        }
        return out.toString();
    }

    /**
     * What a verifying barcode encodes: {@code <number>*<code>}.
     *
     * <p>The number is included even though the short code alone would resolve,
     * because a scan that yields the number lets a human cross-check it against
     * the number printed on the certificate. A barcode carrying only an opaque
     * code proves nothing to someone comparing the two by eye.
     *
     * @return null when there is no short code (legacy certificate); the caller
     *         then falls back to encoding the bare number
     */
    public String buildBarcodePayload(String certificateId, String shortCode) {
        if (!StringUtils.hasText(certificateId) || !StringUtils.hasText(shortCode)) {
            return null;
        }
        return certificateId.trim() + BARCODE_SEPARATOR + shortCode.trim();
    }

    /**
     * The URL a QR should encode, on the institute's own learner portal so a
     * white-labelled school sends its graduates to its own domain rather than
     * ours — e.g. {@code https://student.edustream.ae/verify/EDU2026001?t=…}.
     *
     * @return null when there is no token (legacy certificate) or no portal
     *         configured; the caller then falls back to encoding the number
     */
    public String buildVerificationUrl(Institute institute, String certificateId, String token) {
        if (!StringUtils.hasText(certificateId) || !StringUtils.hasText(token)) {
            return null;
        }
        String host = institute != null ? institute.getLearnerPortalBaseUrl() : null;
        if (!StringUtils.hasText(host)) {
            return null;
        }
        String base = host.trim().replaceFirst("/+$", "");
        if (!base.startsWith("http://") && !base.startsWith("https://")) {
            base = "https://" + base;
        }
        // Percent-encode the number: numbering patterns allow `/`, and an
        // unencoded `EDU/2026/001` would turn one path segment into three and
        // miss the verification route entirely. `+` means a literal plus in a
        // path, not a space, so the encoder's `+` has to become `%20`.
        String encodedId = java.net.URLEncoder
                .encode(certificateId.trim(), java.nio.charset.StandardCharsets.UTF_8)
                .replace("+", "%20");
        return base + "/verify/" + encodedId + "?t=" + token;
    }

    /**
     * Resolve a certificate for public display. The number plus <em>either</em>
     * credential — the QR's long token or the barcode's short code — must match;
     * a wrong or missing credential is indistinguishable from a number that does
     * not exist, so probing reveals nothing.
     *
     * <p>The two are tried in turn rather than being told apart by shape: the
     * caller does not always know which one it was handed (a pasted string from
     * a scanner app could be either), and a length check would be a guess.
     */
    public Optional<CertificateVerificationDto> verify(String certificateId, String credential) {
        if (!StringUtils.hasText(certificateId) || !StringUtils.hasText(credential)) {
            return Optional.empty();
        }
        String number = certificateId.trim();
        String secret = credential.trim();

        return issuedCertificateRepository.findByCertificateIdAndVerificationToken(number, secret)
                .or(() -> issuedCertificateRepository.findByCertificateIdAndShortCode(number, secret))
                .map(this::toDto);
    }

    /**
     * Verification from a raw scanned or pasted string — the entry point behind
     * the public "paste what you scanned" box, and what makes a barcode scan
     * verifiable at all.
     *
     * <p>Accepts, in order:
     * <ul>
     *   <li>a full verification URL ({@code https://…/verify/NUM?t=TOKEN}, or
     *       {@code ?c=CODE}) — what a QR scanner hands over;</li>
     *   <li>{@code NUM*CODE} — what a verifying barcode encodes;</li>
     *   <li>a bare short code — a barcode printed without its number.</li>
     * </ul>
     *
     * <p>A bare certificate number deliberately resolves to empty. It is the
     * enumerable half (see the class javadoc), so accepting it here would
     * reintroduce exactly the harvesting hole the token exists to close.
     */
    public Optional<CertificateVerificationDto> verifyScanned(String raw) {
        if (!StringUtils.hasText(raw)) {
            return Optional.empty();
        }
        String scanned = raw.trim();

        // A URL from a QR scanner. Parsed by hand rather than with URI, because
        // scanner apps hand over strings URI rejects (stray whitespace, missing
        // scheme) and a parse failure here would read to the user as "fake".
        int verifyAt = scanned.lastIndexOf("/verify/");
        if (verifyAt >= 0) {
            // Drop any fragment first. It is never part of the credential, and
            // leaving it attached turns a genuine scan into a failed one — some
            // scanner apps append one.
            String tail = scanned.substring(verifyAt + "/verify/".length()).replaceFirst("#.*$", "");
            String number = tail;
            String credential = null;
            int query = tail.indexOf('?');
            if (query >= 0) {
                number = tail.substring(0, query);
                for (String pair : tail.substring(query + 1).split("&")) {
                    int eq = pair.indexOf('=');
                    if (eq <= 0) continue;
                    String key = pair.substring(0, eq);
                    if ("t".equals(key) || "c".equals(key)) {
                        credential = urlDecode(pair.substring(eq + 1));
                        break;
                    }
                }
            }
            // Only a *trailing* slash is noise. Interior slashes are not:
            // numbering patterns allow `/`, so `EDU/2026/001` is a legitimate
            // certificate number and truncating at the first slash would make
            // every certificate at such an institute unverifiable.
            number = urlDecode(number.replaceFirst("/+$", ""));
            Optional<CertificateVerificationDto> byUrl = verify(number, credential);
            if (byUrl.isPresent()) {
                return byUrl;
            }
            // Fall through: the string looked like a URL but didn't resolve. It
            // could still be a compound code containing a slash, so keep trying.
        }

        int sep = scanned.indexOf(BARCODE_SEPARATOR);
        if (sep > 0 && sep < scanned.length() - 1) {
            return verify(scanned.substring(0, sep), scanned.substring(sep + 1));
        }

        // A bare short code. Shape-guarded so a URL that failed to resolve above
        // isn't handed to the database whole as a "code".
        if (scanned.matches("[A-Za-z0-9]{6,32}")) {
            return issuedCertificateRepository.findByShortCode(scanned).map(this::toDto);
        }
        return Optional.empty();
    }

    private static String urlDecode(String value) {
        try {
            return java.net.URLDecoder.decode(value, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            return value;
        }
    }

    private CertificateVerificationDto toDto(IssuedCertificate certificate) {
        // One lookup for the whole institute rather than one per field: the
        // page needs its branding as well as its name, and two round trips to
        // the same row on a public endpoint is a free way to make a scan slower.
        Institute institute = instituteRepository.findById(certificate.getInstituteId())
                .orElse(null);

        // Parsed once and shared by every settings read below.
        com.fasterxml.jackson.databind.JsonNode certificateConfig = readCertificateConfig(institute);

        // Masked unless the institute opted in to full details. The opt-in is
        // the only way the username and email ever reach this public response.
        boolean fullDetails = Boolean.TRUE.equals(readFlag(certificateConfig, "verificationShowFullDetails"));
        UserDTO learner = resolveLearner(certificate.getUserId());
        String fullName = learner != null && learner.getFullName() != null ? learner.getFullName().trim() : "";

        CertificateVerificationDto.CertificateVerificationDtoBuilder builder = CertificateVerificationDto.builder()
                .valid(true)
                .certificateId(certificate.getCertificateId())
                .instituteName(institute != null ? institute.getInstituteName() : "")
                // Branding travels with the response so the page renders as the
                // institute's own on whatever domain the scan landed on. See
                // the field docs on CertificateVerificationDto.
                .instituteLogoFileId(institute != null ? institute.getLogoFileId() : null)
                .instituteThemeCode(institute != null ? institute.getInstituteThemeCode() : null)
                .instituteWebsite(institute != null ? institute.getWebsiteUrl() : null)
                .instituteNote(readSetting(certificateConfig, "verificationNote"))
                .headline(readSetting(certificateConfig, "verificationHeadline"))
                .showCourse(readFlag(certificateConfig, "verificationShowCourse"))
                .showIssueDate(readFlag(certificateConfig, "verificationShowIssueDate"))
                .showCompletion(readFlag(certificateConfig, "verificationShowCompletion"))
                .courseName(certificate.getCourseName())
                .issuedAt(certificate.getIssuedAt())
                .completionPercentage(certificate.getCompletionPercentage())
                .learnerName(fullDetails ? fullName : maskName(fullName))
                .verificationMode(resolveVerificationMode(certificateConfig))
                .documentType(resolveDocumentType(certificateConfig))
                .documentUrl(resolveDocumentUrl(certificateConfig, certificate));
        if (fullDetails && learner != null) {
            builder.learnerUsername(learner.getUsername())
                    .learnerFirstName(firstName(fullName))
                    .learnerLastName(lastName(fullName))
                    .learnerEmail(learner.getEmail());
        }
        return builder.build();
    }

    /** First word of the full name — "Alex Sample" → "Alex". */
    static String firstName(String fullName) {
        if (!StringUtils.hasText(fullName)) {
            return "";
        }
        return fullName.trim().split("\\s+")[0];
    }

    /**
     * Last word of the full name, or empty for a one-word name — "Alex Q Sample"
     * → "Sample". Middle names belong to neither, matching how a record split
     * into first/last name is usually filled in.
     */
    static String lastName(String fullName) {
        if (!StringUtils.hasText(fullName)) {
            return "";
        }
        String[] parts = fullName.trim().split("\\s+");
        return parts.length > 1 ? parts[parts.length - 1] : "";
    }

    /**
     * {@code DOCUMENT} only when the institute both asked for it and actually has
     * something to serve; {@code PAGE} otherwise.
     *
     * <p>Resolved server-side on purpose. A half-configured institute — mode
     * switched over, document never designed — must still verify, and the client
     * should not have to encode that rule.
     */
    static String resolveVerificationMode(com.fasterxml.jackson.databind.JsonNode config) {
        if (!DOCUMENT_MODE.equalsIgnoreCase(readSetting(config, "verificationMode"))) {
            return PAGE_MODE;
        }
        return hasDocument(config) ? DOCUMENT_MODE : PAGE_MODE;
    }

    /** {@code PDF}/{@code HTML} when a document will be served, else null. */
    private static String resolveDocumentType(com.fasterxml.jackson.databind.JsonNode config) {
        if (!DOCUMENT_MODE.equals(resolveVerificationMode(config))) {
            return null;
        }
        return PDF_DOCUMENT.equalsIgnoreCase(readSetting(config, "verificationDocumentType"))
                ? PDF_DOCUMENT : "HTML";
    }

    /** Whether there is a document to serve, of whichever type is configured. */
    private static boolean hasDocument(com.fasterxml.jackson.databind.JsonNode config) {
        if (PDF_DOCUMENT.equalsIgnoreCase(readSetting(config, "verificationDocumentType"))) {
            return StringUtils.hasText(readSetting(config, "verificationDocumentFileId"));
        }
        return StringUtils.hasText(readSetting(config, "verificationDocumentHtml"));
    }

    /**
     * Where the client should send the reader, or null to render the page.
     *
     * <p>An uploaded PDF is served straight from media; designed HTML goes
     * through this service so the tokens are substituted against the credential
     * the reader actually presented. The credential is carried on the URL for
     * the same reason it is required on {@code /verify}: the document names a
     * learner, so a bare certificate number must never fetch it.
     */
    private String resolveDocumentUrl(com.fasterxml.jackson.databind.JsonNode config, IssuedCertificate certificate) {
        if (!DOCUMENT_MODE.equals(resolveVerificationMode(config))) {
            return null;
        }
        if (PDF_DOCUMENT.equalsIgnoreCase(readSetting(config, "verificationDocumentType"))) {
            String fileId = readSetting(config, "verificationDocumentFileId");
            return StringUtils.hasText(fileId) ? mediaFileUrl(fileId) : null;
        }
        // A path on this API, deliberately not an absolute URL. The scan lands on
        // whichever learner portal the institute configured, so there is no single
        // correct host to bake in here — the client prefixes the same API base it
        // already used to call /verify. documentType tells it this is the case.
        return "/admin-core-service/open/v1/certificate/verify/"
                + urlEncode(certificate.getCertificateId()) + "/document";
    }

    /**
     * Render the institute's designed verification document for one certificate.
     *
     * <p>Requires the same credential as {@link #verify}: the document names a
     * learner, so a bare certificate number must not fetch it. An unknown number
     * and a wrong credential both come back empty, exactly as on the page.
     *
     * <p><b>The token values are taken from the verification DTO, not from the
     * certificate row.</b> That is the whole privacy guarantee: the page masks
     * the learner's name, and building the document from the same object means
     * it cannot print more than the page already shows. Reading the raw row here
     * would quietly turn a public URL into a full-name disclosure.
     *
     * @return the substituted HTML, or empty when the credential does not
     *         resolve or the institute has no HTML document configured
     */
    public Optional<String> renderVerificationDocument(String certificateId, String credential) {
        if (!StringUtils.hasText(certificateId) || !StringUtils.hasText(credential)) {
            return Optional.empty();
        }
        String number = certificateId.trim();
        String secret = credential.trim();

        // Resolved through the same credential-checked lookup as verify(). There
        // is deliberately no findByCertificateId on the repository — numbers are
        // sequential, so a number-only lookup would make the whole institute
        // enumerable. Adding one for convenience here would reopen exactly that.
        Optional<IssuedCertificate> found =
                issuedCertificateRepository.findByCertificateIdAndVerificationToken(number, secret)
                        .or(() -> issuedCertificateRepository.findByCertificateIdAndShortCode(number, secret));
        if (found.isEmpty()) {
            return Optional.empty();
        }
        CertificateVerificationDto dto = toDto(found.get());

        Institute institute = instituteRepository.findById(found.get().getInstituteId()).orElse(null);
        com.fasterxml.jackson.databind.JsonNode config = readCertificateConfig(institute);

        // A PDF document is served straight from media; there is nothing to
        // substitute into it, so this endpoint has no answer for that mode.
        if (PDF_DOCUMENT.equalsIgnoreCase(readSetting(config, "verificationDocumentType"))) {
            return Optional.empty();
        }

        String template = readSetting(config, "verificationDocumentHtml");
        if (!StringUtils.hasText(template)) {
            return Optional.empty();
        }
        // Fitted after substitution, as on the certificate: only the real value
        // says whether it fits. A no-op for documents without data-fit fields.
        return Optional.of(textFitService.fitTemplate(substituteVerificationTokens(template, dto)));
    }

    /**
     * Fill the verification document's tokens from what the page would show.
     *
     * <p>The token names match the certificate editor's, so a field dragged onto
     * a certificate behaves the same when dragged onto a verification document.
     * Anything left unresolved is blanked rather than printed raw — the same
     * rule the certificate renderer applies, and it matters more here because
     * this page is public.
     */
    String substituteVerificationTokens(String template, CertificateVerificationDto dto) {
        java.util.Map<String, String> values = new java.util.LinkedHashMap<>();
        values.put("STUDENT_NAME", nullToEmpty(dto.getLearnerName()));
        values.put("CERTIFICATE_ID", nullToEmpty(dto.getCertificateId()));
        values.put("INSTITUTE_NAME", nullToEmpty(dto.getInstituteName()));
        values.put("COURSE_NAME", nullToEmpty(dto.getCourseName()));
        values.put("VERIFICATION_HEADLINE", nullToEmpty(dto.getHeadline()));
        values.put("VERIFICATION_NOTE", nullToEmpty(dto.getInstituteNote()));
        values.put("DATE_OF_COMPLETION", dto.getIssuedAt() == null ? ""
                : new java.text.SimpleDateFormat("dd MMM yyyy").format(dto.getIssuedAt()));
        values.put("COMPLETION_PERCENTAGE", dto.getCompletionPercentage() == null ? ""
                : dto.getCompletionPercentage() + "%");
        // Empty unless the institute opted in to full details — see toDto.
        values.put("USERNAME", nullToEmpty(dto.getLearnerUsername()));
        values.put("FIRST_NAME", nullToEmpty(dto.getLearnerFirstName()));
        values.put("LAST_NAME", nullToEmpty(dto.getLearnerLastName()));
        values.put("EMAIL", nullToEmpty(dto.getLearnerEmail()));

        String out = template;
        for (java.util.Map.Entry<String, String> entry : values.entrySet()) {
            out = out.replace("{{" + entry.getKey() + "}}", entry.getValue());
        }
        // Blank any token this document carries that verification has no value
        // for — an unresolved {{TOKEN}} printed literally on a public page reads
        // as a broken record rather than a verified one.
        return out.replaceAll("\\{\\{[A-Z0-9_]+}}", "");
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    /**
     * A permanent public URL for an uploaded verification PDF.
     *
     * <p>Non-expiring deliberately: the QR is printed on a physical certificate
     * that may be scanned years later, and a signed URL with a lifetime would
     * turn every one of those into a dead link.
     */
    private String mediaFileUrl(String fileId) {
        if (mediaService == null) {
            return null;   // see the field docs: optional, so the page is the fallback
        }
        try {
            return mediaService.getFilePublicUrlByIdWithoutExpiry(fileId);
        } catch (Exception e) {
            // Falling back to the page beats showing a broken document.
            log.warn("Could not resolve the verification document url for file {}", fileId, e);
            return null;
        }
    }

    /**
     * Percent-encode a certificate number for use as a path segment.
     *
     * <p>Numbering patterns allow {@code /}, so an unencoded {@code EDU/2026/001}
     * would split one segment into three and miss the route. {@code +} means a
     * literal plus in a path rather than a space, so it has to become {@code %20}.
     */
    private static String urlEncode(String value) {
        return java.net.URLEncoder
                .encode(value == null ? "" : value.trim(), java.nio.charset.StandardCharsets.UTF_8)
                .replace("+", "%20");
    }

    /**
     * The institute's COURSE_COMPLETION certificate config, parsed once.
     *
     * <p>Every {@code readVerificationSetting} call used to re-parse the whole
     * settings blob with a fresh ObjectMapper. That blob is large — tens of
     * kilobytes for an institute with a designed template — and this is a
     * public, unauthenticated endpoint, so parsing it a dozen times per scan is
     * an amplification worth avoiding. Read it once and pass the node down.
     *
     * @return the config node, or null when absent or malformed
     */
    private com.fasterxml.jackson.databind.JsonNode readCertificateConfig(Institute institute) {
        String settingJson = institute != null ? institute.getSetting() : null;
        if (!StringUtils.hasText(settingJson)) {
            return null;
        }
        try {
            com.fasterxml.jackson.databind.JsonNode entries = OBJECT_MAPPER.readTree(settingJson)
                    .path("setting").path("CERTIFICATE_SETTING").path("data").path("data");
            if (entries.isArray()) {
                for (com.fasterxml.jackson.databind.JsonNode config : entries) {
                    if ("COURSE_COMPLETION".equals(config.path("key").asText(null))) {
                        return config;
                    }
                }
            }
        } catch (Exception e) {
            // Same posture as before: a malformed blob means defaults, never a
            // failed verification.
            log.warn("Could not read certificate settings for institute {}",
                    institute != null ? institute.getId() : null, e);
        }
        return null;
    }

    /** One string field off an already-parsed config node. */
    private static String readSetting(com.fasterxml.jackson.databind.JsonNode config, String field) {
        if (config == null) {
            return null;
        }
        com.fasterxml.jackson.databind.JsonNode value = config.path(field);
        if (value.isMissingNode() || value.isNull()) {
            return null;
        }
        String text = value.asText(null);
        return StringUtils.hasText(text) ? text.trim() : null;
    }

    /** One boolean flag off an already-parsed config node; null when unset. */
    private static Boolean readFlag(com.fasterxml.jackson.databind.JsonNode config, String field) {
        if (config == null) {
            return null;
        }
        com.fasterxml.jackson.databind.JsonNode value = config.path(field);
        return value.isBoolean() ? value.asBoolean() : null;
    }

    /**
     * The institute's own line for this page, from its certificate settings.
     *
     * <p>Read here rather than passed in because verification is reached from
     * two entry points and both must show the same page. A malformed settings
     * blob means no note, never a failed verification — this is decoration on a
     * page whose job is to answer a yes/no question.
     */
    private String readVerificationSetting(Institute institute, String field) {
        com.fasterxml.jackson.databind.JsonNode value = readVerificationNode(institute, field);
        if (value == null) {
            return null;
        }
        String text = value.asText(null);
        return StringUtils.hasText(text) ? text.trim() : null;
    }

    /** Null when unset, so the page can tell "off" from "never configured". */
    private Boolean readVerificationFlag(Institute institute, String field) {
        com.fasterxml.jackson.databind.JsonNode value = readVerificationNode(institute, field);
        return value != null && value.isBoolean() ? value.asBoolean() : null;
    }

    /**
     * One field off the institute's certificate settings.
     *
     * <p>A malformed settings blob means the page falls back to its defaults,
     * never a failed verification: this is presentation on a page whose job is
     * to answer a yes/no question about a document someone is holding.
     */
    private com.fasterxml.jackson.databind.JsonNode readVerificationNode(Institute institute, String field) {
        String settingJson = institute != null ? institute.getSetting() : null;
        if (!StringUtils.hasText(settingJson)) {
            return null;
        }
        try {
            com.fasterxml.jackson.databind.JsonNode entries =
                    OBJECT_MAPPER.readTree(settingJson)
                            .path("setting").path("CERTIFICATE_SETTING").path("data").path("data");
            if (entries.isArray()) {
                for (com.fasterxml.jackson.databind.JsonNode config : entries) {
                    if ("COURSE_COMPLETION".equals(config.path("key").asText(null))) {
                        com.fasterxml.jackson.databind.JsonNode value = config.path(field);
                        return value.isMissingNode() || value.isNull() ? null : value;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Could not read verification setting '{}' for institute {}",
                    field, institute.getId(), e);
        }
        return null;
    }

    private UserDTO resolveLearner(String userId) {
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            if (users != null && !users.isEmpty()) {
                return users.get(0);
            }
        } catch (Exception e) {
            log.warn("Could not resolve learner for verification of user {}", userId, e);
        }
        return null;
    }

    /**
     * "Alex Sample" → "A··· S·····".
     *
     * <p>Keeps the initials and word shape so the holder can confirm the
     * certificate is theirs, while a scraper collecting these learns almost
     * nothing. Anyone entitled to the full name already has the certificate.
     */
    static String maskName(String fullName) {
        if (!StringUtils.hasText(fullName)) {
            return "";
        }
        String[] parts = fullName.trim().split("\\s+");
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < parts.length; i++) {
            if (i > 0) out.append(' ');
            String part = parts[i];
            out.append(part.charAt(0));
            out.append("·".repeat(Math.max(0, part.length() - 1)));
        }
        return out.toString();
    }
}
