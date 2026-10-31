package vacademy.io.admin_core_service.features.product_page.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

/** One-time code that lets the buyer's browser log in right after a product-page purchase. */
@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "product_page_login_code")
public class ProductPageLoginCode {

    @Id
    @UuidGenerator
    private String id;

    /** SHA-256 hex of the code; the code itself is never stored. */
    @Column(name = "code_hash", nullable = false, unique = true)
    private String codeHash;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "product_page_id", nullable = false)
    private String productPageId;

    @Column(name = "payment_log_id", nullable = false, unique = true)
    private String paymentLogId;

    @Column(name = "expires_at", nullable = false)
    private LocalDateTime expiresAt;

    @Column(name = "consumed_at")
    private LocalDateTime consumedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
