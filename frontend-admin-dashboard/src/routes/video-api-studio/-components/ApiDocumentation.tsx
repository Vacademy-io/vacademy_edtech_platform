import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Copy,
    Check,
    Lightning,
    Clock,
    BookOpen,
    Code,
    Radio,
    ArrowsClockwise,
    FileText,
    ClockCounterClockwise,
    CaretDown,
    CaretUp,
    Info,
    WarningCircle,
    CheckCircle,
} from '@phosphor-icons/react';
import { AI_SERVICE_BASE_URL } from '@/constants/urls';

// ─── Copy button ──────────────────────────────────────────────────────────────
function CopyButton({ text, className = '' }: { text: string; className?: string }) {
    const { t } = useTranslation('videoApiStudioApiDocumentation');
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${className}`}
            onClick={copy}
            title={t('common.copy')}
        >
            {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
        </Button>
    );
}

// ─── Code block with language switcher ────────────────────────────────────────
interface LangExample {
    lang: string;
    label: string;
    code: string;
}

function CodeBlock({ examples }: { examples: LangExample[] }) {
    const [active, setActive] = useState(examples[0]?.lang ?? '');
    const current = examples.find((e) => e.lang === active) ?? examples[0];
    return (
        <div className="rounded-lg overflow-hidden border border-slate-700">
            {/* lang tabs */}
            {examples.length > 1 && (
                <div className="flex bg-slate-800 border-b border-slate-700 px-1 pt-1 gap-0.5">
                    {examples.map((e) => (
                        <button
                            key={e.lang}
                            onClick={() => setActive(e.lang)}
                            className={`px-3 py-1 text-xs rounded-t font-mono transition-colors ${
                                active === e.lang
                                    ? 'bg-slate-900 text-slate-100'
                                    : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            {e.label}
                        </button>
                    ))}
                </div>
            )}
            <div className="relative group bg-slate-900">
                <pre className="text-slate-100 p-4 overflow-x-auto text-xs leading-relaxed">
                    <code>{current?.code}</code>
                </pre>
                <CopyButton
                    text={current?.code ?? ''}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-slate-800 hover:bg-slate-700 text-slate-100"
                />
            </div>
        </div>
    );
}

// ─── Inline code ──────────────────────────────────────────────────────────────
function IC({ children }: { children: React.ReactNode }) {
    return (
        <code className="bg-muted text-foreground font-mono text-2xs px-1.5 py-0.5 rounded border border-border">
            {children}
        </code>
    );
}

// ─── Parameter table ──────────────────────────────────────────────────────────
interface Param {
    name: string;
    type: string;
    required: boolean;
    default?: string;
    description: string;
}

function ParamTable({ params }: { params: Param[] }) {
    const { t } = useTranslation('videoApiStudioApiDocumentation');
    return (
        <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
                <thead>
                    <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left px-3 py-2 font-semibold text-foreground">
                            {t('common.paramTable.field')}
                        </th>
                        <th className="text-left px-3 py-2 font-semibold text-foreground">
                            {t('common.paramTable.type')}
                        </th>
                        <th className="text-start px-3 py-2 font-semibold text-foreground">
                            {t('common.paramTable.required')}
                        </th>
                        <th className="text-start px-3 py-2 font-semibold text-foreground">
                            {t('common.paramTable.default')}
                        </th>
                        <th className="text-left px-3 py-2 font-semibold text-foreground w-1/2">
                            {t('common.paramTable.description')}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {params.map((p, i) => (
                        <tr
                            key={p.name}
                            className={`border-b border-border last:border-0 ${i % 2 === 0 ? '' : 'bg-muted/20'}`}
                        >
                            <td className="px-3 py-2 font-mono text-violet-700 dark:text-violet-400">
                                {p.name}
                            </td>
                            <td className="px-3 py-2 font-mono text-blue-700 dark:text-blue-400">
                                {p.type}
                            </td>
                            <td className="px-3 py-2">
                                {p.required ? (
                                    <span className="text-red-600 font-medium">
                                        {t('common.paramTable.yes')}
                                    </span>
                                ) : (
                                    <span className="text-muted-foreground">
                                        {t('common.paramTable.no')}
                                    </span>
                                )}
                            </td>
                            <td className="px-3 py-2 font-mono text-muted-foreground">
                                {p.default ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-foreground leading-relaxed">
                                {p.description}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ─── Collapsible section ──────────────────────────────────────────────────────
function Section({
    title,
    children,
    defaultOpen = true,
}: {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            >
                <span className="text-sm font-semibold">{title}</span>
                {open ? (
                    <CaretUp className="size-4 text-muted-foreground" />
                ) : (
                    <CaretDown className="size-4 text-muted-foreground" />
                )}
            </button>
            {open && <div className="p-4 space-y-4">{children}</div>}
        </div>
    );
}

// ─── Method badge ─────────────────────────────────────────────────────────────
function MethodBadge({ method }: { method: 'GET' | 'POST' | 'DELETE' }) {
    const c = {
        GET: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
        POST: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    }[method];
    return <Badge className={`${c} font-mono font-semibold text-xs`}>{method}</Badge>;
}

// ─── SSE event badge ──────────────────────────────────────────────────────────
function EventBadge({ type }: { type: 'progress' | 'completed' | 'info' | 'error' }) {
    const c = {
        progress: 'bg-blue-100 text-blue-800',
        completed: 'bg-green-100 text-green-800',
        info: 'bg-yellow-100 text-yellow-800',
        error: 'bg-red-100 text-red-800',
    }[type];
    const Icon = {
        progress: ArrowsClockwise,
        completed: CheckCircle,
        info: Info,
        error: WarningCircle,
    }[type];
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold ${c}`}>
            <Icon className="size-3" />
            {type}
        </span>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function ApiDocumentation() {
    const { t } = useTranslation('videoApiStudioApiDocumentation');
    const baseUrl = AI_SERVICE_BASE_URL;

    // ── shared request params ──────────────────────────────────────────────────
    const generateParams: Param[] = [
        {
            name: 'prompt',
            type: 'string',
            required: true,
            description: t('generateParams.prompt.description'),
        },
        {
            name: 'content_type',
            type: 'string',
            required: false,
            default: 'VIDEO',
            description: t('generateParams.contentType.description'),
        },
        {
            name: 'language',
            type: 'string',
            required: false,
            default: 'English (US)',
            description: t('generateParams.language.description'),
        },
        {
            name: 'voice_gender',
            type: 'string',
            required: false,
            default: 'female',
            description: t('generateParams.voiceGender.description'),
        },
        {
            name: 'tts_provider',
            type: 'string',
            required: false,
            default: 'standard',
            description: t('generateParams.ttsProvider.description'),
        },
        {
            name: 'voice_id',
            type: 'string',
            required: false,
            default: 'null',
            description: t('generateParams.voiceId.description'),
        },
        {
            name: 'captions_enabled',
            type: 'boolean',
            required: false,
            default: 'true',
            description: t('generateParams.captionsEnabled.description'),
        },
        {
            name: 'html_quality',
            type: 'string',
            required: false,
            default: 'advanced',
            description: t('generateParams.htmlQuality.description'),
        },
        {
            name: 'target_audience',
            type: 'string',
            required: false,
            default: 'General/Adult',
            description: t('generateParams.targetAudience.description'),
        },
        {
            name: 'target_duration',
            type: 'string',
            required: false,
            default: '2-3 minutes',
            description: t('generateParams.targetDuration.description'),
        },
        {
            name: 'model',
            type: 'string',
            required: false,
            default: 'vsmart-v1',
            description: t('generateParams.model.description'),
        },
        {
            name: 'video_id',
            type: 'string',
            required: false,
            description: t('generateParams.videoId.description'),
        },
    ];

    // ── code examples ──────────────────────────────────────────────────────────
    const sseExamples: LangExample[] = [
        {
            lang: 'js',
            label: 'JavaScript',
            code: `// SSE streaming — real-time progress updates
const response = await fetch(
  '${baseUrl}/external/video/v1/generate',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Institute-Key': 'vac_live_YOUR_KEY',
    },
    body: JSON.stringify({
      prompt: 'Explain photosynthesis to a 10-year-old.',
      content_type: 'VIDEO',
      language: 'English (India)',
      voice_gender: 'female',
      tts_provider: 'standard',
      captions_enabled: true,
      html_quality: 'advanced',
      target_audience: 'Class 5 (Ages 10-11)',
      target_duration: '2-3 minutes',
    }),
  }
);

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\\n');
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const event = JSON.parse(line.slice(6));

    if (event.type === 'progress') {
      console.log(\`[\${event.stage}] \${event.percentage}% – \${event.message}\`);
      if (event.files?.timeline?.s3_url) {
        console.log('Timeline ready:', event.files.timeline.s3_url);
      }
    } else if (event.type === 'completed') {
      console.log('Done!', event.files);
    } else if (event.type === 'error') {
      console.error('Failed:', event.message);
    }
  }
}`,
        },
        {
            lang: 'python',
            label: 'Python',
            code: `import requests
import json

# SSE streaming — real-time progress updates
with requests.post(
    '${baseUrl}/external/video/v1/generate',
    headers={
        'Content-Type': 'application/json',
        'X-Institute-Key': 'vac_live_YOUR_KEY',
    },
    json={
        'prompt': 'Explain photosynthesis to a 10-year-old.',
        'content_type': 'VIDEO',
        'language': 'English (India)',
        'voice_gender': 'female',
        'tts_provider': 'standard',
        'captions_enabled': True,
        'html_quality': 'advanced',
        'target_audience': 'Class 5 (Ages 10-11)',
        'target_duration': '2-3 minutes',
    },
    stream=True,
) as resp:
    resp.raise_for_status()
    buffer = ''
    for chunk in resp.iter_content(chunk_size=None, decode_unicode=True):
        buffer += chunk
        while '\\n' in buffer:
            line, buffer = buffer.split('\\n', 1)
            if not line.startswith('data: '):
                continue
            event = json.loads(line[6:])

            if event['type'] == 'progress':
                print(f"[{event['stage']}] {event['percentage']}% – {event['message']}")
            elif event['type'] == 'completed':
                print('Done!', event.get('files'))
                break
            elif event['type'] == 'error':
                print('Error:', event['message'])
                break`,
        },
        {
            lang: 'curl',
            label: 'cURL',
            code: `curl -N -X POST \\
  '${baseUrl}/external/video/v1/generate' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Institute-Key: vac_live_YOUR_KEY' \\
  -d '{
    "prompt": "Explain photosynthesis to a 10-year-old.",
    "content_type": "VIDEO",
    "language": "English (India)",
    "voice_gender": "female",
    "tts_provider": "standard",
    "captions_enabled": true,
    "html_quality": "advanced",
    "target_audience": "Class 5 (Ages 10-11)",
    "target_duration": "2-3 minutes"
  }'

# -N flag disables buffering so SSE events print immediately`,
        },
    ];

    const pollingExamples: LangExample[] = [
        {
            lang: 'js',
            label: 'JavaScript',
            code: `// REST polling — fire-and-forget, then poll until complete
const VIDEO_ID = \`vid_\${Date.now()}_\${Math.random().toString(36).slice(2,9)}\`;

// 1. Start generation (connection can close immediately)
await fetch('${baseUrl}/external/video/v1/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Institute-Key': 'vac_live_YOUR_KEY',
  },
  body: JSON.stringify({
    prompt: 'Explain photosynthesis to a 10-year-old.',
    content_type: 'VIDEO',
    language: 'English (India)',
    video_id: VIDEO_ID,      // use a stable ID
  }),
});
// You can close the response immediately — generation runs on the server.

// 2. Poll status every 10 s until done
async function pollUntilDone(videoId, apiKey) {
  while (true) {
    const res = await fetch(
      \`${baseUrl}/external/video/v1/urls/\${videoId}\`,
      { headers: { 'X-Institute-Key': apiKey } }
    );
    const data = await res.json();

    if (data.html_url && data.audio_url) {
      console.log('Ready!');
      console.log('Timeline:', data.html_url);
      console.log('Audio:   ', data.audio_url);
      console.log('Captions:', data.words_url);
      return data;
    }
    if (data.status === 'FAILED') {
      throw new Error('Generation failed');
    }
    console.log('Still generating… retrying in 10s');
    await new Promise(r => setTimeout(r, 10_000));
  }
}

const result = await pollUntilDone(VIDEO_ID, 'vac_live_YOUR_KEY');`,
        },
        {
            lang: 'python',
            label: 'Python',
            code: `import time
import requests

VIDEO_ID = f"vid_{int(time.time())}_abc123"
API_KEY  = "vac_live_YOUR_KEY"
BASE_URL = "${baseUrl}/external/video/v1"

# 1. Start generation (don't need to read the SSE stream)
requests.post(
    f"{BASE_URL}/generate",
    headers={'Content-Type': 'application/json', 'X-Institute-Key': API_KEY},
    json={
        'prompt': 'Explain photosynthesis to a 10-year-old.',
        'content_type': 'VIDEO',
        'language': 'English (India)',
        'video_id': VIDEO_ID,
    },
    # stream=True and immediately close — generation keeps running on server
    stream=True,
    timeout=5,
)

# 2. Poll /urls/{video_id} every 10 s
while True:
    r = requests.get(
        f"{BASE_URL}/urls/{VIDEO_ID}",
        headers={'X-Institute-Key': API_KEY},
    )
    data = r.json()

    if data.get('html_url') and data.get('audio_url'):
        print('Ready!')
        print('Timeline:', data['html_url'])
        print('Audio:   ', data['audio_url'])
        print('Captions:', data.get('words_url'))
        break
    if data.get('status') == 'FAILED':
        raise RuntimeError('Generation failed')

    print('Still generating…')
    time.sleep(10)`,
        },
        {
            lang: 'curl',
            label: 'cURL',
            code: `# Step 1 — start generation (close connection after 2 s, server keeps running)
curl -m 2 -X POST \\
  '${baseUrl}/external/video/v1/generate' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Institute-Key: vac_live_YOUR_KEY' \\
  -d '{
    "prompt": "Explain photosynthesis to a 10-year-old.",
    "content_type": "VIDEO",
    "language": "English (India)",
    "video_id": "my-stable-video-id-001"
  }' || true

# Step 2 — poll status (run every ~10 s until html_url is present)
curl -s '${baseUrl}/external/video/v1/urls/my-stable-video-id-001' \\
  -H 'X-Institute-Key: vac_live_YOUR_KEY' | jq .`,
        },
    ];

    const historyExamples: LangExample[] = [
        {
            lang: 'js',
            label: 'JavaScript',
            code: `const res = await fetch(
  '${baseUrl}/external/video/v1/history?limit=20',
  { headers: { 'X-Institute-Key': 'vac_live_YOUR_KEY' } }
);
const history = await res.json();
history.forEach(item => {
  console.log(item.video_id, item.status, item.current_stage);
});`,
        },
        {
            lang: 'python',
            label: 'Python',
            code: `import requests

resp = requests.get(
    '${baseUrl}/external/video/v1/history?limit=20',
    headers={'X-Institute-Key': 'vac_live_YOUR_KEY'},
)
for item in resp.json():
    print(item['video_id'], item['status'], item['current_stage'])`,
        },
        {
            lang: 'curl',
            label: 'cURL',
            code: `curl '${baseUrl}/external/video/v1/history?limit=20' \\
  -H 'X-Institute-Key: vac_live_YOUR_KEY' | jq .`,
        },
    ];

    const statusExamples: LangExample[] = [
        {
            lang: 'js',
            label: 'JavaScript',
            code: `const res = await fetch(
  '${baseUrl}/external/video/v1/status/YOUR_VIDEO_ID',
  { headers: { 'X-Institute-Key': 'vac_live_YOUR_KEY' } }
);
const status = await res.json();
console.log(status.status, status.current_stage);
console.log(status.s3_urls);`,
        },
        {
            lang: 'python',
            label: 'Python',
            code: `import requests

resp = requests.get(
    '${baseUrl}/external/video/v1/status/YOUR_VIDEO_ID',
    headers={'X-Institute-Key': 'vac_live_YOUR_KEY'},
)
data = resp.json()
print(data['status'], data['current_stage'])`,
        },
        {
            lang: 'curl',
            label: 'cURL',
            code: `curl '${baseUrl}/external/video/v1/status/YOUR_VIDEO_ID' \\
  -H 'X-Institute-Key: vac_live_YOUR_KEY' | jq .`,
        },
    ];

    const urlsExamples: LangExample[] = [
        {
            lang: 'js',
            label: 'JavaScript',
            code: `const res = await fetch(
  '${baseUrl}/external/video/v1/urls/YOUR_VIDEO_ID',
  { headers: { 'X-Institute-Key': 'vac_live_YOUR_KEY' } }
);
const { html_url, audio_url, words_url } = await res.json();
// Pass these directly to the AIContentPlayer component`,
        },
        {
            lang: 'python',
            label: 'Python',
            code: `import requests

resp = requests.get(
    '${baseUrl}/external/video/v1/urls/YOUR_VIDEO_ID',
    headers={'X-Institute-Key': 'vac_live_YOUR_KEY'},
)
urls = resp.json()
print('Timeline:', urls.get('html_url'))
print('Audio:   ', urls.get('audio_url'))
print('Captions:', urls.get('words_url'))`,
        },
        {
            lang: 'curl',
            label: 'cURL',
            code: `curl '${baseUrl}/external/video/v1/urls/YOUR_VIDEO_ID' \\
  -H 'X-Institute-Key: vac_live_YOUR_KEY' | jq .`,
        },
    ];

    const frameRegenExamples: LangExample[] = [
        {
            lang: 'js',
            label: 'JavaScript',
            code: `const res = await fetch(
  '${baseUrl}/external/video/v1/frame/regenerate',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Institute-Key': 'vac_live_YOUR_KEY',
    },
    body: JSON.stringify({
      video_id: 'YOUR_VIDEO_ID',
      timestamp: 12.5,   // seconds into the video
      user_prompt: 'Change background to dark blue, make heading yellow.',
    }),
  }
);
const { frame_index, new_html } = await res.json();
// Preview new_html in your UI before committing`,
        },
        {
            lang: 'curl',
            label: 'cURL',
            code: `curl -X POST '${baseUrl}/external/video/v1/frame/regenerate' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Institute-Key: vac_live_YOUR_KEY' \\
  -d '{
    "video_id": "YOUR_VIDEO_ID",
    "timestamp": 12.5,
    "user_prompt": "Change background to dark blue."
  }' | jq .`,
        },
    ];

    const frameUpdateExamples: LangExample[] = [
        {
            lang: 'js',
            label: 'JavaScript',
            code: `// After previewing the new HTML from /frame/regenerate, commit it:
await fetch('${baseUrl}/external/video/v1/frame/update', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Institute-Key': 'vac_live_YOUR_KEY',
  },
  body: JSON.stringify({
    video_id: 'YOUR_VIDEO_ID',
    frame_index: 5,           // from the regenerate response
    new_html: '<html>...</html>',
  }),
});`,
        },
        {
            lang: 'curl',
            label: 'cURL',
            code: `curl -X POST '${baseUrl}/external/video/v1/frame/update' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Institute-Key: vac_live_YOUR_KEY' \\
  -d '{
    "video_id": "YOUR_VIDEO_ID",
    "frame_index": 5,
    "new_html": "<html>...</html>"
  }' | jq .`,
        },
    ];

    return (
        <div className="space-y-6 pb-8">
            {/* ── Overview ─────────────────────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BookOpen className="size-5 text-violet-600" />
                        {t('overview.cardTitle')}
                    </CardTitle>
                    <CardDescription>{t('overview.cardDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {[
                            {
                                icon: <Lightning className="size-4 text-violet-600" />,
                                title: t('overview.features.sse.title'),
                                desc: t('overview.features.sse.description'),
                            },
                            {
                                icon: <Clock className="size-4 text-blue-600" />,
                                title: t('overview.features.backgroundJobs.title'),
                                desc: t('overview.features.backgroundJobs.description'),
                            },
                            {
                                icon: <ArrowsClockwise className="size-4 text-green-600" />,
                                title: t('overview.features.restPolling.title'),
                                desc: t('overview.features.restPolling.description'),
                            },
                        ].map((f) => (
                            <div
                                key={f.title}
                                className="flex gap-3 p-3 rounded-lg border border-border bg-muted/20"
                            >
                                <div className="mt-0.5 shrink-0">{f.icon}</div>
                                <div>
                                    <p className="text-sm font-semibold">{f.title}</p>
                                    <p className="text-xs text-muted-foreground">{f.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-2">
                        <p className="text-sm font-medium">{t('overview.baseUrlLabel')}</p>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 bg-slate-900 text-slate-100 text-xs font-mono px-3 py-2 rounded-md border border-slate-700 overflow-x-auto">
                                {baseUrl}/external/video/v1
                            </code>
                            <CopyButton
                                text={`${baseUrl}/external/video/v1`}
                                className="shrink-0 border border-border hover:bg-muted"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <p className="text-sm font-medium">{t('overview.authHeaderLabel')}</p>
                        <CodeBlock
                            examples={[
                                {
                                    lang: 'http',
                                    label: 'Header',
                                    code: `X-Institute-Key: vac_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
                                },
                            ]}
                        />
                        <p className="text-xs text-muted-foreground">{t('overview.authHeaderNote')}</p>
                    </div>
                </CardContent>
            </Card>

            {/* ── Content Types ─────────────────────────────────────────────── */}
            <Section title={t('contentTypes.sectionTitle')} defaultOpen={false}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {[
                        {
                            type: 'VIDEO',
                            emoji: '📹',
                            desc: t('contentTypes.video.description'),
                            nav: 'time_driven',
                        },
                        {
                            type: 'SLIDES',
                            emoji: '🖼️',
                            desc: t('contentTypes.slides.description'),
                            nav: 'user_driven',
                        },
                        {
                            type: 'QUIZ',
                            emoji: '❓',
                            desc: t('contentTypes.quiz.description'),
                            nav: 'user_driven',
                        },
                        {
                            type: 'STORYBOOK',
                            emoji: '📚',
                            desc: t('contentTypes.storybook.description'),
                            nav: 'user_driven',
                        },
                        {
                            type: 'FLASHCARDS',
                            emoji: '📇',
                            desc: t('contentTypes.flashcards.description'),
                            nav: 'user_driven',
                        },
                        {
                            type: 'INTERACTIVE_GAME',
                            emoji: '🎮',
                            desc: t('contentTypes.interactiveGame.description'),
                            nav: 'self_contained',
                        },
                        {
                            type: 'PUZZLE_BOOK',
                            emoji: '🧩',
                            desc: t('contentTypes.puzzleBook.description'),
                            nav: 'user_driven',
                        },
                        {
                            type: 'SIMULATION',
                            emoji: '🔬',
                            desc: t('contentTypes.simulation.description'),
                            nav: 'self_contained',
                        },
                        {
                            type: 'MAP_EXPLORATION',
                            emoji: '🗺️',
                            desc: t('contentTypes.mapExploration.description'),
                            nav: 'user_driven',
                        },
                        {
                            type: 'WORKSHEET',
                            emoji: '📝',
                            desc: t('contentTypes.worksheet.description'),
                            nav: 'user_driven',
                        },
                        {
                            type: 'CODE_PLAYGROUND',
                            emoji: '💻',
                            desc: t('contentTypes.codePlayground.description'),
                            nav: 'self_contained',
                        },
                        {
                            type: 'TIMELINE',
                            emoji: '⏳',
                            desc: t('contentTypes.timeline.description'),
                            nav: 'user_driven',
                        },
                        {
                            type: 'CONVERSATION',
                            emoji: '💬',
                            desc: t('contentTypes.conversation.description'),
                            nav: 'user_driven',
                        },
                    ].map((ct) => (
                        <div
                            key={ct.type}
                            className="flex gap-2 p-2.5 rounded-md border border-border bg-muted/10 hover:bg-muted/30 transition-colors"
                        >
                            <span className="text-base shrink-0">{ct.emoji}</span>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <IC>{ct.type}</IC>
                                    <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                                        {ct.nav}
                                    </span>
                                </div>
                                <p className="text-muted-foreground mt-0.5 leading-snug">
                                    {ct.desc}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground">
                    <span className="font-semibold">{t('contentTypes.navigationModeLabel')}</span> —
                    <IC>time_driven</IC>: {t('contentTypes.navAutoPlays')} &nbsp;|&nbsp;
                    <IC>user_driven</IC>: {t('contentTypes.navUserClicks')} &nbsp;|&nbsp;
                    <IC>self_contained</IC>: {t('contentTypes.navSelfContained')}
                </p>
            </Section>

            {/* ── Generation Stages ────────────────────────────────────────────── */}
            <Section title={t('generationStages.sectionTitle')} defaultOpen={false}>
                <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="bg-muted/50 border-b border-border">
                                <th className="text-start px-3 py-2 font-semibold">
                                    {t('generationStages.tableHeaders.stage')}
                                </th>
                                <th className="text-start px-3 py-2 font-semibold">
                                    {t('generationStages.tableHeaders.outputFile')}
                                </th>
                                <th className="text-start px-3 py-2 font-semibold">
                                    {t('generationStages.tableHeaders.s3UrlsKey')}
                                </th>
                                <th className="text-left px-3 py-2 font-semibold w-1/2">
                                    {t('generationStages.tableHeaders.description')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {[
                                {
                                    stage: 'SCRIPT',
                                    file: 'script.txt',
                                    key: 'script',
                                    desc: t('generationStages.script.description'),
                                },
                                {
                                    stage: 'TTS',
                                    file: 'narration.mp3',
                                    key: 'audio',
                                    desc: t('generationStages.tts.description'),
                                },
                                {
                                    stage: 'WORDS',
                                    file: 'narration.words.json',
                                    key: 'words',
                                    desc: t('generationStages.words.description'),
                                },
                                {
                                    stage: 'HTML',
                                    file: 'time_based_frame.json',
                                    key: 'timeline',
                                    desc: t('generationStages.html.description'),
                                },
                                {
                                    stage: 'RENDER',
                                    file: 'output.mp4',
                                    key: 'video',
                                    desc: t('generationStages.render.description'),
                                },
                            ].map((s, i) => (
                                <tr
                                    key={s.stage}
                                    className={`border-b border-border last:border-0 ${i % 2 === 0 ? '' : 'bg-muted/20'}`}
                                >
                                    <td className="px-3 py-2">
                                        <IC>{s.stage}</IC>
                                    </td>
                                    <td className="px-3 py-2 font-mono text-muted-foreground">
                                        {s.file}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-blue-700 dark:text-blue-400">
                                        {s.key}
                                    </td>
                                    <td className="px-3 py-2 text-foreground">{s.desc}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-muted-foreground">
                    <Trans i18nKey="videoApiStudioApiDocumentation:generationStages.footer">
                        The <IC>target_stage</IC> query parameter on <IC>POST /generate</IC> controls which stage to stop at. Default is <IC>HTML</IC>.
                    </Trans>
                </p>
            </Section>

            {/* ── Endpoints ─────────────────────────────────────────────────────── */}
            <Tabs defaultValue="generate" className="w-full">
                <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/30 p-1">
                    {[
                        {
                            value: 'generate',
                            label: t('tabs.generate'),
                            icon: <Lightning className="size-3" />,
                        },
                        {
                            value: 'polling',
                            label: t('tabs.polling'),
                            icon: <ArrowsClockwise className="size-3" />,
                        },
                        {
                            value: 'history',
                            label: t('tabs.history'),
                            icon: <ClockCounterClockwise className="size-3" />,
                        },
                        {
                            value: 'status',
                            label: t('tabs.status'),
                            icon: <Info className="size-3" />,
                        },
                        {
                            value: 'urls',
                            label: t('tabs.urls'),
                            icon: <Code className="size-3" />,
                        },
                        {
                            value: 'frames',
                            label: t('tabs.frames'),
                            icon: <FileText className="size-3" />,
                        },
                        {
                            value: 'events',
                            label: t('tabs.events'),
                            icon: <Radio className="size-3" />,
                        },
                    ].map((tab) => (
                        <TabsTrigger
                            key={tab.value}
                            value={tab.value}
                            className="flex items-center gap-1.5 text-xs"
                        >
                            {tab.icon}
                            {tab.label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                {/* ── Generate (SSE) ───────────────────────────────────────────── */}
                <TabsContent value="generate" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2 mb-1">
                                <MethodBadge method="POST" />
                                <IC>/external/video/v1/generate</IC>
                                <Badge variant="outline" className="text-2xs flex items-center gap-1">
                                    <Radio className="size-3" /> {t('generateTab.streamBadge')}
                                </Badge>
                            </div>
                            <CardTitle>{t('generateTab.cardTitle')}</CardTitle>
                            <CardDescription>
                                <Trans i18nKey="videoApiStudioApiDocumentation:generateTab.cardDescription">
                                    Starts a generation job and streams real-time progress via <strong>Server-Sent Events</strong>. The job runs as a background task on the server — closing the connection will NOT cancel generation. Use <IC>GET /urls/&#123;video_id&#125;</IC> to fetch the result later.{/* design-lint-ignore: &#123;/&#125; are brace HTML entities, not hex colors */}
                                </Trans>
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <Section title={t('common.sectionTitles.queryParameters')}>
                                <ParamTable
                                    params={[
                                        {
                                            name: 'target_stage',
                                            type: 'string',
                                            required: false,
                                            default: 'HTML',
                                            description: t('generateTab.targetStageDescription'),
                                        },
                                    ]}
                                />
                            </Section>

                            <Section title={t('common.sectionTitles.requestBodyParameters')}>
                                <ParamTable params={generateParams} />
                            </Section>

                            <Section title={t('common.sectionTitles.codeExamples')}>
                                <CodeBlock examples={sseExamples} />
                            </Section>

                            <Section title={t('generateTab.responseTitle')}>
                                <div className="space-y-2">
                                    <p className="text-xs text-muted-foreground">
                                        <Trans i18nKey="videoApiStudioApiDocumentation:generateTab.responseNote">
                                            Content-Type: <IC>text/event-stream</IC>. Each line is prefixed with <IC>data: </IC> followed by a JSON object.
                                        </Trans>
                                    </p>
                                    <CodeBlock
                                        examples={[
                                            {
                                                lang: 'sse',
                                                label: 'SSE stream',
                                                code: `data: {"type":"progress","stage":"PENDING","percentage":0,"message":"VIDEO generation initialized","video_id":"vid_..."}

data: {"type":"progress","stage":"SCRIPT","percentage":10,"message":"Generating script...","video_id":"vid_...","files":{"script":{"s3_url":"https://..."}}}

data: {"type":"progress","stage":"TTS","percentage":30,"message":"Synthesizing audio...","video_id":"vid_...","files":{"audio":{"s3_url":"https://..."}}}

data: {"type":"progress","stage":"WORDS","percentage":55,"message":"Word alignment...","video_id":"vid_...","files":{"words":{"s3_url":"https://..."}}}

data: {"type":"progress","stage":"HTML","percentage":85,"message":"Generating slides...","video_id":"vid_...","files":{"timeline":{"s3_url":"https://..."}}}

data: {"type":"completed","percentage":100,"video_id":"vid_...","files":{"script":"https://...","audio":"https://...","timeline":"https://..."}}`,
                                            },
                                        ]}
                                    />
                                </div>
                            </Section>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Polling approach ─────────────────────────────────────────── */}
                <TabsContent value="polling" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2 mb-1">
                                <MethodBadge method="POST" />
                                <IC>/external/video/v1/generate</IC>
                                <Badge variant="outline" className="text-2xs flex items-center gap-1">
                                    <ArrowsClockwise className="size-3" /> {t('pollingTab.badge')}
                                </Badge>
                            </div>
                            <CardTitle>{t('pollingTab.cardTitle')}</CardTitle>
                            <CardDescription>
                                <Trans i18nKey="videoApiStudioApiDocumentation:pollingTab.cardDescription">
                                    Simpler alternative to SSE streaming. Start the generation (you can immediately close the HTTP connection — the server keeps running), then periodically call <IC>GET /urls/&#123;video_id&#125;</IC> until <IC>html_url</IC> is populated.{/* design-lint-ignore: &#123;/&#125; are brace HTML entities, not hex colors */}
                                </Trans>
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-800 space-y-1 dark:border-blue-800/30 dark:bg-blue-900/10 dark:text-blue-300">
                                <p className="font-semibold flex items-center gap-1.5">
                                    <Info className="size-3.5" /> {t('pollingTab.whenToUseTitle')}
                                </p>
                                <ul className="list-disc list-inside space-y-0.5 pl-1">
                                    <li>
                                        <Trans i18nKey="videoApiStudioApiDocumentation:pollingTab.sseBullet">
                                            <strong>SSE</strong>: Best for UI dashboards that need live progress bars (stage %, messages).
                                        </Trans>
                                    </li>
                                    <li>
                                        <Trans i18nKey="videoApiStudioApiDocumentation:pollingTab.pollingBullet">
                                            <strong>Polling</strong>: Best for backend scripts, cron jobs, or when you don't need real-time updates.
                                        </Trans>
                                    </li>
                                    <li>{t('pollingTab.sameEndpointBullet')}</li>
                                </ul>
                            </div>

                            <Section title={t('pollingTab.flowTitle')}>
                                <div className="flex flex-col gap-2 text-sm">
                                    {[
                                        {
                                            step: 1,
                                            label: t('pollingTab.steps.1.label'),
                                            desc: t('pollingTab.steps.1.description'),
                                        },
                                        {
                                            step: 2,
                                            label: t('pollingTab.steps.2.label'),
                                            desc: t('pollingTab.steps.2.description'),
                                        },
                                        {
                                            step: 3,
                                            label: t('pollingTab.steps.3.label'),
                                            desc: t('pollingTab.steps.3.description'),
                                        },
                                        {
                                            step: 4,
                                            label: t('pollingTab.steps.4.label'),
                                            desc: t('pollingTab.steps.4.description'),
                                        },
                                    ].map((s) => (
                                        <div key={s.step} className="flex gap-3">
                                            <div className="size-6 shrink-0 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-bold">
                                                {s.step}
                                            </div>
                                            <div>
                                                <IC>{s.label}</IC>
                                                <span className="text-muted-foreground ml-2 text-xs">
                                                    {s.desc}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Section>

                            <Section title={t('common.sectionTitles.codeExamples')}>
                                <CodeBlock examples={pollingExamples} />
                            </Section>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── History ──────────────────────────────────────────────────── */}
                <TabsContent value="history" className="mt-4">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2 mb-1">
                                <MethodBadge method="GET" />
                                <IC>/external/video/v1/history</IC>
                            </div>
                            <CardTitle>{t('historyTab.cardTitle')}</CardTitle>
                            <CardDescription>{t('historyTab.cardDescription')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Section title={t('common.sectionTitles.queryParameters')}>
                                <ParamTable
                                    params={[
                                        {
                                            name: 'limit',
                                            type: 'integer',
                                            required: false,
                                            default: '10',
                                            description: t('historyTab.limitParamDescription'),
                                        },
                                    ]}
                                />
                            </Section>
                            <Section title={t('common.sectionTitles.codeExamples')}>
                                <CodeBlock examples={historyExamples} />
                            </Section>
                            <Section title={t('common.sectionTitles.response')}>
                                <CodeBlock
                                    examples={[
                                        {
                                            lang: 'json',
                                            label: 'JSON',
                                            code: JSON.stringify(
                                                [
                                                    {
                                                        id: 'uuid-...',
                                                        video_id: 'vid_1234_abc',
                                                        current_stage: 'HTML',
                                                        status: 'COMPLETED',
                                                        content_type: 'VIDEO',
                                                        prompt: 'Explain photosynthesis...',
                                                        language: 'English (India)',
                                                        s3_urls: {
                                                            script: 'https://...',
                                                            audio: 'https://...',
                                                            words: 'https://...',
                                                            timeline: 'https://...',
                                                        },
                                                        error_message: null,
                                                        created_at: '2024-01-25T10:00:00Z',
                                                        updated_at: '2024-01-25T10:05:00Z',
                                                        completed_at: '2024-01-25T10:05:00Z',
                                                    },
                                                ],
                                                null,
                                                2
                                            ),
                                        },
                                    ]}
                                />
                            </Section>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Status ───────────────────────────────────────────────────── */}
                <TabsContent value="status" className="mt-4">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2 mb-1">
                                <MethodBadge method="GET" />
                                <IC>/external/video/v1/status/&#123;video_id&#125;</IC>{/* design-lint-ignore: &#123;/&#125; are brace HTML entities, not hex colors */}
                            </div>
                            <CardTitle>{t('statusTab.cardTitle')}</CardTitle>
                            <CardDescription>{t('statusTab.cardDescription')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <p className="text-sm font-medium">
                                    <Trans i18nKey="videoApiStudioApiDocumentation:statusTab.statusValuesLabel">
                                        Status values (<IC>status</IC> field)
                                    </Trans>
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                    {[
                                        {
                                            val: 'PENDING',
                                            color: 'bg-gray-100 text-gray-700',
                                            desc: t('statusTab.values.pending.description'),
                                        },
                                        {
                                            val: 'IN_PROGRESS',
                                            color: 'bg-blue-100 text-blue-700',
                                            desc: t('statusTab.values.inProgress.description'),
                                        },
                                        {
                                            val: 'COMPLETED',
                                            color: 'bg-green-100 text-green-700',
                                            desc: t('statusTab.values.completed.description'),
                                        },
                                        {
                                            val: 'FAILED',
                                            color: 'bg-red-100 text-red-700',
                                            desc: t('statusTab.values.failed.description'),
                                        },
                                    ].map((s) => (
                                        <div key={s.val} className={`rounded p-2 ${s.color}`}>
                                            <p className="font-mono font-semibold">{s.val}</p>
                                            <p className="mt-0.5 opacity-80">{s.desc}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <Section title={t('common.sectionTitles.codeExamples')}>
                                <CodeBlock examples={statusExamples} />
                            </Section>
                            <Section title={t('common.sectionTitles.response')}>
                                <CodeBlock
                                    examples={[
                                        {
                                            lang: 'json',
                                            label: 'JSON',
                                            code: JSON.stringify(
                                                {
                                                    id: 'uuid-...',
                                                    video_id: 'vid_1234_abc',
                                                    current_stage: 'HTML',
                                                    status: 'COMPLETED',
                                                    content_type: 'VIDEO',
                                                    prompt: 'Explain photosynthesis...',
                                                    language: 'English (India)',
                                                    s3_urls: {
                                                        script: 'https://...s3.amazonaws.com/.../script.txt',
                                                        audio: 'https://...s3.amazonaws.com/.../narration.mp3',
                                                        words: 'https://...s3.amazonaws.com/.../narration.words.json',
                                                        timeline:
                                                            'https://...s3.amazonaws.com/.../time_based_frame.json',
                                                    },
                                                    error_message: null,
                                                    created_at: '2024-01-25T10:00:00Z',
                                                    completed_at: '2024-01-25T10:05:00Z',
                                                },
                                                null,
                                                2
                                            ),
                                        },
                                    ]}
                                />
                            </Section>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── URLs ─────────────────────────────────────────────────────── */}
                <TabsContent value="urls" className="mt-4">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2 mb-1">
                                <MethodBadge method="GET" />
                                <IC>/external/video/v1/urls/&#123;video_id&#125;</IC>{/* design-lint-ignore: &#123;/&#125; are brace HTML entities, not hex colors */}
                            </div>
                            <CardTitle>{t('urlsTab.cardTitle')}</CardTitle>
                            <CardDescription>
                                <Trans i18nKey="videoApiStudioApiDocumentation:urlsTab.cardDescription">
                                    Returns the specific URLs needed to embed the content in a player. This is the most efficient endpoint for polling — smaller response than <IC>/status</IC>.
                                </Trans>
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 text-xs text-green-800 dark:border-green-800/30 dark:bg-green-900/10 dark:text-green-300">
                                <p className="font-semibold mb-1">{t('urlsTab.howToDetectTitle')}</p>
                                <ul className="list-disc list-inside space-y-0.5">
                                    <li>
                                        <Trans i18nKey="videoApiStudioApiDocumentation:urlsTab.videoBullet">
                                            <strong>VIDEO</strong>: wait for <IC>html_url != null AND audio_url != null</IC>
                                        </Trans>
                                    </li>
                                    <li>
                                        <Trans i18nKey="videoApiStudioApiDocumentation:urlsTab.slidesBullet">
                                            <strong>SLIDES / QUIZ / etc.</strong>: wait for <IC>html_url != null</IC> (no audio required)
                                        </Trans>
                                    </li>
                                    <li>
                                        <Trans i18nKey="videoApiStudioApiDocumentation:urlsTab.failedBullet">
                                            <strong>Failed</strong>: <IC>status === &quot;FAILED&quot;</IC>
                                        </Trans>
                                    </li>
                                </ul>
                            </div>
                            <Section title={t('common.sectionTitles.codeExamples')}>
                                <CodeBlock examples={urlsExamples} />
                            </Section>
                            <Section title={t('common.sectionTitles.response')}>
                                <CodeBlock
                                    examples={[
                                        {
                                            lang: 'json',
                                            label: 'JSON',
                                            code: JSON.stringify(
                                                {
                                                    video_id: 'vid_1234_abc',
                                                    html_url: 'https://...s3.amazonaws.com/.../time_based_frame.json',
                                                    audio_url: 'https://...s3.amazonaws.com/.../narration.mp3',
                                                    words_url: 'https://...s3.amazonaws.com/.../narration.words.json',
                                                    avatar_url: null,
                                                    status: 'COMPLETED',
                                                    current_stage: 'HTML',
                                                },
                                                null,
                                                2
                                            ),
                                        },
                                    ]}
                                />
                            </Section>
                            <Section title={t('urlsTab.urlFileDescriptionsTitle')}>
                                <ParamTable
                                    params={[
                                        {
                                            name: 'html_url',
                                            type: 'string | null',
                                            required: false,
                                            description: t('urlsTab.params.htmlUrl.description'),
                                        },
                                        {
                                            name: 'audio_url',
                                            type: 'string | null',
                                            required: false,
                                            description: t('urlsTab.params.audioUrl.description'),
                                        },
                                        {
                                            name: 'words_url',
                                            type: 'string | null',
                                            required: false,
                                            description: t('urlsTab.params.wordsUrl.description'),
                                        },
                                        {
                                            name: 'avatar_url',
                                            type: 'string | null',
                                            required: false,
                                            description: t('urlsTab.params.avatarUrl.description'),
                                        },
                                    ]}
                                />
                            </Section>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Frame Edit ───────────────────────────────────────────────── */}
                <TabsContent value="frames" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2 mb-1">
                                <MethodBadge method="POST" />
                                <IC>/external/video/v1/frame/regenerate</IC>
                            </div>
                            <CardTitle>{t('framesTab.regenerate.cardTitle')}</CardTitle>
                            <CardDescription>
                                <Trans i18nKey="videoApiStudioApiDocumentation:framesTab.regenerate.cardDescription">
                                    Ask the AI to rewrite the HTML of a specific slide/frame based on a prompt. Returns the new HTML for <strong>preview only</strong> — does not modify the timeline yet. Confirm by calling <IC>/frame/update</IC>.
                                </Trans>
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Section title={t('common.sectionTitles.requestBody')}>
                                <ParamTable
                                    params={[
                                        {
                                            name: 'video_id',
                                            type: 'string',
                                            required: true,
                                            description: t(
                                                'framesTab.regenerate.params.videoId.description'
                                            ),
                                        },
                                        {
                                            name: 'timestamp',
                                            type: 'number',
                                            required: true,
                                            description: t(
                                                'framesTab.regenerate.params.timestamp.description'
                                            ),
                                        },
                                        {
                                            name: 'user_prompt',
                                            type: 'string',
                                            required: true,
                                            description: t(
                                                'framesTab.regenerate.params.userPrompt.description'
                                            ),
                                        },
                                    ]}
                                />
                            </Section>
                            <Section title={t('common.sectionTitles.codeExamples')}>
                                <CodeBlock examples={frameRegenExamples} />
                            </Section>
                            <Section title={t('common.sectionTitles.response')}>
                                <CodeBlock
                                    examples={[
                                        {
                                            lang: 'json',
                                            label: 'JSON',
                                            code: JSON.stringify(
                                                {
                                                    video_id: 'vid_1234_abc',
                                                    frame_index: 5,
                                                    timestamp: 12.5,
                                                    original_html: '<html>…</html>',
                                                    new_html: '<html><style>body{background:darkblue}</style>…</html>',
                                                },
                                                null,
                                                2
                                            ),
                                        },
                                    ]}
                                />
                            </Section>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2 mb-1">
                                <MethodBadge method="POST" />
                                <IC>/external/video/v1/frame/update</IC>
                            </div>
                            <CardTitle>{t('framesTab.update.cardTitle')}</CardTitle>
                            <CardDescription>
                                <Trans i18nKey="videoApiStudioApiDocumentation:framesTab.update.cardDescription">
                                    Writes the confirmed HTML change into the stored timeline (time_based_frame.json). Call this after the user approves the preview from <IC>/frame/regenerate</IC>.
                                </Trans>
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Section title={t('common.sectionTitles.requestBody')}>
                                <ParamTable
                                    params={[
                                        {
                                            name: 'video_id',
                                            type: 'string',
                                            required: true,
                                            description: t(
                                                'framesTab.update.params.videoId.description'
                                            ),
                                        },
                                        {
                                            name: 'frame_index',
                                            type: 'integer',
                                            required: true,
                                            description: t(
                                                'framesTab.update.params.frameIndex.description'
                                            ),
                                        },
                                        {
                                            name: 'new_html',
                                            type: 'string',
                                            required: true,
                                            description: t(
                                                'framesTab.update.params.newHtml.description'
                                            ),
                                        },
                                    ]}
                                />
                            </Section>
                            <Section title={t('common.sectionTitles.codeExamples')}>
                                <CodeBlock examples={frameUpdateExamples} />
                            </Section>
                            <Section title={t('common.sectionTitles.response')}>
                                <CodeBlock
                                    examples={[
                                        {
                                            lang: 'json',
                                            label: 'JSON',
                                            code: JSON.stringify(
                                                {
                                                    status: 'success',
                                                    video_id: 'vid_1234_abc',
                                                    updated_frame_index: 5,
                                                    message:
                                                        'Frame updated successfully. Player reflects changes immediately.',
                                                },
                                                null,
                                                2
                                            ),
                                        },
                                    ]}
                                />
                            </Section>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── SSE Event Reference ──────────────────────────────────────── */}
                <TabsContent value="events" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Radio className="size-4 text-blue-500" />
                                {t('eventsTab.cardTitle')}
                            </CardTitle>
                            <CardDescription>
                                <Trans i18nKey="videoApiStudioApiDocumentation:eventsTab.cardDescription">
                                    Every event in the <IC>POST /generate</IC> SSE stream is a JSON object on a <IC>data: </IC> line. There are four event types.
                                </Trans>
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            {/* progress */}
                            <Section title={t('eventsTab.progress.sectionTitle')}>
                                <div className="space-y-3">
                                    <EventBadge type="progress" />
                                    <p className="text-xs text-muted-foreground">
                                        <Trans i18nKey="videoApiStudioApiDocumentation:eventsTab.progress.note">
                                            Emitted at the start and end of each stage. The <IC>files</IC> field is populated as each stage completes.
                                        </Trans>
                                    </p>
                                    <CodeBlock
                                        examples={[
                                            {
                                                lang: 'json',
                                                label: 'JSON',
                                                code: JSON.stringify(
                                                    {
                                                        type: 'progress',
                                                        stage: 'HTML',
                                                        percentage: 85,
                                                        message: 'Generating HTML slides…',
                                                        video_id: 'vid_1234_abc',
                                                        content_type: 'VIDEO',
                                                        files: {
                                                            script: {
                                                                file_id: 'fid_...',
                                                                s3_url: 'https://...script.txt',
                                                            },
                                                            audio: {
                                                                file_id: 'fid_...',
                                                                s3_url: 'https://...narration.mp3',
                                                            },
                                                            words: {
                                                                file_id: 'fid_...',
                                                                s3_url: 'https://...words.json',
                                                            },
                                                            timeline: {
                                                                file_id: 'fid_...',
                                                                s3_url: 'https://...time_based_frame.json',
                                                            },
                                                        },
                                                    },
                                                    null,
                                                    2
                                                ),
                                            },
                                        ]}
                                    />
                                </div>
                            </Section>

                            {/* completed */}
                            <Section title={t('eventsTab.completed.sectionTitle')}>
                                <div className="space-y-3">
                                    <EventBadge type="completed" />
                                    <p className="text-xs text-muted-foreground">
                                        {t('eventsTab.completed.note')}
                                    </p>
                                    <CodeBlock
                                        examples={[
                                            {
                                                lang: 'json',
                                                label: 'JSON',
                                                code: JSON.stringify(
                                                    {
                                                        type: 'completed',
                                                        percentage: 100,
                                                        video_id: 'vid_1234_abc',
                                                        content_type: 'VIDEO',
                                                        files: {
                                                            script: 'https://...script.txt',
                                                            audio: 'https://...narration.mp3',
                                                            words: 'https://...words.json',
                                                            timeline:
                                                                'https://...time_based_frame.json',
                                                        },
                                                    },
                                                    null,
                                                    2
                                                ),
                                            },
                                        ]}
                                    />
                                </div>
                            </Section>

                            {/* info */}
                            <Section title={t('eventsTab.info.sectionTitle')}>
                                <div className="space-y-3">
                                    <EventBadge type="info" />
                                    <p className="text-xs text-muted-foreground">
                                        {t('eventsTab.info.note')}
                                    </p>
                                    <CodeBlock
                                        examples={[
                                            {
                                                lang: 'json',
                                                label: 'JSON',
                                                code: JSON.stringify(
                                                    {
                                                        type: 'info',
                                                        message: 'Skipping SCRIPT — already completed.',
                                                        video_id: 'vid_1234_abc',
                                                    },
                                                    null,
                                                    2
                                                ),
                                            },
                                        ]}
                                    />
                                </div>
                            </Section>

                            {/* error */}
                            <Section title={t('eventsTab.error.sectionTitle')}>
                                <div className="space-y-3">
                                    <EventBadge type="error" />
                                    <p className="text-xs text-muted-foreground">
                                        <Trans i18nKey="videoApiStudioApiDocumentation:eventsTab.error.note">
                                            Sent when the pipeline fails. The <IC>stage</IC> field indicates which stage failed.
                                        </Trans>
                                    </p>
                                    <CodeBlock
                                        examples={[
                                            {
                                                lang: 'json',
                                                label: 'JSON',
                                                code: JSON.stringify(
                                                    {
                                                        type: 'error',
                                                        message: 'TTS provider returned 503.',
                                                        stage: 'TTS',
                                                        video_id: 'vid_1234_abc',
                                                    },
                                                    null,
                                                    2
                                                ),
                                            },
                                        ]}
                                    />
                                </div>
                            </Section>

                            {/* heartbeat note */}
                            <div className="rounded-md border border-muted p-3 text-xs text-muted-foreground">
                                <Trans i18nKey="videoApiStudioApiDocumentation:eventsTab.heartbeatNote">
                                    <strong>Heartbeat</strong> — every 60 s of silence the server sends an SSE comment line (<IC>: heartbeat</IC>) to keep proxies alive. These are not <IC>data:</IC> events and should be ignored by your parser.
                                </Trans>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* ── Error Reference ───────────────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <WarningCircle className="size-4 text-red-500" />
                        {t('errors.cardTitle')}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto rounded-md border border-border">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-muted/50 border-b border-border">
                                    <th className="text-left px-3 py-2 font-semibold">
                                        {t('errors.tableHeaders.code')}
                                    </th>
                                    <th className="text-start px-3 py-2 font-semibold">
                                        {t('errors.tableHeaders.meaning')}
                                    </th>
                                    <th className="text-start px-3 py-2 font-semibold">
                                        {t('errors.tableHeaders.cause')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    {
                                        code: '401',
                                        meaning: t('errors.unauthorized.meaning'),
                                        cause: t('errors.unauthorized.cause'),
                                    },
                                    {
                                        code: '403',
                                        meaning: t('errors.forbidden.meaning'),
                                        cause: t('errors.forbidden.cause'),
                                    },
                                    {
                                        code: '404',
                                        meaning: t('errors.notFound.meaning'),
                                        cause: t('errors.notFound.cause'),
                                    },
                                    {
                                        code: '422',
                                        meaning: t('errors.validationError.meaning'),
                                        cause: t('errors.validationError.cause'),
                                    },
                                    {
                                        code: '500',
                                        meaning: t('errors.internalServerError.meaning'),
                                        cause: t('errors.internalServerError.cause'),
                                    },
                                ].map((e, i) => (
                                    <tr
                                        key={e.code}
                                        className={`border-b border-border last:border-0 ${i % 2 === 0 ? '' : 'bg-muted/20'}`}
                                    >
                                        <td className="px-3 py-2">
                                            <Badge
                                                variant="outline"
                                                className="font-mono text-red-600 border-red-200"
                                            >
                                                {e.code}
                                            </Badge>
                                        </td>
                                        <td className="px-3 py-2 font-semibold">{e.meaning}</td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                            {e.cause}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
