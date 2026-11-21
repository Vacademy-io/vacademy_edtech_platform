import { useTranslation } from 'react-i18next';
import { Info } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type {
    BuiltinConfig,
    BuiltinWidget,
    CheckIssue,
    StatsCard,
} from '../../-types/learner-home-types';
import { BUILTIN_INFO, STATS_CARDS } from '../../-utils/builtins';
import { FieldIssues } from '../shared/FieldIssues';
import { exact } from '../shared/issues';
import { SwitchField } from '../shared/fields';

export function BuiltinEditor({
    blockKey,
    widget,
    config,
    onChange,
    issues,
}: {
    blockKey: string;
    widget: BuiltinWidget;
    config: BuiltinConfig;
    onChange: (next: BuiltinConfig) => void;
    issues: CheckIssue[];
}) {
    const { t } = useTranslation('learnerHome');
    const info = BUILTIN_INFO[widget];
    const o = config.options;
    const set = (patch: BuiltinConfig['options']) => onChange({ options: { ...o, ...patch } });

    const options = (() => {
        switch (widget) {
            case 'HERO':
                return (
                    <SwitchField
                        id={`${blockKey}-gs`}
                        label={t('builtin.gettingStarted')}
                        checked={o.getting_started !== false}
                        onChange={(getting_started) => set({ getting_started })}
                    />
                );
            case 'STATS_ROW': {
                const cards = o.cards ?? [...STATS_CARDS];
                const toggle = (c: StatsCard, on: boolean) =>
                    set({ cards: STATS_CARDS.filter((x) => (x === c ? on : cards.includes(x))) });
                return (
                    <fieldset className="space-y-2">
                        <legend className="text-body font-semibold text-neutral-700">
                            {t('builtin.cards')}
                        </legend>
                        {STATS_CARDS.map((c) => (
                            <div key={c} className="flex items-center gap-2">
                                <Checkbox
                                    id={`${blockKey}-card-${c}`}
                                    checked={cards.includes(c)}
                                    onCheckedChange={(v) => toggle(c, v === true)}
                                />
                                <Label htmlFor={`${blockKey}-card-${c}`} className="font-normal">
                                    {t(`builtin.cardNames.${c}`)}
                                </Label>
                            </div>
                        ))}
                        <FieldIssues issues={exact(issues, 'config.options.cards')} />
                    </fieldset>
                );
            }
            // ENROLLED_COURSES `show_all` is not read by the learner widget yet, so
            // the switch is not offered (the saved option stays false).
            case 'EXPLORE_BUTTONS':
                return (
                    <div className="space-y-3">
                        <SwitchField
                            id={`${blockKey}-mem`}
                            label={t('builtin.memberships')}
                            checked={o.memberships !== false}
                            onChange={(memberships) => set({ memberships })}
                        />
                        <SwitchField
                            id={`${blockKey}-books`}
                            label={t('builtin.books')}
                            checked={o.books !== false}
                            onChange={(books) => set({ books })}
                        />
                    </div>
                );
            default:
                return <p className="text-caption text-neutral-500">{t('builtin.noOptions')}</p>;
        }
    })();

    return (
        <div className="space-y-4">
            <p className="text-body text-neutral-700">{t(`builtins.${widget}.desc`)}</p>
            {options}
            <ul className="space-y-1 text-caption text-neutral-600">
                {!info.removable && <Note text={t('builtin.heroRequired')} />}
                {info.ownGate && <Note text={t('builtin.gateNote')} />}
                {info.hiddenInFun && <Note text={t('builtin.funNote')} />}
                <Note text={t('builtin.placeholderNote')} />
            </ul>
        </div>
    );
}

function Note({ text }: { text: string }) {
    return (
        <li className="flex items-start gap-1.5">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {text}
        </li>
    );
}
