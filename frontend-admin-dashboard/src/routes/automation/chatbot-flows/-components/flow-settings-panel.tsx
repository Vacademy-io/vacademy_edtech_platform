import { useEffect, useState } from 'react';
import { X, EnvelopeSimple, Plus, WhatsappLogo, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import { useChatbotFlowStore } from '../-stores/chatbot-flow-store';
import {
    ChatbotFlowSettings,
    ESCALATION_TEMPLATE_VARIABLES,
} from '@/types/chatbot-flow/chatbot-flow-types';
import {
    listTemplates,
    type WhatsAppTemplateDTO,
} from '@/routes/communication/whatsapp-templates/-services/template-api';

interface Props {
    onClose: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Digits, optionally prefixed with +. Spaces, dashes and brackets are stripped before this runs. */
const PHONE_RE = /^\+?\d{8,15}$/;

/**
 * Flow-level settings, stored on `ChatbotFlow.settings`.
 *
 * Decides who hears about a chatbot hand-over ("a learner is waiting for your reply") and which of
 * the institute's existing notification templates renders that alert on each channel. An AI node
 * escalates when the answer isn't in its context (see its "When the AI doesn't know" section);
 * this panel decides who is told and how it reads.
 */
export function FlowSettingsPanel({ onClose }: Props) {
    const { t } = useTranslation('automationFlowSettingsPanel');
    const flowSettings = useChatbotFlowStore((s) => s.flowSettings);
    const setFlowSettings = useChatbotFlowStore((s) => s.setFlowSettings);
    const instituteId = useChatbotFlowStore((s) => s.instituteId);

    const emails = flowSettings.notificationEmails || [];
    const phones = flowSettings.notificationPhones || [];
    const notifyOnEscalation = flowSettings.notifyOnEscalation !== false;
    const renotifyMinutes = flowSettings.escalationRenotifyMinutes ?? 120;
    const emailTemplate = flowSettings.escalationEmailTemplate || '';
    const whatsappTemplate = flowSettings.escalationWhatsappTemplate || '';

    const [emailTemplates, setEmailTemplates] = useState<WhatsAppTemplateDTO[]>([]);
    const [waTemplates, setWaTemplates] = useState<WhatsAppTemplateDTO[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);

    useEffect(() => {
        if (!instituteId) return;
        setLoadingTemplates(true);
        Promise.all([listTemplates(instituteId, 'EMAIL'), listTemplates(instituteId, 'WHATSAPP')])
            .then(([email, whatsapp]) => {
                setEmailTemplates(email);
                // Only APPROVED WhatsApp templates can carry a business-initiated message.
                setWaTemplates(whatsapp.filter((t) => t.status === 'APPROVED'));
            })
            .catch(() => toast.error(t('toast.loadTemplatesError')))
            .finally(() => setLoadingTemplates(false));
    }, [instituteId]);

    const patch = (changes: Partial<ChatbotFlowSettings>) =>
        setFlowSettings({ ...flowSettings, ...changes });

    const selectedWaTemplate = waTemplates.find((t) => t.name === whatsappTemplate);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="flex max-h-full w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
                {/* Header */}
                <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
                    <h3 className="text-title font-semibold text-gray-800">{t('title')}</h3>
                    <button
                        onClick={onClose}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title={t('close')}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    <p className="mb-4 text-caption text-gray-500">
                        <Trans i18nKey="automationFlowSettingsPanel:description">
                            Who to tell when the chatbot can’t answer and hands a conversation to a
                            human. The same conversations show as <b>Unanswered</b> in the WhatsApp
                            Inbox until someone replies.
                        </Trans>
                    </p>

                    {/* ---------- Email ---------- */}
                    <SectionHeading
                        icon={<EnvelopeSimple size={16} />}
                        label={t('email.sectionLabel')}
                    />
                    <RecipientEditor
                        values={emails}
                        placeholder={t('email.placeholder')}
                        inputType="email"
                        emptyText={t('email.emptyText')}
                        validate={(v) => (EMAIL_RE.test(v) ? null : t('email.invalidError'))}
                        normalize={(v) => v.trim().toLowerCase()}
                        onChange={(next) => patch({ notificationEmails: next })}
                    />

                    <TemplateSelect
                        label={t('email.template.label')}
                        value={emailTemplate}
                        templates={emailTemplates}
                        loading={loadingTemplates}
                        emptyOptionLabel={t('email.template.emptyOption')}
                        onChange={(name) => patch({ escalationEmailTemplate: name })}
                        hint={t('email.template.hint')}
                    />

                    {/* ---------- WhatsApp ---------- */}
                    <div className="mt-6">
                        <SectionHeading
                            icon={<WhatsappLogo size={16} />}
                            label={t('whatsapp.sectionLabel')}
                        />
                    </div>
                    <RecipientEditor
                        values={phones}
                        placeholder={t('whatsapp.placeholder')}
                        inputType="tel"
                        emptyText={t('whatsapp.emptyText')}
                        validate={(v) => (PHONE_RE.test(v) ? null : t('whatsapp.invalidError'))}
                        normalize={(v) => v.replace(/[\s()-]/g, '').trim()}
                        onChange={(next) => patch({ notificationPhones: next })}
                    />

                    <TemplateSelect
                        label={t('whatsapp.template.label')}
                        value={whatsappTemplate}
                        templates={waTemplates}
                        loading={loadingTemplates}
                        emptyOptionLabel={t('whatsapp.template.emptyOption')}
                        onChange={(name) => patch({ escalationWhatsappTemplate: name })}
                        hint={t('whatsapp.template.hint')}
                    />

                    {/* WhatsApp cannot send a business-initiated message without a template, so a
                        number list with no template chosen would silently never fire. Say so. */}
                    {phones.length > 0 && !whatsappTemplate && (
                        <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 p-2 text-caption text-amber-800">
                            <Warning size={14} className="mt-px shrink-0" />
                            <span>{t('whatsapp.warning')}</span>
                        </div>
                    )}

                    {selectedWaTemplate?.bodyText && (
                        <p className="mt-1 truncate text-caption text-gray-400">
                            {selectedWaTemplate.bodyText}
                        </p>
                    )}

                    {/* ---------- Variables reference ---------- */}
                    {(emailTemplate || whatsappTemplate) && (
                        <div className="mt-4 rounded border bg-gray-50 p-2">
                            <p className="mb-1 text-caption font-medium text-gray-600">
                                {t('variables.title')}
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {ESCALATION_TEMPLATE_VARIABLES.map((v) => (
                                    <span
                                        key={v.key}
                                        title={v.description}
                                        className="rounded bg-white px-1.5 py-px font-mono text-caption text-gray-600 ring-1 ring-gray-200"
                                    >
                                        {`{{${v.key}}}`}
                                    </span>
                                ))}
                            </div>
                            <p className="mt-1 text-caption text-gray-400">
                                {t('variables.hint')}
                            </p>
                        </div>
                    )}

                    {/* ---------- Delivery controls ---------- */}
                    <label className="mt-6 flex cursor-pointer items-center gap-2">
                        <input
                            type="checkbox"
                            checked={notifyOnEscalation}
                            onChange={(e) => patch({ notifyOnEscalation: e.target.checked })}
                            className="rounded"
                        />
                        <span className="text-body">{t('delivery.sendAlerts')}</span>
                    </label>

                    <div className="mt-3">
                        <label className="mb-1 block text-caption font-medium text-gray-600">
                            {t('delivery.renotifyLabel')}
                        </label>
                        <input
                            type="number"
                            min={1}
                            max={10080}
                            value={renotifyMinutes}
                            onChange={(e) =>
                                patch({
                                    escalationRenotifyMinutes: parseInt(e.target.value, 10) || 120,
                                })
                            }
                            className="w-32 rounded border px-2 py-1.5 text-body"
                        />
                        <p className="mt-1 text-caption text-gray-400">
                            {t('delivery.renotifyHint')}
                        </p>
                    </div>
                </div>

                <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3">
                    <button
                        onClick={onClose}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-body text-white hover:bg-blue-700"
                    >
                        {t('done')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <div className="mb-1.5 flex items-center gap-1.5 text-body font-medium text-gray-700">
            {icon} {label}
        </div>
    );
}

/** Chip editor shared by the email and phone lists. */
function RecipientEditor({
    values,
    placeholder,
    inputType,
    emptyText,
    validate,
    normalize,
    onChange,
}: {
    values: string[];
    placeholder: string;
    inputType: 'email' | 'tel';
    emptyText: string;
    validate: (value: string) => string | null;
    normalize: (value: string) => string;
    onChange: (next: string[]) => void;
}) {
    const { t } = useTranslation('automationFlowSettingsPanel');
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);

    const add = () => {
        const candidate = normalize(draft);
        if (!candidate) return;
        const problem = validate(candidate);
        if (problem) {
            setError(problem);
            return;
        }
        if (values.includes(candidate)) {
            setError(t('recipient.alreadyOnList'));
            return;
        }
        onChange([...values, candidate]);
        setDraft('');
        setError(null);
    };

    return (
        <>
            <div className="mb-2 flex flex-wrap gap-1.5">
                {values.length === 0 && (
                    <span className="text-caption italic text-gray-400">{emptyText}</span>
                )}
                {values.map((value) => (
                    <span
                        key={value}
                        className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-caption text-gray-700"
                    >
                        {value}
                        <button
                            onClick={() => onChange(values.filter((v) => v !== value))}
                            className="text-gray-400 hover:text-red-500"
                            title={t('recipient.remove', { value })}
                        >
                            <X size={12} />
                        </button>
                    </span>
                ))}
            </div>

            <div className="flex gap-2">
                <input
                    type={inputType}
                    value={draft}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setError(null);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            add();
                        }
                    }}
                    placeholder={placeholder}
                    className="flex-1 rounded border px-2 py-1.5 text-body"
                />
                <button
                    onClick={add}
                    className="inline-flex items-center gap-1 rounded bg-gray-800 px-3 py-1.5 text-body text-white hover:bg-gray-700"
                >
                    <Plus size={14} /> {t('recipient.add')}
                </button>
            </div>
            {error && <p className="mt-1 text-caption text-red-500">{error}</p>}
        </>
    );
}

function TemplateSelect({
    label,
    value,
    templates,
    loading,
    emptyOptionLabel,
    hint,
    onChange,
}: {
    label: string;
    value: string;
    templates: WhatsAppTemplateDTO[];
    loading: boolean;
    emptyOptionLabel: string;
    hint: string;
    onChange: (name: string) => void;
}) {
    const { t } = useTranslation('automationFlowSettingsPanel');
    // A template named in settings but missing from the list (deleted, or no longer approved) must
    // stay visible — silently resetting it to "none" would change behaviour without saying so.
    const isOrphan = value !== '' && !templates.some((tpl) => tpl.name === value);

    return (
        <div className="mt-3">
            <label className="mb-1 block text-caption font-medium text-gray-600">{label}</label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-body"
                disabled={loading}
            >
                <option value="">{loading ? t('template.loading') : emptyOptionLabel}</option>
                {isOrphan && <option value={value}>{t('template.orphanOption', { value })}</option>}
                {templates.map((tpl) => (
                    <option key={tpl.id || tpl.name} value={tpl.name}>
                        {tpl.name}
                        {tpl.language ? ` (${tpl.language})` : ''}
                    </option>
                ))}
            </select>
            {isOrphan ? (
                <p className="mt-1 text-caption text-amber-600">
                    {t('template.orphanHint', { value })}
                </p>
            ) : (
                <p className="mt-1 text-caption text-gray-400">{hint}</p>
            )}
        </div>
    );
}
