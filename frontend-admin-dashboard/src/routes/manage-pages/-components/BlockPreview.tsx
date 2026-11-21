/**
 * BlockPreview — the look-alike picture of one block, drawn inside the admin
 * with the site's theme, fonts and section styles (renderComponentPreview).
 *
 * The Structure view shows it under each row when "Show previews" is on. It
 * does not depend on the learner site, so an institute whose Website view
 * cannot load still edits against a visual canvas. It is an approximation:
 * the Website view is the real page.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { CatalogueConfig, Component } from '../-types/editor-types';
import { renderComponentPreview } from './ComponentPreviews';
import {
    buildComponentStyle,
    buildPrimaryScaleVars,
    buildSectionShellStyles,
    hasSectionShell,
} from '../-utils/style-utils';
import { SectionDecorations, hasDecorations } from '../-utils/catalogue-decorations';

/**
 * The site's theme around a preview: the same data attributes and inline
 * variables as the learner page wrapper, so theme tokens, radius, type scale,
 * brand colour and fonts read as they do on the site.
 */
export const PreviewSurface = ({
    config,
    children,
}: {
    config: CatalogueConfig | null | undefined;
    children: ReactNode;
}) => {
    const settings = config?.globalSettings;
    const fonts = settings?.fonts;
    const style: CSSProperties = {
        ...(buildPrimaryScaleVars(settings?.theme?.primaryColor) as CSSProperties),
        fontFamily: fonts?.enabled && fonts.family ? fonts.family : undefined,
        ...(fonts?.enabled && fonts.headingFamily
            ? ({ '--catalogue-heading-font': fonts.headingFamily } as CSSProperties)
            : {}),
    };
    return (
        <div
            className={`relative overflow-hidden bg-catalogue-bg-elevated${settings?.mode === 'dark' ? ' dark' : ''}`}
            data-catalogue-theme={settings?.theme?.preset || 'default'}
            data-catalogue-radius={settings?.theme?.borderRadius || 'rounded'}
            data-heading-scale={settings?.theme?.headingScale || 'default'}
            data-catalogue-atmosphere={settings?.theme?.atmosphere?.canvas || 'flat'}
            data-catalogue-motion={settings?.motion?.personality}
            data-catalogue-intensity={settings?.theme?.atmosphere?.intensity || 'subtle'}
            data-catalogue-density={settings?.compactness || 'medium'}
            style={style}
        >
            {children}
        </div>
    );
};

/** One block as the old editor canvas drew it: its section style, background
 *  overlay and decorations around renderComponentPreview. Never interactive. */
export const BlockPreview = ({ component }: { component: Component }) => {
    const style = component.style;
    const shellStyles = hasSectionShell(style) ? buildSectionShellStyles(style!) : null;
    // Like the learner renderer: a shell with no background of its own takes
    // the block's own backgroundColor prop, so the band paints full width.
    if (
        shellStyles &&
        !shellStyles.canvasStyle.backgroundColor &&
        !shellStyles.canvasStyle.background &&
        !shellStyles.canvasStyle.backgroundImage
    ) {
        const propBg = (component.props as Record<string, unknown> | undefined)?.backgroundColor;
        if (typeof propBg === 'string' && propBg) shellStyles.canvasStyle.backgroundColor = propBg;
    }
    const outerStyle = shellStyles ? shellStyles.canvasStyle : buildComponentStyle(style);
    const hasOverlay = !!(style?.backgroundImage && style?.backgroundOverlay);
    const decor = hasDecorations(style?.ornaments, style?.dividers);
    const layered = hasOverlay || decor;
    return (
        <div
            data-testid="block-preview"
            aria-hidden="true"
            className={`relative ${style?.customClass || ''} ${component.enabled === false ? 'opacity-40' : ''}`}
            style={{ ...outerStyle, ...(style?.ornaments?.length ? { overflow: 'hidden' } : {}) }}
        >
            {hasOverlay && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundColor: style!.backgroundOverlay,
                        zIndex: 0,
                        borderRadius: outerStyle.borderRadius,
                    }}
                />
            )}
            {decor && <SectionDecorations ornaments={style?.ornaments} dividers={style?.dividers} />}
            <div
                style={
                    shellStyles
                        ? { ...shellStyles.contentStyle, pointerEvents: 'none', position: 'relative', zIndex: 1 }
                        : {
                              pointerEvents: 'none',
                              position: layered ? 'relative' : undefined,
                              zIndex: layered ? 1 : undefined,
                          }
                }
            >
                {renderComponentPreview(component)}
            </div>
        </div>
    );
};
