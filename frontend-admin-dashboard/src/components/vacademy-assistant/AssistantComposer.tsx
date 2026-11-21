import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PaperPlaneRight } from '@phosphor-icons/react';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { VoiceInputControls, VoiceInputStatusMessage } from './VoiceInput';
import type { VoiceInput } from '@/hooks/use-voice-input';

/** Tallest the message box grows to (in px) before it scrolls; matches `max-h-40`. */
const MAX_HEIGHT_PX = 160;

/** True for the Enter that sends: not Shift+Enter and not an IME composition. */
export function isSendKey(event: {
    key: string;
    shiftKey: boolean;
    nativeEvent?: { isComposing?: boolean };
    keyCode?: number;
}): boolean {
    return (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.nativeEvent?.isComposing &&
        event.keyCode !== 229
    );
}

export interface AssistantComposerProps {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    busy: boolean;
    chatbotName: string;
    voice: VoiceInput;
}

/**
 * The panel's message box: grows with its text up to a few lines, Enter sends and Shift+Enter
 * adds a line. The mic and Send buttons sit on the last line, Send disabled while empty or busy.
 */
export const AssistantComposer = forwardRef<HTMLTextAreaElement, AssistantComposerProps>(
    function AssistantComposer({ value, onChange, onSend, busy, chatbotName, voice }, ref) {
        const { t } = useTranslation('dashboardIndex');
        const id = useId();
        const inputRef = useRef<HTMLTextAreaElement>(null);
        useImperativeHandle(ref, () => inputRef.current as HTMLTextAreaElement);

        const fit = useCallback(() => {
            const el = inputRef.current;
            if (!el) return;
            // Auto-grow: the height follows the text (a measured, per-keystroke value).
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
        }, []);
        useEffect(fit, [value, fit]);

        const canSend = value.trim() !== '' && !busy;
        const send = () => {
            if (canSend) onSend();
        };

        return (
            <div className="shrink-0 border-t border-neutral-200 bg-white px-3 pb-3 pt-2">
                <VoiceInputStatusMessage voice={voice} className="mb-2" />
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        send();
                    }}
                    className="flex items-end gap-2 rounded-lg border border-neutral-300 bg-white py-1.5 pe-1.5 ps-3 transition-colors focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-100 motion-reduce:transition-none"
                >
                    <label htmlFor={`${id}-message`} className="sr-only">
                        {t('assistant.panel.composer.label', { chatbotName })}
                    </label>
                    <Textarea
                        ref={inputRef}
                        id={`${id}-message`}
                        rows={1}
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (isSendKey(event)) {
                                event.preventDefault();
                                send();
                            }
                        }}
                        placeholder={t('assistant.panel.composer.placeholder')}
                        aria-describedby={`${id}-hint`}
                        className="max-h-40 min-h-9 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-2 text-body shadow-none focus-visible:ring-0"
                    />
                    <div className="flex shrink-0 items-center gap-1 pb-0.5">
                        <VoiceInputControls voice={voice} />
                        <MyButton
                            type="submit"
                            buttonType="primary"
                            scale="medium"
                            layoutVariant="icon"
                            disable={!canSend}
                            aria-label={t('assistant.panel.actions.send')}
                            className={cn(!canSend && 'cursor-not-allowed')}
                        >
                            <PaperPlaneRight
                                size={18}
                                weight="fill"
                                className="rtl:-scale-x-100"
                                aria-hidden="true"
                            />
                        </MyButton>
                    </div>
                </form>
                <p
                    id={`${id}-hint`}
                    className="mt-1.5 hidden px-1 text-2xs text-neutral-400 sm:block"
                >
                    {t('assistant.inputHint')}
                </p>
            </div>
        );
    }
);
