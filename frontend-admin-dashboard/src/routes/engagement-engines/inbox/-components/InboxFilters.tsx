import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarBlank, Check, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { DatePickerButton } from '@/components/shared/crm-enhance/date-picker-button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { buildChannelMeta, CHANNEL_ORDER } from '../../-constants';
import type { ChannelKey, EngagementEngine } from '../../-types';
import { formatInboxPeriod, movePeriodEnd } from '../-utils/period';
import { hasInboxFilters, type InboxSearch } from '../-utils/search';

const ALL = 'all';

/** The kinds the select offers (NO_OP is the waited tab, not a choice). */
const KINDS = ['TASK', 'REPLY', 'SEND', 'CRM'] as const;

/** Wording of each kind in the kind select; CRM comes from the actions locale. */
const KIND_LABEL_KEY = {
    TASK: 'toolbar.kindTask',
    REPLY: 'toolbar.kindReply',
    SEND: 'toolbar.kindSend',
} as const;

type Patch = Partial<InboxSearch>;

/**
 * The inbox's server-side filters: engine, channel, kind and day or period. They read from and
 * write to the URL (through `onChange`); the only local state is whether the From / To pickers
 * are open. Renders inline, to sit in the toolbar's wrapping row.
 */
export function InboxFilterControls({
    search,
    engines,
    enginesLoaded,
    onChange,
}: {
    search: InboxSearch;
    engines: Pick<EngagementEngine, 'id' | 'name'>[];
    enginesLoaded: boolean;
    onChange: (patch: Patch) => void;
}) {
    const { t } = useTranslation('engagementEnginesInboxIndex');
    const { t: tActions } = useTranslation('engagementEnginesActions');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    const channelMeta = buildChannelMeta(tConstants);
    // A link can name an engine the list does not hold; the select still has to show something.
    const unknownEngine =
        enginesLoaded && !!search.engine && !engines.some((e) => e.id === search.engine);
    // The waited tab is NO_OP and the approvals tab CRM by definition: no kind to choose.
    const showKind = search.filter !== 'waited' && search.filter !== 'approvals';
    // A period set in the URL shows as a chip under the toolbar; the pickers open on request.
    const [editingPeriod, setEditingPeriod] = useState(false);
    const period = { from: search.from, to: search.to };
    const openPeriod = () => {
        // A day already chosen becomes a one-day period to widen, rather than being lost.
        if (search.date) onChange({ date: undefined, from: search.date, to: search.date });
        setEditingPeriod(true);
    };

    return (
        <>
            <Select
                value={search.engine ?? ALL}
                onValueChange={(v) => onChange({ engine: v === ALL ? undefined : v })}
            >
                <SelectTrigger className="w-44" aria-label={t('toolbar.allEngines')}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL}>{t('toolbar.allEngines')}</SelectItem>
                    {unknownEngine && search.engine && (
                        <SelectItem value={search.engine}>{t('toolbar.selectedEngine')}</SelectItem>
                    )}
                    {engines.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                            {e.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Select
                value={search.channel ?? ALL}
                onValueChange={(v) =>
                    onChange({ channel: v === ALL ? undefined : (v as ChannelKey) })
                }
            >
                <SelectTrigger className="w-36" aria-label={t('toolbar.allChannels')}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL}>{t('toolbar.allChannels')}</SelectItem>
                    {CHANNEL_ORDER.map((c) => (
                        <SelectItem key={c} value={c}>
                            {channelMeta[c].label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {showKind && (
                <Select
                    value={search.kind ?? ALL}
                    onValueChange={(v) =>
                        onChange({ kind: v === ALL ? undefined : (v as InboxSearch['kind']) })
                    }
                >
                    <SelectTrigger className="w-40" aria-label={t('toolbar.allKinds')}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>{t('toolbar.allKinds')}</SelectItem>
                        {KINDS.map((k) => (
                            <SelectItem key={k} value={k}>
                                {k === 'CRM' ? tActions('inbox.kindFilter') : t(KIND_LABEL_KEY[k])}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}
            {editingPeriod ? (
                <div className="flex items-center gap-1">
                    <DatePickerButton
                        label={t('toolbar.from')}
                        value={search.from ?? ''}
                        onChange={(day) =>
                            onChange({ date: undefined, ...movePeriodEnd(period, 'from', day) })
                        }
                        placeholder={t('toolbar.pickDay')}
                    />
                    <DatePickerButton
                        label={t('toolbar.to')}
                        value={search.to ?? ''}
                        onChange={(day) =>
                            onChange({ date: undefined, ...movePeriodEnd(period, 'to', day) })
                        }
                        placeholder={t('toolbar.pickDay')}
                    />
                    <MyButton
                        buttonType="secondary"
                        layoutVariant="icon"
                        scale="medium"
                        aria-label={t('toolbar.doneRange')}
                        title={t('toolbar.doneRange')}
                        onClick={() => setEditingPeriod(false)}
                    >
                        <Check size={14} />
                    </MyButton>
                </div>
            ) : (
                <div className="flex items-center gap-1">
                    {!(search.from && search.to) && (
                        <DatePickerButton
                            label={t('toolbar.day')}
                            value={search.date ?? ''}
                            onChange={(date) => onChange({ date })}
                            placeholder={t('toolbar.anyDay')}
                        />
                    )}
                    {search.date && (
                        <MyButton
                            buttonType="secondary"
                            layoutVariant="icon"
                            scale="medium"
                            aria-label={t('toolbar.clearDay')}
                            title={t('toolbar.clearDay')}
                            onClick={() => onChange({ date: undefined })}
                        >
                            <X size={14} />
                        </MyButton>
                    )}
                    <MyButton buttonType="text" scale="medium" onClick={openPeriod}>
                        <CalendarBlank className="me-1 size-4" /> {t('toolbar.dateRange')}
                    </MyButton>
                </div>
            )}
        </>
    );
}

/** A filter that arrived in a link (an outcome, a template) shown as a chip you can remove. */
function RemovableChip({
    label,
    removeLabel,
    onRemove,
}: {
    label: string;
    removeLabel: string;
    onRemove: () => void;
}) {
    return (
        <span
            title={label}
            className="inline-flex max-w-xs items-center gap-1 rounded-md bg-primary-50 py-0.5 pe-1 ps-2 font-medium text-primary-600"
        >
            <span className="truncate text-caption">{label}</span>
            <button
                type="button"
                aria-label={removeLabel}
                onClick={onRemove}
                className="shrink-0 rounded-sm p-0.5 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <X size={12} weight="bold" />
            </button>
        </span>
    );
}

/**
 * What the list is narrowed to beyond the controls above: the period, outcome and template from
 * a report link, as removable chips, and "Clear filters". Renders nothing with no filter on.
 */
export function ActiveFilters({
    search,
    onChange,
    onClear,
}: {
    search: InboxSearch;
    onChange: (patch: Patch) => void;
    onClear: () => void;
}) {
    const { t } = useTranslation('engagementEnginesInboxIndex');
    if (!hasInboxFilters(search)) return null;
    return (
        <div className="flex flex-wrap items-center gap-2">
            {search.from && search.to && (
                <RemovableChip
                    label={t('chips.period', {
                        value: formatInboxPeriod(search.from, search.to),
                    })}
                    removeLabel={t('chips.removePeriod')}
                    onRemove={() => onChange({ from: undefined, to: undefined })}
                />
            )}
            {search.outcome && (
                <RemovableChip
                    label={t('chips.outcome', { value: t(`outcomeFilter.${search.outcome}`) })}
                    removeLabel={t('chips.removeOutcome')}
                    onRemove={() => onChange({ outcome: undefined })}
                />
            )}
            {search.template && (
                <RemovableChip
                    label={t('chips.template', { name: search.template })}
                    removeLabel={t('chips.removeTemplate')}
                    onRemove={() => onChange({ template: undefined })}
                />
            )}
            <MyButton buttonType="text" scale="small" onClick={onClear}>
                {t('chips.clear')}
            </MyButton>
        </div>
    );
}
