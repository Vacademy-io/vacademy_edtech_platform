/**
 * A Wi-Fi dip must not restart what is on screen: PanelPlayer keys each player on
 * dataUpdatedAt, so a refetch on reconnect would remount it at page 1 or 0:00.
 */
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({
    getPublicUrl: vi.fn(async () => `https://cdn.example/x?sig=${Math.random()}`),
}));
vi.mock('@/services/upload_file', async (original) => ({
    ...(await original<object>()),
    getPublicUrl: files.getPublicUrl,
}));
// The render state comes through the shared service, not panelApi.
const render_ = vi.hoisted(() => ({ fetch: vi.fn(async () => ({ status: 'completed' })) }));
vi.mock('@/services/lms-ai-video', () => ({ getLmsVideoRender: render_.fetch }));

import { useAiVideoRender, useSignedUrl } from './lessonApi';

let mounts = 0;
function Player() {
    useEffect(() => {
        mounts += 1;
    }, []);
    return null;
}
function Signed() {
    const query = useSignedUrl('file-1');
    return query.data ? <Player key={query.dataUpdatedAt} /> : null;
}
function AiVideo() {
    const query = useAiVideoRender('vid-1');
    return query.dataUpdatedAt ? <Player key={query.dataUpdatedAt} /> : null;
}
const wrap = (children: ReactNode) => {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
    });
    return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
};
const dip = async () => {
    await act(async () => {
        onlineManager.setOnline(false);
    });
    await act(async () => {
        onlineManager.setOnline(true);
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
};

describe('lesson queries on reconnect', () => {
    afterEach(() => {
        mounts = 0;
        onlineManager.setOnline(true);
    });

    it.each([
        ['a signed URL', () => <Signed />],
        ['an AI video render', () => <AiVideo />],
    ])('%s is not fetched again, so the player stays mounted', async (_name, view) => {
        wrap(view());
        await waitFor(() => expect(mounts).toBe(1));
        await new Promise((resolve) => setTimeout(resolve, 20));
        await dip();
        expect(mounts).toBe(1);
    });
});
