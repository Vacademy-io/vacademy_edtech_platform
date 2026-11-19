package vacademy.io.notification_service.features.email_verification.service;

import com.amazonaws.AmazonClientException;
import com.amazonaws.services.simpleemail.AmazonSimpleEmailService;
import com.amazonaws.services.simpleemail.model.GetIdentityVerificationAttributesRequest;
import com.amazonaws.services.simpleemail.model.GetIdentityVerificationAttributesResult;
import com.amazonaws.services.simpleemail.model.IdentityVerificationAttributes;
import com.amazonaws.services.simpleemail.model.VerifyDomainDkimRequest;
import com.amazonaws.services.simpleemail.model.VerifyDomainDkimResult;
import com.amazonaws.services.simpleemail.model.VerifyDomainIdentityRequest;
import com.amazonaws.services.simpleemail.model.VerifyDomainIdentityResult;
import com.amazonaws.services.simpleemail.model.VerifyEmailIdentityRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import vacademy.io.common.external.VendorCallLog;
import vacademy.io.notification_service.features.email_verification.dto.DnsRecordDTO;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Thin wrapper over the AWS SES (v1) identity-verification API. It is always
 * loadable — the underlying {@link AmazonSimpleEmailService} bean only exists when
 * {@code aws.ses.verification.enabled=true}, so {@link #isEnabled()} guards every call
 * and lets the rest of the app (and the admin UI) degrade gracefully when SES
 * verification is not provisioned on this deployment.
 */
@Slf4j
@Service
public class SesIdentityService {

    private final AmazonSimpleEmailService ses; // null when the feature flag is off

    // ObjectProvider so this service loads even when the SES bean is absent (flag off).
    public SesIdentityService(ObjectProvider<AmazonSimpleEmailService> sesProvider) {
        this.ses = sesProvider.getIfAvailable();
    }

    /** Whether SES verification is provisioned/enabled on this deployment. */
    public boolean isEnabled() {
        return ses != null;
    }

    private void requireEnabled() {
        if (ses == null) {
            throw new IllegalStateException(
                    "SES sender verification is not enabled on this deployment (set SES_VERIFICATION_ENABLED=true "
                            + "and provide AWS credentials with SES permissions).");
        }
    }

    /**
     * Ask SES to verify a single email address. SES emails a confirmation link to
     * that address; the identity becomes usable as a "From" only after the recipient
     * clicks it. Idempotent — safe to call again to re-send the confirmation email.
     */
    public void verifyEmailIdentity(String email) {
        requireEnabled();
        try {
            ses.verifyEmailIdentity(new VerifyEmailIdentityRequest().withEmailAddress(email));
        } catch (AmazonClientException e) {
            VendorCallLog.failed("aws-ses", "verify email identity", null, e);
            throw e;
        }
        log.info("Requested SES email-identity verification for {}", email);
    }

    /**
     * Initiate domain verification: registers the domain for both ownership (TXT) and
     * DKIM (3 CNAMEs) and returns the DNS records the institute must publish. Verification
     * completes asynchronously once AWS observes those records in DNS.
     */
    public List<DnsRecordDTO> verifyDomain(String domain) {
        requireEnabled();
        List<DnsRecordDTO> records = new ArrayList<>();

        // 1) Domain ownership TXT record: _amazonses.<domain> = <token>
        VerifyDomainIdentityResult identityResult;
        try {
            identityResult = ses.verifyDomainIdentity(new VerifyDomainIdentityRequest().withDomain(domain));
        } catch (AmazonClientException e) {
            VendorCallLog.failed("aws-ses", "verify domain identity", null, e);
            throw e;
        }
        if (identityResult != null && identityResult.getVerificationToken() != null) {
            records.add(DnsRecordDTO.builder()
                    .type("TXT")
                    .name("_amazonses." + domain)
                    .value(identityResult.getVerificationToken())
                    .purpose("Domain ownership")
                    .build());
        }

        // 2) DKIM CNAMEs: <token>._domainkey.<domain> = <token>.dkim.amazonses.com
        VerifyDomainDkimResult dkimResult;
        try {
            dkimResult = ses.verifyDomainDkim(new VerifyDomainDkimRequest().withDomain(domain));
        } catch (AmazonClientException e) {
            VendorCallLog.failed("aws-ses", "verify domain dkim", null, e);
            throw e;
        }
        records.addAll(buildDkimRecords(domain, dkimResult));

        log.info("Initiated SES domain verification for {} ({} DNS records)", domain, records.size());
        return records;
    }

    /** Rebuild the DKIM DNS records for an already-initiated domain (for re-display). */
    public List<DnsRecordDTO> getDkimRecords(String domain) {
        requireEnabled();
        VerifyDomainDkimResult dkimResult;
        try {
            dkimResult = ses.verifyDomainDkim(new VerifyDomainDkimRequest().withDomain(domain));
        } catch (AmazonClientException e) {
            VendorCallLog.failed("aws-ses", "verify domain dkim", null, e);
            throw e;
        }
        return buildDkimRecords(domain, dkimResult);
    }

    private List<DnsRecordDTO> buildDkimRecords(String domain, VerifyDomainDkimResult dkimResult) {
        List<DnsRecordDTO> records = new ArrayList<>();
        if (dkimResult == null || dkimResult.getDkimTokens() == null) {
            return records;
        }
        List<String> tokens = dkimResult.getDkimTokens();
        for (int i = 0; i < tokens.size(); i++) {
            String token = tokens.get(i);
            records.add(DnsRecordDTO.builder()
                    .type("CNAME")
                    .name(token + "._domainkey." + domain)
                    .value(token + ".dkim.amazonses.com")
                    .purpose("DKIM " + (i + 1) + " of " + tokens.size())
                    .build());
        }
        return records;
    }

    /**
     * Current SES verification status for an identity (email or domain), normalized to
     * one of: VERIFIED, PENDING, FAILED, NOT_STARTED.
     * SES returns Pending/Success/Failed/TemporaryFailure, or nothing if never registered.
     */
    public String getStatus(String identity) {
        requireEnabled();
        GetIdentityVerificationAttributesResult result;
        try {
            result = ses.getIdentityVerificationAttributes(
                    new GetIdentityVerificationAttributesRequest().withIdentities(identity));
        } catch (AmazonClientException e) {
            VendorCallLog.failed("aws-ses", "get identity verification status", null, e);
            throw e;
        }

        Map<String, IdentityVerificationAttributes> attrs =
                result != null ? result.getVerificationAttributes() : null;
        if (attrs == null || !attrs.containsKey(identity)) {
            return "NOT_STARTED";
        }
        String status = attrs.get(identity).getVerificationStatus();
        if (status == null) {
            return "NOT_STARTED";
        }
        switch (status) {
            case "Success":
                return "VERIFIED";
            case "Pending":
                return "PENDING";
            case "Failed":
            case "TemporaryFailure":
                return "FAILED";
            default:
                return "PENDING";
        }
    }
}
