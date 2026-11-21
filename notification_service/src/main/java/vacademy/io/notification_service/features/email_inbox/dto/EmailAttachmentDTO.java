package vacademy.io.notification_service.features.email_inbox.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One file on an inbound email, as indexed at ingest. Bytes are fetched separately by id. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EmailAttachmentDTO {
    /** MIME part id ("2", "2.1") — pass it back to the attachment endpoint. */
    private String id;
    private String filename;
    private String contentType;
    /** Decoded size in bytes; -1 when unknown. */
    private long size;
    /** An image the HTML body shows in place (cid:) rather than a file attached to the email. */
    private boolean inline;
}
