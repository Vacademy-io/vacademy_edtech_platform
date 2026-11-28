import { fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import copy from '../../../../../public/locales/en/dashboardIndex.json';
import { AssistantComposer, isSendKey } from '../../AssistantComposer';
import type { VoiceInput } from '@/hooks/use-voice-input';

const i18n = createInstance();
void i18n.init({
    lng: 'en',
    resources: { en: { dashboardIndex: copy } },
    interpolation: { escapeValue: false },
});

const voice = {
    supported: false,
    status: 'idle',
    error: null,
    elapsedSeconds: 0,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    clearError: vi.fn(),
} as unknown as VoiceInput;

function Harness({ busy = false, onSend }: { busy?: boolean; onSend: (text: string) => void }) {
    const [value, setValue] = useState('');
    return (
        <I18nextProvider i18n={i18n}>
            <AssistantComposer
                value={value}
                onChange={setValue}
                onSend={() => {
                    onSend(value);
                    setValue('');
                }}
                busy={busy}
                chatbotName="Assistant"
                voice={voice}
            />
        </I18nextProvider>
    );
}

const box = () => screen.getByRole('textbox', { name: 'Message Assistant' });
const sendButton = () => screen.getByRole('button', { name: copy.assistant.panel.actions.send });

describe('assistant composer', () => {
    it('Enter sends, Shift+Enter does not', () => {
        const onSend = vi.fn();
        render(<Harness onSend={onSend} />);
        fireEvent.change(box(), { target: { value: 'first line' } });
        fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
        expect(onSend).not.toHaveBeenCalled();
        fireEvent.keyDown(box(), { key: 'Enter' });
        expect(onSend).toHaveBeenCalledWith('first line');
        expect((box() as HTMLTextAreaElement).value).toBe('');
    });

    it('does not send while composing text with an input method', () => {
        const onSend = vi.fn();
        render(<Harness onSend={onSend} />);
        fireEvent.change(box(), { target: { value: 'नमस्ते' } });
        fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
        expect(onSend).not.toHaveBeenCalled();
    });

    it('disables Send while empty or busy, and never sends then', () => {
        const onSend = vi.fn();
        const { rerender } = render(<Harness onSend={onSend} />);
        expect(sendButton().hasAttribute('disabled')).toBe(true);
        fireEvent.change(box(), { target: { value: '   ' } });
        fireEvent.keyDown(box(), { key: 'Enter' });
        expect(onSend).not.toHaveBeenCalled();

        rerender(<Harness onSend={onSend} busy />);
        fireEvent.change(box(), { target: { value: 'question' } });
        expect(sendButton().hasAttribute('disabled')).toBe(true);
        fireEvent.keyDown(box(), { key: 'Enter' });
        expect(onSend).not.toHaveBeenCalled();
    });

    it('the Send button sends', () => {
        const onSend = vi.fn();
        render(<Harness onSend={onSend} />);
        fireEvent.change(box(), { target: { value: 'question' } });
        fireEvent.click(sendButton());
        expect(onSend).toHaveBeenCalledWith('question');
    });

    it('recognises the send key', () => {
        expect(isSendKey({ key: 'Enter', shiftKey: false })).toBe(true);
        expect(isSendKey({ key: 'Enter', shiftKey: true })).toBe(false);
        expect(
            isSendKey({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true } })
        ).toBe(false);
        expect(isSendKey({ key: 'a', shiftKey: false })).toBe(false);
    });
});
