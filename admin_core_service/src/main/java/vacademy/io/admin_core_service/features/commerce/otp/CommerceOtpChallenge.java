package vacademy.io.admin_core_service.features.commerce.otp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/**
 * One code sent to a shopper (V686). The row keeps the HMAC of the code, never the code, and
 * carries the wrong-guess limit, single use, the institute and the purpose. The phone is kept
 * as a hash.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_otp_challenge")
public class CommerceOtpChallenge {

    public static final String SENT = "SENT";
    public static final String VERIFIED = "VERIFIED";
    public static final String CONSUMED = "CONSUMED";
    public static final String LOCKED = "LOCKED";
    public static final String SUPERSEDED = "SUPERSEDED";

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "phone_hash", nullable = false, length = 64)
    private String phoneHash;

    @Column(name = "purpose", nullable = false, length = 32)
    private String purpose;

    @Column(name = "status", nullable = false, length = 16)
    private String status = SENT;

    @Column(name = "attempts", nullable = false)
    private Integer attempts = 0;

    /** HMAC-SHA256 (hex) of the code with the server key; the code itself is stored nowhere. */
    @Column(name = "code_hash", length = 64)
    private String codeHash;

    @Column(name = "expires_at", nullable = false)
    private Date expiresAt;

    @Column(name = "verified_at")
    private Date verifiedAt;

    /** The key that signs the verified-phone token of this challenge. Never leaves the server. */
    @Column(name = "token_key", length = 64)
    private String tokenKey;

    @Column(name = "token_expires_at")
    private Date tokenExpiresAt;

    @Column(name = "consumed_at")
    private Date consumedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;
}
