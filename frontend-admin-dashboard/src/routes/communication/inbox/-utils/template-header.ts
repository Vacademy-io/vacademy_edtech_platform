import type { WhatsAppTemplateDTO } from '@/routes/communication/whatsapp-templates/-services/template-api';

/** The header kinds a template can be approved with that need a file sent alongside it. */
export type TemplateHeaderKind = 'image' | 'video' | 'document';

/**
 * Which media header, if any, an approved template carries — in the lowercase form the unified
 * send API wants for `options.headerType`.
 *
 * Meta stores it uppercase (IMAGE / VIDEO / DOCUMENT / TEXT / NONE) and rejects a send that omits
 * the header component with error 132012 "header: Format mismatch, expected DOCUMENT, received
 * UNKNOWN", so a sender must know this before building the request. TEXT and NONE need no file
 * and map to null.
 */
export function templateHeaderKind(
    template: Pick<WhatsAppTemplateDTO, 'headerType'>
): TemplateHeaderKind | null {
    const raw = template.headerType?.trim().toUpperCase();
    if (raw === 'IMAGE') return 'image';
    if (raw === 'VIDEO') return 'video';
    if (raw === 'DOCUMENT') return 'document';
    return null;
}
