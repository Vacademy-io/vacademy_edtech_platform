package vacademy.io.admin_core_service.features.commerce.pos.entity;

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
import java.util.Date;

/**
 * One cashier's shift at one register, from the opening cash count to the closing one. Sales,
 * refunds and cash movements are stamped with its id. The row is locked FOR SHARE by every
 * write of the counter and FOR UPDATE by the close; {@link DynamicUpdate} keeps a save from
 * writing back columns it did not change.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@DynamicUpdate
@Table(name = "pos_session")
public class PosSession extends CommerceCatalogueEntity {

    @Column(name = "register_id", nullable = false, updatable = false, length = 36)
    private String registerId;

    @Column(name = "location_id", nullable = false, updatable = false, length = 36)
    private String locationId;

    @Column(name = "cashier_user_id", nullable = false, updatable = false, length = 36)
    private String cashierUserId;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "opened_at", nullable = false, updatable = false)
    private Date openedAt;

    @Column(name = "opening_cash", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal openingCash;

    @Column(name = "opening_note", updatable = false, length = 500)
    private String openingNote;

    @Column(name = "previous_session_id", updatable = false, length = 36)
    private String previousSessionId;

    @Column(name = "previous_counted_cash", updatable = false, precision = 12, scale = 2)
    private BigDecimal previousCountedCash;

    @Column(name = "open_request_id", updatable = false, length = 64)
    private String openRequestId;

    @Column(name = "closed_at")
    private Date closedAt;

    @Column(name = "closed_by", length = 36)
    private String closedBy;

    @Column(name = "close_request_id", length = 64)
    private String closeRequestId;

    @Column(name = "expected_cash", precision = 12, scale = 2)
    private BigDecimal expectedCash;

    @Column(name = "counted_cash", precision = 12, scale = 2)
    private BigDecimal countedCash;

    @Column(name = "variance", precision = 12, scale = 2)
    private BigDecimal variance;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "counted_denominations_json", columnDefinition = "jsonb")
    private String countedDenominationsJson;

    @Column(name = "close_note", length = 500)
    private String closeNote;

    /** The day report, frozen at close. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "z_report_json", columnDefinition = "jsonb")
    private String zReportJson;

    /** Cash taken out at close; written by the till accounts (WP-63), null until then. */
    @Column(name = "handover_amount", precision = 12, scale = 2)
    private BigDecimal handoverAmount;

    @Column(name = "handover_account_id", length = 36)
    private String handoverAccountId;

    @Column(name = "handover_transfer_id", length = 36)
    private String handoverTransferId;

    public boolean isOpen() {
        return "OPEN".equals(status);
    }
}
