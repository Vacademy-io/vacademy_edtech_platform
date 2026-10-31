package vacademy.io.admin_core_service.features.user_subscription.entity;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.annotations.BatchSize;
import org.hibernate.annotations.Where;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Objects;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "payment_option")
@Data
// payment_option_json snapshots stored on user_plan carry an extra
// "cpo_discount_state" key (CPO-level discount + per-installment overrides
// audit). Existing readers deserialize the snapshot back into PaymentOption
// via JsonUtil; ignore unknown keys so they don't choke on the extra field.
@JsonIgnoreProperties(ignoreUnknown = true)
public class PaymentOption {
    @Id
    @UuidGenerator
    private String id;

    @Column(name = "name")
    private String name;

    @Column(name = "status")
    private String status;

    @Column(name = "source")
    private String source;

    @Column(name = "source_id") // could be institute or package session
    private String sourceId;

    @Column(name = "tag") // default etc
    private String tag;

    @Column(name = "type")
    private String type;

    @Column(name = "payment_option_metadata_json")
    private String paymentOptionMetadataJson;

    @Column(name = "require_approval")
    private boolean requireApproval = true;

    @Column(name = "unit")
    private String unit;

    /**
     * Master switch for plan change: members already enrolled under another option of the
     * same package session may switch INTO this option. A plan is only offered as a switch
     * target when BOTH this and {@code PaymentPlan.planChangeAllowed} are true.
     *
     * Boxed rather than primitive so a partial DTO that omits the field can be told apart
     * from an explicit false and left alone on edit.
     */
    @Column(name = "plan_change_allowed")
    private Boolean planChangeAllowed = false;

    /**
     * Regional pricing master switch (V585). When on, learner checkouts are priced from
     * payment_plan_regional_price by the viewer's country instead of the plan's own price.
     * Boxed for the same reason as planChangeAllowed: a partial edit must not switch it off.
     */
    @Column(name = "regional_pricing_enabled")
    private Boolean regionalPricingEnabled = false;

    /** Comma-separated ISO-4217 codes the system keeps an AUTO price for on every plan. */
    @Column(name = "regional_pricing_currencies")
    private String regionalPricingCurrencies;

    /**
     * The column is NOT NULL (default FALSE). Any code path that builds an option without
     * setting the switch (all-args constructor, a JSON copy, an explicit null) is written as
     * off rather than failing the insert or update.
     */
    @PrePersist
    @PreUpdate
    void defaultRegionalPricingSwitch() {
        if (regionalPricingEnabled == null) {
            regionalPricingEnabled = false;
        }
    }

    /**
     * Scalar FK to ComplexPaymentOption. Intentionally NOT also mapped as a @ManyToOne
     * relation — two Hibernate mappings on the same column cause the scalar to come back
     * null on some read paths (notably the enroll-invite payload). All callers use
     * getComplexPaymentOptionId() directly.
     */
    @Column(name = "complex_payment_option_id")
    private String complexPaymentOptionId;

    /**
     * auth_service user id of the admin who created this option. Stamped by the
     * service on insert from the request's JWT, never from the client DTO.
     *
     * updatable = false on purpose: the Settings page edits a plan through the same
     * POST, which rebuilds the entity from the DTO and merges it — with an updatable
     * column that merge would silently null the creator on every edit.
     */
    @Column(name = "created_by_user_id", updatable = false)
    private String createdByUserId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;

    // This defines the one-to-many relationship with PaymentPlan
    // mappedBy refers to the field in the PaymentPlan entity that owns the relationship (the foreign key)
    @OneToMany(mappedBy = "paymentOption", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @Where(clause = "status = 'ACTIVE'")
    // Every caller that maps a list of options to DTOs reads this collection, so a lazy
    // load per option is an N+1 the size of the list. get-payment-options measured 31s
    // against an institute with 6,665 options while the query behind it takes 31ms --
    // a thousand lazy SELECTs, not a slow query. Hibernate now fetches the plans for up
    // to 500 options at a time, turning that into about fourteen round trips.
    @BatchSize(size = 500)
    // Without this the plans come back in physical row order, so editing any one plan
    // silently reshuffles the learner's plan list. Shortest cycle first (Monthly →
    // Quarterly → Half-Yearly → Annual), which is the order learners expect to compare in.
    @OrderBy("validityInDays ASC")
    private List<PaymentPlan> paymentPlans = new ArrayList<>();

    public PaymentOption(PaymentOptionDTO paymentOptionDTO) {
        if (paymentOptionDTO == null) return;
        this.setId(paymentOptionDTO.getId());
        this.name = paymentOptionDTO.getName();
        this.status = paymentOptionDTO.getStatus();
        this.source = paymentOptionDTO.getSource();
        this.sourceId = paymentOptionDTO.getSourceId();
        this.tag = paymentOptionDTO.getTag();
        this.type = paymentOptionDTO.getType();
        this.requireApproval = paymentOptionDTO.isRequireApproval();
        this.unit = paymentOptionDTO.getUnit();
        this.planChangeAllowed = Boolean.TRUE.equals(paymentOptionDTO.getPlanChangeAllowed());
        this.regionalPricingEnabled = Boolean.TRUE.equals(paymentOptionDTO.getRegionalPricingEnabled());
        this.regionalPricingCurrencies = joinCurrencies(paymentOptionDTO.getRegionalPricingCurrencies());
        this.complexPaymentOptionId = paymentOptionDTO.getComplexPaymentOptionId();
        this.paymentOptionMetadataJson = paymentOptionDTO.getPaymentOptionMetadataJson();
        if (paymentOptionDTO.getPaymentPlans() != null && !paymentOptionDTO.getPaymentPlans().isEmpty()) {
            this.paymentPlans.addAll(paymentOptionDTO.getPaymentPlans()
                    .stream()
                    .filter(Objects::nonNull)
                    .map(dto -> new PaymentPlan(dto, this))
                    .toList());
        }
    }

    public PaymentOptionDTO mapToPaymentOptionDTO() {
        return PaymentOptionDTO.builder()
                .id(this.id)
                .name(this.name)
                .status(this.status)
                .source(this.source)
                .sourceId(this.sourceId)
                .tag(this.tag)
                .type(this.type)
                .paymentOptionMetadataJson(this.paymentOptionMetadataJson)
                .requireApproval(this.requireApproval)
                .unit(this.unit)
                .planChangeAllowed(Boolean.TRUE.equals(this.planChangeAllowed))
                .regionalPricingEnabled(Boolean.TRUE.equals(this.regionalPricingEnabled))
                .regionalPricingCurrencies(splitCurrencies(this.regionalPricingCurrencies))
                .complexPaymentOptionId(this.complexPaymentOptionId)
                .createdByUserId(this.createdByUserId)
                .createdAt(this.createdAt)
                .updatedAt(this.updatedAt)
                .paymentPlans(this.paymentPlans != null
                        ? this.paymentPlans.stream()
                        .map(PaymentPlan::mapToPaymentPlanDTO)
                        .toList()
                        : List.of()) // or Collections.emptyList()
                .build();
    }

    public PaymentOptionDTO mapToPaymentOptionDTOWithoutPlans() {
        return PaymentOptionDTO.builder()
            .id(this.id)
            .name(this.name)
            .status(this.status)
            .source(this.source)
            .sourceId(this.sourceId)
            .tag(this.tag)
            .type(this.type)
            .paymentOptionMetadataJson(this.paymentOptionMetadataJson)
            .requireApproval(this.requireApproval)
            .unit(this.unit)
            .planChangeAllowed(Boolean.TRUE.equals(this.planChangeAllowed))
            .regionalPricingEnabled(Boolean.TRUE.equals(this.regionalPricingEnabled))
            .regionalPricingCurrencies(splitCurrencies(this.regionalPricingCurrencies))
            .complexPaymentOptionId(this.complexPaymentOptionId)
            .createdByUserId(this.createdByUserId)
            .createdAt(this.createdAt)
            .updatedAt(this.updatedAt)
            .build();
    }

    /** Normalises an admin-entered currency list to "USD,GBP" (upper-case, de-duplicated). */
    public static String joinCurrencies(List<String> currencies) {
        if (currencies == null) {
            return null;
        }
        String joined = currencies.stream()
                .filter(Objects::nonNull)
                .map(c -> c.trim().toUpperCase())
                .filter(c -> c.length() == 3)
                .distinct()
                .collect(java.util.stream.Collectors.joining(","));
        return joined.isEmpty() ? null : joined;
    }

    public static List<String> splitCurrencies(String currencies) {
        if (currencies == null || currencies.isBlank()) {
            return List.of();
        }
        return java.util.Arrays.stream(currencies.split(","))
                .map(String::trim)
                .filter(c -> !c.isEmpty())
                .toList();
    }
}
