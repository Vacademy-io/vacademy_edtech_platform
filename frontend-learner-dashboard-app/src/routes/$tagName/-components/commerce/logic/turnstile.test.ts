// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChallengeError, challengeToken } from './turnstile';

type Options = Record<string, (arg?: string) => void>;

const stubTurnstile = () => {
    const rendered: Options[] = [];
    const removed: string[] = [];
    (window as unknown as { turnstile: unknown }).turnstile = {
        render: (_host: HTMLElement, options: Options) => {
            rendered.push(options);
            return `w${rendered.length}`;
        },
        execute: () => undefined,
        reset: () => undefined,
        remove: (id: string) => void removed.push(id),
    };
    return { rendered, removed };
};

afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { turnstile?: unknown }).turnstile;
});

describe('challengeToken', () => {
    it('scrolls the widget into view when Cloudflare asks for an interaction, and waits longer', async () => {
        vi.useFakeTimers();
        const { rendered, removed } = stubTurnstile();
        const host = document.createElement('div');
        const scroll = vi.fn();
        host.scrollIntoView = scroll;
        const token = challengeToken('site-key', host, 1_000);
        await vi.waitFor(() => expect(rendered).toHaveLength(1));
        rendered[0]!['before-interactive-callback']!();
        expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
        // Past the first timeout, still waiting for the shopper.
        await vi.advanceTimersByTimeAsync(5_000);
        rendered[0]!.callback!('tok-1');
        await expect(token).resolves.toBe('tok-1');
        expect(removed).toEqual(['w1']);
    });

    it('fails after the timeout when no answer comes', async () => {
        vi.useFakeTimers();
        const { rendered } = stubTurnstile();
        const token = challengeToken('site-key', document.createElement('div'), 1_000);
        const failed = expect(token).rejects.toBeInstanceOf(ChallengeError);
        await vi.waitFor(() => expect(rendered).toHaveLength(1));
        await vi.advanceTimersByTimeAsync(1_500);
        await failed;
    });
});
