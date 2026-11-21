package vacademy.io.admin_core_service.features.certificate.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * What a public certificate verification returns.
 *
 * <p>Everything here is visible to anyone holding the QR, so the field list is
 * the disclosure decision. Deliberately absent:
 *
 * <ul>
 *   <li>{@code fileId} — media-service turns any file id into a permanent,
 *       non-expiring public URL, so exposing it would hand out the PDF forever</li>
 *   <li>{@code userId}, email, phone — no learner identifiers</li>
 *   <li>{@code packageSessionId}, institute id — nothing to pivot from</li>
 * </ul>
 *
 * <p>The learner's name is masked to initials-plus-shape. It is enough for the
 * holder to confirm the certificate is theirs and for an employer to corroborate
 * a claim, without making a harvested set of these worth anything.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CertificateVerificationDto {

    private boolean valid;

    /** The human-readable number, echoed so the page can show what was checked. */
    private String certificateId;

    private String instituteName;
    private String courseName;
    private Date issuedAt;
    private Integer completionPercentage;

    /**
     * Masked, e.g. "A··· S·····", unless the institute turned on
     * verificationShowFullDetails, in which case it is the full name.
     */
    private String learnerName;

    /**
     * The learner's record, filled only when the institute turned on
     * verificationShowFullDetails. Null otherwise, so the default response
     * discloses nothing more than it did before.
     */
    private String learnerUsername;
    private String learnerFirstName;
    private String learnerLastName;
    private String learnerEmail;

    /**
     * Institute branding, so the verification page can present itself as the
     * institute's own rather than as a platform page with a name typed on it.
     *
     * <p>Sent on the response rather than looked up by the page, because a
     * verification link is opened by strangers on whatever domain the QR
     * happens to carry — an employer scanning a certificate is not logged in
     * and has no institute context to resolve branding from. Without these the
     * page could only render generically, which reads as "some third party
     * says this is fine" rather than "the institute that awarded it says so".
     *
     * <p>All three are public-by-nature: a logo and a brand colour are on the
     * certificate itself, and the website is printed in its footer.
     */
    private String instituteLogoFileId;
    private String instituteThemeCode;
    private String instituteWebsite;

    /**
     * A line the institute chose to show on this page — a registrar's contact,
     * or what the certificate attests to. Public by definition: anyone holding
     * the link reads it. Blank prints nothing rather than an empty panel.
     */
    private String instituteNote;

    /**
     * How the institute has set this page up, sent with the result rather than
     * looked up by the page: whoever scans a certificate is not logged in and
     * has no institute context to resolve settings from.
     *
     * <p>Null means the shipped default. The course, date and completion flags
     * are what the institute chose to disclose — the masked name and the number
     * are not optional, because without them the page confirms that <em>a</em>
     * certificate exists rather than the one in the reader's hand.
     */
    private String headline;
    private Boolean showCourse;
    private Boolean showIssueDate;
    private Boolean showCompletion;

    /**
     * What the scan should present: {@code PAGE} (default) or {@code DOCUMENT}.
     *
     * <p>The client decides on this rather than guessing from the presence of a
     * URL, so an institute that configured a document but left it empty still
     * falls back to the page instead of showing a blank frame.
     */
    private String verificationMode;

    /**
     * Which kind of document {@link #documentUrl} points at: {@code PDF} or
     * {@code HTML}. Null when the mode is PAGE.
     *
     * <p>This exists because the two are fetched differently, and without it the
     * client cannot tell them apart — see {@link #documentUrl}.
     */
    private String documentType;

    /**
     * Where the verification document lives, when the mode is {@code DOCUMENT}.
     *
     * <p><b>How to resolve it depends on {@link #documentType}:</b>
     * <ul>
     *   <li>{@code PDF} — an absolute, permanent media URL. Open it as-is.</li>
     *   <li>{@code HTML} — a path on <em>this API</em>, not on the portal the
     *       reader is looking at. Prefix it with the API base the client already
     *       uses for {@code /verify}. A scan lands on the institute's own learner
     *       portal ({@code student.edustream.ae/verify/…}) while the API lives on
     *       a different host, so treating this as same-origin would 404.</li>
     * </ul>
     *
     * <p>Null whenever the mode is PAGE, or when the mode is DOCUMENT but nothing
     * has been designed or uploaded yet — in which case the client renders the
     * page, so verification never dead-ends on a half-finished configuration.
     */
    private String documentUrl;
}
