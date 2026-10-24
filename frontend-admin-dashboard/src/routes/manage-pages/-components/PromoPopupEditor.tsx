import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Check, Code, Copy, Info, WarningCircle } from '@phosphor-icons/react';
import { ColorPickerField } from './ColorPickerField';
import { ImageUploadField } from './ImageUploadField';
import { LinkPicker } from './LinkPicker';
import { CampaignPicker } from './CampaignPicker';
import {
    CUSTOM_HTML_LIMIT,
    PROMO_STARTERS,
    buildPromoStarter,
    hookSnippets,
    type PromoStarter,
} from '../-utils/promo-popup-html';

/**
 * Property panel for the "promoPopup" block (learner: promo/PromoPopup.tsx).
 *
 * Template = the look only (layout + where it sits). Switching it never
 * touches the admin's text, coupon or dates, so trying the looks is free.
 * "custom" swaps the fields for one HTML box (markup + <style>); it starts from
 * a starter built out of the current text, so it is never a blank page.
 */

const TEMPLATES = ['spotlight', 'split', 'poster', 'ticket', 'corner', 'bar', 'custom'] as const;
type Template = (typeof TEMPLATES)[number];

/** A small schematic of each look, drawn with blocks. */
const Thumb = ({ template }: { template: Template }) => {
    const accent = 'bg-primary-400';
    const line = 'h-1 rounded-full bg-neutral-300';
    switch (template) {
        case 'spotlight':
            return (
                <div className="mx-auto flex h-full w-3/5 flex-col overflow-hidden rounded-md bg-white shadow">
                    <div className={cn('flex h-1/2 flex-col items-center justify-center gap-0.5', accent)}>
                        <div className="h-1.5 w-1/2 rounded-full bg-white/90" />
                        <div className="h-1 w-1/3 rounded-full bg-white/60" />
                    </div>
                    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-2">
                        <div className={cn(line, 'w-3/4')} />
                        <div className={cn('h-1.5 w-full rounded-sm', accent)} />
                    </div>
                </div>
            );
        case 'split':
            return (
                <div className="mx-auto flex h-4/5 w-4/5 overflow-hidden rounded-md bg-white shadow">
                    <div className={cn('w-1/2', accent)} />
                    <div className="flex flex-1 flex-col justify-center gap-1 px-1.5">
                        <div className="h-1.5 w-full rounded-full bg-neutral-400" />
                        <div className={cn(line, 'w-3/4')} />
                        <div className={cn('h-1.5 w-full rounded-sm', accent)} />
                    </div>
                </div>
            );
        case 'poster':
            return (
                <div className="mx-auto flex h-full w-3/5 flex-col items-center justify-end gap-0.5 overflow-hidden rounded-md bg-gradient-to-t from-neutral-800 to-primary-400 pb-1.5 shadow">
                    <div className="h-2 w-2/3 rounded-full bg-white/90" />
                    <div className="h-1 w-1/2 rounded-full bg-white/60" />
                    <div className="mt-0.5 h-1.5 w-2/3 rounded-sm bg-white" />
                </div>
            );
        case 'ticket':
            return (
                <div className="mx-auto flex h-full w-3/5 flex-col overflow-hidden rounded-md bg-white shadow">
                    <div className="flex flex-1 flex-col items-center justify-center gap-0.5">
                        <div className={cn('size-2.5 rounded-sm', accent)} />
                        <div className="h-1 w-1/2 rounded-full bg-neutral-400" />
                    </div>
                    <div className="mx-1 border-t border-dashed border-neutral-300" />
                    <div className="flex flex-1 items-center justify-center px-1.5">
                        <div className="h-2.5 w-full rounded-sm border border-dashed border-primary-400" />
                    </div>
                </div>
            );
        case 'corner':
            return (
                <div className="relative h-full w-full">
                    <div className="absolute bottom-0.5 start-0.5 flex w-1/2 flex-col gap-0.5 rounded-md bg-white p-1 shadow">
                        <div className={cn('h-0.5 w-full rounded-full', accent)} />
                        <div className="h-1 w-3/4 rounded-full bg-neutral-400" />
                        <div className={cn('h-1.5 w-full rounded-sm', accent)} />
                    </div>
                </div>
            );
        case 'bar':
            return (
                <div className="relative h-full w-full">
                    <div className={cn('absolute inset-x-0 bottom-0 flex h-1/4 items-center gap-1 px-1', accent)}>
                        <div className="h-1 flex-1 rounded-full bg-white/80" />
                        <div className="h-1.5 w-1/4 rounded-sm bg-white" />
                    </div>
                </div>
            );
        case 'custom':
            return (
                <div className="mx-auto flex h-full w-3/5 items-center justify-center rounded-md bg-neutral-800 shadow">
                    <Code weight="bold" className="size-5 text-primary-300" />
                </div>
            );
    }
};

/** Pill row used for every enum, same look as the neighbouring editors. */
const Pills = <T extends string>({
    value,
    options,
    onChange,
}: {
    value: T;
    options: { value: T; label: string }[];
    onChange: (v: T) => void;
}) => (
    <div className="mt-1 flex flex-wrap gap-1">
        {options.map((o) => (
            <button
                key={o.value}
                type="button"
                onClick={() => onChange(o.value)}
                aria-pressed={value === o.value}
                className={`rounded px-2.5 py-1 text-caption font-medium ${value === o.value ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
            >
                {o.label}
            </button>
        ))}
    </div>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="space-y-3 rounded-lg border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-600">{title}</p>
        {children}
    </div>
);

const Note = ({ tone, children }: { tone: 'info' | 'warn'; children: ReactNode }) => (
    // Plain string, not cn(): tailwind-merge reads text-caption as a colour and drops it.
    <p
        className={`flex items-start gap-1.5 rounded px-2 py-1.5 text-caption ${
            tone === 'warn' ? 'bg-warning-50 text-warning-700' : 'bg-blue-50 text-blue-700'
        }`}
    >
        {tone === 'warn' ? (
            <WarningCircle className="mt-0.5 size-3.5 shrink-0" />
        ) : (
            <Info className="mt-0.5 size-3.5 shrink-0" />
        )}
        <span>{children}</span>
    </p>
);

const HOOK_KEYS = ['close', 'copy', 'countdown', 'route', 'form', 'link', 'whatsapp'] as const;

/** The custom template's one box: width, starters, the HTML itself and the hook cheat sheet. */
const CustomHtmlSection = ({
    props,
    updateProp,
}: {
    props: Record<string, any>;
    updateProp: (key: string, value: any) => void;
}) => {
    const { t } = useTranslation('managePagesPromoPopup');
    const [pending, setPending] = useState<PromoStarter | null>(null);
    const [audienceId, setAudienceId] = useState('');
    const [copied, setCopied] = useState<string | null>(null);
    const html: string = typeof props.html === 'string' ? props.html : '';
    const snippets = hookSnippets({ audienceId, couponCode: props.couponCode });

    const applyStarter = (kind: PromoStarter) => {
        updateProp('html', buildPromoStarter(kind, props, starterLabels(t)));
        setPending(null);
    };
    const copySnippet = (key: string, value: string) => {
        void navigator.clipboard
            ?.writeText(value)
            .then(() => {
                setCopied(key);
                window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
            })
            .catch(() => undefined);
    };

    return (
        <Section title={t('sections.customHtml')}>
            <div>
                <Label className="text-xs">{t('fields.customWidth')}</Label>
                <Pills
                    value={props.customWidth || 'md'}
                    onChange={(v) => updateProp('customWidth', v)}
                    options={(['sm', 'md', 'lg'] as const).map((w) => ({ value: w, label: t(`width.${w}`) }))}
                />
            </div>
            <div>
                <Label className="text-xs">{t('starters.title')}</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                    {PROMO_STARTERS.map((kind) => (
                        <button
                            key={kind}
                            type="button"
                            onClick={() => (html.trim() ? setPending(kind) : applyStarter(kind))}
                            className="rounded border border-gray-200 px-2.5 py-1 text-caption font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                        >
                            {t(`starters.${kind}`)}
                        </button>
                    ))}
                </div>
                <p className="mt-1 text-caption text-gray-500">{t('starters.hint')}</p>
                {pending && (
                    <div className="mt-2 space-y-2 rounded bg-warning-50 p-2">
                        <p className="text-caption text-warning-700">{t('starters.replaceConfirm')}</p>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => applyStarter(pending)}
                                className="rounded bg-warning-600 px-2.5 py-1 text-caption font-medium text-white"
                            >
                                {t('starters.replace')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setPending(null)}
                                className="rounded bg-white px-2.5 py-1 text-caption font-medium text-gray-700"
                            >
                                {t('starters.cancel')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
            <div>
                <Label className="text-xs">{t('fields.customHtml')}</Label>
                <Textarea
                    value={html}
                    onChange={(e) => updateProp('html', e.target.value)}
                    rows={18}
                    spellCheck={false}
                    className="mt-1 font-mono text-caption"
                    placeholder={'<style>\n  .box { padding: 24px; }\n</style>\n<div class="box">…</div>'}
                />
                <p className={`mt-1 text-caption ${html.length > CUSTOM_HTML_LIMIT ? 'text-danger-600' : 'text-gray-500'}`}>
                    {t('hints.customLimit', { count: html.length, limit: CUSTOM_HTML_LIMIT.toLocaleString() })}
                </p>
                {html.length > CUSTOM_HTML_LIMIT && <Note tone="warn">{t('hints.customTooLong')}</Note>}
            </div>
            <Note tone="info">{t('hints.customHtml')}</Note>
            <details className="rounded border border-gray-200 p-2">
                <summary className="cursor-pointer text-xs font-semibold text-gray-700">{t('hooks.title')}</summary>
                <p className="mt-2 text-caption text-gray-500">{t('hooks.intro')}</p>
                <div className="mt-2 space-y-2">
                    {HOOK_KEYS.map((key) => (
                        <div key={key} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-caption font-medium text-gray-700">{t(`hooks.${key}`)}</span>
                                <button
                                    type="button"
                                    onClick={() => copySnippet(key, snippets[key])}
                                    className="flex items-center gap-1 text-caption font-medium text-blue-600 hover:underline"
                                >
                                    {copied === key ? <Check className="size-3" /> : <Copy className="size-3" />}
                                    {copied === key ? t('hooks.copied') : t('hooks.copyAction')}
                                </button>
                            </div>
                            {key === 'form' && (
                                <CampaignPicker label={t('hooks.formPicker')} value={audienceId} onChange={(id) => setAudienceId(id)} />
                            )}
                            <code className="block whitespace-pre-wrap break-all rounded bg-gray-50 px-2 py-1 text-caption text-gray-700">
                                {snippets[key]}
                            </code>
                        </div>
                    ))}
                </div>
            </details>
        </Section>
    );
};

const starterLabels = (t: (key: string) => string) => ({
    useCode: t('starterText.useCode'),
    copy: t('starterText.copy'),
    endsIn: t('starterText.endsIn'),
});

const toMs = (v: unknown): number | null => {
    if (typeof v !== 'string' || !v.trim()) return null;
    const ms = new Date(v).getTime();
    return Number.isNaN(ms) ? null : ms;
};

export const PromoPopupEditor = ({ component, pageId, updateComponent }: any) => {
    const { t } = useTranslation('managePagesPromoPopup');
    const { props } = component;
    const button = props.button || {};
    const template: Template = TEMPLATES.includes(props.template) ? props.template : 'spotlight';
    const trigger = props.trigger || 'delay';
    const action = button.action || 'link';
    const isCustom = template === 'custom';

    const updateProp = (key: string, value: any) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });
    const updateButton = (patch: Record<string, any>) => updateProp('button', { ...button, ...patch });
    // Custom HTML with nothing in it yet starts from the current text, as HTML.
    const selectTemplate = (key: Template) => {
        if (key === 'custom' && !String(props.html || '').trim()) {
            updateComponent(pageId, component.id, {
                props: { ...props, template: key, html: buildPromoStarter('offer', props, starterLabels(t)) },
            });
            return;
        }
        updateProp('template', key);
    };

    const start = toMs(props.startDate);
    const end = toMs(props.endDate);
    const now = Date.now();

    return (
        <div className="space-y-4">
            <Note tone="info">{t('previewNote')}</Note>

            {/* ── Template ─────────────────────────────────────────── */}
            <Section title={t('sections.template')}>
                <div className="grid grid-cols-2 gap-2">
                    {TEMPLATES.map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => selectTemplate(key)}
                            aria-pressed={template === key}
                            className={cn(
                                'flex flex-col gap-1.5 rounded-lg border p-1.5 text-start transition-colors',
                                template === key
                                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                                    : 'border-gray-200 hover:border-blue-300'
                            )}
                        >
                            <div className="h-16 w-full rounded bg-neutral-100 p-1.5">
                                <Thumb template={key} />
                            </div>
                            <div className="px-0.5">
                                <p className="text-xs font-semibold text-gray-800">{t(`templates.${key}.label`)}</p>
                                <p className="text-caption leading-tight text-gray-500">{t(`templates.${key}.description`)}</p>
                            </div>
                        </button>
                    ))}
                </div>
            </Section>

            {isCustom && <CustomHtmlSection props={props} updateProp={updateProp} />}
            {isCustom && (
                <Section title={t('sections.offer')}>
                    <div>
                        <Label className="text-xs">{t('fields.endDate')}</Label>
                        <Input className="mt-1" type="datetime-local" value={props.endDate || ''} onChange={(e) => updateProp('endDate', e.target.value)} />
                        <p className="mt-1 text-caption text-gray-500">{t('hints.endDateCustom')}</p>
                    </div>
                </Section>
            )}

            {/* ── Content ──────────────────────────────────────────── */}
            {!isCustom && (<>
            <Section title={t('sections.content')}>
                <div>
                    <Label className="text-xs">{t('fields.badge')}</Label>
                    <Input className="mt-1" value={props.badge || ''} onChange={(e) => updateProp('badge', e.target.value)} placeholder={t('placeholders.badge')} />
                </div>
                <div>
                    <Label className="text-xs">{t('fields.highlight')}</Label>
                    <Input className="mt-1" value={props.highlight || ''} onChange={(e) => updateProp('highlight', e.target.value)} placeholder={t('placeholders.highlight')} />
                    <p className="mt-1 text-caption text-gray-500">{t('hints.highlight')}</p>
                </div>
                <div>
                    <Label className="text-xs">{t('fields.heading')}</Label>
                    <Input className="mt-1" value={props.heading || ''} onChange={(e) => updateProp('heading', e.target.value)} placeholder={t('placeholders.heading')} />
                </div>
                <div>
                    <Label className="text-xs">{t('fields.body')}</Label>
                    <Textarea className="mt-1" rows={3} value={props.body || ''} onChange={(e) => updateProp('body', e.target.value)} placeholder={t('placeholders.body')} />
                </div>
                <ImageUploadField label={t('fields.image')} value={props.image || ''} onChange={(url) => updateProp('image', url)} aiKind="image" />
                {props.image && (
                    <Input value={props.imageAlt || ''} onChange={(e) => updateProp('imageAlt', e.target.value)} placeholder={t('placeholders.imageAlt')} />
                )}
                {template === 'bar' && props.image && <Note tone="info">{t('hints.barNoImage')}</Note>}
                <div>
                    <Label className="text-xs">{t('fields.dismissText')}</Label>
                    <Input className="mt-1" value={props.dismissText || ''} onChange={(e) => updateProp('dismissText', e.target.value)} placeholder={t('placeholders.dismissText')} />
                </div>
                <div>
                    <Label className="text-xs">{t('fields.footnote')}</Label>
                    <Input className="mt-1" value={props.footnote || ''} onChange={(e) => updateProp('footnote', e.target.value)} placeholder={t('placeholders.footnote')} />
                </div>
            </Section>

            {/* ── Offer: coupon + countdown ───────────────────────── */}
            <Section title={t('sections.offer')}>
                <div>
                    <Label className="text-xs">{t('fields.couponCode')}</Label>
                    <Input
                        className="mt-1 font-mono uppercase"
                        value={props.couponCode || ''}
                        onChange={(e) => updateProp('couponCode', e.target.value.toUpperCase().replace(/\s+/g, ''))}
                        placeholder={t('placeholders.couponCode')}
                    />
                    <p className="mt-1 text-caption text-gray-500">{t('hints.couponCode')}</p>
                </div>
                <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('fields.showCountdown')}</Label>
                    <Switch checked={props.showCountdown !== false} onCheckedChange={(c) => updateProp('showCountdown', c)} />
                </div>
                <div>
                    <Label className="text-xs">{t('fields.endDate')}</Label>
                    <Input className="mt-1" type="datetime-local" value={props.endDate || ''} onChange={(e) => updateProp('endDate', e.target.value)} />
                    <p className="mt-1 text-caption text-gray-500">{t('hints.endDate')}</p>
                </div>
                {props.showCountdown !== false && end === null && <Note tone="info">{t('hints.countdownNeedsEnd')}</Note>}
            </Section>

            {/* ── Button ───────────────────────────────────────────── */}
            <Section title={t('sections.button')}>
                <div>
                    <Label className="text-xs">{t('fields.buttonText')}</Label>
                    <Input className="mt-1" value={button.text || ''} onChange={(e) => updateButton({ text: e.target.value })} placeholder={t('placeholders.buttonText')} />
                    {!String(button.text || '').trim() && <p className="mt-1 text-caption text-gray-500">{t('hints.noButton')}</p>}
                </div>
                <div>
                    <Label className="text-xs">{t('fields.onClick')}</Label>
                    <Pills
                        value={action}
                        onChange={(v) => updateButton({ action: v })}
                        options={[
                            { value: 'link', label: t('actions.link') },
                            { value: 'openForm', label: t('actions.openForm') },
                            { value: 'whatsapp', label: t('actions.whatsapp') },
                        ]}
                    />
                </div>
                {action === 'openForm' ? (
                    <>
                        <CampaignPicker
                            label={t('fields.formToOpen')}
                            allowEmpty={false}
                            value={button.audienceId || ''}
                            onChange={(id) => updateButton({ audienceId: id })}
                        />
                        {!button.audienceId && <Note tone="warn">{t('hints.pickForm')}</Note>}
                        <div>
                            <Label className="text-xs">{t('fields.formTitle')}</Label>
                            <Input className="mt-1" value={button.formTitle || ''} onChange={(e) => updateButton({ formTitle: e.target.value })} placeholder={t('placeholders.formTitle')} />
                        </div>
                    </>
                ) : action === 'whatsapp' ? (
                    <>
                        <div>
                            <Label className="text-xs">{t('fields.whatsappPhone')}</Label>
                            <Input className="mt-1" inputMode="tel" value={button.whatsappPhone || ''} onChange={(e) => updateButton({ whatsappPhone: e.target.value })} placeholder={t('placeholders.whatsappPhone')} />
                            <p className="mt-1 text-caption text-gray-500">{t('hints.whatsappPhone')}</p>
                        </div>
                        <div>
                            <Label className="text-xs">{t('fields.whatsappMessage')}</Label>
                            <Input className="mt-1" value={button.whatsappMessage || ''} onChange={(e) => updateButton({ whatsappMessage: e.target.value })} placeholder={t('placeholders.whatsappMessage')} />
                        </div>
                    </>
                ) : (
                    <LinkPicker
                        label={t('fields.link')}
                        value={button.url || ''}
                        onChange={(v) => updateButton({ url: v })}
                        showTarget
                        target={button.target}
                        onTargetChange={(tgt) => updateButton({ target: tgt })}
                    />
                )}
            </Section>

            </>)}

            {/* ── When to show ─────────────────────────────────────── */}
            <Section title={t('sections.behaviour')}>
                <div>
                    <Label className="text-xs">{t('fields.trigger')}</Label>
                    <Pills
                        value={trigger}
                        onChange={(v) => updateProp('trigger', v)}
                        options={[
                            { value: 'delay', label: t('triggers.delay') },
                            { value: 'scroll', label: t('triggers.scroll') },
                            { value: 'exit', label: t('triggers.exit') },
                        ]}
                    />
                </div>
                {trigger === 'delay' && (
                    <div>
                        <Label className="text-xs">{t('fields.delaySeconds')}</Label>
                        <Pills
                            value={String(props.delaySeconds ?? 3)}
                            onChange={(v) => updateProp('delaySeconds', Number(v))}
                            options={['0', '3', '5', '10', '20', '30'].map((s) => ({
                                value: s,
                                label: s === '0' ? t('delay.instant') : t('delay.seconds', { count: Number(s) }),
                            }))}
                        />
                    </div>
                )}
                {trigger === 'scroll' && (
                    <div>
                        <Label className="text-xs">{t('fields.scrollPercent')}</Label>
                        <Pills
                            value={String(props.scrollPercent ?? 40)}
                            onChange={(v) => updateProp('scrollPercent', Number(v))}
                            options={['25', '40', '50', '75'].map((s) => ({ value: s, label: `${s}%` }))}
                        />
                    </div>
                )}
                {trigger === 'exit' && <Note tone="info">{t('hints.exit')}</Note>}
                <div>
                    <Label className="text-xs">{t('fields.frequency')}</Label>
                    <select
                        className="mt-1 w-full rounded border px-3 py-2 text-sm"
                        value={props.frequency || 'session'}
                        onChange={(e) => updateProp('frequency', e.target.value)}
                    >
                        {['always', 'session', 'daily', 'weekly', 'once'].map((f) => (
                            <option key={f} value={f}>
                                {t(`frequency.${f}`)}
                            </option>
                        ))}
                    </select>
                    <p className="mt-1 text-caption text-gray-500">{t('hints.frequency')}</p>
                </div>
                <div>
                    <Label className="text-xs">{t('fields.devices')}</Label>
                    <Pills
                        value={props.devices || 'all'}
                        onChange={(v) => updateProp('devices', v)}
                        options={[
                            { value: 'all', label: t('devices.all') },
                            { value: 'desktop', label: t('devices.desktop') },
                            { value: 'mobile', label: t('devices.mobile') },
                        ]}
                    />
                </div>
                <div>
                    <Label className="text-xs">{t('fields.startDate')}</Label>
                    <Input className="mt-1" type="datetime-local" value={props.startDate || ''} onChange={(e) => updateProp('startDate', e.target.value)} />
                    <p className="mt-1 text-caption text-gray-500">{t('hints.startDate')}</p>
                </div>
                {start !== null && end !== null && start >= end && <Note tone="warn">{t('hints.startAfterEnd')}</Note>}
                {end !== null && end <= now && <Note tone="warn">{t('hints.ended')}</Note>}
                {['spotlight', 'split', 'poster', 'ticket', 'custom'].includes(template) && (
                    <div className="flex items-center justify-between">
                        <Label className="text-xs">{t('fields.closeOnBackdrop')}</Label>
                        <Switch checked={props.closeOnBackdrop !== false} onCheckedChange={(c) => updateProp('closeOnBackdrop', c)} />
                    </div>
                )}
            </Section>

            {/* ── Colours ──────────────────────────────────────────── */}
            {!isCustom && (
            <Section title={t('sections.colours')}>
                <p className="text-caption text-gray-500">{t('hints.colours')}</p>
                <ColorPickerField label={t('fields.accentColor')} value={props.accentColor || ''} onChange={(c) => updateProp('accentColor', c)} />
                {template !== 'poster' && template !== 'bar' && (
                    <>
                        <ColorPickerField label={t('fields.backgroundColor')} value={props.backgroundColor || ''} onChange={(c) => updateProp('backgroundColor', c)} />
                        <ColorPickerField label={t('fields.textColor')} value={props.textColor || ''} onChange={(c) => updateProp('textColor', c)} />
                    </>
                )}
                {(props.accentColor || props.backgroundColor || props.textColor) && (
                    <button
                        type="button"
                        className="text-caption font-medium text-blue-600 hover:underline"
                        onClick={() =>
                            updateComponent(pageId, component.id, {
                                props: { ...props, accentColor: '', backgroundColor: '', textColor: '' },
                            })
                        }
                    >
                        {t('resetColours')}
                    </button>
                )}
            </Section>
            )}
        </div>
    );
};

export default PromoPopupEditor;
