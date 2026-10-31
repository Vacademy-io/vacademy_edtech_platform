import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { Trash2, ImagePlus } from 'lucide-react';
import { Palette, Trash } from '@phosphor-icons/react';
import { nanoid } from 'nanoid';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type {
    FieldMapping,
    ImageTemplate,
} from '@/types/certificate/certificate-types';

// FieldMapping is shared with the bulk wizard, so we don't extend the type.
// Instead we encode "this field is an image" via the fieldName itself:
// - `institute_logo` / `signature`: resolve URL from props.systemImageUrls.
// - `custom_image:<id>`: an admin-uploaded image; URL lives in customImages.
// certificate_qr / certificate_barcode resolve to base64 PNGs on the backend, so
// they must be treated as images here too — otherwise the editor sizes them as
// text boxes and the serializer emits a raw data URI as visible text.
import { resolveCertificateCodePlaceholder } from '../../-utils/certificate-code-placeholders';
import {
    fieldContentHeightPx,
    fieldContentWidthPx,
    fieldTextMaxHeightPx,
    TEXT_LINE_HEIGHT,
} from '../../-utils/serialize-image-template-to-html';
import { textFitWarning } from '../../-utils/certificate-text-fit';
import {
    AUTO_BADGE,
    codeAspectRatio,
    codeDisplayName,
    codeFieldName,
    codePlaceholder,
    codeScanWarning,
    codeSizePx,
    isCodeFieldName,
    planFromFieldNames,
    PX_PER_MM,
    type BadgeCodeType,
    type BarcodeContent,
} from '../../-utils/certificate-auto-badge';

const SYSTEM_IMAGE_FIELDS = new Set([
    'institute_logo',
    'signature',
    'certificate_qr',
    'certificate_barcode',
]);

const isImageField = (f: FieldMapping): boolean =>
    SYSTEM_IMAGE_FIELDS.has(f.fieldName) || f.fieldName.startsWith('custom_image:');

interface CustomImage {
    id: string; // matches the custom_image:<id> fieldName
    dataUrl: string;
}

interface Props {
    imageTemplate: ImageTemplate;
    fieldMappings: FieldMapping[];
    onFieldMappingsChange: (mappings: FieldMapping[]) => void;
    /**
     * Resolved URLs for system image fields. Currently `institute_logo` and
     * optionally `signature`. Editor uses these to render real previews.
     */
    systemImageUrls?: Partial<Record<'institute_logo' | 'signature', string>>;
    /**
     * Admin-uploaded custom images persisted alongside the template state.
     * Editor exposes an "Upload custom image" button that calls
     * onCustomImagesChange to append.
     */
    customImages?: CustomImage[];
    onCustomImagesChange?: (next: CustomImage[]) => void;
    /**
     * Which code the institute stamps automatically. Drives the ghost preview
     * of the badge, so switching QR ↔ Barcode changes what admins see it print.
     */
    badgeCodeType?: BadgeCodeType;
    /**
     * What a placed Barcode field encodes. Drives its aspect and the width below
     * which it stops scanning — a verifying barcode carries about twice the
     * payload of a bare number and needs about twice the width.
     */
    barcodeContent?: BarcodeContent;
    /**
     * Printed width of the certificate. The canvas is in pixels, but whether a
     * code scans is a question about millimetres on paper, so the warning needs
     * the page size to convert. Defaults to A4 landscape.
     */
    pageWidthMm?: number;
    /** Sample number shown inside the ghost badge. */
    sampleCertificateId?: string;
    /**
     * Whether the platform is allowed to stamp the code / the number on designs
     * that do not place them. Default on, as the badge always was.
     */
    autoStampCode?: boolean;
    autoStampNumber?: boolean;
    /**
     * Turn the automatic stamp off for one part of the badge.
     *
     * <p>Called both from the ghost badge's own dismiss control and from
     * removing a placed QR / barcode / Certificate ID field — because removing
     * the field is what an admin does when they do not want the thing, and
     * without this the platform simply stamped it back bottom-right. "I deleted
     * the QR and it came back" was exactly that loop.
     */
    onAutoStampChange?: (part: 'code' | 'number', enabled: boolean) => void;
}

type DragMode =
    | { kind: 'idle' }
    | { kind: 'move'; id: string; offsetX: number; offsetY: number }
    | {
          kind: 'resize';
          id: string;
          startX: number;
          startY: number;
          w: number;
          h: number;
          /** Set for code fields, which must keep their shape to stay scannable. */
          aspect?: number;
      };

const SCALE_PADDING_PX = 32;

export const CertificateVisualEditor = ({
    imageTemplate,
    fieldMappings,
    onFieldMappingsChange,
    systemImageUrls,
    customImages,
    onCustomImagesChange,
    badgeCodeType = 'QR',
    barcodeContent = 'NUMBER',
    pageWidthMm = 297,
    sampleCertificateId = 'VA-0123-2026',
    autoStampCode = true,
    autoStampNumber = true,
    onAutoStampChange,
}: Props) => {
    const { t } = useTranslation('settingsCertificateVisualEditor');
    const containerRef = useRef<HTMLDivElement | null>(null);
    const customImageInputRef = useRef<HTMLInputElement | null>(null);
    const ghostCodeRef = useRef<HTMLImageElement | null>(null);
    const ghostIdRef = useRef<HTMLSpanElement | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [drag, setDrag] = useState<DragMode>({ kind: 'idle' });
    const [scale, setScale] = useState(1);

    const { setNodeRef, isOver } = useDroppable({
        id: 'image-editor',
        data: { type: 'image-editor' },
    });

    // Compute a fit-to-container scale so a large background image still fits.
    useEffect(() => {
        const recalc = () => {
            const c = containerRef.current;
            if (!c) return;
            const w = c.clientWidth - SCALE_PADDING_PX;
            const s = Math.min(1, w / imageTemplate.width);
            setScale(s);
        };
        recalc();
        const obs = new ResizeObserver(recalc);
        if (containerRef.current) obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, [imageTemplate.width]);

    // Convert a pointer event to image-natural-coordinate (x, y).
    const evtToImagePos = (e: React.PointerEvent | PointerEvent) => {
        const surface = document.getElementById('cert-editor-surface');
        if (!surface) return { x: 0, y: 0 };
        const rect = surface.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / scale,
            y: (e.clientY - rect.top) / scale,
        };
    };

    const updateField = (id: string, patch: Partial<FieldMapping>) => {
        onFieldMappingsChange(
            fieldMappings.map((f) => (f.id === id ? { ...f, ...patch } : f))
        );
    };

    const updateFieldStyle = (id: string, patch: Partial<FieldMapping['style']>) => {
        onFieldMappingsChange(
            fieldMappings.map((f) =>
                f.id === id ? { ...f, style: { ...f.style, ...patch } } : f
            )
        );
    };

    const updateFieldPos = (id: string, patch: Partial<FieldMapping['position']>) => {
        onFieldMappingsChange(
            fieldMappings.map((f) =>
                f.id === id ? { ...f, position: { ...f.position, ...patch } } : f
            )
        );
    };

    const removeField = (id: string) => {
        const removed = fieldMappings.find((f) => f.id === id);
        onFieldMappingsChange(fieldMappings.filter((f) => f.id !== id));
        if (selectedId === id) setSelectedId(null);

        // Removing the field is only half the job: the platform stamps a code
        // and a number onto any design that does not place them, so deleting
        // one used to bring the stamped version straight back. Take the removal
        // at face value and stop stamping that part.
        if (removed && isCodeFieldName(removed.fieldName)) {
            onAutoStampChange?.('code', false);
        }
        if (removed?.fieldName === 'certificate_id') {
            onAutoStampChange?.('number', false);
        }
    };

    const startMove = (e: React.PointerEvent, f: FieldMapping) => {
        e.stopPropagation();
        setSelectedId(f.id);
        const pos = evtToImagePos(e);
        setDrag({
            kind: 'move',
            id: f.id,
            offsetX: pos.x - f.position.x,
            offsetY: pos.y - f.position.y,
        });
    };

    const startResize = (e: React.PointerEvent, f: FieldMapping) => {
        e.stopPropagation();
        setSelectedId(f.id);
        setDrag({
            kind: 'resize',
            id: f.id,
            startX: e.clientX,
            startY: e.clientY,
            w: f.position.width,
            h: f.position.height,
            aspect: isCodeFieldName(f.fieldName)
                ? codeAspectRatio(f.fieldName, barcodeContent)
                : undefined,
        });
    };

    // Global pointermove/up so drags continue if the cursor leaves a field.
    useEffect(() => {
        if (drag.kind === 'idle') return;
        const onMove = (e: PointerEvent) => {
            if (drag.kind === 'move') {
                const pos = evtToImagePos(e);
                updateFieldPos(drag.id, {
                    x: Math.max(0, Math.min(imageTemplate.width, pos.x - drag.offsetX)),
                    y: Math.max(0, Math.min(imageTemplate.height, pos.y - drag.offsetY)),
                });
            } else if (drag.kind === 'resize') {
                const dx = (e.clientX - drag.startX) / scale;
                const dy = (e.clientY - drag.startY) / scale;
                if (drag.aspect) {
                    // Codes resize proportionally. A QR is square by
                    // construction and a stretched one is rejected by scanners;
                    // a squashed barcode stops scanning too. Driving both
                    // dimensions off whichever the pointer moved further keeps
                    // the drag feeling direct while the shape stays valid.
                    const width = Math.max(
                        20,
                        Math.abs(dx) >= Math.abs(dy) ? drag.w + dx : (drag.h + dy) * drag.aspect
                    );
                    updateFieldPos(drag.id, {
                        width,
                        height: Math.max(16, width / drag.aspect),
                    });
                } else {
                    updateFieldPos(drag.id, {
                        width: Math.max(20, drag.w + dx),
                        height: Math.max(16, drag.h + dy),
                    });
                }
            }
        };
        const onUp = () => setDrag({ kind: 'idle' });
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drag, scale, imageTemplate.width, imageTemplate.height]);

    // Resolve the URL to render for an image-typed field.
    const resolveImageUrl = (f: FieldMapping): string => {
        if (f.fieldName === 'institute_logo') return systemImageUrls?.institute_logo || '';
        if (f.fieldName === 'signature') return systemImageUrls?.signature || '';
        // The real QR/barcode only exist once a number is allocated at issuance,
        // so show a schematic stand-in — otherwise these render as an empty box
        // and there is nothing to position.
        const codePlaceholder = resolveCertificateCodePlaceholder(f.fieldName);
        if (codePlaceholder) return codePlaceholder;
        if (f.fieldName.startsWith('custom_image:')) {
            const id = f.fieldName.split(':')[1];
            return customImages?.find((c) => c.id === id)?.dataUrl || '';
        }
        return '';
    };

    // Upload a custom image: persists data URL + auto-places a FieldMapping.
    const onCustomImagePicked = async (file: File) => {
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(file);
        });
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.src = dataUrl;
        });
        const id = nanoid(8);
        const next: CustomImage[] = [...(customImages || []), { id, dataUrl }];
        onCustomImagesChange?.(next);

        // Place a sized field at the center, scaled so its longest side ≈ 25% of the canvas.
        const targetMax = Math.max(imageTemplate.width, imageTemplate.height) * 0.25;
        const longest = Math.max(dims.w, dims.h);
        const fit = longest > 0 ? targetMax / longest : 1;
        const w = Math.round(dims.w * fit);
        const h = Math.round(dims.h * fit);
        onFieldMappingsChange([
            ...fieldMappings,
            {
                id: nanoid(),
                fieldName: `custom_image:${id}`,
                displayName: file.name,
                type: 'text',
                position: {
                    x: Math.max(0, (imageTemplate.width - w) / 2),
                    y: Math.max(0, (imageTemplate.height - h) / 2),
                    width: w,
                    height: h,
                },
                style: {
                    fontSize: 14,
                    fontColor: '#000000',
                    fontFamily: 'Arial',
                    alignment: 'left',
                    fontWeight: 'normal',
                },
            },
        ]);
    };

    const selectedField = useMemo(
        () => fieldMappings.find((f) => f.id === selectedId) || null,
        [fieldMappings, selectedId]
    );

    // What the backend will still stamp bottom-right, given what is placed.
    const badgePlan = useMemo(
        () =>
            planFromFieldNames(
                fieldMappings.map((f) => f.fieldName),
                { code: autoStampCode, number: autoStampNumber }
            ),
        [fieldMappings, autoStampCode, autoStampNumber]
    );

    // The ghost is laid out by the browser (it shrink-wraps its contents just
    // like the PDF renderer does), so read the real boxes off the DOM rather
    // than re-deriving them — that keeps "where it prints" and "where the field
    // lands when you grab it" the same rectangle.
    const domRectToImageRect = (el: HTMLElement) => {
        const surface = document.getElementById('cert-editor-surface');
        if (!surface) return null;
        const s = surface.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return {
            x: Math.round((r.left - s.left) / scale),
            y: Math.round((r.top - s.top) / scale),
            width: Math.round(r.width / scale),
            height: Math.round(r.height / scale),
        };
    };

    /**
     * Grabbing the automatic badge turns it into real fields at the exact spot
     * it was drawn, then hands the drag straight over to them — so the gesture
     * reads as "move that thing" rather than "configure a replacement for it".
     * Once placed, the backend stops stamping its own (see certificate-auto-badge).
     */
    const adoptAutoBadge = (e: React.PointerEvent) => {
        e.stopPropagation();
        const adopted: FieldMapping[] = [];
        if (badgePlan.code && ghostCodeRef.current) {
            const rect = domRectToImageRect(ghostCodeRef.current);
            if (rect) {
                adopted.push({
                    id: nanoid(),
                    fieldName: codeFieldName(badgeCodeType),
                    displayName: codeDisplayName(badgeCodeType),
                    type: 'text',
                    position: rect,
                    style: {
                        fontSize: AUTO_BADGE.idFontSizePx,
                        fontColor: AUTO_BADGE.textColor,
                        fontFamily: AUTO_BADGE.fontFamily,
                        alignment: 'center',
                        fontWeight: 'normal',
                    },
                });
            }
        }
        if (badgePlan.id && ghostIdRef.current) {
            const rect = domRectToImageRect(ghostIdRef.current);
            if (rect) {
                adopted.push({
                    id: nanoid(),
                    fieldName: 'certificate_id',
                    displayName: t('badge.certificateIdFieldLabel'),
                    type: 'text',
                    position: rect,
                    style: {
                        fontSize: AUTO_BADGE.idFontSizePx,
                        fontColor: AUTO_BADGE.textColor,
                        fontFamily: AUTO_BADGE.fontFamily,
                        alignment: 'center',
                        fontWeight: 'normal',
                    },
                });
            }
        }
        if (adopted.length === 0) return;
        onFieldMappingsChange([...fieldMappings, ...adopted]);

        // Continue the same gesture on the code (or the number, when the code
        // was already placed) so the admin drags without re-pressing.
        const primary = adopted[0];
        if (!primary) return;
        setSelectedId(primary.id);
        const pos = evtToImagePos(e);
        setDrag({
            kind: 'move',
            id: primary.id,
            offsetX: pos.x - primary.position.x,
            offsetY: pos.y - primary.position.y,
        });
    };

    return (
        <div className="flex flex-col gap-3">
            {/* Toolbar */}
            <div className="flex items-center justify-between rounded border bg-card px-3 py-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <span>
                        {t('toolbar.fieldsPlaced', { count: fieldMappings.length })}
                    </span>
                    {isOver && (
                        <span className="text-purple-600">{t('toolbar.dropToAdd')}</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <input
                        ref={customImageInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) onCustomImagePicked(f);
                            if (customImageInputRef.current) customImageInputRef.current.value = '';
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => customImageInputRef.current?.click()}
                        className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
                    >
                        <ImagePlus className="size-3.5" /> {t('toolbar.uploadCustomImage')}
                    </button>
                </div>
            </div>

            {/* Canvas surface */}
            <div ref={containerRef} className="relative rounded border bg-neutral-100 p-4">
                {selectedField && (
                    <FloatingPropertiesPanel
                        field={selectedField}
                        isImage={isImageField(selectedField)}
                        fitWarning={
                            isImageField(selectedField)
                                ? null
                                : textFitWarning({
                                      fieldName: selectedField.fieldName,
                                      widthPx: fieldContentWidthPx(selectedField),
                                      heightPx: fieldContentHeightPx(selectedField),
                                      fontSizePx: selectedField.style.fontSize,
                                      bold: selectedField.style.fontWeight === 'bold',
                                  })
                        }
                        scanWarning={codeScanWarning({
                            fieldName: selectedField.fieldName,
                            widthPx: selectedField.position.width,
                            heightPx: selectedField.position.height,
                            canvasWidthPx: imageTemplate.width,
                            canvasWidthMm: pageWidthMm,
                            barcodeContent,
                        })}
                        onChangeStyle={(p) => updateFieldStyle(selectedField.id, p)}
                        onChangePos={(p) => updateFieldPos(selectedField.id, p)}
                        onChangeField={(p) => updateField(selectedField.id, p)}
                        onRemove={() => removeField(selectedField.id)}
                        onClose={() => setSelectedId(null)}
                    />
                )}
                <div
                    ref={setNodeRef}
                    id="cert-editor-surface"
                    className="relative mx-auto bg-white shadow-sm"
                    style={{
                        width: imageTemplate.width * scale,
                        height: imageTemplate.height * scale,
                    }}
                    onClick={() => setSelectedId(null)}
                >
                    <img
                        src={imageTemplate.imageDataUrl}
                        alt=""
                        draggable={false}
                        className="pointer-events-none absolute inset-0 size-full object-contain"
                    />
                    {/* Inner scaled coordinate system so children use natural pixels */}
                    <div
                        className="absolute left-0 top-0"
                        style={{
                            width: imageTemplate.width,
                            height: imageTemplate.height,
                            transform: `scale(${scale})`,
                            transformOrigin: '0 0',
                        }}
                    >
                        {fieldMappings.map((f) => {
                            const isImg = isImageField(f);
                            const imgUrl = isImg ? resolveImageUrl(f) : '';
                            const selected = f.id === selectedId;
                            return (
                                <div
                                    key={f.id}
                                    onPointerDown={(e) => startMove(e, f)}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedId(f.id);
                                    }}
                                    className={`absolute box-border cursor-grab ${selected ? 'ring-2 ring-purple-500' : 'ring-1 ring-neutral-300/60 hover:ring-purple-400'}`}
                                    style={{
                                        left: f.position.x,
                                        top: f.position.y,
                                        width: f.position.width,
                                        height: f.position.height,
                                        background: f.style.backgroundColor,
                                    }}
                                >
                                    {isImg ? (
                                        imgUrl ? (
                                            <img
                                                src={imgUrl}
                                                alt={f.displayName}
                                                draggable={false}
                                                className="size-full object-contain"
                                            />
                                        ) : (
                                            <div className="flex size-full items-center justify-center bg-neutral-100/70 text-[11px] text-neutral-500">
                                                {f.displayName}
                                            </div>
                                        )
                                    ) : (
                                        <div
                                            className="flex size-full items-center"
                                            style={{
                                                justifyContent:
                                                    f.style.alignment === 'center'
                                                        ? 'center'
                                                        : f.style.alignment === 'right'
                                                          ? 'flex-end'
                                                          : 'flex-start',
                                                padding: f.style.padding,
                                            }}
                                        >
                                            {/* Wraps and clamps exactly as the
                                                issued certificate does, so a box
                                                too small for a real value shows
                                                it here rather than on the
                                                learner's PDF. */}
                                            <div
                                                style={{
                                                    width: '100%',
                                                    color: f.style.fontColor,
                                                    fontFamily: f.style.fontFamily,
                                                    fontSize: f.style.fontSize,
                                                    fontWeight: f.style.fontWeight,
                                                    textAlign: f.style.alignment,
                                                    lineHeight: TEXT_LINE_HEIGHT,
                                                    // The drawn box is the clamp,
                                                    // exactly as the serializer
                                                    // emits it — so a field that
                                                    // will be cut on the PDF is
                                                    // cut here too.
                                                    maxHeight: fieldTextMaxHeightPx(f),
                                                    overflow: 'hidden',
                                                    overflowWrap: 'break-word',
                                                }}
                                            >
                                                {f.displayName}
                                            </div>
                                        </div>
                                    )}

                                    {selected && (
                                        <>
                                            <div
                                                onPointerDown={(e) => startResize(e, f)}
                                                className="absolute bottom-0 right-0 size-3 cursor-se-resize bg-purple-500"
                                                style={{ transform: 'translate(50%,50%)' }}
                                            />
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeField(f.id);
                                                }}
                                                className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-red-500 text-white shadow"
                                                title={t('canvas.removeFieldTitle')}
                                            >
                                                <Trash2 className="size-3" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            );
                        })}

                        {/* Ghost of the badge the backend stamps on every
                            certificate. Drawn with the server's own offsets and
                            sizes so this is where it really prints; grabbing it
                            converts it into fields you own. */}
                        {badgePlan.any && (
                            <div
                                onPointerDown={adoptAutoBadge}
                                onClick={(e) => e.stopPropagation()}
                                title={t('badge.autoStampTitle')}
                                className="group absolute cursor-grab outline-dashed outline-2 outline-offset-2 outline-purple-400/70"
                                style={{
                                    // Mirrors appendCertificateIdBadge in
                                    // InstituteSettingService — see
                                    // certificate-auto-badge.ts.
                                    right: AUTO_BADGE.rightMm * PX_PER_MM,
                                    bottom: AUTO_BADGE.bottomMm * PX_PER_MM,
                                    padding: `${AUTO_BADGE.paddingYPx}px ${AUTO_BADGE.paddingXPx}px`,
                                    border: `${AUTO_BADGE.borderPx}px solid ${AUTO_BADGE.borderColor}`,
                                    borderRadius: AUTO_BADGE.borderRadiusPx,
                                    background: AUTO_BADGE.background,
                                    fontFamily: AUTO_BADGE.fontFamily,
                                    fontSize: AUTO_BADGE.idFontSizePx,
                                    color: AUTO_BADGE.textColor,
                                    letterSpacing: AUTO_BADGE.letterSpacing,
                                    textAlign: 'center',
                                }}
                            >
                                {badgePlan.code && (
                                    <img
                                        ref={ghostCodeRef}
                                        src={codePlaceholder(badgeCodeType)}
                                        alt={codeDisplayName(badgeCodeType)}
                                        draggable={false}
                                        style={{
                                            width: codeSizePx(badgeCodeType).width,
                                            height: codeSizePx(badgeCodeType).height,
                                            display: 'block',
                                        }}
                                    />
                                )}
                                {badgePlan.id && (
                                    <span
                                        ref={ghostIdRef}
                                        style={{
                                            display: 'block',
                                            marginTop: AUTO_BADGE.idMarginTopPx,
                                        }}
                                    >
                                        {sampleCertificateId}
                                    </span>
                                )}
                                {onAutoStampChange && (
                                    <button
                                        type="button"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (badgePlan.code) onAutoStampChange('code', false);
                                            if (badgePlan.id) onAutoStampChange('number', false);
                                        }}
                                        title={t('badge.stopPrintingTitle')}
                                        aria-label={t('badge.turnOffAriaLabel')}
                                        className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-red-500 text-white shadow"
                                    >
                                        <Trash2 className="size-3" />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                {badgePlan.any && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                        {t('badge.stampedFooter', {
                            names: [
                                badgePlan.code ? codeDisplayName(badgeCodeType) : null,
                                badgePlan.id ? t('badge.certificateNumberLabel') : null,
                            ]
                                .filter(Boolean)
                                .join(' + '),
                        })}
                    </p>
                )}
            </div>
        </div>
    );
};

// Floating, draggable, dismissible properties panel matching the bulk
// wizard's pdf-annotation-editor design pixel-for-pixel: viewport-fixed
// position, gradient purple→blue header with Palette icon, font-size slider,
// font/weight dropdowns, hex text-color input, individual alignment buttons,
// background-color with Clear, Position, and Field Size groups.
const FloatingPropertiesPanel = ({
    scanWarning,
    fitWarning,
    field,
    isImage,
    onChangeStyle,
    onChangePos,
    onRemove,
    onClose,
}: {
    field: FieldMapping;
    isImage: boolean;
    /**
     * Why this code would not scan off the printed page, or null. Shown rather
     * than enforced: the admin owns the design, and silently resizing a box
     * they are dragging is worse than telling them what is wrong.
     */
    scanWarning: string | null;
    /**
     * What a realistically long value does in this box, or null. Text fields are
     * sized against a short sample and filled with real data much later, so
     * without this the admin only discovers the box is too tight when a learner
     * with a long name receives a shrunken or cut-off certificate.
     */
    fitWarning: string | null;
    onChangeStyle: (p: Partial<FieldMapping['style']>) => void;
    onChangePos: (p: Partial<FieldMapping['position']>) => void;
    onChangeField: (p: Partial<FieldMapping>) => void;
    onRemove: () => void;
    onClose: () => void;
}) => {
    const { t } = useTranslation('settingsCertificateVisualEditor');
    const [pos, setPos] = useState({ x: 20, y: 20 });
    const dragRef = useRef<{ ox: number; oy: number } | null>(null);

    const onHeaderDown = (e: React.MouseEvent) => {
        dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y };
        const move = (ev: MouseEvent) => {
            if (!dragRef.current) return;
            const newX = ev.clientX - dragRef.current.ox;
            const newY = ev.clientY - dragRef.current.oy;
            // Keep panel within viewport bounds (matches the original).
            const maxX = window.innerWidth - 320;
            const maxY = window.innerHeight - 400;
            setPos({
                x: Math.max(0, Math.min(maxX, newX)),
                y: Math.max(0, Math.min(maxY, newY)),
            });
        };
        const up = () => {
            dragRef.current = null;
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    return (
        <div
            className="fixed z-50 flex w-80 flex-col rounded-lg border border-neutral-200 bg-white shadow-lg"
            // Capped to what is left of the viewport below the panel's own top
            // edge. Without this the panel is as tall as its content, so on a
            // laptop screen the Position and Field Size groups — the X/Y boxes
            // an admin actually came here to type into — sat below the fold
            // with nothing to scroll: the page itself does not scroll a
            // position:fixed element.
            style={{ left: pos.x, top: pos.y, maxHeight: `calc(100vh - ${pos.y}px - 16px)` }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Draggable Header — shrink-0 so it stays put while the body
                scrolls under it. */}
            <div
                className="flex shrink-0 cursor-move items-center justify-between rounded-t-lg border-b border-neutral-200 bg-gradient-to-r from-purple-50 to-blue-50 p-3"
                onMouseDown={onHeaderDown}
            >
                <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-purple-100 p-2">
                        <Palette className="size-4 text-purple-600" />
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-neutral-700">
                            {t('properties.title')}
                        </h3>
                        <p className="text-xs text-neutral-500">{field.displayName}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={onRemove}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                        <Trash className="mr-1 size-3" />
                        {t('properties.removeButton')}
                    </MyButton>
                    <button
                        onClick={onClose}
                        className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                        title={t('properties.closeTitle')}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Panel Content — the scrolling half. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                <div className="space-y-4">
                    {scanWarning && (
                        <div className="rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
                            {scanWarning}
                        </div>
                    )}
                    {fitWarning && (
                        <div className="rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
                            {fitWarning}
                        </div>
                    )}
                    {!isImage && (
                        <>
                            {/* Font Size — max scales with the field box so
                                large boxes on high-res templates can fit large
                                text. Floor at 72 so small boxes still allow a
                                reasonable range. */}
                            {(() => {
                                const dynamicMax = Math.max(
                                    72,
                                    Math.round(field.position.height * 0.9)
                                );
                                return (
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-neutral-700">
                                            {t('properties.fontSize.label')}
                                        </label>
                                        <input
                                            type="range"
                                            min={8}
                                            max={dynamicMax}
                                            value={Math.min(field.style.fontSize, dynamicMax)}
                                            onChange={(e) =>
                                                onChangeStyle({
                                                    fontSize: parseInt(e.target.value),
                                                })
                                            }
                                            className="w-full"
                                        />
                                        <div className="flex justify-between text-xs text-neutral-500">
                                            <span>
                                                {t('properties.fontSize.pxValue', { value: 8 })}
                                            </span>
                                            <span className="font-medium">
                                                {t('properties.fontSize.pxValue', {
                                                    value: field.style.fontSize,
                                                })}
                                            </span>
                                            <span>
                                                {t('properties.fontSize.pxValue', {
                                                    value: dynamicMax,
                                                })}
                                            </span>
                                        </div>
                                        <input
                                            type="number"
                                            min={8}
                                            value={field.style.fontSize}
                                            onChange={(e) =>
                                                onChangeStyle({
                                                    fontSize: Math.max(
                                                        8,
                                                        parseInt(e.target.value) || 8
                                                    ),
                                                })
                                            }
                                            className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                                            placeholder={t('properties.fontSize.customPlaceholder')}
                                        />
                                    </div>
                                );
                            })()}

                            {/* Font Family */}
                            <div>
                                <label className="mb-1 block text-xs font-medium text-neutral-700">
                                    {t('properties.fontFamily.label')}
                                </label>
                                <select
                                    value={field.style.fontFamily}
                                    onChange={(e) => onChangeStyle({ fontFamily: e.target.value })}
                                    className="w-full rounded-md border border-neutral-200 p-2 text-sm"
                                >
                                    <option value="Arial, sans-serif">Arial</option>
                                    <option value="Times New Roman, serif">Times New Roman</option>
                                    <option value="Helvetica, sans-serif">Helvetica</option>
                                    <option value="Georgia, serif">Georgia</option>
                                    <option value="Courier New, monospace">Courier New</option>
                                    <option value="Verdana, sans-serif">Verdana</option>
                                    <option value="Impact, sans-serif">Impact</option>
                                </select>
                            </div>

                            {/* Font Weight */}
                            <div>
                                <label className="mb-1 block text-xs font-medium text-neutral-700">
                                    {t('properties.fontWeight.label')}
                                </label>
                                <select
                                    value={field.style.fontWeight}
                                    onChange={(e) =>
                                        onChangeStyle({
                                            fontWeight: e.target.value as 'normal' | 'bold',
                                        })
                                    }
                                    className="w-full rounded-md border border-neutral-200 p-2 text-sm"
                                >
                                    <option value="normal">{t('properties.fontWeight.normal')}</option>
                                    <option value="bold">{t('properties.fontWeight.bold')}</option>
                                </select>
                            </div>

                            {/* Text Color */}
                            <div>
                                <label className="mb-1 block text-xs font-medium text-neutral-700">
                                    {t('properties.textColor.label')}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="color"
                                        value={field.style.fontColor}
                                        onChange={(e) =>
                                            onChangeStyle({ fontColor: e.target.value })
                                        }
                                        className="h-8 w-12 cursor-pointer rounded border border-neutral-200"
                                    />
                                    <input
                                        type="text"
                                        value={field.style.fontColor}
                                        onChange={(e) =>
                                            onChangeStyle({ fontColor: e.target.value })
                                        }
                                        className="flex-1 rounded-md border border-neutral-200 p-2 text-sm"
                                        placeholder="#000000"
                                    />
                                </div>
                            </div>

                            {/* Text Alignment */}
                            <div>
                                <label className="mb-1 block text-xs font-medium text-neutral-700">
                                    {t('properties.textAlignment.label')}
                                </label>
                                <div className="flex gap-1">
                                    {(['left', 'center', 'right'] as const).map((align) => (
                                        <button
                                            key={align}
                                            onClick={() => onChangeStyle({ alignment: align })}
                                            className={cn(
                                                'flex-1 rounded-md border p-2 text-xs transition-all',
                                                field.style.alignment === align
                                                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                                                    : 'border-neutral-200 hover:border-neutral-300'
                                            )}
                                        >
                                            {t(`properties.textAlignment.${align}`)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Background Color */}
                            <div>
                                <label className="mb-1 block text-xs font-medium text-neutral-700">
                                    {t('properties.backgroundColor.label')}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="color"
                                        value={
                                            field.style.backgroundColor &&
                                            field.style.backgroundColor !== 'transparent' &&
                                            !field.style.backgroundColor.includes('rgba')
                                                ? field.style.backgroundColor
                                                : '#ffffff'
                                        }
                                        onChange={(e) =>
                                            onChangeStyle({ backgroundColor: e.target.value })
                                        }
                                        className="h-8 w-12 cursor-pointer rounded border border-neutral-200"
                                    />
                                    <button
                                        onClick={() =>
                                            onChangeStyle({ backgroundColor: 'transparent' })
                                        }
                                        className="rounded-md border border-neutral-200 px-3 py-2 text-xs hover:bg-neutral-50"
                                    >
                                        {t('properties.backgroundColor.clear')}
                                    </button>
                                </div>
                                <p className="mt-1 text-xs text-neutral-500">
                                    {t('properties.backgroundColor.current', {
                                        value:
                                            field.style.backgroundColor ||
                                            t('properties.backgroundColor.transparentValue'),
                                    })}
                                </p>
                            </div>
                        </>
                    )}

                    {/* Position */}
                    <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-700">
                            {t('properties.position.label')}
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="mb-1 block text-xs text-neutral-500">
                                    {t('properties.position.x')}
                                </label>
                                <input
                                    type="number"
                                    value={Math.round(field.position.x)}
                                    onChange={(e) =>
                                        onChangePos({ x: parseInt(e.target.value) || 0 })
                                    }
                                    className="w-full rounded-md border border-neutral-200 p-2 text-sm"
                                    min={0}
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs text-neutral-500">
                                    {t('properties.position.y')}
                                </label>
                                <input
                                    type="number"
                                    value={Math.round(field.position.y)}
                                    onChange={(e) =>
                                        onChangePos({ y: parseInt(e.target.value) || 0 })
                                    }
                                    className="w-full rounded-md border border-neutral-200 p-2 text-sm"
                                    min={0}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Field Size */}
                    <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-700">
                            {t('properties.fieldSize.label')}
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="mb-1 block text-xs text-neutral-500">
                                    {t('properties.fieldSize.width')}
                                </label>
                                <input
                                    type="number"
                                    value={field.position.width}
                                    onChange={(e) =>
                                        onChangePos({
                                            width: Math.max(20, parseInt(e.target.value) || 120),
                                        })
                                    }
                                    className="w-full rounded-md border border-neutral-200 p-2 text-sm"
                                    min={20}
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs text-neutral-500">
                                    {t('properties.fieldSize.height')}
                                </label>
                                <input
                                    type="number"
                                    value={field.position.height}
                                    onChange={(e) =>
                                        onChangePos({
                                            height: Math.max(16, parseInt(e.target.value) || 24),
                                        })
                                    }
                                    className="w-full rounded-md border border-neutral-200 p-2 text-sm"
                                    min={16}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Re-export the helper-types so callers can persist customImages alongside
// the imageTemplateJson payload.
export type { CustomImage };
