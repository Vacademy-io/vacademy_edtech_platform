package vacademy.io.admin_core_service.features.commerce.customer.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.util.Date;

/**
 * A buyer known to the shop. Inside one institute the phone is
 * the identity; {@code userId} is the auth user the plans and payment logs are written for.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_customer")
public class CommerceCustomer extends CommerceCatalogueEntity {

    @Column(name = "user_id", length = 36)
    private String userId;

    @Column(name = "phone", nullable = false, length = 20)
    private String phone;

    @Column(name = "name", length = 200)
    private String name;

    @Column(name = "email", length = 320)
    private String email;

    @Column(name = "marketing_consent", nullable = false)
    private Boolean marketingConsent = false;

    @Column(name = "consent_at")
    private Date consentAt;

    @Column(name = "consent_source", length = 64)
    private String consentSource;

    @Column(name = "cod_refusals", nullable = false)
    private Integer codRefusals = 0;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;

    @Column(name = "external_ref", length = 100)
    private String externalRef;

    @Column(name = "anonymised_at")
    private Date anonymisedAt;

    /**
     * Shopper sessions carry the epoch they were issued at; raising it (sign out everywhere)
     * ends every session of this phone in this shop (V687). Written only by
     * {@code CommerceCustomerRepository.bumpSessionEpoch}, never by a save of this entity.
     */
    @Column(name = "session_epoch", nullable = false, insertable = false, updatable = false)
    private Integer sessionEpoch = 0;
}
