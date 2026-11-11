import React, { useEffect, useState } from 'react';
import { Input, InputNumber, Radio, Select } from '@arco-design/web-react';
import { useBlock, useFocusIdx } from 'easy-email-editor';

/**
 * Visual border editor for the Text block: width stepper, style dropdown and colour
 * picker, either for all four sides at once or per side.
 *
 * Values are stored as CSS shorthands so textBorderFrame.ts can emit them unchanged:
 *   all sides  -> `border`        e.g. "1px solid #cccccc"
 *   per side   -> `border-top` / `border-right` / `border-bottom` / `border-left`
 * Only one of the two shapes is kept at a time; switching mode carries the values over.
 */

export const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof BORDER_SIDES)[number];

const SIDE_LABEL: Record<Side, string> = {
    top: 'Top',
    right: 'Right',
    bottom: 'Bottom',
    left: 'Left',
};

// Email-safe styles only; each option previews its own line.
const STYLE_OPTIONS = (['solid', 'dashed', 'dotted', 'double', 'none'] as const).map((style) => ({
    value: style,
    label: (
        <span className="vac-border-style-option">
            {style !== 'none' && (
                <span className="vac-border-style-option__line" style={{ borderTopStyle: style }} />
            )}
            {style.charAt(0).toUpperCase() + style.slice(1)}
        </span>
    ),
}));
const STYLE_VALUES = new Set(['none', 'hidden', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']);

const DEFAULT_STYLE = 'solid';
const DEFAULT_COLOR = '#cccccc';
const MAX_WIDTH = 20;
const MAX_RADIUS = 100;

interface BorderValue {
    width?: number;
    style: string;
    color: string;
}

type Attributes = Record<string, string | undefined>;

// Splits on whitespace outside parentheses, so "1px solid rgb(0, 0, 0)" stays three tokens.
function tokenize(shorthand: string): string[] {
    return shorthand.match(/[^\s(]+(\([^)]*\))?/g) ?? [];
}

/** "2px dashed #ff0000" -> { width: 2, style: 'dashed', color: '#ff0000' }. Lenient on order. */
export function parseBorder(shorthand?: string): BorderValue {
    const value: BorderValue = { style: DEFAULT_STYLE, color: DEFAULT_COLOR };
    if (!shorthand) return value;
    const trimmed = shorthand.trim();
    if (trimmed === 'none' || trimmed === '0') return { ...value, width: 0, style: 'none' };

    tokenize(trimmed).forEach((token) => {
        const lower = token.toLowerCase();
        const width = lower.match(/^(\d*\.?\d+)(px)?$/);
        if (width?.[1]) value.width = Number(width[1]);
        else if (lower === 'thin') value.width = 1;
        else if (lower === 'medium') value.width = 3;
        else if (lower === 'thick') value.width = 5;
        else if (STYLE_VALUES.has(lower)) value.style = lower;
        else value.color = token;
    });
    return value;
}

/** Inverse of parseBorder; undefined means "no border on this side". */
export function serializeBorder(value: BorderValue): string | undefined {
    if (!value.width || value.style === 'none') return undefined;
    return `${value.width}px ${value.style} ${value.color}`;
}

function sideKey(side: Side): string {
    return `border-${side}`;
}

function hasSideBorders(attributes: Attributes): boolean {
    return BORDER_SIDES.some((side) => Boolean(attributes[sideKey(side)]));
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// <input type="color"> only accepts #rrggbb; expand #rgb and fall back for named/rgb() colours.
function toPickerHex(color: string): string {
    if (!HEX_COLOR.test(color)) return DEFAULT_COLOR;
    if (color.length === 4) {
        return `#${color
            .slice(1)
            .split('')
            .map((c) => c + c)
            .join('')}`.toLowerCase();
    }
    return color.toLowerCase();
}

/**
 * Swatch that opens the browser's colour picker, plus a hex field for exact values.
 * (The bundled arco theme CSS predates arco's ColorPicker, so that component renders unstyled.)
 */
function ColorSwatch({ value, onChange }: { value: string; onChange: (color: string) => void }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);

    const commit = () => {
        const next = draft.trim();
        if (next && next !== value && (HEX_COLOR.test(next) || CSS.supports('color', next))) {
            onChange(next);
        } else {
            setDraft(value);
        }
    };

    return (
        <div className="vac-color-swatch">
            <label className="vac-color-swatch__chip" style={{ backgroundColor: value }} title="Pick colour">
                <input
                    type="color"
                    value={toPickerHex(value)}
                    onChange={(event) => onChange(event.target.value)}
                />
            </label>
            <Input
                className="vac-color-swatch__hex"
                size="small"
                value={draft}
                onChange={setDraft}
                onBlur={commit}
                onPressEnter={commit}
            />
        </div>
    );
}

/** One row: width stepper, style dropdown, colour swatch. */
function BorderRow({
    label,
    value,
    onChange,
}: {
    label?: string;
    value: BorderValue;
    onChange: (next: BorderValue) => void;
}) {
    // Picking a style or colour on a side with no width yet should show a border straight away.
    const withWidth = (next: BorderValue): BorderValue =>
        next.width || next.style === 'none' ? next : { ...next, width: 1 };

    return (
        <div className="vac-border-row">
            {label && <div className="vac-border-row__label">{label}</div>}
            <div className="vac-border-row__controls">
                <InputNumber
                    className="vac-border-row__width"
                    mode="button"
                    size="small"
                    min={0}
                    max={MAX_WIDTH}
                    precision={0}
                    placeholder="0"
                    value={value.style === 'none' ? 0 : value.width}
                    onChange={(width) =>
                        onChange({
                            ...value,
                            width: width ?? undefined,
                            style: value.style === 'none' ? DEFAULT_STYLE : value.style,
                        })
                    }
                />
                <Select
                    className="vac-border-row__style"
                    size="small"
                    options={STYLE_OPTIONS}
                    value={value.style}
                    onChange={(style: string) => onChange(withWidth({ ...value, style }))}
                />
                <ColorSwatch
                    value={value.color}
                    onChange={(color) => onChange(withWidth({ ...value, color }))}
                />
            </div>
        </div>
    );
}

export function BorderControls() {
    const { focusIdx } = useFocusIdx();
    const { focusBlock, change } = useBlock();
    const attributes: Attributes = focusBlock?.attributes ?? {};

    const [mode, setMode] = useState<'all' | 'sides'>(() =>
        hasSideBorders(attributes) ? 'sides' : 'all'
    );
    // Selecting another text block re-derives the mode from that block's attributes.
    useEffect(() => {
        setMode(hasSideBorders(focusBlock?.attributes ?? {}) ? 'sides' : 'all');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusIdx]);

    // Local state per row so a half-edited side (e.g. width cleared) keeps its style and colour.
    const [all, setAll] = useState<BorderValue>(() => parseBorder(attributes.border));
    const [sides, setSides] = useState<Record<Side, BorderValue>>(() => sidesFrom(attributes));
    // Another block selected: reload everything.
    useEffect(() => {
        const current = focusBlock?.attributes ?? {};
        setAll(parseBorder(current.border));
        setSides(sidesFrom(current));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusIdx]);
    // Stored value changed under us (undo/redo, source edit): reload only the rows that no
    // longer match, so a row whose width was just cleared keeps its style and colour.
    const storedKey = [attributes.border, ...BORDER_SIDES.map((side) => attributes[sideKey(side)])].join('|');
    useEffect(() => {
        const current = focusBlock?.attributes ?? {};
        // Follow the stored shape when it is unambiguous; with no border at all keep the admin's choice.
        if (hasSideBorders(current)) setMode('sides');
        else if (current.border) setMode('all');
        setAll((prev) =>
            serializeBorder(prev) === (current.border || undefined) ? prev : parseBorder(current.border)
        );
        setSides((prev) => {
            const stored = sidesFrom(current);
            const next = { ...prev };
            BORDER_SIDES.forEach((side) => {
                if (serializeBorder(prev[side]) !== (current[sideKey(side)] || undefined)) {
                    next[side] = stored[side];
                }
            });
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storedKey]);

    const writeAttributes = (patch: Attributes) => {
        const next: Attributes = { ...attributes };
        Object.entries(patch).forEach(([key, val]) => {
            if (val) next[key] = val;
            else delete next[key];
        });
        change(`${focusIdx}.attributes`, next);
    };

    const updateAll = (value: BorderValue) => {
        setAll(value);
        writeAttributes({ border: serializeBorder(value) });
    };

    const updateSide = (side: Side, value: BorderValue) => {
        const nextSides = { ...sides, [side]: value };
        setSides(nextSides);
        writeAttributes({ [sideKey(side)]: serializeBorder(value) });
    };

    const switchMode = (nextMode: 'all' | 'sides') => {
        if (nextMode === mode) return;
        setMode(nextMode);
        const patch: Attributes = {};
        if (nextMode === 'sides') {
            // Start every side from the shared border, then drop the shorthand.
            const seeded = { top: all, right: all, bottom: all, left: all };
            setSides(seeded);
            BORDER_SIDES.forEach((side) => (patch[sideKey(side)] = serializeBorder(all)));
            patch.border = undefined;
        } else {
            // Collapse to the first side that has a border (top, right, bottom, left).
            const source =
                BORDER_SIDES.map((side) => sides[side]).find((v) => serializeBorder(v)) ?? all;
            setAll(source);
            BORDER_SIDES.forEach((side) => (patch[sideKey(side)] = undefined));
            patch.border = serializeBorder(source);
        }
        writeAttributes(patch);
    };

    const radius = parseRadius(attributes['border-radius']);

    return (
        <div className="vac-border-controls">
            <Radio.Group
                type="button"
                size="small"
                value={mode}
                onChange={switchMode}
                className="vac-border-controls__mode"
            >
                <Radio value="all">All sides</Radio>
                <Radio value="sides">Individual sides</Radio>
            </Radio.Group>

            <div className="vac-border-row__controls vac-border-controls__header">
                <span className="vac-border-row__width">Width (px)</span>
                <span className="vac-border-row__style">Style</span>
                <span>Colour</span>
            </div>

            {mode === 'all' ? (
                <BorderRow value={all} onChange={updateAll} />
            ) : (
                BORDER_SIDES.map((side) => (
                    <BorderRow
                        key={side}
                        label={SIDE_LABEL[side]}
                        value={sides[side]}
                        onChange={(value) => updateSide(side, value)}
                    />
                ))
            )}

            <div className="vac-border-row">
                <div className="vac-border-row__label">Corner radius</div>
                <div className="vac-border-row__controls">
                    <InputNumber
                        className="vac-border-row__width"
                        mode="button"
                        size="small"
                        min={0}
                        max={radius.unit === '%' ? 50 : MAX_RADIUS}
                        precision={0}
                        placeholder="0"
                        suffix={radius.unit}
                        value={radius.value}
                        onChange={(value) =>
                            writeAttributes({
                                'border-radius': value ? `${value}${radius.unit}` : undefined,
                            })
                        }
                    />
                </div>
            </div>
        </div>
    );
}

function sidesFrom(attributes: Attributes): Record<Side, BorderValue> {
    // A legacy `border` shorthand still seeds the per-side rows.
    const fallback = attributes.border;
    return {
        top: parseBorder(attributes['border-top'] ?? fallback),
        right: parseBorder(attributes['border-right'] ?? fallback),
        bottom: parseBorder(attributes['border-bottom'] ?? fallback),
        left: parseBorder(attributes['border-left'] ?? fallback),
    };
}

// Existing templates may hold a percentage radius from the old free-text field; keep its unit.
function parseRadius(raw?: string): { value?: number; unit: 'px' | '%' } {
    const match = raw?.trim().match(/^(\d*\.?\d+)\s*(px|%)?$/);
    if (!match?.[1]) return { unit: 'px' };
    return { value: Number(match[1]), unit: match[2] === '%' ? '%' : 'px' };
}
