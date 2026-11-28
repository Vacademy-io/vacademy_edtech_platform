package vacademy.io.admin_core_service.features.commerce.accounts.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Anyone the seller owes or pays (V743): trader, worker, landlord, courier; the kind is
 * {@code group_code}. The PAN is not here but in {@link CommerceSupplierSecret}.
 *
 * <p>The id is assigned by the caller before the first save ({@code UUID.randomUUID()}), so data
 * bound to the supplier can name it before the row exists. {@code version} stays null until that
 * first save: Spring Data then treats the row as new and Hibernate writes version 0.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_supplier")
public class CommerceSupplier {

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "code", nullable = false, length = 32)
    private String code;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    @Column(name = "legal_name", length = 255)
    private String legalName;

    @Column(name = "name_alt", length = 255)
    private String nameAlt;

    @Column(name = "group_code", nullable = false, length = 32)
    private String groupCode = "SUPPLIER";

    @Column(name = "phone", length = 20)
    private String phone;

    @Column(name = "email", length = 255)
    private String email;

    @Column(name = "address_line1", length = 255)
    private String addressLine1;

    @Column(name = "address_line2", length = 255)
    private String addressLine2;

    @Column(name = "city", length = 100)
    private String city;

    @Column(name = "country_code", nullable = false, length = 2)
    private String countryCode = "IN";

    @Column(name = "state_code", length = 2)
    private String stateCode;

    @Column(name = "pincode", length = 10)
    private String pincode;

    /** A name of {@code RegistrationType}. */
    @Column(name = "registration_type", nullable = false, length = 32)
    private String registrationType = "UNREGISTERED";

    @Column(name = "gstin", length = 15)
    private String gstin;

    @Column(name = "payment_terms_days", nullable = false)
    private int paymentTermsDays;

    @Column(name = "tds_applicable", nullable = false)
    private boolean tdsApplicable;

    @Column(name = "default_tds_code", length = 32)
    private String defaultTdsCode;

    @Column(name = "upi_id", length = 100)
    private String upiId;

    @Column(name = "payment_note", length = 500)
    private String paymentNote;

    @Column(name = "default_head_id", length = 36)
    private String defaultHeadId;

    @Column(name = "customer_id", length = 36)
    private String customerId;

    /** Lower-case join of name, legal name, other name, code, phone and GSTIN; the list's text search. */
    @Column(name = "search_text", nullable = false, columnDefinition = "TEXT")
    private String searchText = "";

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;

    /** A name of {@code SupplierStatus}. */
    @Column(name = "status", nullable = false, length = 32)
    private String status = "ACTIVE";

    @Column(name = "external_ref", length = 100)
    private String externalRef;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;

    @Column(name = "client_request_id", updatable = false, length = 64)
    private String clientRequestId;

    @Column(name = "request_hash", updatable = false, length = 64)
    private String requestHash;

    @Column(name = "created_by", updatable = false, length = 36)
    private String createdBy;

    @Column(name = "updated_by", length = 36)
    private String updatedBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    // The database default covers the insert only and no trigger maintains the column.
    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    void touchUpdatedAt() {
        this.updatedAt = LocalDateTime.now();
    }
}
