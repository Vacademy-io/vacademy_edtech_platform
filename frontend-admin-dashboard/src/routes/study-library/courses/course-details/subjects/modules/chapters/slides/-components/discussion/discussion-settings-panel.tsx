import { useId, type ReactNode } from 'react';
import { Info, Warning } from '@phosphor-icons/react';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
    CARE_NOTE_MAX,
    DISCUSSION_REACTIONS,
    type DiscussionReactionKey,
    type DiscussionSettings,
    type DiscussionSlideData,
    type DiscussionVisibility,
    htmlToPlainText,
} from './discussion-types';

const VISIBILITY_OPTIONS: ReadonlyArray<{
    value: DiscussionVisibility;
    label: string;
    help: string;
}> = [
    {
        value: 'OPEN',
        label: 'Everyone in the batch',
        help: 'Learners see their classmates’ replies straight away.',
    },
    {
        value: 'AFTER_REPLY',
        label: 'After they post their own reply',
        help: 'Classmates’ replies stay hidden until a learner shares their own thoughts first.',
    },
    {
        value: 'PRIVATE',
        label: 'Only teachers — private reflection',
        help: 'Each reply is seen only by the learner and teachers. Teachers can reply inside it.',
    },
];

function SettingRow({
    title,
    help,
    checked,
    disabled,
    onChange,
    children,
}: {
    title: string;
    help?: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
    children?: ReactNode;
}) {
    const id = useId();
    return (
        <div className="border-b border-border py-3 last:border-b-0">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <Label htmlFor={id} className="text-body font-semibold text-neutral-700">
                        {title}
                    </Label>
                    {help && <p className="mt-0.5 text-caption text-neutral-500">{help}</p>}
                </div>
                <Switch
                    id={id}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={onChange}
                    className="mt-0.5"
                />
            </div>
            {children}
        </div>
    );
}

export function DiscussionSettingsPanel({
    data,
    isEditable,
    onPromptChange,
    onSettingsChange,
}: {
    data: DiscussionSlideData;
    isEditable: boolean;
    onPromptChange: (html: string) => void;
    onSettingsChange: (patch: Partial<DiscussionSettings>) => void;
}) {
    const { settings } = data;
    const visibilityGroupId = useId();
    const careNoteId = useId();

    const toggleReaction = (key: DiscussionReactionKey) => {
        const has = settings.reactions.includes(key);
        const next = has
            ? settings.reactions.filter((r) => r !== key)
            : // keep the canonical order
              DISCUSSION_REACTIONS.map((r) => r.key).filter(
                  (k) => k === key || settings.reactions.includes(k)
              );
        onSettingsChange({ reactions: next });
    };

    return (
        <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
                <h3 className="text-subtitle font-semibold text-neutral-700">Question</h3>
                <p className="text-caption text-neutral-500">
                    Ask something learners can answer in their own words. A gentle, open question
                    works best.
                </p>
                {isEditable ? (
                    <RichTextEditor
                        value={data.prompt_html}
                        onChange={onPromptChange}
                        placeholder="e.g. What helps you feel calm before an exam?"
                        minHeight={140}
                        minimalToolbar
                    />
                ) : (
                    <p className="whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-body text-neutral-700">
                        {htmlToPlainText(data.prompt_html) || 'No question yet.'}
                    </p>
                )}
            </section>

            <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-col gap-1">
                    <h3
                        id={visibilityGroupId}
                        className="text-subtitle font-semibold text-neutral-700"
                    >
                        Who can see replies
                    </h3>
                </div>
                <RadioGroup
                    aria-labelledby={visibilityGroupId}
                    value={settings.visibility}
                    onValueChange={(v) =>
                        onSettingsChange({ visibility: v as DiscussionVisibility })
                    }
                    disabled={!isEditable}
                    className="gap-3"
                >
                    {VISIBILITY_OPTIONS.map((opt) => {
                        const optionId = `${visibilityGroupId}-${opt.value}`;
                        return (
                            <div
                                key={opt.value}
                                className={cn(
                                    'flex items-start gap-3 rounded-md border p-3 transition-colors',
                                    settings.visibility === opt.value
                                        ? 'border-primary-300 bg-primary-50'
                                        : 'border-border'
                                )}
                            >
                                <RadioGroupItem
                                    value={opt.value}
                                    id={optionId}
                                    className="mt-0.5"
                                />
                                <Label
                                    htmlFor={optionId}
                                    className="flex cursor-pointer flex-col gap-0.5"
                                >
                                    <span className="text-body font-semibold text-neutral-700">
                                        {opt.label}
                                    </span>
                                    <span className="text-caption font-regular text-neutral-500">
                                        {opt.help}
                                    </span>
                                </Label>
                            </div>
                        );
                    })}
                </RadioGroup>
            </section>

            <section className="flex flex-col rounded-lg border border-border bg-card px-4 py-1">
                <SettingRow
                    title="Allow comments on classmates’ replies"
                    help="Learners can always reply inside their own thread, for example to answer you."
                    checked={settings.allow_comments}
                    disabled={!isEditable}
                    onChange={(v) => onSettingsChange({ allow_comments: v })}
                />
                <SettingRow
                    title="Allow emoji reactions"
                    help="Supportive reactions only — there is no dislike."
                    checked={settings.allow_reactions}
                    disabled={!isEditable}
                    onChange={(v) => onSettingsChange({ allow_reactions: v })}
                >
                    {settings.allow_reactions && (
                        <div className="mt-3 flex flex-col gap-2">
                            <div className="flex flex-wrap gap-2">
                                {DISCUSSION_REACTIONS.map((r) => {
                                    const on = settings.reactions.includes(r.key);
                                    return (
                                        <button
                                            key={r.key}
                                            type="button"
                                            aria-pressed={on}
                                            disabled={!isEditable}
                                            onClick={() => toggleReaction(r.key)}
                                            className={cn(
                                                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                                on
                                                    ? 'border-primary-300 bg-primary-50 text-neutral-700'
                                                    : 'border-border text-neutral-400 hover:border-primary-200'
                                            )}
                                        >
                                            <span aria-hidden>{r.emoji}</span>
                                            {r.label}
                                        </button>
                                    );
                                })}
                            </div>
                            {settings.reactions.length === 0 && (
                                <p className="flex items-center gap-1 text-caption text-warning-600">
                                    <Warning className="size-4 shrink-0" />
                                    Pick at least one reaction, or turn reactions off.
                                </p>
                            )}
                        </div>
                    )}
                </SettingRow>
                <SettingRow
                    title="Allow anonymous posting"
                    help="Classmates won’t see the name. Teachers always can."
                    checked={settings.allow_anonymous}
                    disabled={!isEditable}
                    onChange={(v) => onSettingsChange({ allow_anonymous: v })}
                />
                <SettingRow
                    title="Teacher approves posts before others see them"
                    help="New posts and edits wait in Responses › Awaiting approval."
                    checked={settings.require_approval}
                    disabled={!isEditable}
                    onChange={(v) => onSettingsChange({ require_approval: v })}
                />
                <SettingRow
                    title="Students can edit or delete their own posts"
                    checked={settings.allow_edit_own}
                    disabled={!isEditable}
                    onChange={(v) => onSettingsChange({ allow_edit_own: v })}
                />
                <SettingRow
                    title="Lock discussion"
                    help="No new learner posts or edits. Reading, reactions and your replies still work."
                    checked={settings.locked}
                    disabled={!isEditable}
                    onChange={(v) => onSettingsChange({ locked: v })}
                />
            </section>

            <section className="flex flex-col gap-2">
                <Label
                    htmlFor={careNoteId}
                    className="text-subtitle font-semibold text-neutral-700"
                >
                    Care note{' '}
                    <span className="text-caption font-regular text-neutral-500">(optional)</span>
                </Label>
                <p className="text-caption text-neutral-500">
                    Shown above the reply box — for example, a helpline or who to talk to.
                </p>
                <Textarea
                    id={careNoteId}
                    value={settings.care_note}
                    disabled={!isEditable}
                    maxLength={CARE_NOTE_MAX}
                    rows={3}
                    placeholder="If this brings up something difficult, you can talk to your counsellor or call a helpline."
                    onChange={(e) =>
                        onSettingsChange({ care_note: e.target.value.slice(0, CARE_NOTE_MAX) })
                    }
                />
                <p className="self-end text-caption text-neutral-400">
                    {settings.care_note.length}/{CARE_NOTE_MAX}
                </p>
            </section>

            {isEditable && (
                <p className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-info-700">
                    <Info className="mt-0.5 size-4 shrink-0" />
                    Save Draft keeps your changes. Learners get the new question and settings only
                    after you Publish.
                </p>
            )}
        </div>
    );
}
