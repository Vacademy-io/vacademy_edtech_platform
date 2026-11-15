package vacademy.io.admin_core_service.features.commerce.document.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

/**
 * A number series for one kind of document. A SYSTEM series hands
 * out its next value under a row lock; a MANUAL_BOOK series is a registered paper bill book
 * whose numbers are typed in. {@code nextValue} is never written through this entity: the
 * allocator updates it with its own statement while it holds the row lock.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_document_series")
public class CommerceDocumentSeries extends CommerceCatalogueEntity {

    @Column(name = "seller_gstin", length = 15)
    private String sellerGstin;

    @Column(name = "location_id", length = 36)
    private String locationId;

    @Column(name = "register_id", length = 36)
    private String registerId;

    /** ALL, ONLINE, POS or ADMIN. */
    @Column(name = "channel", nullable = false, length = 32)
    private String channel;

    @Column(name = "document_type", nullable = false, length = 32)
    private String documentType;

    @Column(name = "kind", nullable = false, length = 32)
    private String kind;

    @Column(name = "prefix", nullable = false, length = 16)
    private String prefix;

    /** For example 2026-27. */
    @Column(name = "financial_year", nullable = false, length = 8)
    private String financialYear;

    @Column(name = "next_value", nullable = false, updatable = false)
    private Long nextValue;

    @Column(name = "book_from")
    private Long bookFrom;

    @Column(name = "book_to")
    private Long bookTo;

    @Column(name = "status", nullable = false, length = 32)
    private String status;
}
