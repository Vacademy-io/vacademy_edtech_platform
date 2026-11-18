import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { formatMoney } from '@/components/design-system/money-cell';
import { code128Bars, isCode128B } from '../-shared/code128';
import type { LabelLanguage, LabelTemplate, PrintLabel } from '../-shared/inventory-types';
import { a4Sheets, expandCopies, labelText } from '../-shared/label-print';
import './label-print.css';

/** The code as a Code 128 (set B) barcode, drawn in module units and stretched to the CSS size. */
export function Code128Svg({ code }: { code: string }) {
    const drawn = useMemo(() => (isCode128B(code) ? code128Bars(code) : null), [code]);
    if (!drawn) return null;
    return (
        <svg
            viewBox={`0 0 ${drawn.totalModules} 10`}
            preserveAspectRatio="none"
            shapeRendering="crispEdges"
            role="img"
            aria-label={code}
            data-testid="label-barcode"
        >
            <rect x={0} y={0} width={drawn.totalModules} height={10} fill="white" />
            {drawn.bars.map((bar) => (
                <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={10} fill="black" />
            ))}
        </svg>
    );
}

/** A unit after the price for measured goods ("/ m"). */
const perUnit = (unit: string | null): string => {
    const u = (unit ?? '').toUpperCase();
    if (!u || u === 'PCS' || u === 'NOS') return '';
    return u === 'MTR' ? ' / m' : ` / ${unit}`;
};

function LabelFace({ label, language, cell }: { label: PrintLabel; language: LabelLanguage; cell: boolean }) {
    const { t } = useTranslation('commerce');
    const name = labelText(label.product_name, language);
    const variant = labelText(label.variant_name, language === 'both' ? 'hi' : language).main;
    return (
        <div className={cell ? 'inv-cell' : 'inv-sticker'} data-testid="print-label">
            <QRCodeSVG value={label.qr_value} level="M" marginSize={1} size={64} className="inv-label-qr" />
            <div className="inv-label-text">
                <span className="inv-label-name">{name.main}</span>
                {name.small && <span className="inv-label-small">{name.small}</span>}
                {variant && <span className="inv-label-small">{variant}</span>}
                {label.price !== null && (
                    <>
                        <span className="inv-label-price">
                            {t('inventory.labels.mrp', { price: formatMoney(label.price, label.currency) })}
                            {perUnit(label.unit)}
                        </span>
                        <span className="inv-label-small">{t('inventory.labels.inclTaxes')}</span>
                    </>
                )}
                {label.sku && <span className="inv-label-small">{label.sku}</span>}
            </div>
            <div className="inv-label-bar">
                <Code128Svg code={label.code} />
                <span className="inv-label-code">{label.code}</span>
            </div>
        </div>
    );
}

/**
 * The labels to print, portalled straight under `<body>` and hidden on
 * screen; `printLabels()` shows only this block for the one print.
 * Sticker: one label per 50 × 25 mm page. A4: sheets of 65.
 */
export function LabelPrintView({
    labels,
    template,
    language,
    startPosition,
}: {
    labels: PrintLabel[];
    template: LabelTemplate;
    language: LabelLanguage;
    startPosition: number;
}) {
    if (typeof document === 'undefined') return null;
    const content =
        template === 'A4_65' ? (
            a4Sheets(labels, startPosition).map((sheet, index) => (
                <div key={index} className="inv-sheet">
                    {sheet.map((label, cell) =>
                        label ? (
                            <LabelFace key={cell} label={label} language={language} cell />
                        ) : (
                            <div key={cell} className="inv-cell" />
                        )
                    )}
                </div>
            ))
        ) : (
            expandCopies(labels).map((label, index) => (
                <LabelFace key={index} label={label} language={language} cell={false} />
            ))
        );
    return createPortal(
        <div className="inv-label-print" aria-hidden="true" data-testid="label-print-view">
            {content}
        </div>,
        document.body
    );
}
