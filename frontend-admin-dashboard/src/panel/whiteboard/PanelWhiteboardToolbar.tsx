/**
 * Large bottom toolbar for the panel whiteboard: tools, ink colours, undo/redo.
 * Every target is >= size-14 (colours) / h-16 (tools) at the 10-foot root
 * scale. space-x-* only: flex `gap` needs Chrome 84.
 *
 * Labels under the tool icons appear from xl (1280 CSS px); below that the bar
 * is icon-only so it still fits a 960 px wide Android TV viewport.
 */
import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    ArrowCounterClockwise,
    Cursor,
    Eraser,
    HandGrabbing,
    Highlighter,
    PencilSimple,
    type Icon,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import {
    WHITEBOARD_TOOLS,
    paletteFor,
    type InkColourKey,
    type InkSelection,
    type WhiteboardTool,
} from './whiteboardTools';

const TOOL_ICONS: Record<WhiteboardTool, Icon> = {
    pen: PencilSimple,
    highlighter: Highlighter,
    eraser: Eraser,
    pan: HandGrabbing,
    select: Cursor,
};

interface BarButtonProps {
    icon: Icon;
    label: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
}

/** Icon + (xl+) caption button. Active = selected tool. */
function BarButton({ icon: IconComponent, label, active, disabled, onClick }: BarButtonProps) {
    return (
        <MyButton
            type="button"
            buttonType="secondary"
            layoutVariant="icon"
            scale="large"
            aria-label={label}
            aria-pressed={active}
            title={label}
            disable={disabled}
            onClick={onClick}
            className={cn(
                // ui/button forces [&_svg]:size-4; 10-foot icons need size-8.
                'h-16 w-auto min-w-16 shrink-0 px-2 [&_svg]:size-8',
                // primary-500, not 600: ThemeProvider re-themes 50-500 only, so 600
                // stayed the default orange on an institute-branded (teal) panel.
                active && '!border-primary-500 !bg-primary-100 !text-primary-500'
            )}
        >
            <span className="flex flex-col items-center justify-center">
                <IconComponent size={32} weight={active ? 'fill' : 'regular'} aria-hidden />
                <span className="hidden text-caption leading-none xl:mt-1 xl:block">{label}</span>
            </span>
        </MyButton>
    );
}

function Divider() {
    return <span className="mx-1 h-12 w-px shrink-0 bg-border lg:mx-2" aria-hidden />;
}

export interface PanelWhiteboardToolbarProps {
    tool: WhiteboardTool;
    ink: InkSelection;
    disabled?: boolean;
    onToolChange: (tool: WhiteboardTool) => void;
    onColourChange: (colour: InkColourKey) => void;
    onUndo: () => void;
    onRedo: () => void;
}

export function PanelWhiteboardToolbar({
    tool,
    ink,
    disabled,
    onToolChange,
    onColourChange,
    onUndo,
    onRedo,
}: PanelWhiteboardToolbarProps) {
    const { t } = useTranslation('whiteboard');
    const palette = paletteFor(tool);
    const drawing = tool === 'pen' || tool === 'highlighter';
    const selectedColour = tool === 'highlighter' ? ink.highlighter : ink.pen;

    return (
        <div
            role="toolbar"
            aria-label={t('toolbarLabel')}
            className="pointer-events-auto flex max-w-full items-center overflow-x-auto rounded-lg border border-border bg-card p-2 shadow-lg"
        >
            <div className="flex items-center space-x-1 lg:space-x-2">
                {WHITEBOARD_TOOLS.map((name) => (
                    <BarButton
                        key={name}
                        icon={TOOL_ICONS[name]}
                        label={t(`tools.${name}`)}
                        active={tool === name}
                        disabled={disabled}
                        onClick={() => onToolChange(name)}
                    />
                ))}
            </div>

            <Divider />

            <div
                role="radiogroup"
                aria-label={t('coloursLabel')}
                className="flex items-center space-x-1 lg:space-x-2"
            >
                {palette.map((colour) => {
                    const selected = drawing && colour.key === selectedColour;
                    const label = t(`colours.${colour.key}`);
                    return (
                        <MyButton
                            key={colour.key}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={label}
                            title={label}
                            buttonType="secondary"
                            layoutVariant="icon"
                            scale="large"
                            disable={disabled}
                            onClick={() => onColourChange(colour.key)}
                            className={cn(
                                // 48 px swatches below lg so the bar fits a 912-960 px TV viewport.
                                'size-12 shrink-0 rounded-full lg:size-14 [&_svg]:size-8 lg:[&_svg]:size-9',
                                selected && '!border-4 !border-primary-500'
                            )}
                        >
                            {/* SVG fill = the ink colour itself (canvas content), not a UI token. */}
                            <svg viewBox="0 0 32 32" aria-hidden>
                                <circle cx="16" cy="16" r="15" fill={colour.hex} />
                            </svg>
                        </MyButton>
                    );
                })}
            </div>

            <Divider />

            <div className="flex items-center space-x-1 lg:space-x-2">
                <BarButton
                    icon={ArrowCounterClockwise}
                    label={t('actions.undo')}
                    disabled={disabled}
                    onClick={onUndo}
                />
                <BarButton
                    icon={ArrowClockwise}
                    label={t('actions.redo')}
                    disabled={disabled}
                    onClick={onRedo}
                />
            </div>
        </div>
    );
}
