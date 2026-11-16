package vacademy.io.admin_core_service.features.commerce.shipment.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Date;

/**
 * One parcel of an order (V688). Changed only while the order row and this row are locked
 * FOR UPDATE; {@link DynamicUpdate} keeps a save to the columns it changed.
 */
@Getter
@Setter
@NoArgsConstructor
@DynamicUpdate
@Entity
@Table(name = "commerce_shipment")
public class CommerceShipment extends CommerceCatalogueEntity {

    public static final String CARRIER_MANUAL = "MANUAL";
    public static final String CARRIER_HANDOVER = "HANDOVER";

    @Column(name = "order_id", nullable = false, updatable = false, length = 36)
    private String orderId;

    @Column(name = "location_id", nullable = false, updatable = false, length = 36)
    private String locationId;

    @Column(name = "carrier_code", nullable = false, length = 32)
    private String carrierCode = CARRIER_MANUAL;

    @Column(name = "carrier_name", length = 100)
    private String carrierName;

    @Column(name = "tracking_number", length = 64)
    private String trackingNumber;

    @Column(name = "tracking_url", length = 500)
    private String trackingUrl;

    @Column(name = "status", nullable = false, length = 32)
    private String status;

    @Column(name = "cod_amount", precision = 12, scale = 2)
    private BigDecimal codAmount;

    /** Raised by every ship; part of the SALE keys, so a re-ship after an undo posts new rows. */
    @Column(name = "ship_count", nullable = false)
    private Integer shipCount = 0;

    @Column(name = "weight_grams")
    private Integer weightGrams;

    @Column(name = "eway_bill_no", length = 32)
    private String ewayBillNo;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "carrier_payload_json", columnDefinition = "jsonb")
    private String carrierPayloadJson;

    @Column(name = "invoice_id", length = 255)
    private String invoiceId;

    @Column(name = "rto_reason", length = 32)
    private String rtoReason;

    @Column(name = "note", length = 500)
    private String note;

    @Column(name = "packed_at")
    private Date packedAt;

    @Column(name = "packed_by", length = 36)
    private String packedBy;

    @Column(name = "shipped_at")
    private Date shippedAt;

    @Column(name = "shipped_by", length = 36)
    private String shippedBy;

    @Column(name = "delivered_on")
    private LocalDate deliveredOn;

    @Column(name = "delivered_at")
    private Date deliveredAt;

    @Column(name = "delivered_by", length = 36)
    private String deliveredBy;

    @Column(name = "rto_at")
    private Date rtoAt;

    @Column(name = "rto_by", length = 36)
    private String rtoBy;

    @Column(name = "rto_received_at")
    private Date rtoReceivedAt;

    @Column(name = "rto_received_by", length = 36)
    private String rtoReceivedBy;

    @Column(name = "cancelled_at")
    private Date cancelledAt;

    @Column(name = "cancelled_by", length = 36)
    private String cancelledBy;
}
