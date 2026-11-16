import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MyButton } from '@/components/design-system/button';
import type { CheckIssue, ShortcutTile, ShortcutsConfig } from '../../-types/learner-home-types';
import { emptyTile } from '../../-utils/block-factory';
import { LIMITS } from '../../-utils/publish-checks';
import { FieldIssues } from '../shared/FieldIssues';
import { IconPicker } from '../shared/IconPicker';
import { ImageRefField } from '../shared/ImageRefField';
import { exact } from '../shared/issues';
import { LinkTargetPicker } from '../shared/LinkTargetPicker';
import { TextField } from '../shared/fields';

export function ShortcutsEditor({
    blockKey,
    config,
    onChange,
    issues,
}: {
    blockKey: string;
    config: ShortcutsConfig;
    onChange: (next: ShortcutsConfig) => void;
    issues: CheckIssue[];
}) {
    const { t } = useTranslation('learnerHome');
    const setTile = (i: number, next: ShortcutTile) =>
        onChange({ ...config, tiles: config.tiles.map((x, j) => (j === i ? next : x)) });
    const move = (i: number, to: number) => {
        const tiles = [...config.tiles];
        const [x] = tiles.splice(i, 1);
        tiles.splice(to, 0, x!);
        onChange({ ...config, tiles });
    };
    return (
        <div className="space-y-4">
            <TextField
                id={`${blockKey}-title`}
                label={t('shortcuts.title')}
                value={config.title}
                onChange={(title) => onChange({ ...config, title })}
                max={LIMITS.shortcuts.title}
                issues={issues}
                path="config.title"
            />
            <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-body font-semibold text-neutral-700">{t('shortcuts.tiles')}</h4>
                <span className="text-caption text-neutral-500">{t('shortcuts.maxTiles')}</span>
            </div>
            <FieldIssues issues={exact(issues, 'config.tiles')} />
            <ol className="space-y-3">
                {config.tiles.map((tile, i) => {
                    const p = `config.tiles[${i}]`;
                    const n = i + 1;
                    return (
                        <li
                            key={tile.key}
                            className="space-y-3 rounded-md border border-neutral-200 p-3"
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-body font-semibold">
                                    {t('shortcuts.tile', { n })}
                                </span>
                                <div className="flex items-center gap-1">
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="medium"
                                        aria-label={t('shortcuts.moveUp', { n })}
                                        disabled={i === 0}
                                        onClick={() => move(i, i - 1)}
                                    >
                                        <ArrowUp className="size-4" />
                                    </MyButton>
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="medium"
                                        aria-label={t('shortcuts.moveDown', { n })}
                                        disabled={i === config.tiles.length - 1}
                                        onClick={() => move(i, i + 1)}
                                    >
                                        <ArrowDown className="size-4" />
                                    </MyButton>
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="medium"
                                        aria-label={t('shortcuts.removeTile', { n })}
                                        disabled={config.tiles.length <= LIMITS.shortcuts.tilesMin}
                                        onClick={() =>
                                            onChange({
                                                ...config,
                                                tiles: config.tiles.filter((_, j) => j !== i),
                                            })
                                        }
                                    >
                                        <Trash className="size-4" />
                                    </MyButton>
                                </div>
                            </div>
                            <TextField
                                id={`${tile.key}-label`}
                                label={t('shortcuts.label')}
                                value={tile.label}
                                onChange={(label) => setTile(i, { ...tile, label })}
                                max={LIMITS.shortcuts.label}
                                issues={issues}
                                path={`${p}.label`}
                            />
                            <fieldset className="space-y-2">
                                <legend className="text-body font-semibold text-neutral-700">
                                    {t('shortcuts.iconKind')}
                                </legend>
                                <RadioGroup
                                    value={tile.icon.kind}
                                    onValueChange={(kind) =>
                                        setTile(i, {
                                            ...tile,
                                            icon:
                                                kind === 'ICON'
                                                    ? { kind: 'ICON', name: 'Star' }
                                                    : { kind: 'IMAGE', image: null },
                                        })
                                    }
                                    className="flex gap-4"
                                >
                                    {(['ICON', 'IMAGE'] as const).map((k) => (
                                        <div key={k} className="flex items-center gap-2">
                                            <RadioGroupItem
                                                id={`${tile.key}-kind-${k}`}
                                                value={k}
                                            />
                                            <Label
                                                htmlFor={`${tile.key}-kind-${k}`}
                                                className="font-normal"
                                            >
                                                {t(`shortcuts.iconKinds.${k}`)}
                                            </Label>
                                        </div>
                                    ))}
                                </RadioGroup>
                                {tile.icon.kind === 'ICON' ? (
                                    <IconPicker
                                        id={`${tile.key}-icon`}
                                        value={tile.icon.name}
                                        onChange={(name) =>
                                            setTile(i, { ...tile, icon: { kind: 'ICON', name } })
                                        }
                                    />
                                ) : (
                                    <ImageRefField
                                        id={`${tile.key}-img`}
                                        label={t('shortcuts.image')}
                                        slot="tileIcon"
                                        value={tile.icon.image}
                                        onChange={(image) =>
                                            setTile(i, { ...tile, icon: { kind: 'IMAGE', image } })
                                        }
                                        issues={issues}
                                        path={`${p}.icon.image`}
                                    />
                                )}
                                <FieldIssues issues={exact(issues, `${p}.icon`)} />
                            </fieldset>
                            <LinkTargetPicker
                                id={`${tile.key}-link`}
                                label={t('banner.link')}
                                value={tile.link}
                                allowNone={false}
                                onChange={(link) => setTile(i, { ...tile, link })}
                                issues={issues}
                                path={`${p}.link`}
                            />
                        </li>
                    );
                })}
            </ol>
            {config.tiles.length < LIMITS.shortcuts.tilesMax && (
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={() => onChange({ ...config, tiles: [...config.tiles, emptyTile()] })}
                >
                    <Plus className="me-1 size-3.5" aria-hidden />
                    {t('shortcuts.addTile')}
                </MyButton>
            )}
        </div>
    );
}
