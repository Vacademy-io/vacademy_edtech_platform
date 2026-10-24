/**
 * LeadFormResponseCard — surfaces the audience-form answers of a lead in the
 * side-view, stitched alongside the existing Overview content.
 *
 * Only renders when {@code selectedStudent._response_fields} is populated
 * (which campaign-users-table.tsx attaches when a lead row is clicked). For
 * users coming from manage-students / manage-contacts the prop is absent and
 * the card is silently skipped.
 *
 * Each field is rendered with its display name, a type-aware formatted value,
 * and (for {@code multi_select}) a row of chips so multiple selections read
 * cleanly instead of as raw JSON.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListChecks, FileText, ArrowSquareOut, Phone, Robot } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MyButton } from '@/components/design-system/button';
import { AiCallChooserFields, useAiCallChooser } from '@/components/shared/leads/ai-call-chooser';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import {
    formatCustomFieldValue,
    isMultiSelectType,
    parseMultiSelectValue,
} from '../../-utils/format-custom-field-value';
import {
    CallPickerPopover,
    usePlaceCall,
    usePlaceAiCall,
    useAiCallButtonEnabled,
} from '@/components/shared/leads';
import { cn } from '@/lib/utils';

export interface LeadResponseField {
    id: string;
    name: string;
    type: string;
    rawValue: string | null;
}

const isUrlValue = (value: string | null) =>
    !!value && (value.startsWith('http://') || value.startsWith('https://'));

/**
 * Returns true when this form-response row holds the lead's phone number —
 * either by field type or by a name that looks like phone/mobile. We accept
 * the loose name match because campaign authors sometimes pick a generic
 * "text" field for the phone column.
 */
const isPhoneField = (field: LeadResponseField): boolean => {
    const fieldType = (field.type ?? '').toLowerCase().trim();
    if (fieldType === 'phone' || fieldType === 'mobile' || fieldType === 'telephone') return true;
    const n = (field.name ?? '').toLowerCase();
    return /\bphone\b|\bmobile\b|\btelephone\b/.test(n);
};

interface CallAction {
    /** Called when the counsellor picks an ExoPhone and clicks "Call now". */
    onCall: (preferredNumberId: string) => void;
    leadUserId: string | null | undefined;
    /** Greys out the trigger and shows {@link reason} as a tooltip. */
    disabled: boolean;
    reason?: string;
    /** Reflects {@code placeCallMutation.isPending} so the button shows progress. */
    isPending: boolean;
}

/**
 * Pill-style Call CTA — visually mirrors the CALL_LOG action tile in the
 * activity timeline (teal accent + phone icon) so counsellors immediately
 * recognise it as the "place a call" affordance.
 */
const CallButton = ({ call }: { call: CallAction }) => {
    const { t } = useTranslation('audienceManagerLeadFormResponseCard');
    const muted = call.disabled || call.isPending;
    return (
        <CallPickerPopover
            leadUserId={call.leadUserId}
            disabled={muted}
            disabledReason={call.reason}
            onConfirm={call.onCall}
            trigger={
                <button
                    type="button"
                    title={call.reason ?? t('callButton.title')}
                    aria-label={t('callButton.ariaLabel')}
                    disabled={muted}
                    className={cn(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                        muted
                            ? 'cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-400'
                            : 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100'
                    )}
                >
                    <Phone weight="fill" className="size-3.5" />
                    {call.isPending ? t('callButton.connecting') : t('callButton.callNow')}
                </button>
            }
        />
    );
};

interface AiCallAction {
    /** Fire the AI call. Optional chosen agent + caller-number ids (blank ⇒ defaults). */
    onCall: (campaignId?: string, preferredNumberId?: string) => void;
    disabled: boolean;
    reason?: string;
    isPending: boolean;
}

const AI_PILL =
    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors';
const AI_PILL_MUTED = 'cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-400';
const AI_PILL_ACTIVE = 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100';

/**
 * AI-call CTA — mirrors {@link CallButton} but places a call with the AI voice agent.
 * When the institute has more than one AI agent or calling number, clicking opens a
 * small chooser (agent + caller number) before placing; otherwise it fires straight
 * away with the defaults. Rendered only when AI calling's lead-list surface is enabled.
 */
const AiCallButton = ({ ai }: { ai: AiCallAction }) => {
    const { t } = useTranslation('audienceManagerLeadFormResponseCard');
    const muted = ai.disabled || ai.isPending;
    const { needsChooser } = useAiCallChooser();
    const [open, setOpen] = useState(false);
    const [agentId, setAgentId] = useState('');
    const [numberId, setNumberId] = useState('');

    const label = (
        <>
            <Robot weight="fill" className="size-3.5" />
            {ai.isPending ? t('aiCallButton.calling') : t('aiCallButton.aiCall')}
        </>
    );

    if (!needsChooser) {
        return (
            <button
                type="button"
                title={ai.reason ?? t('aiCallButton.title')}
                aria-label={t('aiCallButton.ariaLabel')}
                disabled={muted}
                onClick={() => ai.onCall()}
                className={cn(AI_PILL, muted ? AI_PILL_MUTED : AI_PILL_ACTIVE)}
            >
                {label}
            </button>
        );
    }

    return (
        <Popover
            open={open}
            onOpenChange={(o) => {
                setOpen(o);
                if (!o) {
                    setAgentId('');
                    setNumberId('');
                }
            }}
        >
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title={t('aiCallButton.title')}
                    aria-label={t('aiCallButton.ariaLabel')}
                    disabled={ai.disabled}
                    className={cn(AI_PILL, ai.disabled ? AI_PILL_MUTED : AI_PILL_ACTIVE)}
                >
                    {label}
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
                <div className="flex flex-col gap-3">
                    <p className="text-caption font-medium text-neutral-700">
                        {t('aiCallButton.optionsHeading')}
                    </p>
                    <AiCallChooserFields
                        agentId={agentId}
                        onAgentChange={setAgentId}
                        numberId={numberId}
                        onNumberChange={setNumberId}
                    />
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={ai.disabled || ai.isPending}
                        onClick={() => {
                            ai.onCall(agentId || undefined, numberId || undefined);
                            setOpen(false);
                        }}
                    >
                        {ai.isPending ? t('aiCallButton.calling') : t('aiCallButton.placeAiCall')}
                    </MyButton>
                </div>
            </PopoverContent>
        </Popover>
    );
};

const Row = ({
    field,
    call,
    aiCall,
}: {
    field: LeadResponseField;
    call?: CallAction;
    aiCall?: AiCallAction;
}) => {
    const { t } = useTranslation('audienceManagerLeadFormResponseCard');
    const { t: tFormat } = useTranslation('audienceManagerFormatCustomFieldValue');
    const { name, type, rawValue } = field;
    const normalized = (type ?? '').toLowerCase();

    if (isMultiSelectType(type)) {
        const items = parseMultiSelectValue(rawValue);
        return (
            <div className="flex items-start gap-3 px-3 py-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                    <ListChecks className="size-3.5" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-2xs font-medium uppercase tracking-wider text-neutral-500">
                        {name}
                    </p>
                    {items.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                            {items.map((item, idx) => (
                                <Badge
                                    key={`${item}-${idx}`}
                                    variant="secondary"
                                    className="bg-primary-50 text-primary-700 hover:bg-primary-50"
                                >
                                    {item}
                                </Badge>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm italic text-neutral-400">{t('row.notProvided')}</p>
                    )}
                </div>
            </div>
        );
    }

    if (normalized === 'file' && isUrlValue(rawValue)) {
        return (
            <div className="flex items-start gap-3 px-3 py-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                    <FileText className="size-3.5" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-2xs font-medium uppercase tracking-wider text-neutral-500">
                        {name}
                    </p>
                    <a
                        href={rawValue!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1.5 truncate text-sm font-medium text-primary-600 hover:underline"
                    >
                        <span className="truncate">{t('row.viewAttachment')}</span>
                        <ArrowSquareOut className="size-3.5 shrink-0" />
                    </a>
                </div>
            </div>
        );
    }

    const display = formatCustomFieldValue(rawValue, type, tFormat);
    const showCall = !!call && isPhoneField(field) && display !== '-';
    return (
        <div className="flex items-start gap-3 px-3 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                <FileText className="size-3.5" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-2xs font-medium uppercase tracking-wider text-neutral-500">
                    {name}
                </p>
                <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 break-words text-sm font-medium text-neutral-900">
                        {display === '-' ? (
                            <span className="font-normal italic text-neutral-400">
                                {t('row.notProvided')}
                            </span>
                        ) : (
                            display
                        )}
                    </p>
                    {showCall && (
                        <div className="flex shrink-0 items-center gap-1.5">
                            {aiCall && <AiCallButton ai={aiCall} />}
                            <CallButton call={call!} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export const LeadFormResponseCard = () => {
    const { t } = useTranslation('audienceManagerLeadFormResponseCard');
    const { selectedStudent } = useStudentSidebar();
    // Loose access — `_response_fields` / `_audience_campaign_name` /
    // `_response_id` are attached by audience-list flows only and aren't part
    // of the canonical StudentTable shape. `user_id` IS canonical, so we
    // read it off the typed object directly.
    //
    // `selectedStudent` is nullable: this card renders whenever the side view's
    // active tab is `lead`, which a tenant can configure as the *default* tab —
    // so it mounts before any lead is selected (selectedStudent === null).
    // Optional-chain every read so that case renders nothing instead of
    // throwing "Cannot read properties of null (reading '_response_fields')".
    const ext = selectedStudent as unknown as {
        _response_fields?: LeadResponseField[];
        _audience_campaign_name?: string;
        _audience_campaign_type?: string;
        _response_id?: string | null;
    } | null;
    const fields = ext?._response_fields;
    const responseId = ext?._response_id ?? null;
    const leadUserId = selectedStudent?.user_id ?? null;

    // Hooks must run unconditionally — set up the mutations before the
    // empty-fields short-circuit so React's hook order stays stable.
    const placeCallMutation = usePlaceCall();
    const aiEnabled = useAiCallButtonEnabled();
    const placeAiCallMutation = usePlaceAiCall({ invalidateKeys: [['telephony-call-history']] });

    if (!fields || fields.length === 0) return null;

    const campaignName = ext?._audience_campaign_name;
    // Channel › list, so the side view reads the same hierarchy as the leads table.
    const campaignType = ext?._audience_campaign_type;
    const campaignTrail = [campaignType, campaignName].filter(Boolean).join(' › ');

    // The Call button shows on the phone-number row only (see {@link isPhoneField}).
    // We disable it pre-emptively when we don't have a response id (the backend
    // looks up the lead's phone via that id).
    const call: CallAction = {
        leadUserId,
        disabled: !responseId,
        reason: !responseId ? t('errors.noResponseForCall') : undefined,
        isPending: placeCallMutation.isPending,
        onCall: (preferredNumberId) => {
            if (!responseId) return;
            placeCallMutation.mutate({
                responseId,
                userId: leadUserId ?? undefined,
                preferredNumberId,
            });
        },
    };

    // AI-call action — only when AI calling's lead-list surface is enabled for the
    // institute (undefined otherwise, so the button isn't rendered).
    const aiCall: AiCallAction | undefined = aiEnabled
        ? {
              disabled: !responseId,
              reason: !responseId ? t('errors.noResponseForAiCall') : undefined,
              isPending: placeAiCallMutation.isPending,
              onCall: (campaignId, preferredNumberId) => {
                  if (!responseId) return;
                  placeAiCallMutation.mutate({
                      responseId,
                      userId: leadUserId ?? undefined,
                      campaignId,
                      preferredNumberId,
                  });
              },
          }
        : undefined;

    return (
        <Card className="border-neutral-200 shadow-none">
            <CardHeader className="px-4 pb-3 pt-4">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
                    <ListChecks className="size-4 text-primary-500" />
                    {t('card.title')}
                    {campaignTrail && (
                        <span className="text-xs font-normal text-neutral-500">
                            · {campaignTrail}
                        </span>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent className="px-1 pb-3 pt-0">
                {fields.map((field, idx) => (
                    <div key={field.id || `${field.name}-${idx}`}>
                        <Row field={field} call={call} aiCall={aiCall} />
                        {idx < fields.length - 1 && <Separator className="bg-neutral-100" />}
                    </div>
                ))}
            </CardContent>
        </Card>
    );
};

export default LeadFormResponseCard;
