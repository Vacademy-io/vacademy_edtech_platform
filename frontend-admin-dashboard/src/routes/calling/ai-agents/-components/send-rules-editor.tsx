/**
 * "When the call ends like this, send that" — the action rules for one AI agent.
 *
 * The agent already offers a quiz link, a brochure and an advisor call on nearly every
 * call and nothing is sent today. Each rule here closes one of those promises. See
 * docs/crm/AI_CALL_ACTIONS.md.
 *
 * Deliberately a questionnaire, not a rule builder: SuchBliss-style admins are not
 * technical, so every rule reads as one sentence — WHEN <trigger> DO <action> USING
 * <template>. The predicate vocabulary is the agent's OWN dispositions and extraction
 * questions, so there is nothing new to learn and nothing to spell correctly.
 */
import { Plus, Trash, WhatsappLogo, EnvelopeSimple, CalendarCheck } from '@phosphor-icons/react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { whatsappTemplateService } from '@/services/whatsapp-template-service';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { fetchEmailTemplates } from '@/routes/calling/ai-agents/-services/ai-agents';
import type { AiCallActionRule } from '@/routes/settings/-components/AiAgentsCard';
import type { MetaWhatsAppTemplate } from '@/types/message-template-types';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

type TriggerKind = 'promised' | 'declined' | 'custom' | 'disposition' | 'meeting' | 'extracted';

interface Props {
    rules: AiCallActionRule[];
    dispositions: string[];
    extractionQuestions: string[];
    bookingPages: { id?: string; title?: string }[];
    onChange: (rules: AiCallActionRule[]) => void;
}

/**
 * A stable, spoken-safe key for one artefact. The AI names this key in a mid-call
 * marker and in its post-call report, so it must be plain ASCII with no spaces —
 * anything else is dropped server-side rather than sent.
 */
function slugify(label: string): string {
    return (label || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
}

function triggerKindOf(rule: AiCallActionRule): TriggerKind {
    const w = rule.when || {};
    if (w.promised) return 'promised';
    if (w.declined) return 'declined';
    if (w.custom !== undefined) return 'custom';
    if (w.disposition) return 'disposition';
    if (w.meetingRequested) return 'meeting';
    if (w.extracted && Object.keys(w.extracted).length) return 'extracted';
    return 'promised';
}

/**
 * Why a rule would never fire, in the admin's words.
 *
 * This exists because the editor used to lie: triggerKindOf() falls back to
 * 'promised' for DISPLAY when nothing is set, so the When dropdown showed a real
 * selection while `when` was still {}. AiCallActionService.isUsable then rejected
 * the rule (an empty predicate would fire on every call) and skipped it silently -
 * the admin saw a configured rule, the agent offered the link on a live call, and
 * nothing was ever sent.
 */
function ruleProblems(
    rule: AiCallActionRule,
    templates: MetaWhatsAppTemplate[] = []
): string[] {
    const problems: string[] = [];
    if (!rule.artefact || !rule.artefact.trim()) {
        problems.push('Give this rule a name — the AI needs one to refer to it.');
    }
    const w = rule.when || {};
    // A "caller says yes" rule derives its predicate from the key, so a missing key is
    // already reported above and there is nothing separate to choose. The other kinds
    // carry a value the admin has to pick.
    if (w.disposition !== undefined && !w.disposition) {
        problems.push('Choose which disposition triggers this.');
    }
    if (w.extracted && Object.keys(w.extracted).some((k) => !k)) {
        problems.push('Choose which captured answer triggers this.');
    }
    if (triggerKindOf(rule) === 'custom' && !(rule.when || {}).custom) {
        problems.push('Describe the situation this rule should run in.');
    }
    if (rule.actionType === 'BOOK_MEETING') {
        if (!rule.bookingPageId) problems.push('Choose a booking page.');
    } else if (rule.channel === 'WHATSAPP' && !rule.template) {
        problems.push('Choose an approved WhatsApp template.');
    } else if (rule.channel === 'EMAIL' && !rule.messageBody) {
        problems.push('Write the email message.');
    }
    // Rules saved BEFORE the swap handler cleared stale params still carry the wrong
    // count, and nothing on screen says so — the editor renders the current template's
    // blanks while the rule holds the old array. Meta rejects that send outright, so
    // surface it here rather than letting it fail silently on a live call.
    if (rule.actionType !== 'BOOK_MEETING' && rule.channel === 'WHATSAPP' && rule.template) {
        const chosen = templates.find((t) => t.name === rule.template);
        if (chosen) {
            // A media-header template renders a file above the body and is rejected
            // outright without one — Meta answers 132012, "header: Format mismatch,
            // expected IMAGE, received UNKNOWN". That is what sn_unlockx did on every
            // Shikshanation call once its body parameters were fixed.
            //
            // Image and document travel as the _headerUrl variable, which
            // UnifiedSendService reads per recipient. Video does NOT: it needs
            // options.headerType="video" on the send request, and the AI-call dispatcher
            // sets only source and sourceId — so a video template cannot work here.
            const headerFormat = chosen.components?.find((c) => c.type === 'HEADER')?.format;
            if (headerFormat === 'VIDEO') {
                problems.push(
                    `"${rule.template}" has a video header, which an AI call cannot attach — Meta rejects the send. Choose a template with an image, document or text header.`
                );
            } else if (
                (headerFormat === 'IMAGE' || headerFormat === 'DOCUMENT') &&
                !(rule.templateHeaderUrl || '').trim()
            ) {
                problems.push(
                    `"${rule.template}" shows ${headerFormat === 'IMAGE' ? 'an image' : 'a document'} above the message, so it needs a link to that file — Meta rejects the send without one.`
                );
            }
            const need = templateParamCount(chosen);
            const have = (rule.templateParams || []).length;
            if (have !== need) {
                problems.push(
                    need === 0
                        ? `"${rule.template}" takes no variables, but ${have} value${have === 1 ? '' : 's'} from a previous template ${have === 1 ? 'is' : 'are'} still saved. Pick the template again to clear them.`
                        : `"${rule.template}" needs exactly ${need} value${need === 1 ? '' : 's'}, but ${have} ${have === 1 ? 'is' : 'are'} saved. Pick the template again to reset them.`
                );
            }
        }
    }
    // The question IS the trigger for a "caller says yes" rule: with no question the
    // agent never offers it, so nothing can be agreed to and the rule sits idle.
    if (triggerKindOf(rule) === 'custom' && rule.timing === 'MID_CALL') {
        problems.push(
            'A described situation is judged after the call, so this rule cannot send during it.'
        );
    }
    if (!rule.askLine && (triggerKindOf(rule) === 'promised' || rule.timing === 'MID_CALL')) {
        problems.push(
            'Write what the agent asks — this rule fires when the agent offers it and the caller agrees, so without a question it never runs.'
        );
    }
    return problems;
}

/**
 * How many placeholders a Meta template body declares, and the text around them.
 *
 * Meta parameters are POSITIONAL - {{1}}, {{2}} - and the send is rejected outright if the
 * count we supply differs ("number of localizable_params (10) does not match the expected
 * number of params (2)"). So the editor has to ask for exactly as many values as the chosen
 * template declares, no more and no fewer.
 */
function templatePlaceholders(bodyText: string): number {
    const found = new Set<number>();
    const re = /\{\{\s*(\d+)\s*\}\}/g;
    let m = re.exec(bodyText || '');
    while (m !== null) {
        found.add(Number(m[1]));
        m = re.exec(bodyText || '');
    }
    return found.size;
}

/** How many values the chosen template needs. 0 when we cannot see its body. */
function templateParamCount(t?: MetaWhatsAppTemplate): number {
    const body = t?.components?.find((c) => c.type === 'BODY')?.text || '';
    return templatePlaceholders(body);
}

/** IMAGE / DOCUMENT / VIDEO when the template shows a file above the body, else undefined. */
function mediaHeaderFormat(t?: MetaWhatsAppTemplate): 'IMAGE' | 'DOCUMENT' | 'VIDEO' | undefined {
    const f = t?.components?.find((c) => c.type === 'HEADER')?.format;
    return f === 'IMAGE' || f === 'DOCUMENT' || f === 'VIDEO' ? f : undefined;
}

/** The variables a call can always fill, offered as a hint next to each parameter. */
const SUGGESTED_VARS = ['name', 'phone', 'email'];

const BLANK: AiCallActionRule = {
    enabled: true,
    timing: 'POST_CALL',
    actionType: 'SHARE_LINK',
    channel: 'WHATSAPP',
    to: 'phone',
    when: {},
};

export function SendRulesEditor({
    rules,
    dispositions,
    extractionQuestions,
    bookingPages,
    onChange,
}: Props) {
    // Only APPROVED templates are offered. An unapproved name is accepted by us and
    // then rejected by Meta at send time, which surfaces as a failed action hours
    // later instead of as a validation error while the admin is still looking.
    const templatesQuery = useQuery({
        queryKey: ['whatsapp-templates-approved'],
        queryFn: () => whatsappTemplateService.getMetaTemplates(),
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
    const templates = (templatesQuery.data ?? []).filter(
        (t) => (t.status || '').toUpperCase() === 'APPROVED'
    );
    // Three distinct states, and the admin must be able to tell them apart. Falling back
    // to a bare text box for all of them (the first cut) reads as "they forgot to build
    // the dropdown" when the real cause is that this institute has never synced its
    // templates — getMetaTemplates reads the STORED list, it does not call Meta.
    const templatesLoading = templatesQuery.isLoading;
    const templatesFailed = templatesQuery.isError;

    const emailTemplatesQuery = useQuery({
        queryKey: ['institute-email-templates'],
        queryFn: () => fetchEmailTemplates(getCurrentInstituteId() || ''),
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
    const emailTemplates = (emailTemplatesQuery.data ?? []).filter(
        (t) => (t.status || 'ACTIVE').toUpperCase() !== 'INACTIVE'
    );

    const [advancedOpen, setAdvancedOpen] = useState<Record<number, boolean>>({});

    const update = (i: number, patch: Partial<AiCallActionRule>) => {
        const next = rules.map((r, n) => {
            if (n !== i) return r;
            const merged = { ...r, ...patch };
            // For the common rule - "the agent offers it, the caller says yes" - the
            // QUESTION is the trigger, so the predicate is derived from the rule's key
            // instead of being maintained separately. Hand-syncing the two is what let a
            // rule show a When it did not actually have, look configured, and never fire.
            if (triggerKindOf(merged) === 'promised') {
                return { ...merged, when: { promised: (merged.artefact || '').trim() } };
            }
            return merged;
        });
        onChange(next);
    };

    const setTrigger = (i: number, kind: TriggerKind) => {
        const rule = rules[i];
        if (!rule) return;
        // One predicate at a time. Carrying the old one over would silently AND them
        // together and the rule would stop firing for reasons nothing on screen explains.
        const when: AiCallActionRule['when'] =
            kind === 'promised'
                ? { promised: rule.artefact || slugify(rule.label || '') }
                : kind === 'declined'
                  ? { declined: rule.artefact || slugify(rule.label || '') }
                  : kind === 'custom'
                    ? { custom: '' }
                    : kind === 'disposition'
                      ? { disposition: dispositions[0] || '' }
                      : kind === 'meeting'
                        ? { meetingRequested: true }
                        : { extracted: { [extractionQuestions[0] || '']: 'present' } };
        update(i, { when });
    };

    // Seed the predicate the UI is already showing. Adding a rule with when:{} made
    // the dropdown display "The caller accepted this on the call" over an empty
    // object, so a rule looked configured and could never run.
    const add = () => onChange([...rules, { ...BLANK, when: { promised: '' } }]);
    const remove = (i: number) => onChange(rules.filter((_, n) => n !== i));

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div>
                    <Label>What to send after a call</Label>
                    <p className="text-caption text-neutral-500">
                        The agent promises links and brochures on calls. Add a rule for each
                        promise so it is actually delivered.
                    </p>
                </div>
                <MyButton type="button" buttonType="secondary" scale="small" onClick={add}>
                    <Plus size={14} /> Add rule
                </MyButton>
            </div>

            {rules.length === 0 && (
                <p className="rounded-md border border-dashed border-neutral-200 p-4 text-caption text-neutral-500">
                    No rules yet — this agent sends nothing after a call.
                </p>
            )}

            {rules.map((rule, i) => {
                const kind = triggerKindOf(rule);
                const isMeeting = rule.actionType === 'BOOK_MEETING';
                const isWhatsApp = !isMeeting && rule.channel === 'WHATSAPP';
                return (
                    <div
                        key={rule.id || `new-${i}`}
                        className="space-y-3 rounded-md border border-neutral-200 p-3"
                    >
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={rule.enabled !== false}
                                onCheckedChange={(v) => update(i, { enabled: v })}
                            />
                            <Input
                                className="h-8 flex-1"
                                placeholder={`Name this rule, e.g. ${getTerminology(ContentTerms.Course, SystemTerms.Course)} brochure`}
                                value={rule.label || ''}
                                onChange={(e) => {
                                    const label = e.target.value;
                                    // The key follows the label only until the rule is saved.
                                    // After that the backend owns the id and the key is part
                                    // of what the AI was told, so renaming must not move it.
                                    // `when` is not touched here - update() derives it.
                                    const patch: Partial<AiCallActionRule> = { label };
                                    if (!rule.id) patch.artefact = slugify(label);
                                    update(i, patch);
                                }}
                            />
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => remove(i)}
                                aria-label="Remove rule"
                            >
                                <Trash size={14} />
                            </MyButton>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-caption">What the agent asks on the call</Label>
                            <Input
                                className="h-8"
                                placeholder="Kya main aapko WhatsApp par details bhej doon?"
                                value={rule.askLine || ''}
                                onChange={(e) => update(i, { askLine: e.target.value })}
                            />
                            <p className="text-caption text-neutral-500">
                                Write it the way the agent should say it. It is added to the
                                call prompt automatically — don&apos;t also put it in the system
                                prompt. Leave blank if the caller usually brings this up first.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label className="text-caption">When to do it</Label>
                                <Select value={kind} onValueChange={(v) => setTrigger(i, v as TriggerKind)}>
                                    <SelectTrigger className="h-8">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="promised">
                                            The caller says yes to your question
                                        </SelectItem>
                                        <SelectItem value="declined">
                                            The caller says no to your question
                                        </SelectItem>
                                        <SelectItem value="custom">
                                            Something else I describe
                                        </SelectItem>
                                        <SelectItem value="disposition">
                                            The call ended with a disposition
                                        </SelectItem>
                                        <SelectItem value="meeting">
                                            The caller agreed to a meeting time
                                        </SelectItem>
                                        <SelectItem value="extracted">
                                            An answer was captured
                                        </SelectItem>
                                    </SelectContent>
                                </Select>

                                {kind === 'custom' && (
                                    <>
                                        <Input
                                            className="h-8"
                                            placeholder="e.g. the parent asked about fees"
                                            value={rule.when?.custom || ''}
                                            onChange={(e) =>
                                                update(i, { when: { custom: e.target.value } })
                                            }
                                        />
                                        <p className="text-caption text-neutral-500">
                                            Written as a statement about the call. After each call
                                            the AI decides whether it was clearly true — if it is
                                            unsure, the rule does not run.
                                        </p>
                                    </>
                                )}

                                {kind === 'disposition' && (
                                    <Select
                                        value={rule.when?.disposition || ''}
                                        onValueChange={(v) => update(i, { when: { disposition: v } })}
                                    >
                                        <SelectTrigger className="h-8">
                                            <SelectValue placeholder="Pick a disposition" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {dispositions.map((d) => (
                                                <SelectItem key={d} value={d}>
                                                    {d}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                                {kind === 'extracted' && (
                                    <Select
                                        value={Object.keys(rule.when?.extracted || {})[0] || ''}
                                        onValueChange={(v) =>
                                            update(i, { when: { extracted: { [v]: 'present' } } })
                                        }
                                    >
                                        <SelectTrigger className="h-8">
                                            <SelectValue placeholder="Pick a question" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {extractionQuestions.map((q) => (
                                                <SelectItem key={q} value={q}>
                                                    {q}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                                {kind === 'disposition' && dispositions.length === 0 && (
                                    <p className="text-caption text-warning-600">
                                        Add dispositions to this agent first.
                                    </p>
                                )}
                                {kind === 'extracted' && extractionQuestions.length === 0 && (
                                    <p className="text-caption text-warning-600">
                                        Add extraction questions to this agent first.
                                    </p>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-caption">Do</Label>
                                <Select
                                    value={isMeeting ? 'BOOK_MEETING' : rule.channel || 'WHATSAPP'}
                                    onValueChange={(v) =>
                                        update(
                                            i,
                                            v === 'BOOK_MEETING'
                                                ? {
                                                      actionType: 'BOOK_MEETING',
                                                      channel: undefined,
                                                      to: 'phone',
                                                  }
                                                : {
                                                      actionType: 'SHARE_LINK',
                                                      channel: v as 'WHATSAPP' | 'EMAIL',
                                                      to: v === 'EMAIL' ? 'email' : 'phone',
                                                  }
                                        )
                                    }
                                >
                                    <SelectTrigger className="h-8">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="WHATSAPP">
                                            <span className="flex items-center gap-2">
                                                <WhatsappLogo size={14} /> Send on WhatsApp
                                            </span>
                                        </SelectItem>
                                        <SelectItem value="EMAIL">
                                            <span className="flex items-center gap-2">
                                                <EnvelopeSimple size={14} /> Send by email
                                            </span>
                                        </SelectItem>
                                        <SelectItem value="BOOK_MEETING">
                                            <span className="flex items-center gap-2">
                                                <CalendarCheck size={14} /> Book a meeting
                                            </span>
                                        </SelectItem>
                                    </SelectContent>
                                </Select>

                                {isMeeting ? (
                                    <Select
                                        value={rule.bookingPageId || 'DEFAULT'}
                                        onValueChange={(v) =>
                                            update(i, {
                                                bookingPageId: v === 'DEFAULT' ? undefined : v,
                                            })
                                        }
                                    >
                                        <SelectTrigger className="h-8">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="DEFAULT">
                                                Use the agent&apos;s booking page
                                            </SelectItem>
                                            {bookingPages.map((bp) => (
                                                <SelectItem key={bp.id} value={bp.id ?? ''}>
                                                    {bp.title}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : isWhatsApp && templatesLoading ? (
                                    <Select disabled value="">
                                        <SelectTrigger className="h-8">
                                            <SelectValue placeholder="Loading templates..." />
                                        </SelectTrigger>
                                        <SelectContent />
                                    </Select>
                                ) : isWhatsApp && templates.length > 0 ? (
                                    <Select
                                        value={rule.template || ''}
                                        onValueChange={(v) => {
                                            const t = templates.find((x) => x.name === v);
                                            // Meta parameters are positional and the count must
                                            // match EXACTLY, so the params belong to the template
                                            // that is chosen now — not to the one it replaced.
                                            // Leaving them behind is silent: the editor renders
                                            // the new template's blanks (or "takes no variables")
                                            // while the rule still carries the old array, and the
                                            // mismatch only surfaces mid-call, as Meta error 132000.
                                            // Shikshanation's quiz rule kept two params from
                                            // hello_utility_confirmation after being pointed at
                                            // sn_unlockx, which declares none, and every send
                                            // failed. Values for positions the new template still
                                            // has are kept, so swapping between two 2-variable
                                            // templates does not make the admin retype them.
                                            const count = templateParamCount(t);
                                            const prev = rule.templateParams || [];
                                            update(i, {
                                                template: v,
                                                templateLanguage: t?.language || undefined,
                                                templateParams:
                                                    count === 0
                                                        ? []
                                                        : Array.from(
                                                              { length: count },
                                                              (_x, k) => prev[k] || ''
                                                          ),
                                                // The header file belongs to the old template's
                                                // header, so it is dropped unless the new one
                                                // also shows one. Same staleness trap as the
                                                // params, with a worse failure: a leftover link
                                                // on a text-header template is sent as a header
                                                // Meta is not expecting.
                                                templateHeaderUrl: mediaHeaderFormat(t)
                                                    ? rule.templateHeaderUrl
                                                    : undefined,
                                                // Derived, never typed. The send has to say
                                                // whether the file is an image or a document —
                                                // WhatsAppService treats anything that is not
                                                // literally "image" as a document — and the
                                                // template already declares which it is.
                                                templateHeaderType:
                                                    mediaHeaderFormat(t) === 'IMAGE'
                                                        ? 'image'
                                                        : mediaHeaderFormat(t) === 'DOCUMENT'
                                                          ? 'document'
                                                          : undefined,
                                            });
                                        }}
                                    >
                                        <SelectTrigger className="h-8">
                                            <SelectValue placeholder="Pick an approved template" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {templates.map((t) => (
                                                <SelectItem key={`${t.name}-${t.language}`} value={t.name}>
                                                    {t.name}
                                                    {t.language ? ` · ${t.language}` : ''}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : isWhatsApp ? (
                                    <>
                                        <Input
                                            className="h-8"
                                            placeholder="Approved template name"
                                            value={rule.template || ''}
                                            onChange={(e) =>
                                                update(i, { template: e.target.value })
                                            }
                                        />
                                        <p className="text-caption text-warning-600">
                                            {templatesFailed
                                                ? 'Could not load your WhatsApp templates. Type the name exactly as Meta approved it.'
                                                : 'No approved templates for this institute yet. Sync them under Settings, WhatsApp Templates, or type the name exactly as Meta approved it.'}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        {emailTemplates.length > 0 && (
                                            <Select
                                                value=""
                                                onValueChange={(v) => {
                                                    const t = emailTemplates.find(
                                                        (x) => x.id === v
                                                    );
                                                    if (!t) return;
                                                    // Copy, do not reference: the email path
                                                    // sends draft_body verbatim, so the rule
                                                    // has to own the text.
                                                    const subject = (t.subject || t.name || '').trim();
                                                    const content = (t.content || '').trim();
                                                    update(i, {
                                                        messageBody: subject
                                                            ? subject + '\n\n' + content
                                                            : content,
                                                    });
                                                }}
                                            >
                                                <SelectTrigger className="h-8">
                                                    <SelectValue placeholder="Start from one of your email templates" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {emailTemplates.map((t) => (
                                                        <SelectItem key={t.id} value={t.id}>
                                                            {t.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    <Textarea
                                        rows={4}
                                        placeholder={`Subject line goes here

Namaste {{name}}, ...`}
                                        value={rule.messageBody || ''}
                                        onChange={(e) => update(i, { messageBody: e.target.value })}
                                    />
                                    </>
                                )}
                            </div>
                        </div>

                        {isWhatsApp &&
                            rule.template &&
                            (() => {
                                const chosen = templates.find((t) => t.name === rule.template);
                                const fmt = mediaHeaderFormat(chosen);
                                if (!chosen || !fmt) return null;
                                if (fmt === 'VIDEO') {
                                    return (
                                        <p className="text-caption text-warning-600">
                                            This template has a video header, which an AI call
                                            cannot attach. Pick one with an image, document or text
                                            header.
                                        </p>
                                    );
                                }
                                return (
                                    <div className="space-y-1.5">
                                        <Label className="text-caption">
                                            Link to the {fmt === 'IMAGE' ? 'image' : 'document'}{' '}
                                            shown above the message
                                        </Label>
                                        <Input
                                            className="h-8"
                                            placeholder="https://… — a public link to the file"
                                            value={rule.templateHeaderUrl || ''}
                                            onChange={(e) =>
                                                update(i, { templateHeaderUrl: e.target.value })
                                            }
                                        />
                                        <p className="text-caption text-neutral-500">
                                            This template shows{' '}
                                            {fmt === 'IMAGE' ? 'an image' : 'a document'} above the
                                            text. Meta rejects the send without one.
                                        </p>
                                    </div>
                                );
                            })()}

                        {isWhatsApp && rule.template && (() => {
                            const chosen = templates.find((t) => t.name === rule.template);
                            const body =
                                chosen?.components?.find((c) => c.type === 'BODY')?.text || '';
                            const count = templatePlaceholders(body);
                            if (!chosen) return null;
                            if (count === 0) {
                                return (
                                    <p className="text-caption text-neutral-500">
                                        This template takes no variables — nothing else to fill in.
                                    </p>
                                );
                            }
                            const params = rule.templateParams || [];
                            return (
                                <div className="space-y-1.5">
                                    <Label className="text-caption">
                                        What goes in the template&apos;s {count} blank
                                        {count > 1 ? 's' : ''}
                                    </Label>
                                    {Array.from({ length: count }).map((_, n) => (
                                        <Input
                                            key={n}
                                            className="h-8"
                                            placeholder={
                                                'Blank ' +
                                                (n + 1) +
                                                ' — a variable like ' +
                                                SUGGESTED_VARS[n % SUGGESTED_VARS.length] +
                                                ', or type fixed text'
                                            }
                                            value={params[n] || ''}
                                            onChange={(e) => {
                                                const next = Array.from({ length: count }).map(
                                                    (_x, k) =>
                                                        k === n ? e.target.value : params[k] || ''
                                                );
                                                update(i, { templateParams: next });
                                            }}
                                        />
                                    ))}
                                    <p className="text-caption text-neutral-500">
                                        Meta fills these in order. Give exactly {count} — a
                                        different number and the message is rejected.
                                    </p>
                                </div>
                            );
                        })()}

                        {!isMeeting && !isWhatsApp && (
                            <p className="text-caption text-neutral-500">
                                Email is sent exactly as written — the first line becomes the
                                subject. Variables are filled from the lead&apos;s own record:{' '}
                                {'{{name}}'}, {'{{phone}}'}, {'{{email}}'}, any field your form
                                captured (e.g. {'{{course_interested}}'}), and anything the agent
                                captured on the call. A variable that lead has no value for is
                                left as written — so pick a template that matches the data you
                                collect.
                            </p>
                        )}

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label className="text-caption">Send it</Label>
                                <Select
                                    value={rule.timing || 'POST_CALL'}
                                    onValueChange={(v) =>
                                        update(i, { timing: v as 'POST_CALL' | 'MID_CALL' })
                                    }
                                >
                                    <SelectTrigger className="h-8">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="POST_CALL">
                                            After the call ends
                                        </SelectItem>
                                        <SelectItem value="MID_CALL">
                                            During the call, as soon as they say yes
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div />
                        </div>

                        {ruleProblems(rule, templates).length > 0 && (
                            <div className="rounded-md bg-warning-50 p-2">
                                {ruleProblems(rule, templates).map((problem) => (
                                    <p key={problem} className="text-caption text-warning-600">
                                        {problem}
                                    </p>
                                ))}
                            </div>
                        )}

                        <div>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                onClick={() =>
                                    setAdvancedOpen((o) => ({ ...o, [i]: !o[i] }))
                                }
                            >
                                {advancedOpen[i] ? 'Hide advanced' : 'Advanced'}
                            </MyButton>
                            {advancedOpen[i] && (
                                <div className="mt-2 space-y-1.5">
                                    <Label className="text-caption">Reference name</Label>
                                    <Input
                                        className="h-8 font-mono text-caption"
                                        value={rule.artefact || ''}
                                        onChange={(e) =>
                                            update(i, { artefact: slugify(e.target.value) })
                                        }
                                    />
                                    <p className="text-caption text-neutral-500">
                                        The short name the AI uses for this item when it reports
                                        what the caller agreed to. Filled in from the rule name.
                                        You only need to change it if two rules would end up with
                                        the same one.
                                    </p>
                                </div>
                            )}
                        </div>

                        {rule.timing === 'MID_CALL' && (
                            <p className="text-caption text-neutral-500">
                                The agent sends this the moment the caller agrees, without
                                waiting for the call to end.
                            </p>
                        )}
                    </div>
                );
            })}

        </div>
    );
}
