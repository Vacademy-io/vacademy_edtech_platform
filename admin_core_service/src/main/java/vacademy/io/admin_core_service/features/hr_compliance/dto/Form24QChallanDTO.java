package vacademy.io.admin_core_service.features.hr_compliance.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;

/** One TDS deposit (challan) mapped into the quarter's Form 24Q. */
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Form24QChallanDTO {

    private String id;
    private LocalDate depositDate;
    private String bsrCode;
    private String challanSerial;
    private BigDecimal amount;
    private BigDecimal interest;
    private BigDecimal fee;
}
