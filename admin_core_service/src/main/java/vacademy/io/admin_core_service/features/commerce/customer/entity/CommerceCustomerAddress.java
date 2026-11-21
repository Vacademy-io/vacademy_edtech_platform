package vacademy.io.admin_core_service.features.commerce.customer.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

/** One address of a customer's address book. An order copies the address it is placed with. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_customer_address")
public class CommerceCustomerAddress extends CommerceCatalogueEntity {

    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_DELETED = "DELETED";

    @Column(name = "customer_id", nullable = false, updatable = false, length = 36)
    private String customerId;

    @Column(name = "label", length = 64)
    private String label;

    @Column(name = "name", length = 200)
    private String name;

    @Column(name = "phone", length = 20)
    private String phone;

    @Column(name = "line1", nullable = false, length = 300)
    private String line1;

    @Column(name = "line2", length = 300)
    private String line2;

    @Column(name = "landmark", length = 200)
    private String landmark;

    @Column(name = "city", length = 100)
    private String city;

    @Column(name = "state_code", length = 8)
    private String stateCode;

    @Column(name = "pincode", nullable = false, length = 6)
    private String pincode;

    @Column(name = "is_default", nullable = false)
    private Boolean isDefault = false;

    @Column(name = "status", nullable = false, length = 32)
    private String status = STATUS_ACTIVE;
}
