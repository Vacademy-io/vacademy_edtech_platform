import { useTranslation } from 'react-i18next';
import { ChatCircleText } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { ColorPickerField } from './ColorPickerField';
import { Note, Pills, Section } from './PromoPopupEditor';
import { useReviewManagerStore } from '../-stores/review-manager-store';

/**
 * Property panel for the "reviewCollector" block (learner:
 * review/ReviewCollector.tsx) — how a site asks visitors for a review.
 *
 * A preset sets the look and behaviour in one click (display, button, where it
 * sits, when it opens); every one of those stays editable below. Text fields
 * left empty use the built-in wording in the visitor's site language.
 * Reviews land in Website Builder → Reviews for the admin to approve.
 */

type Display = 'floatingPopup' | 'floating' | 'popup' | 'inline';
type FieldMode = 'off' | 'optional' | 'required';

interface Preset {
    key: string;
    props: Record<string, string | number>;
}

const PRESETS: Preset[] = [
    { key: 'buttonAndPopup', props: { display: 'floatingPopup', buttonStyle: 'pill', position: 'bottom-right', popupStyle: 'modal', trigger: 'delay', delaySeconds: 5, frequency: 'once' } },
    { key: 'floatingButton', props: { display: 'floating', buttonStyle: 'pill', position: 'bottom-right', popupStyle: 'modal' } },
    { key: 'sideTab', props: { display: 'floating', buttonStyle: 'tab', position: 'middle-right', popupStyle: 'modal' } },
    { key: 'popupAfterDelay', props: { display: 'popup', popupStyle: 'modal', trigger: 'delay', delaySeconds: 5, frequency: 'weekly' } },
    { key: 'popupFirstVisit', props: { display: 'popup', popupStyle: 'modal', trigger: 'delay', delaySeconds: 0, frequency: 'once' } },
    { key: 'cornerCard', props: { display: 'popup', popupStyle: 'corner', position: 'bottom-right', trigger: 'delay', delaySeconds: 8, frequency: 'weekly' } },
    { key: 'inlineForm', props: { display: 'inline' } },
];

/** A small schematic of each preset: a page with the launcher / popup drawn on it. */
const PresetThumb = ({ preset }: { preset: string }) => {
    const accent = 'bg-primary-400';
    const page = 'relative h-full w-full overflow-hidden rounded bg-white shadow-sm';
    const lines = (
        <div className="space-y-1 p-1.5">
            <div className="h-1 w-3/4 rounded-full bg-neutral-200" />
            <div className="h-1 w-1/2 rounded-full bg-neutral-200" />
        </div>
    );
    const modal = (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-800/40">
            <div className="flex w-1/2 flex-col items-center gap-0.5 rounded-sm bg-white p-1">
                <div className={cn('h-1 w-3/4 rounded-full', accent)} />
                <div className="h-1 w-1/2 rounded-full bg-neutral-300" />
            </div>
        </div>
    );
    switch (preset) {
        case 'buttonAndPopup':
            return (
                <div className={page}>
                    {lines}
                    {modal}
                    <div className={cn('absolute bottom-1 right-1 h-1.5 w-5 rounded-full', accent)} />
                </div>
            );
        case 'floatingButton':
            return (
                <div className={page}>
                    {lines}
                    <div className={cn('absolute bottom-1 right-1 h-2 w-6 rounded-full', accent)} />
                </div>
            );
        case 'sideTab':
            return (
                <div className={page}>
                    {lines}
                    <div className={cn('absolute right-0 top-1/2 h-6 w-1.5 -translate-y-1/2 rounded-l-sm', accent)} />
                </div>
            );
        case 'popupAfterDelay':
        case 'popupFirstVisit':
            return (
                <div className={page}>
                    {lines}
                    {modal}
                </div>
            );
        case 'cornerCard':
            return (
                <div className={page}>
                    {lines}
                    <div className="absolute bottom-1 right-1 flex w-2/5 flex-col gap-0.5 rounded-sm border bg-white p-1 shadow">
                        <div className={cn('h-1 w-3/4 rounded-full', accent)} />
                        <div className="h-1 w-1/2 rounded-full bg-neutral-300" />
                    </div>
                </div>
            );
        default:
            return (
                <div className={page}>
                    {lines}
                    <div className="mx-auto mt-0.5 flex w-3/5 flex-col gap-0.5 rounded-sm border p-1">
                        <div className={cn('h-1 w-1/2 rounded-full', accent)} />
                        <div className="h-1.5 w-full rounded-sm bg-neutral-100" />
                    </div>
                </div>
            );
    }
};

const matches = (props: Record<string, unknown>, preset: Preset) =>
    Object.entries(preset.props).every(([k, v]) => {
        const current = props[k];
        if (current === undefined || current === null || current === '') return false;
        return String(current) === String(v);
    });

const FIELD_KEYS = ['reviewText', 'course', 'city', 'designation'] as const;
const LABEL_PROP: Record<(typeof FIELD_KEYS)[number], string> = {
    reviewText: 'textLabel',
    course: 'courseLabel',
    city: 'cityLabel',
    designation: 'designationLabel',
};

export const ReviewCollectorEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesReviews');
    const { t: tp } = useTranslation('managePagesPromoPopup');
    const openReviews = useReviewManagerStore((s) => s.open);
    const { props } = component;
    const display: Display = ['floatingPopup', 'floating', 'popup', 'inline'].includes(props.display) ? props.display : 'floatingPopup';
    const hasLauncher = display === 'floating' || display === 'floatingPopup';
    const opensByItself = display === 'popup' || display === 'floatingPopup';
    const trigger = props.trigger || 'delay';
    const fields: Record<string, FieldMode> = { reviewText: 'optional', city: 'optional', course: 'optional', designation: 'optional', ...(props.fields || {}) };
    const courseOptions: string[] = Array.isArray(props.courseOptions) ? props.courseOptions : [];

    const update = (patch: Record<string, unknown>) =>
        updateComponent(pageId, component.id, { props: { ...props, ...patch } });
    const updateProp = (key: string, value: unknown) => update({ [key]: value });

    return (
        <div className="space-y-4">
            <div className="space-y-2 rounded border bg-gray-50 p-3">
                <p className="text-xs text-gray-600">{t('editor.manageHint')}</p>
                <MyButton buttonType="secondary" scale="small" className="w-full" onClick={() => openReviews()}>
                    <ChatCircleText className="size-4" /> {t('editor.openReviews')}
                </MyButton>
            </div>

            {/* ── Template ─────────────────────────────────────────── */}
            <Section title={t('editor.sections.template')}>
                <div className="grid grid-cols-2 gap-2">
                    {PRESETS.map((preset) => {
                        const active = matches(props, preset);
                        return (
                            <button
                                key={preset.key}
                                type="button"
                                onClick={() => update(preset.props)}
                                aria-pressed={active}
                                className={cn(
                                    'flex flex-col gap-1.5 rounded-lg border p-1.5 text-start transition-colors',
                                    active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 hover:border-blue-300'
                                )}
                            >
                                <div className="h-14 w-full rounded bg-neutral-100 p-1.5">
                                    <PresetThumb preset={preset.key} />
                                </div>
                                <div className="px-0.5">
                                    <p className="text-xs font-semibold text-gray-800">{t(`editor.presets.${preset.key}.label`)}</p>
                                    <p className="text-caption leading-tight text-gray-500">{t(`editor.presets.${preset.key}.description`)}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </Section>

            {/* ── Look ─────────────────────────────────────────────── */}
            <Section title={t('editor.sections.look')}>
                <div>
                    <Label className="text-xs">{t('editor.fields.display')}</Label>
                    <Pills
                        value={display}
                        onChange={(v) => updateProp('display', v)}
                        options={(['floatingPopup', 'floating', 'popup', 'inline'] as const).map((d) => ({ value: d, label: t(`editor.display.${d}`) }))}
                    />
                </div>
                {hasLauncher && (
                    <>
                        <div>
                            <Label className="text-xs">{t('editor.fields.buttonStyle')}</Label>
                            <Pills
                                value={props.buttonStyle || 'pill'}
                                onChange={(v) => updateProp('buttonStyle', v)}
                                options={(['pill', 'icon', 'tab'] as const).map((s) => ({ value: s, label: t(`editor.buttonStyle.${s}`) }))}
                            />
                            {props.buttonStyle === 'tab' && String(props.position || 'bottom-right').startsWith('bottom') && (
                                <p className="mt-1 text-caption text-gray-500">{t('editor.hints.tabNeedsSide')}</p>
                            )}
                        </div>
                        <div>
                            <Label className="text-xs">{t('editor.fields.buttonLabel')}</Label>
                            <Input
                                className="mt-1"
                                value={props.buttonLabel || ''}
                                placeholder={t('editor.defaults.buttonLabel')}
                                onChange={(e) => updateProp('buttonLabel', e.target.value)}
                            />
                        </div>
                    </>
                )}
                {display !== 'inline' && (
                    <>
                        <div>
                            <Label className="text-xs">{t('editor.fields.position')}</Label>
                            <Pills
                                value={props.position || 'bottom-right'}
                                onChange={(v) => updateProp('position', v)}
                                options={(['bottom-right', 'bottom-left', 'middle-right', 'middle-left'] as const).map((p) => ({
                                    value: p,
                                    label: t(`editor.position.${p}`),
                                }))}
                            />
                        </div>
                        <div>
                            <Label className="text-xs">{t('editor.fields.popupStyle')}</Label>
                            <Pills
                                value={props.popupStyle || 'modal'}
                                onChange={(v) => updateProp('popupStyle', v)}
                                options={(['modal', 'corner'] as const).map((s) => ({ value: s, label: t(`editor.popupStyle.${s}`) }))}
                            />
                        </div>
                    </>
                )}
                {display === 'inline' && (
                    <ColorPickerField
                        label={t('editor.fields.backgroundColor')}
                        value={props.backgroundColor || ''}
                        onChange={(c) => updateProp('backgroundColor', c)}
                    />
                )}
            </Section>

            {/* ── When it opens by itself ──────────────────────────── */}
            {opensByItself && (
                <Section title={t('editor.sections.behaviour')}>
                    <div>
                        <Label className="text-xs">{tp('fields.trigger')}</Label>
                        <Pills
                            value={trigger}
                            onChange={(v) => updateProp('trigger', v)}
                            options={[
                                { value: 'delay', label: tp('triggers.delay') },
                                { value: 'scroll', label: tp('triggers.scroll') },
                                { value: 'exit', label: tp('triggers.exit') },
                            ]}
                        />
                    </div>
                    {trigger === 'delay' && (
                        <div>
                            <Label className="text-xs">{tp('fields.delaySeconds')}</Label>
                            <Pills
                                value={String(props.delaySeconds ?? 5)}
                                onChange={(v) => updateProp('delaySeconds', Number(v))}
                                options={['0', '3', '5', '10', '20', '30'].map((s) => ({
                                    value: s,
                                    label: s === '0' ? tp('delay.instant') : tp('delay.seconds', { count: Number(s) }),
                                }))}
                            />
                        </div>
                    )}
                    {trigger === 'scroll' && (
                        <div>
                            <Label className="text-xs">{tp('fields.scrollPercent')}</Label>
                            <Pills
                                value={String(props.scrollPercent ?? 40)}
                                onChange={(v) => updateProp('scrollPercent', Number(v))}
                                options={['25', '40', '50', '75'].map((s) => ({ value: s, label: `${s}%` }))}
                            />
                        </div>
                    )}
                    {trigger === 'exit' && <Note tone="info">{tp('hints.exit')}</Note>}
                    <div>
                        <Label className="text-xs">{tp('fields.frequency')}</Label>
                        <select
                            className="mt-1 w-full rounded border px-3 py-2 text-sm"
                            value={props.frequency || 'once'}
                            onChange={(e) => updateProp('frequency', e.target.value)}
                        >
                            {['always', 'session', 'daily', 'weekly', 'once'].map((f) => (
                                <option key={f} value={f}>
                                    {tp(`frequency.${f}`)}
                                </option>
                            ))}
                        </select>
                        <p className="mt-1 text-caption text-gray-500">{t('editor.hints.frequency')}</p>
                    </div>
                </Section>
            )}

            {display !== 'inline' && (
                <Section title={t('editor.sections.visibility')}>
                    <div>
                        <Label className="text-xs">{tp('fields.devices')}</Label>
                        <Pills
                            value={props.devices || 'all'}
                            onChange={(v) => updateProp('devices', v)}
                            options={[
                                { value: 'all', label: tp('devices.all') },
                                { value: 'desktop', label: tp('devices.desktop') },
                                { value: 'mobile', label: tp('devices.mobile') },
                            ]}
                        />
                    </div>
                    {hasLauncher && (
                        <div className="flex items-center justify-between gap-3">
                            <Label className="text-xs">{t('editor.fields.hideAfterSubmit')}</Label>
                            <Switch checked={props.hideAfterSubmit !== false} onCheckedChange={(c) => updateProp('hideAfterSubmit', c)} />
                        </div>
                    )}
                </Section>
            )}

            {/* ── What it asks ─────────────────────────────────────── */}
            <Section title={t('editor.sections.fields')}>
                <p className="text-caption text-gray-500">{t('editor.hints.alwaysAsked')}</p>
                {FIELD_KEYS.map((key) => (
                    <div key={key} className="space-y-1.5">
                        <Label className="text-xs">{t(`editor.fieldNames.${key}`)}</Label>
                        <Pills
                            value={fields[key] || 'optional'}
                            onChange={(v) => updateProp('fields', { ...fields, [key]: v })}
                            options={(['off', 'optional', 'required'] as const).map((m) => ({ value: m, label: t(`editor.fieldMode.${m}`) }))}
                        />
                        {fields[key] !== 'off' && (
                            <Input
                                value={props[LABEL_PROP[key]] || ''}
                                placeholder={t(`editor.defaults.${LABEL_PROP[key]}`)}
                                aria-label={t('editor.fields.labelFor', { field: t(`editor.fieldNames.${key}`) })}
                                onChange={(e) => updateProp(LABEL_PROP[key], e.target.value)}
                            />
                        )}
                        {key === 'course' && fields.course !== 'off' && (
                            <div>
                                <Label className="text-xs">{t('editor.fields.courseOptions')}</Label>
                                <Textarea
                                    className="mt-1"
                                    rows={3}
                                    value={courseOptions.join('\n')}
                                    placeholder={t('editor.hints.courseOptionsPlaceholder')}
                                    onChange={(e) => updateProp('courseOptions', e.target.value.split('\n'))}
                                    onBlur={(e) =>
                                        updateProp(
                                            'courseOptions',
                                            e.target.value
                                                .split('\n')
                                                .map((s) => s.trim())
                                                .filter(Boolean)
                                        )
                                    }
                                />
                                <p className="mt-1 text-caption text-gray-500">{t('editor.hints.courseOptions')}</p>
                            </div>
                        )}
                    </div>
                ))}
            </Section>

            {/* ── Text ─────────────────────────────────────────────── */}
            <Section title={t('editor.sections.text')}>
                <p className="text-caption text-gray-500">{t('editor.hints.emptyUsesDefault')}</p>
                {(
                    [
                        ['heading', false],
                        ['subheading', true],
                        ['nameLabel', false],
                        ['textPlaceholder', false],
                        ['submitLabel', false],
                        ['successHeading', false],
                        ['successMessage', true],
                    ] as const
                ).map(([key, multiline]) => (
                    <div key={key}>
                        <Label className="text-xs">{t(`editor.fields.${key}`)}</Label>
                        {multiline ? (
                            <Textarea
                                className="mt-1"
                                rows={2}
                                value={props[key] || ''}
                                placeholder={t(`editor.defaults.${key}`)}
                                onChange={(e) => updateProp(key, e.target.value)}
                            />
                        ) : (
                            <Input
                                className="mt-1"
                                value={props[key] || ''}
                                placeholder={t(`editor.defaults.${key}`)}
                                onChange={(e) => updateProp(key, e.target.value)}
                            />
                        )}
                    </div>
                ))}
            </Section>
        </div>
    );
};

export default ReviewCollectorEditor;
