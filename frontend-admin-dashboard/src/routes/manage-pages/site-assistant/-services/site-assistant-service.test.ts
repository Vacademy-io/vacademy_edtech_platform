import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
}));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: http }));
vi.mock('@/constants/urls', () => ({ AI_SERVICE_BASE_URL: 'https://api.test/ai-service' }));

import {
    SITE_ASSISTANT_BASE,
    buildKnowledgePayload,
    createKnowledge,
    deleteKnowledge,
    fetchConversation,
    fetchConversations,
    fetchKnowledge,
    fetchStatus,
    fetchUnanswered,
    normalizeConversationPage,
    normalizeStatus,
    reindexSite,
    sendPreviewMessage,
    startPreviewSession,
    updateKnowledge,
    type KnowledgeInput,
    type PreviewSession,
} from './site-assistant-service';

const BASE = 'https://api.test/ai-service/site-assistant/v1';

const faqInput = (over: Partial<KnowledgeInput> = {}): KnowledgeInput => ({
    kind: 'FAQ',
    title: '  Do you give a certificate? ',
    body: ' Yes, after the last class. ',
    active: true,
    allSites: false,
    startDate: '',
    endDate: '',
    ...over,
});

beforeEach(() => {
    for (const fn of Object.values(http)) fn.mockReset();
});

describe('site assistant staff API: request shapes', () => {
    it('uses the ai_service base path', () => {
        expect(SITE_ASSISTANT_BASE).toBe(BASE);
    });

    it('lists knowledge by site tag (and kind when given)', async () => {
        http.get.mockResolvedValue({
            data: {
                items: [
                    { id: 'k1', kind: 'FAQ', site_tag: null, title: 'Q', body: 'A', active: true },
                    {
                        id: 'k2',
                        kind: 'NOTICE',
                        site_tag: 'bv',
                        title: 'T',
                        body: 'B',
                        active: false,
                    },
                ],
            },
        });
        const items = await fetchKnowledge('bv');
        expect(http.get).toHaveBeenCalledWith(`${BASE}/admin/knowledge`, {
            params: { site_tag: 'bv' },
        });
        expect(items).toMatchObject([
            { id: 'k1', kind: 'FAQ', siteTag: null, active: true },
            { id: 'k2', kind: 'NOTICE', siteTag: 'bv', active: false },
        ]);

        http.get.mockResolvedValue({ data: [] });
        await fetchKnowledge('bv', 'NOTICE');
        expect(http.get).toHaveBeenLastCalledWith(`${BASE}/admin/knowledge`, {
            params: { site_tag: 'bv', kind: 'NOTICE' },
        });
    });

    it('creates an FAQ with a trimmed snake_case body for this site', async () => {
        http.post.mockResolvedValue({ data: { id: 'k9', kind: 'FAQ', title: 'x', body: 'y' } });
        const item = await createKnowledge('bv', faqInput());
        expect(http.post).toHaveBeenCalledWith(`${BASE}/admin/knowledge`, {
            site_tag: 'bv',
            kind: 'FAQ',
            title: 'Do you give a certificate?',
            body: 'Yes, after the last class.',
            active: true,
            starts_at: null,
            ends_at: null,
        });
        expect(item?.id).toBe('k9');
    });

    it('"all sites" sends site_tag null; dates become the start / end of the local day', () => {
        const payload = buildKnowledgePayload(
            'bv',
            faqInput({
                kind: 'NOTICE',
                allSites: true,
                startDate: '2026-11-01',
                endDate: '2026-11-03',
            })
        );
        expect(payload.site_tag).toBeNull();
        expect(payload.kind).toBe('NOTICE');
        expect(payload.starts_at).toBe(new Date(2026, 10, 1, 0, 0, 0, 0).toISOString());
        expect(payload.ends_at).toBe(new Date(2026, 10, 3, 23, 59, 59, 999).toISOString());
    });

    it('refuses an empty answer or an end before the start, before any request', async () => {
        expect(() => buildKnowledgePayload('bv', faqInput({ body: '  ' }))).toThrow(
            'body_required'
        );
        expect(() =>
            buildKnowledgePayload(
                'bv',
                faqInput({ startDate: '2026-11-05', endDate: '2026-11-01' })
            )
        ).toThrow('end_before_start');
        await expect(createKnowledge('bv', faqInput({ title: '' }))).rejects.toThrow(
            'title_required'
        );
        expect(http.post).not.toHaveBeenCalled();
    });

    it('updates with PUT and deletes by id (ids are URL-encoded)', async () => {
        http.put.mockResolvedValue({ data: { id: 'a/b' } });
        await updateKnowledge('bv', 'a/b', faqInput({ active: false }));
        expect(http.put).toHaveBeenCalledWith(
            `${BASE}/admin/knowledge/a%2Fb`,
            expect.objectContaining({ site_tag: 'bv', active: false })
        );
        http.delete.mockResolvedValue({});
        await deleteKnowledge('k1');
        expect(http.delete).toHaveBeenCalledWith(`${BASE}/admin/knowledge/k1`);
    });

    it('lists conversations with paging; the lead filter is sent only when narrowed', async () => {
        http.get.mockResolvedValue({ data: { items: [], total: 0 } });
        await fetchConversations({ siteTag: 'bv', lead: 'ALL', page: 2, size: 20 });
        expect(http.get).toHaveBeenLastCalledWith(`${BASE}/admin/conversations`, {
            params: { site_tag: 'bv', page: 2, size: 20 },
        });
        await fetchConversations({ siteTag: 'bv', lead: 'SALES', page: 0, size: 20 });
        expect(http.get).toHaveBeenLastCalledWith(`${BASE}/admin/conversations`, {
            params: { site_tag: 'bv', lead: 'SALES', page: 0, size: 20 },
        });
    });

    it('reads a conversation with its messages and cards', async () => {
        http.get.mockResolvedValue({
            data: {
                id: 'c1',
                lead_status: 'support',
                messages: [
                    { id: 1, role: 'user', content: 'Any free class?' },
                    {
                        id: 2,
                        role: 'assistant',
                        content: 'Yes:',
                        answered: true,
                        feedback: 1,
                        cards: [
                            { type: 'page_link', title: 'Free class', href: 'javascript:alert(1)' },
                            { type: 'mystery' },
                        ],
                    },
                ],
            },
        });
        const c = await fetchConversation('c1');
        expect(http.get).toHaveBeenCalledWith(`${BASE}/admin/conversations/c1`);
        expect(c.leadStatus).toBe('SUPPORT');
        expect(c.messages).toHaveLength(2);
        expect(c.messages[1]).toMatchObject({ role: 'assistant', feedback: 1, answered: true });
        // Unknown cards are dropped; unsafe links are blanked.
        expect(c.messages[1]!.cards).toEqual([
            { type: 'page_link', title: 'Free class', href: null, sectionId: null, snippet: null },
        ]);
    });

    it('asks for unanswered questions of the last N days, most asked first', async () => {
        http.get.mockResolvedValue({
            data: [
                { question: 'EMI?', count: 2 },
                { question: 'Is there a hostel?', count: 7, examples: ['hostel?'] },
            ],
        });
        const groups = await fetchUnanswered('bv', 7);
        expect(http.get).toHaveBeenCalledWith(`${BASE}/admin/unanswered`, {
            params: { site_tag: 'bv', days: 7 },
        });
        expect(groups.map((g) => g.question)).toEqual(['Is there a hostel?', 'EMI?']);
    });

    it('reads status and starts a re-index for the site', async () => {
        http.get.mockResolvedValue({
            data: {
                index: { status: 'READY', chunks: 42 },
                today: { answers: 12, cap: 300 },
                credits: { low: true, warning: 'Only 20 credits left' },
            },
        });
        const s = await fetchStatus('bv');
        expect(http.get).toHaveBeenCalledWith(`${BASE}/admin/status`, {
            params: { site_tag: 'bv' },
        });
        expect(s).toMatchObject({
            index: { status: 'READY', chunks: 42 },
            answersToday: 12,
            dailyCap: 300,
            creditsLow: true,
            creditsWarning: 'Only 20 credits left',
        });
        http.post.mockResolvedValue({});
        await reindexSite('bv');
        expect(http.post).toHaveBeenCalledWith(`${BASE}/admin/reindex`, null, {
            params: { site_tag: 'bv' },
        });
    });
});

describe('normalizers', () => {
    it('page counts fall back sensibly', () => {
        const p = normalizeConversationPage(
            {
                content: [{ id: 'c1', message_count: '4', started_page: { title: 'Home' } }],
                totalElements: 41,
            },
            0,
            20
        );
        expect(p.total).toBe(41);
        expect(p.totalPages).toBe(3);
        expect(p.items[0]).toMatchObject({
            messageCount: 4,
            startedPage: 'Home',
            leadStatus: null,
        });
    });

    it('an unknown index state reads as "not indexed"', () => {
        expect(normalizeStatus({}).index.status).toBe('NOT_INDEXED');
        expect(normalizeStatus({}).creditsLow).toBe(false);
    });
});

describe('preview chat', () => {
    const session: PreviewSession = {
        sessionId: 's1',
        token: 'tok-123',
        expiresAt: null,
        assistant: { name: 'Ask BV', avatarUrl: null, greeting: 'Hi', suggestions: [] },
    };

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('starts a preview session with the staff JWT client, the site tag and preview: true', async () => {
        http.post.mockResolvedValue({
            data: {
                session_id: 's1',
                token: 'tok-123',
                expires_at: '2026-10-21T00:00:00Z',
                assistant: { name: 'Ask BV', greeting: 'Namaste', suggestions: ['Free class?'] },
                history: [],
            },
        });
        const s = await startPreviewSession('bv');
        expect(http.post).toHaveBeenCalledWith(`${BASE}/sessions`, {
            site_tag: 'bv',
            page: { url: '/bv', route: '/', title: 'Admin preview' },
            preview: true,
        });
        expect(s).toMatchObject({
            sessionId: 's1',
            token: 'tok-123',
            assistant: { name: 'Ask BV', greeting: 'Namaste', suggestions: ['Free class?'] },
        });
    });

    it('posts the message with the session token and streams typed events', async () => {
        const frames = [
            'event: token\ndata: {"text":"Hel',
            'lo"}\n\nevent: token\ndata: {"text":" there"}\n\n',
            'event: card\ndata: {"card":{"type":"notice","title":"New batch","body":"From 1 Nov"}}\n\n',
            ': keepalive\n\nevent: done\ndata: {"message_id":7,"answered":false,"billed":true}\n\n',
        ];
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                frames.forEach((f) => controller.enqueue(encoder.encode(f)));
                controller.close();
            },
        });
        // A plain object: happy-dom's Response does not hand back the stream as given.
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body });
        vi.stubGlobal('fetch', fetchMock);

        const events: unknown[] = [];
        await sendPreviewMessage(session, 'bv', '  Any new batch?  ', (e) => events.push(e));

        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe(`${BASE}/sessions/s1/messages`);
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer tok-123');
        const sent = JSON.parse(init.body);
        expect(sent).toMatchObject({
            text: 'Any new batch?',
            page: { url: '/bv', route: '/', title: 'Admin preview' },
        });
        expect(typeof sent.client_msg_id).toBe('string');
        expect(events).toEqual([
            { type: 'token', text: 'Hello' },
            { type: 'token', text: ' there' },
            {
                type: 'card',
                card: { type: 'notice', title: 'New batch', body: 'From 1 Nov', endsAt: null },
            },
            { type: 'done', messageId: '7', answered: false, billed: true },
        ]);
    });

    it('a refused request carries its status (401 = the preview expired)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 401,
                body: null,
                json: async () => ({ detail: 'session expired' }),
            })
        );
        await expect(sendPreviewMessage(session, 'bv', 'hi', () => {})).rejects.toMatchObject({
            message: 'session expired',
            status: 401,
        });
    });
});
