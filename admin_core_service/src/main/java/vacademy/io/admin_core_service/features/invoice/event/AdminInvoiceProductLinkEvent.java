package vacademy.io.admin_core_service.features.invoice.event;

/**
 * An admin invoice (ADMIN_MANUAL) that carries a product link needs its link looked at: it has
 * just been paid (gateway or an admin recording an offline payment), or it was just raised with
 * "apply now". Published by InvoiceService once its own work is done; handled after the
 * transaction commits by InvoiceProductLinkService, which renews / enrols when due and records
 * the paid payment on the membership.
 *
 * @param waitForResult true when an admin is waiting on the response (offline payment, invoice
 *                      just raised), so the work finishes before it returns; false for gateway
 *                      webhooks, which must answer quickly.
 */
public record AdminInvoiceProductLinkEvent(String invoiceId, String instituteId, boolean waitForResult) {
}
