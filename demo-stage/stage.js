// Demo stage: the real admin app in a frame, a guide beside it.
//
// Three parts, kept apart so each can be replaced:
//   app     the bridge to the framed app (postMessage commands)
//   player  runs a tour: a list of steps from tours/<product>.json
//   guide   the conversation. `brain` decides what to say and which tour to
//           play; today it is a small local script, next it is the AI backend.

const params = new URLSearchParams(location.search);
// Address overrides (?app= ?api= ?guide=) are for local preview only. On a public host
// they are ignored, so a crafted link cannot point this page at someone else's backend.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const override = (name) => (LOCAL ? params.get(name) : null);
const CONFIG = {
    app: override('app') || window.DEMO_APP_ORIGIN || 'https://demo-app.vacademy.io',
    // Local stand-in for the demo sign-in (dev-server.mjs); unused once `guide` is set.
    api: override('api') || window.DEMO_API || '',
    // Guide backend. On a public host it is always the live one; locally it is empty
    // unless given, which means the small scripted guide below.
    guide: (
        override('guide') ||
        window.DEMO_GUIDE_API ||
        (LOCAL ? '' : 'https://backend-stage.vacademy.io/ai-service/demo-guide/v1')
    ).replace(/\/$/, ''),
    tts: 'https://backend-stage.vacademy.io/ai-service/tts/v1/speak',
    product: params.get('product') || 'vacademy',
    // Film mode: no guide panel; the recorder (tools/record.py) plays tours and
    // sets how long each line is held, then lays the narration audio over the video.
    film: params.has('film'),
    // The app is drawn at this size and scaled to fit, so it always looks like a desktop screen.
    width: 1440,
    height: 860,
};
const SOURCE = 'vx-demo';
const $ = (id) => document.getElementById(id);

// ── app bridge ──────────────────────────────────────────────────────────────

const app = (() => {
    const frame = $('app');
    const appOrigin = new URL(CONFIG.app).origin;
    const waiting = new Map();
    let seq = 0;
    let onReady = null;
    const ready = new Promise((resolve) => (onReady = resolve));

    window.addEventListener('message', (event) => {
        if (event.origin !== appOrigin || event.source !== frame.contentWindow) return;
        const data = event.data;
        if (!data || data.source !== SOURCE) return;
        if (data.type === 'ready') onReady(data);
        if (data.type === 'result' && waiting.has(data.id)) {
            waiting.get(data.id)(data);
            waiting.delete(data.id);
        }
    });

    const send = (cmd, timeoutMs = 15000) =>
        new Promise((resolve) => {
            const id = `c${++seq}`;
            const timer = setTimeout(() => {
                waiting.delete(id);
                resolve({ ok: false, error: 'timeout' });
            }, timeoutMs);
            waiting.set(id, (result) => {
                clearTimeout(timer);
                resolve(result);
            });
            frame.contentWindow.postMessage({ source: SOURCE, id, ...cmd }, appOrigin);
        });

    const fit = () => {
        const box = $('screen').getBoundingClientRect();
        if (!box.width) return;
        const scale = box.width / CONFIG.width;
        frame.style.width = `${CONFIG.width}px`;
        frame.style.height = `${box.height / scale}px`;
        frame.style.transform = `scale(${scale})`;
    };
    new ResizeObserver(fit).observe($('screen'));

    const open = async (getSignIn) => {
        fit();
        frame.src = `${appOrigin}/login`;
        const hello = await ready;
        if (!hello.signedIn) {
            const session = await getSignIn();
            if (!session) throw new Error('no demo session');
            const result = await send({ type: 'auth', ...session, to: '/dashboard' });
            if (!result.ok) throw new Error(result.error || 'sign-in refused');
        } else {
            await send({ type: 'go', to: '/dashboard' });
        }
        $('veil').classList.add('off');
    };

    return { send, open };
})();

// ── voice ───────────────────────────────────────────────────────────────────

const film = { log: [], durations: {}, gap: 450 };

const voice = (() => {
    let on = true;
    let audio = null;
    let finish = null;
    const stop = () => {
        if (audio) {
            audio.pause();
            audio.src = '';
            audio = null;
        }
        if (finish) finish();
        finish = null;
    };
    // Resolves when the line has been spoken, or after a reading pause when sound is off.
    // `url` is the audio for this exact line; without it the open preview voice is used.
    const say = (text, lang, url, key) =>
        new Promise((resolve) => {
            stop();
            const readMs = Math.max(1800, text.length * 55);
            if (CONFIG.film) {
                film.log.push({ key, at: performance.now() });
                const t = setTimeout(resolve, (film.durations[key] ?? readMs) + film.gap);
                finish = () => {
                    clearTimeout(t);
                    resolve();
                };
                return;
            }
            if (!on) {
                const t = setTimeout(resolve, readMs);
                finish = () => {
                    clearTimeout(t);
                    resolve();
                };
                return;
            }
            audio = new Audio(url || `${CONFIG.tts}?language=${lang}&text=${encodeURIComponent(text)}`);
            const guard = setTimeout(done, readMs + 15000);
            function done() {
                clearTimeout(guard);
                finish = null;
                resolve();
            }
            finish = done;
            audio.onended = done;
            audio.onerror = () => setTimeout(done, readMs);
            audio.play().catch(() => setTimeout(done, readMs));
        });
    return {
        say,
        stop,
        pause: () => audio && audio.pause(),
        resume: () => audio && audio.play().catch(() => {}),
        set on(v) {
            on = v;
            if (!v && audio) audio.muted = true;
        },
        get on() {
            return on;
        },
    };
})();

// ── player ──────────────────────────────────────────────────────────────────

const player = (() => {
    let run = null; // { tour, index, paused, cancelled, wake }
    const text = (v, lang) => (typeof v === 'string' ? v : v?.[lang] ?? v?.en ?? '');
    const caption = (t) => ($('caption').textContent = t);

    const setButtons = () => {
        $('play').disabled = !run;
        $('skip').disabled = !run;
        $('play').setAttribute('aria-label', run?.paused ? 'Play' : 'Pause');
        $('play').innerHTML = run?.paused
            ? '<svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6z"/></svg>'
            : '<svg viewBox="0 0 16 16"><path d="M4 2h3v12H4zM9 2h3v12H9z"/></svg>';
    };

    const gate = (r) =>
        r.paused ? new Promise((resolve) => (r.wake = resolve)) : Promise.resolve();

    async function step(r, s, lang) {
        if (s.go) {
            const res = await app.send({ type: 'go', to: s.go });
            if (!res.ok) return res;
        }
        if (s.point) {
            const res = await app.send({ type: 'point', target: s.point, click: !!s.click });
            if (!res.ok) return res;
        }
        if (s.spot) {
            const res = await app.send({
                type: 'spot',
                target: s.spot,
                title: text(s.title, lang) || undefined,
                pad: s.pad,
            });
            if (!res.ok) return res;
        } else if (s.say && !s.keep) {
            await app.send({ type: 'clear' });
        }
        if (s.say) {
            const line = text(s.say, lang);
            caption(line);
            const url = CONFIG.guide
                ? `${CONFIG.guide}/narration/${CONFIG.product}/${r.tour.id}/${r.index}?lang=${lang}`
                : undefined;
            await voice.say(line, lang, url, `${r.tour.id}:${r.index}`);
        }
        if (s.pause) await new Promise((resolve) => setTimeout(resolve, s.pause));
        return { ok: true };
    }

    async function play(tour, lang) {
        stop();
        const r = (run = { tour, index: 0, paused: false, cancelled: false, wake: null });
        const missed = [];
        setButtons();
        $('now').textContent = text(tour.title, lang);
        for (r.index = 0; r.index < tour.steps.length; r.index++) {
            await gate(r);
            if (r.cancelled) return { finished: false, missed };
            $('progress').style.width = `${(r.index / tour.steps.length) * 100}%`;
            const result = await step(r, tour.steps[r.index], lang);
            // A step whose element is not on screen is skipped, not fatal: the
            // product changed and this tour needs an update.
            if (!result.ok) missed.push({ index: r.index, error: result.error });
            if (r.cancelled) return { finished: false, missed };
        }
        $('progress').style.width = '100%';
        await app.send({ type: 'clear' });
        if (run === r) run = null;
        setButtons();
        return { finished: true, missed };
    }

    function stop() {
        if (!run) return;
        run.cancelled = true;
        run.wake?.();
        run = null;
        voice.stop();
        app.send({ type: 'clear' });
        setButtons();
    }

    $('play').addEventListener('click', () => {
        if (!run) return;
        run.paused = !run.paused;
        if (run.paused) voice.pause();
        else {
            voice.resume();
            run.wake?.();
        }
        setButtons();
    });
    $('skip').addEventListener('click', () => voice.stop());

    return { play, stop, caption, text };
})();

// ── guide ───────────────────────────────────────────────────────────────────

const guide = (() => {
    const log = $('log');
    let lang = 'en';
    let catalog = null;
    const lead = {};

    const add = (node) => {
        log.appendChild(node);
        log.scrollTop = log.scrollHeight;
        return node;
    };
    const bubble = (who, textValue) => {
        const el = document.createElement('div');
        el.className = `msg ${who}`;
        el.textContent = textValue;
        return add(el);
    };
    const clearChoices = () => log.querySelectorAll('.chips, .form').forEach((n) => n.remove());
    const chips = (options, onPick) => {
        const row = document.createElement('div');
        row.className = 'chips';
        for (const option of options) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip';
            b.textContent = option.label;
            b.addEventListener('click', () => {
                row.remove();
                bubble('me', option.label);
                onPick(option);
            });
            row.appendChild(b);
        }
        add(row);
    };
    const t = (v) => player.text(v, lang);

    function contactForm(onSend) {
        const form = document.createElement('form');
        form.className = 'form';
        const field = (name, label, attrs) => {
            const l = document.createElement('label');
            l.textContent = label;
            const input = document.createElement('input');
            input.name = name;
            Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));
            l.appendChild(input);
            form.appendChild(l);
        };
        field('name', t(catalog.copy.name), { required: '', autocomplete: 'name' });
        field('phone', t(catalog.copy.phone), { required: '', inputmode: 'tel', autocomplete: 'tel' });
        field('organisation', t(catalog.copy.institute), { autocomplete: 'organization' });
        const consent = document.createElement('p');
        consent.className = 'consent';
        consent.textContent = t(catalog.copy.consent);
        const send = document.createElement('button');
        send.className = 'primary';
        send.type = 'submit';
        send.textContent = t(catalog.copy.send);
        form.append(consent, send);
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const details = Object.fromEntries(new FormData(form));
            send.disabled = true;
            const ok = await onSend(details);
            if (ok) form.remove();
            else send.disabled = false;
        });
        add(form);
    }

    // ── the scripted guide (local preview, no backend) ──
    const localBrain = {
        seen: new Set(),
        signIn: async () => {
            const res = await fetch(`${CONFIG.api}/session`);
            return res.ok ? res.json() : null;
        },
        async say(textValue) {
            bubble('bot', textValue);
            await voice.say(textValue, lang);
        },
        async start() {
            await this.say(t(catalog.copy.hello));
            chips(
                catalog.audiences.map((a) => ({ label: t(a.label), audience: a.id })),
                (o) => this.pick(o)
            );
        },
        offer() {
            const rest = catalog.topics.filter((topic) => !this.seen.has(topic.id));
            const options = rest.map((topic) => ({ label: t(topic.label), topic: topic.id }));
            options.push({ label: t(catalog.copy.talk), contact: true });
            chips(options, (o) => this.pick(o));
        },
        async pick(option) {
            if (option.audience) {
                lead.audience = option.audience;
                await this.say(t(catalog.copy.askTopic));
                return this.offer();
            }
            if (option.contact) {
                await this.say(t(catalog.copy.askContact));
                return contactForm(async (details) => {
                    console.info('lead (local preview, not sent)', { ...lead, ...details });
                    await this.say(t(catalog.copy.thanks).replace('{name}', details.name.split(' ')[0]));
                    this.offer();
                    return true;
                });
            }
            const topic = catalog.topics.find((x) => x.id === option.topic);
            const tour = catalog.tours.find((x) => x.id === topic.tour);
            this.seen.add(topic.id);
            bubble('bot', t(topic.intro));
            const result = await player.play(tour, lang);
            if (result.missed.length) console.warn('tour steps not found', tour.id, result.missed);
            if (!result.finished) return;
            player.caption(t(catalog.copy.idle));
            await this.say(t(catalog.copy.next));
            this.offer();
        },
        async text() {
            await this.say(t(catalog.copy.notYet));
            this.offer();
        },
        listen: null,
    };

    // ── the AI guide (backend, docs/demo-stage/SPEC.md section 2) ──
    const remoteBrain = (() => {
        let session = null;
        let opening = null;
        let current = null; // AbortController of the turn in flight
        const visitorId = (() => {
            try {
                let id = localStorage.getItem('demoVisitor');
                if (!id) localStorage.setItem('demoVisitor', (id = crypto.randomUUID()));
                return id;
            } catch {
                return crypto.randomUUID();
            }
        })();

        const open = () =>
            (opening ||= (async () => {
                const utm = {};
                for (const [k, v] of params) if (k.startsWith('utm_')) utm[k] = v;
                const res = await fetch(`${CONFIG.guide}/sessions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        product: CONFIG.product,
                        lang,
                        visitor_id: visitorId,
                        page_url: document.referrer || location.href,
                        referrer: document.referrer,
                        utm,
                    }),
                });
                if (!res.ok) throw new Error(`guide session ${res.status}`);
                session = await res.json();
                return session;
            })());

        const auth = () => ({ Authorization: `Bearer ${session.token}` });

        // Reads one server-sent event stream and calls on(event, data) in order.
        async function stream(res, on) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let cut;
                while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
                    const block = buffer.slice(0, cut);
                    buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '');
                    let event = 'message';
                    let data = '';
                    for (const line of block.split(/\r?\n/)) {
                        if (line.startsWith('event:')) event = line.slice(6).trim();
                        else if (line.startsWith('data:')) data += line.slice(5).trim();
                    }
                    if (!data) continue;
                    try {
                        on(event, JSON.parse(data));
                    } catch (e) {
                        console.warn('bad guide event', event, e);
                    }
                }
            }
        }

        async function turn(payload) {
            current?.abort();
            const control = (current = new AbortController());
            player.stop();
            voice.stop();
            clearChoices();
            let el = null;
            let messageId = null;
            const after = { choices: null, tour: null, form: null };
            // Sentences are spoken in order while later ones are still being written.
            let speech = Promise.resolve();
            const speak = (n, sentence) => {
                const id = messageId;
                speech = speech.then(() => {
                    if (control.signal.aborted) return;
                    const url = `${CONFIG.guide}/sessions/${session.session_id}/speech/${id}/${n}?t=${encodeURIComponent(session.token)}`;
                    return voice.say(sentence, lang, url);
                });
            };
            try {
                await open();
                const res = await fetch(`${CONFIG.guide}/sessions/${session.session_id}/turns`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...auth() },
                    body: JSON.stringify({ ...payload, lang }),
                    signal: control.signal,
                });
                if (!res.ok) throw new Error(`guide turn ${res.status}`);
                await stream(res, (event, data) => {
                    if (event === 'open') messageId = data.message_id;
                    else if (event === 'token') {
                        el ||= bubble('bot', '');
                        el.textContent += data.text;
                        log.scrollTop = log.scrollHeight;
                    } else if (event === 'sentence') speak(data.n, data.text);
                    else if (event === 'choices') after.choices = data.options;
                    else if (event === 'tour') after.tour = data.tour_id;
                    else if (event === 'form') after.form = data;
                    else if (event === 'error') throw new Error(data.code || 'guide error');
                });
                await speech;
                if (control.signal.aborted) return;
                if (after.form) {
                    contactForm(async (details) => {
                        const saved = await fetch(
                            `${CONFIG.guide}/sessions/${session.session_id}/contact`,
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', ...auth() },
                                body: JSON.stringify({ ...details, consent: true }),
                            }
                        );
                        if (!saved.ok) return false;
                        turn({ kind: 'contact_saved' });
                        return true;
                    });
                }
                if (after.choices?.length) {
                    chips(after.choices, (o) => turn({ kind: 'choice', choice_id: o.id, text: o.label }));
                }
                if (after.tour) {
                    const tour = catalog.tours.find((x) => x.id === after.tour);
                    if (tour) {
                        const result = await player.play(tour, lang);
                        if (result.missed.length) console.warn('tour steps not found', tour.id, result.missed);
                        if (control.signal.aborted) return;
                        player.caption(t(catalog.copy.idle));
                        turn({ kind: 'tour_end', tour_id: tour.id, finished: result.finished });
                    }
                }
            } catch (error) {
                if (control.signal.aborted) return;
                console.error(error);
                bubble('bot', t(catalog.copy.trouble));
            }
        }

        return {
            signIn: async () => (await open()).app,
            start: () => turn({ kind: 'start' }),
            text: (value, spoken) => turn({ kind: 'text', text: value, spoken: !!spoken }),
            async listen(blob) {
                await open();
                const body = new FormData();
                body.append('audio', blob, 'speech.webm');
                const res = await fetch(`${CONFIG.guide}/sessions/${session.session_id}/listen`, {
                    method: 'POST',
                    headers: auth(),
                    body,
                });
                return res.ok ? (await res.json()).text : '';
            },
        };
    })();

    const brain = CONFIG.guide ? remoteBrain : localBrain;

    const sendText = (value, spoken) => {
        if (!value) return;
        bubble('me', value);
        if (brain === localBrain) {
            player.stop();
            clearChoices();
        }
        brain.text(value, spoken);
    };

    $('composer').addEventListener('submit', (event) => {
        event.preventDefault();
        const value = $('text').value.trim();
        $('text').value = '';
        sendText(value, false);
    });

    // Microphone: press to start, press again to send. No French yet.
    const mic = $('mic');
    let recorder = null;
    const micAvailable = () =>
        !!brain.listen && lang !== 'fr' && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
    const showMic = () => (mic.hidden = !micAvailable());
    mic.addEventListener('click', async () => {
        if (recorder) return recorder.stop();
        let media;
        try {
            media = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            bubble('bot', t(catalog.copy.micBlocked));
            return;
        }
        player.stop();
        voice.stop();
        const parts = [];
        recorder = new MediaRecorder(media);
        const limit = setTimeout(() => recorder?.stop(), 45000);
        recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
        recorder.onstop = async () => {
            clearTimeout(limit);
            media.getTracks().forEach((track) => track.stop());
            const blob = new Blob(parts, { type: recorder.mimeType });
            recorder = null;
            mic.setAttribute('aria-pressed', 'false');
            mic.disabled = true;
            try {
                const heard = (await brain.listen(blob)).trim();
                if (heard) sendText(heard, true);
                else bubble('bot', t(catalog.copy.notHeard));
            } catch {
                bubble('bot', t(catalog.copy.notHeard));
            }
            mic.disabled = false;
        };
        recorder.start();
        mic.setAttribute('aria-pressed', 'true');
    });

    const applyLanguage = () => {
        document.documentElement.lang = lang;
        if (!catalog) return;
        $('text').placeholder = t(catalog.copy.placeholder);
        $('send').textContent = t(catalog.copy.sendMessage);
        $('note').textContent = t(catalog.copy.note);
        $('live').textContent = t(catalog.copy.live);
        showMic();
    };
    $('lang').addEventListener('change', (event) => {
        lang = event.target.value;
        try {
            localStorage.setItem('demoLang', lang);
        } catch {
            // noop
        }
        applyLanguage();
    });
    $('sound').addEventListener('click', (event) => {
        voice.on = !voice.on;
        event.currentTarget.setAttribute('aria-pressed', String(voice.on));
        if (!voice.on) voice.stop();
    });

    return {
        signIn: () => brain.signIn(),
        async start() {
            const supported = ['en', 'hi', 'kn', 'fr'];
            let wanted = params.get('lang');
            try {
                wanted ||= localStorage.getItem('demoLang');
            } catch {
                // noop
            }
            wanted ||= (navigator.language || 'en').slice(0, 2);
            lang = supported.includes(wanted) ? wanted : 'en';
            $('lang').value = lang;
            catalog = await (await fetch(`tours/${CONFIG.product}.json`)).json();
            applyLanguage();
            if (CONFIG.film) {
                document.body.classList.add('film');
                player.caption('');
                window.demoStage.catalog = catalog;
                return;
            }
            player.caption(t(catalog.copy.idle));
            await brain.start();
        },
    };
})();

// ── boot ────────────────────────────────────────────────────────────────────

// For the tour checker and the video recorder (they drive this page).
window.demoStage = { app, player, voice, film };

app.open(guide.signIn).catch((error) => {
    $('veil').textContent = 'The demo account could not be opened. Please try again in a minute.';
    console.error(error);
});
guide.start();
