/**
 * URL-keyed cache of decoded audio. Stores the raw `Float32Array` channel
 * data (not an `AudioBuffer`) so it's reusable across:
 *   - the playback engine (which needs an `AudioBuffer` attached to its own
 *     `AudioContext`),
 *   - the waveform peak extractor (which only needs channel-0 samples).
 *
 * Decoding runs in a Web Worker so it doesn't block the main thread; the
 * worker uses `OfflineAudioContext.decodeAudioData`. If the worker fails or
 * the browser blocks worker construction, we fall back to a main-thread
 * `AudioContext.decodeAudioData` — same behavior as before, no regression.
 */
import DecodeWorker from './audio-decode-worker.ts?worker';

export interface DecodedAudio {
    sampleRate: number;
    length: number;
    numberOfChannels: number;
    duration: number;
    /** One Float32Array per channel. */
    channels: Float32Array[];
}

interface WorkerResponseOk {
    id: number;
    ok: true;
    sampleRate: number;
    length: number;
    numberOfChannels: number;
    duration: number;
    channels: Float32Array[];
}
interface WorkerResponseErr {
    id: number;
    ok: false;
    error: string;
}
type WorkerResponse = WorkerResponseOk | WorkerResponseErr;

const cache = new Map<string, Promise<DecodedAudio>>();

let workerInstance: Worker | null = null;
let workerDisabled = false;
let nextRequestId = 1;
const pending = new Map<
    number,
    { resolve: (v: DecodedAudio) => void; reject: (e: Error) => void }
>();

function ensureWorker(): Worker | null {
    if (workerDisabled) return null;
    if (workerInstance) return workerInstance;
    try {
        const w = new DecodeWorker();
        w.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const data = event.data;
            const slot = pending.get(data.id);
            if (!slot) return;
            pending.delete(data.id);
            if (data.ok) {
                slot.resolve({
                    sampleRate: data.sampleRate,
                    length: data.length,
                    numberOfChannels: data.numberOfChannels,
                    duration: data.duration,
                    channels: data.channels,
                });
            } else {
                slot.reject(new Error(data.error || 'Worker decode failed'));
            }
        };
        w.onerror = () => {
            // Flag once and let in-flight pending fall back to main thread.
            workerDisabled = true;
            for (const [id, slot] of pending) {
                slot.reject(new Error('Worker errored'));
                pending.delete(id);
            }
            workerInstance = null;
        };
        workerInstance = w;
        return w;
    } catch {
        // SecurityError / unsupported environment — disable forever this session.
        workerDisabled = true;
        return null;
    }
}

function decodeViaWorker(arrayBuffer: ArrayBuffer): Promise<DecodedAudio> {
    const w = ensureWorker();
    if (!w) return Promise.reject(new Error('Worker unavailable'));
    return new Promise((resolve, reject) => {
        const id = nextRequestId++;
        pending.set(id, { resolve, reject });
        try {
            w.postMessage({ id, arrayBuffer }, [arrayBuffer]);
        } catch (err) {
            pending.delete(id);
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    });
}

async function decodeOnMainThread(arrayBuffer: ArrayBuffer): Promise<DecodedAudio> {
    // Fallback path. Uses a transient AudioContext just for decoding — we
    // close it immediately afterward to avoid leaking audio output graphs.
    const ctx = new AudioContext();
    try {
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        const channels: Float32Array[] = [];
        for (let i = 0; i < buffer.numberOfChannels; i++) {
            const view = buffer.getChannelData(i);
            const copy = new Float32Array(view.length);
            copy.set(view);
            channels.push(copy);
        }
        return {
            sampleRate: buffer.sampleRate,
            length: buffer.length,
            numberOfChannels: buffer.numberOfChannels,
            duration: buffer.duration,
            channels,
        };
    } finally {
        ctx.close().catch(() => {});
    }
}

export async function decodeFromUrl(url: string): Promise<DecodedAudio> {
    const existing = cache.get(url);
    if (existing) return existing;
    const promise = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
        const ab = await res.arrayBuffer();
        try {
            return await decodeViaWorker(ab);
        } catch {
            // The arrayBuffer was transferred (so it's now empty); refetch
            // for the fallback. Cheap because the response is in HTTP cache.
            const res2 = await fetch(url);
            const ab2 = await res2.arrayBuffer();
            return decodeOnMainThread(ab2);
        }
    })();
    cache.set(url, promise);
    try {
        return await promise;
    } catch (err) {
        // Don't poison the cache on transient errors.
        cache.delete(url);
        throw err;
    }
}

/**
 * Materialize a `DecodedAudio` into an `AudioBuffer` attached to the given
 * `audioCtx`. Sample-rate mismatch (e.g. file decoded at 44.1k, ctx at 48k)
 * is handled by `BufferSourceNode` at playback time — the browser resamples
 * internally. We just need the buffer to carry its native sample rate.
 */
export function toAudioBuffer(audioCtx: AudioContext, decoded: DecodedAudio): AudioBuffer {
    const buf = audioCtx.createBuffer(
        Math.max(1, decoded.numberOfChannels),
        Math.max(1, decoded.length),
        decoded.sampleRate
    );
    for (let i = 0; i < decoded.numberOfChannels; i++) {
        const channel = decoded.channels[i];
        if (channel) buf.getChannelData(i).set(channel);
    }
    return buf;
}

/**
 * Convenience: decode and convert in one shot for callers that want an
 * `AudioBuffer` directly (the playback engine).
 */
export async function decodeForContext(audioCtx: AudioContext, url: string): Promise<AudioBuffer> {
    const decoded = await decodeFromUrl(url);
    return toAudioBuffer(audioCtx, decoded);
}

export function clearAudioDecodeCache() {
    cache.clear();
}
