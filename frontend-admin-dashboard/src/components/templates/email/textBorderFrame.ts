import type { ReactNode } from 'react';
import { AdvancedType, BasicType, BlockManager } from 'easy-email-core';
import type { IBlock, IBlockData } from 'easy-email-core';

/**
 * Border / border-radius support for the Text block.
 *
 * The Image block gets this for free: <mj-image> accepts `border` and `border-radius`
 * natively. <mj-text> accepts neither — MJML drops unknown attributes (and flags them as
 * validation errors, which surfaces as the "Some MJML errors occurred" toast on save).
 * Its wrapper <td> also sits inside a border-collapse table, where border-radius is
 * ignored, so the frame has to land on mj-text's own inner <div>.
 *
 * So instead of passing the attributes through, the Text render strips them, tags the
 * block with a `vac-text-frame-<hash>` css-class, and the Page render emits a matching
 * <mj-style inline="inline"> rule. MJML inlines that rule onto the <div> at compile time,
 * which leaves plain inline CSS in the final HTML — exactly what email clients want. The
 * same path runs in the editor's live preview, so what admins see is what gets sent.
 */

/** Text-block attributes handled here; none of them may reach the <mj-text> tag. */
export const TEXT_FRAME_ATTRIBUTES = ['border', 'border-radius', 'inner-padding'] as const;

const TEXT_BLOCK_TYPES: string[] = [BasicType.TEXT, AdvancedType.TEXT];
const CLASS_PREFIX = 'vac-text-frame-';

type Attributes = Record<string, string | undefined>;

function hasFrame(attributes: Attributes): boolean {
    return Boolean(attributes.border || attributes['border-radius']);
}

/** The CSS declarations for one text block's frame, or '' when it has none. */
function textFrameCss(attributes: Attributes): string {
    const declarations: string[] = [];
    if (attributes.border) declarations.push(`border:${attributes.border}`);
    if (attributes['border-radius'])
        declarations.push(`border-radius:${attributes['border-radius']}`);
    if (attributes['inner-padding']) declarations.push(`padding:${attributes['inner-padding']}`);
    // With a frame, the background belongs inside the border so rounded corners clip it.
    // Left on the outer <td> it would bleed past the radius into the block's padding.
    if (hasFrame(attributes) && attributes['container-background-color']) {
        declarations.push(`background-color:${attributes['container-background-color']}`);
    }
    return declarations.join(';');
}

// djb2 — blocks with identical frames share one class, so the head stays small.
function textFrameClassName(css: string): string {
    let hash = 5381;
    for (let i = 0; i < css.length; i++) {
        hash = ((hash << 5) + hash + css.charCodeAt(i)) | 0;
    }
    return `${CLASS_PREFIX}${(hash >>> 0).toString(36)}`;
}

/** Text block data with the frame attributes swapped for the css-class that carries them. */
function withTextFrameClass(data: IBlockData): IBlockData {
    const attributes: Attributes = { ...data.attributes };
    const css = textFrameCss(attributes);
    TEXT_FRAME_ATTRIBUTES.forEach((key) => delete attributes[key]);
    if (!css) return { ...data, attributes };

    if (hasFrame(data.attributes)) delete attributes['container-background-color'];
    attributes['css-class'] = [attributes['css-class'], textFrameClassName(css)]
        .filter(Boolean)
        .join(' ');
    return { ...data, attributes };
}

function collectTextFrameRules(block: IBlockData, rules: Map<string, string>): Map<string, string> {
    if (TEXT_BLOCK_TYPES.includes(block.type)) {
        const css = textFrameCss(block.attributes);
        if (css) rules.set(textFrameClassName(css), css);
    }
    block.children?.forEach((child) => collectTextFrameRules(child, rules));
    return rules;
}

type RenderParams<T extends IBlockData> = Parameters<IBlock<T>['render']>[0];

// Re-registers a block with a wrapped render; everything else delegates to the original.
function overrideRender<T extends IBlockData>(
    type: string,
    render: (original: IBlock<T>, params: RenderParams<T>) => ReactNode
) {
    const original = BlockManager.getBlockByType<T>(type);
    if (!original) throw new Error(`easy-email block "${type}" is not registered`);
    const block: IBlock<T> = {
        get name() {
            return original.name;
        },
        type: original.type,
        create: original.create,
        validParentType: original.validParentType,
        render: (params) => render(original, params),
    };
    // registerBlocks takes IBlock<IBlockData>; IBlock<T> is not assignable
    // (`create`'s payload is contravariant), but the block IS the T-typed
    // original with only `render` wrapped, so widening back is safe.
    BlockManager.registerBlocks({ [type]: block as unknown as IBlock });
}

let registered = false;

/**
 * Installs the Text-frame render overrides. Idempotent; call once before the editor
 * mounts (module scope of EmailBuilder). Advanced text blocks resolve their base render
 * through BlockManager at render time, so overriding BasicType.TEXT covers both.
 */
export function registerTextBorderFrame(): void {
    if (registered) return;
    registered = true;

    overrideRender<IBlockData>(BasicType.TEXT, (original, params) =>
        original.render({ ...params, data: withTextFrameClass(params.data) })
    );

    overrideRender<IBlockData>(BasicType.PAGE, (original, params) => {
        const rules = collectTextFrameRules(params.data, new Map());
        if (rules.size === 0) return original.render(params);

        const content = Array.from(rules, ([className, css]) => `.${className} > div{${css}}`).join(
            '\n'
        );
        const value = params.data.data.value;
        return original.render({
            ...params,
            data: {
                ...params.data,
                data: {
                    ...params.data.data,
                    value: {
                        ...value,
                        headStyles: [...(value.headStyles ?? []), { content, inline: 'inline' }],
                    },
                },
            },
        });
    });
}
