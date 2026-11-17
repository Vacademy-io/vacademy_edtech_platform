import type { StatusType } from '@/components/design-system/status-chips';

/**
 * Every commerce status, mapped ONCE to its label key and chip colour.
 * Screens never spell a status label or pick a colour
 * themselves: they render `<CommerceStatusChip kind="…" value="…" />`.
 *
 * Values are the binding enum names of the backend. Labels live in the
 * `commerce` strings under `status.<kind>.<VALUE>`, in Hindi and English.
 * Maps for areas that are not built yet (POS sessions) are added here by the
 * work package that builds the screen.
 */
export interface CommerceStatusMeta {
    /** Key under the `commerce` namespace. */
    labelKey: string;
    tone: StatusType;
}

const meta = (kind: string, value: string, tone: StatusType): CommerceStatusMeta => ({
    labelKey: `status.${kind}.${value}`,
    tone,
});

export const PRODUCT_STATUS_MAP = {
    DRAFT: meta('product', 'DRAFT', 'WARNING'),
    ACTIVE: meta('product', 'ACTIVE', 'SUCCESS'),
    ARCHIVED: meta('product', 'ARCHIVED', 'INFO'),
} as const;

export const COLLECTION_STATUS_MAP = {
    ACTIVE: meta('collection', 'ACTIVE', 'SUCCESS'),
    ARCHIVED: meta('collection', 'ARCHIVED', 'INFO'),
} as const;

export const LOCATION_STATUS_MAP = {
    ACTIVE: meta('location', 'ACTIVE', 'SUCCESS'),
    INACTIVE: meta('location', 'INACTIVE', 'INFO'),
} as const;

export const TAX_CLASS_STATUS_MAP = {
    ACTIVE: meta('taxClass', 'ACTIVE', 'SUCCESS'),
    ARCHIVED: meta('taxClass', 'ARCHIVED', 'INFO'),
} as const;

export const TAX_MODE_MAP = {
    REGULAR: meta('taxMode', 'REGULAR', 'SUCCESS'),
    COMPOSITION: meta('taxMode', 'COMPOSITION', 'INFO'),
    UNREGISTERED: meta('taxMode', 'UNREGISTERED', 'INFO'),
} as const;

/** Setup checklist rows on Commerce Home. */
export const SETUP_STATUS_MAP = {
    DONE: meta('setup', 'DONE', 'SUCCESS'),
    TODO: meta('setup', 'TODO', 'WARNING'),
    NOT_NEEDED: meta('setup', 'NOT_NEEDED', 'INFO'),
    COMING_SOON: meta('setup', 'COMING_SOON', 'INFO'),
    UNKNOWN: meta('setup', 'UNKNOWN', 'INFO'),
} as const;

export const PIN_STATUS_MAP = {
    SET: meta('pin', 'SET', 'SUCCESS'),
    NOT_SET: meta('pin', 'NOT_SET', 'WARNING'),
} as const;

/** A background import. */
export const IMPORT_JOB_STATUS_MAP = {
    QUEUED: meta('importJob', 'QUEUED', 'INFO'),
    RUNNING: meta('importJob', 'RUNNING', 'WARNING'),
    COMPLETED: meta('importJob', 'COMPLETED', 'SUCCESS'),
    COMPLETED_WITH_ERRORS: meta('importJob', 'COMPLETED_WITH_ERRORS', 'WARNING'),
    FAILED: meta('importJob', 'FAILED', 'DANGER'),
} as const;

/** Renditions of a gallery image: made after the upload (`CommerceRenditionState`). */
export const MEDIA_RENDITION_STATUS_MAP = {
    PENDING: meta('mediaRendition', 'PENDING', 'WARNING'),
    PROCESSING: meta('mediaRendition', 'PROCESSING', 'WARNING'),
    READY: meta('mediaRendition', 'READY', 'SUCCESS'),
    FAILED: meta('mediaRendition', 'FAILED', 'DANGER'),
} as const;

/** A row of an import validation. */
export const IMPORT_SEVERITY_MAP = {
    ERROR: meta('importSeverity', 'ERROR', 'DANGER'),
    WARNING: meta('importSeverity', 'WARNING', 'WARNING'),
} as const;

/** An order (`CommerceOrderStatus`). */
export const ORDER_STATUS_MAP = {
    PENDING_PAYMENT: meta('order', 'PENDING_PAYMENT', 'WARNING'),
    COD_PENDING_CONFIRMATION: meta('order', 'COD_PENDING_CONFIRMATION', 'WARNING'),
    CONFIRMED: meta('order', 'CONFIRMED', 'INFO'),
    PACKED: meta('order', 'PACKED', 'INFO'),
    SHIPPED: meta('order', 'SHIPPED', 'INFO'),
    DELIVERED: meta('order', 'DELIVERED', 'SUCCESS'),
    RTO: meta('order', 'RTO', 'DANGER'),
    CANCELLED: meta('order', 'CANCELLED', 'DANGER'),
} as const;

export const PAYMENT_STATUS_MAP = {
    UNPAID: meta('paymentStatus', 'UNPAID', 'WARNING'),
    PARTIALLY_PAID: meta('paymentStatus', 'PARTIALLY_PAID', 'WARNING'),
    PAID: meta('paymentStatus', 'PAID', 'SUCCESS'),
} as const;

/** A parcel. */
export const SHIPMENT_STATUS_MAP = {
    PACKED: meta('shipment', 'PACKED', 'INFO'),
    SHIPPED: meta('shipment', 'SHIPPED', 'INFO'),
    DELIVERED: meta('shipment', 'DELIVERED', 'SUCCESS'),
    RTO: meta('shipment', 'RTO', 'DANGER'),
    RTO_RECEIVED: meta('shipment', 'RTO_RECEIVED', 'WARNING'),
    CANCELLED: meta('shipment', 'CANCELLED', 'INFO'),
} as const;

/** A customer return. */
export const RETURN_STATUS_MAP = {
    REQUESTED: meta('return', 'REQUESTED', 'WARNING'),
    APPROVED: meta('return', 'APPROVED', 'INFO'),
    REJECTED: meta('return', 'REJECTED', 'DANGER'),
    RECEIVED: meta('return', 'RECEIVED', 'SUCCESS'),
    CLOSED: meta('return', 'CLOSED', 'INFO'),
} as const;

export const REFUND_STATUS_MAP = {
    PENDING: meta('refund', 'PENDING', 'WARNING'),
    IN_PROGRESS: meta('refund', 'IN_PROGRESS', 'WARNING'),
    PROCESSED: meta('refund', 'PROCESSED', 'SUCCESS'),
    FAILED: meta('refund', 'FAILED', 'DANGER'),
} as const;

/** A WhatsApp or email message to the customer. */
export const DELIVERY_STATUS_MAP = {
    PENDING: meta('delivery', 'PENDING', 'INFO'),
    SENDING: meta('delivery', 'SENDING', 'INFO'),
    SENT: meta('delivery', 'SENT', 'SUCCESS'),
    FAILED: meta('delivery', 'FAILED', 'DANGER'),
    SKIPPED: meta('delivery', 'SKIPPED', 'WARNING'),
    UNKNOWN: meta('delivery', 'UNKNOWN', 'WARNING'),
    EXPIRED: meta('delivery', 'EXPIRED', 'INFO'),
} as const;

/** A WhatsApp template's approval. */
export const TEMPLATE_STATUS_MAP = {
    APPROVED: meta('templateStatus', 'APPROVED', 'SUCCESS'),
    PENDING: meta('templateStatus', 'PENDING', 'WARNING'),
    REJECTED: meta('templateStatus', 'REJECTED', 'DANGER'),
    DRAFT: meta('templateStatus', 'DRAFT', 'INFO'),
    MISSING: meta('templateStatus', 'MISSING', 'WARNING'),
    UNKNOWN: meta('templateStatus', 'UNKNOWN', 'INFO'),
} as const;

export const COMMERCE_STATUS_MAPS = {
    product: PRODUCT_STATUS_MAP,
    collection: COLLECTION_STATUS_MAP,
    location: LOCATION_STATUS_MAP,
    taxClass: TAX_CLASS_STATUS_MAP,
    taxMode: TAX_MODE_MAP,
    setup: SETUP_STATUS_MAP,
    pin: PIN_STATUS_MAP,
    importJob: IMPORT_JOB_STATUS_MAP,
    mediaRendition: MEDIA_RENDITION_STATUS_MAP,
    importSeverity: IMPORT_SEVERITY_MAP,
    order: ORDER_STATUS_MAP,
    paymentStatus: PAYMENT_STATUS_MAP,
    shipment: SHIPMENT_STATUS_MAP,
    return: RETURN_STATUS_MAP,
    refund: REFUND_STATUS_MAP,
    delivery: DELIVERY_STATUS_MAP,
    templateStatus: TEMPLATE_STATUS_MAP,
} as const;

export type CommerceStatusKind = keyof typeof COMMERCE_STATUS_MAPS;

/**
 * The label key and colour for a status. An unknown value (a new enum the app
 * has not learned yet) is shown as it came, in the neutral colour, rather than
 * hidden or mislabelled.
 */
export function commerceStatusMeta(
    kind: CommerceStatusKind,
    value: string | null | undefined
): CommerceStatusMeta & { known: boolean; value: string } {
    const key = (value ?? '').toUpperCase();
    const map = COMMERCE_STATUS_MAPS[kind] as Record<string, CommerceStatusMeta>;
    const found = map[key];
    if (found) return { ...found, known: true, value: key };
    return { labelKey: `status.${kind}.${key}`, tone: 'INFO', known: false, value: key };
}
