package vacademy.io.admin_core_service.features.commerce.accounts.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * What a money entry was for, shown as a category (V734). One level of parent. {@code code} never
 * changes after insert; {@code account_code} is reserved for a later export and not exposed.
 * Values of {@code nature}, {@code expense_kind}, {@code default_itc_eligibility} and
 * {@code status} are the names of {@code HeadNature}, {@code ExpenseKind}, {@code ItcEligibility}
 * and {@code HeadStatus}.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_account_head")
public class CommerceAccountHead {

    @Id
    @UuidGenerator
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "code", nullable = false, updatable = false, length = 32)
    private String code;

    /** Language code to name, for example {"en": "Rent", "hi": "..."}; "en" is always present. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "name_i18n", nullable = false, columnDefinition = "jsonb")
    private Map<String, String> nameI18n;

    @Column(name = "parent_id", length = 36)
    private String parentId;

    @Column(name = "nature", nullable = false, length = 32)
    private String nature;

    @Column(name = "expense_kind", length = 32)
    private String expenseKind;

    @Column(name = "is_capital", nullable = false)
    private boolean capital;

    @Column(name = "default_itc_eligibility", length = 32)
    private String defaultItcEligibility;

    @Column(name = "default_hsn_code", length = 8)
    private String defaultHsnCode;

    @Column(name = "account_code", length = 32)
    private String accountCode;

    @Column(name = "is_system", nullable = false)
    private boolean system;

    @Column(name = "position", nullable = false)
    private int position;

    @Column(name = "status", nullable = false, length = 32)
    private String status = "ACTIVE";

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
