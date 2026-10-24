package vacademy.io.admin_core_service.features.hr_payslip.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Internal service→controller carrier for streamed file downloads
 * (payslip PDFs, bank-export files). Never serialized to JSON.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FileDownloadDTO {

    private String fileName;
    private String contentType;
    private byte[] bytes;
}
