import { useTranslation } from 'react-i18next';
import { Plus } from '@phosphor-icons/react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MyButton } from '@/components/design-system/button';
import {
    BUILTIN_WIDGETS,
    CONTENT_BLOCK_TYPES,
    type BuiltinWidget,
    type ContentBlockType,
    type HomeBlock,
} from '../-types/learner-home-types';
import { LIMITS } from '../-utils/publish-checks';
import { BLOCK_TYPE_ICON } from './block-display';

/** "Add block": the 5 new types, then the built-ins not on the page yet (spec 8.2). */
export function AddBlockMenu({
    blocks,
    onAddContent,
    onAddBuiltin,
}: {
    blocks: HomeBlock[];
    onAddContent: (type: ContentBlockType) => void;
    onAddBuiltin: (widget: BuiltinWidget) => void;
}) {
    const { t } = useTranslation('learnerHome');
    const full = blocks.length >= LIMITS.blocks;
    const contentCount = blocks.filter((b) => b.type !== 'BUILTIN').length;
    const placed = new Set(blocks.flatMap((b) => (b.type === 'BUILTIN' ? [b.builtin_widget] : [])));
    const missing = BUILTIN_WIDGETS.filter((w) => !placed.has(w));
    const typeFull = (type: ContentBlockType) => {
        const max = LIMITS.perType[type];
        return (
            full ||
            contentCount >= LIMITS.contentBlocks ||
            (max !== undefined && blocks.filter((b) => b.type === type).length >= max)
        );
    };
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <MyButton type="button" buttonType="secondary" scale="medium" className="w-full">
                    <Plus className="me-1 size-4" aria-hidden />
                    {t('add.button')}
                </MyButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
                <DropdownMenuLabel>{t('add.content')}</DropdownMenuLabel>
                {CONTENT_BLOCK_TYPES.map((type) => {
                    const Icon = BLOCK_TYPE_ICON[type];
                    const disabled = typeFull(type);
                    return (
                        <DropdownMenuItem
                            key={type}
                            disabled={disabled}
                            onSelect={() => onAddContent(type)}
                            className="items-start gap-2"
                        >
                            <Icon className="mt-0.5 size-4 shrink-0 text-primary-500" aria-hidden />
                            <span className="min-w-0">
                                <span className="block text-body">{t(`blockTypes.${type}`)}</span>
                                <span className="block text-caption text-neutral-500">
                                    {disabled ? t('add.limitReached') : t(`blockTypeHints.${type}`)}
                                </span>
                            </span>
                        </DropdownMenuItem>
                    );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t('add.builtins')}</DropdownMenuLabel>
                {missing.length === 0 ? (
                    <p className="px-2 py-1.5 text-caption text-neutral-500">
                        {t('add.allPlaced')}
                    </p>
                ) : (
                    missing.map((w) => (
                        <DropdownMenuItem key={w} disabled={full} onSelect={() => onAddBuiltin(w)}>
                            {t(`builtins.${w}.name`)}
                        </DropdownMenuItem>
                    ))
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
