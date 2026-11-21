package vacademy.io.admin_core_service.features.user_subscription.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "payment_log_line_item")
public class PaymentLogLineItem {
    @Id
    @UuidGenerator
    private String id;

    @ManyToOne
    @JoinColumn(name = "payment_log_id")
    private PaymentLog paymentLog;

    @Column(name = "type") // Discount etc
    private String type;

    // numeric(12,2) since V558 — discounts keep their paise (12.90, not 13).
    @Column(name = "amount")
    private Double amount;

    @Column(name = "source") // copoun code , refferal code
    private String source;

    @Column(name = "source_id")
    private String sourceId;
}