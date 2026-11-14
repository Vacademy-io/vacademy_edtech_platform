import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { TutorModelOption, TutorVoiceOption } from '@/services/tutor';

/** Radix Select cannot carry an empty value: sentinels for "inherit" and "type an id". */
const INHERIT = '__inherit__';
const CUSTOM = '__custom__';

interface PickerCommon {
    value: string | undefined;
    onChange: (next: string | undefined) => void;
    /** Label of the blank choice, e.g. "Institute default (Priya)" or "Platform default". */
    inheritLabel: string;
    disabled?: boolean;
}

/**
 * Voice dropdown for one provider: grouped female / male, Hindi-capable voices
 * first, cloned voices on top, plus "Other (type an id)" for anything not
 * listed. Falls back to a plain input when the provider has no catalogue.
 */
export const VoicePicker: React.FC<
    PickerCommon & { voices: TutorVoiceOption[]; provider?: string }
> = ({ value, onChange, inheritLabel, voices, provider, disabled }) => {
    const [custom, setCustom] = useState(false);
    const groups = useMemo(() => {
        const hindiFirst = (a: TutorVoiceOption, b: TutorVoiceOption) => {
            const ah = a.languages?.includes('hindi') ? 0 : 1;
            const bh = b.languages?.includes('hindi') ? 0 : 1;
            return ah - bh || a.name.localeCompare(b.name);
        };
        return [
            { label: 'Your voices', items: voices.filter((v) => v.cloned) },
            {
                label: 'Female',
                items: voices.filter((v) => !v.cloned && v.gender === 'female').sort(hindiFirst),
            },
            {
                label: 'Male',
                items: voices.filter((v) => !v.cloned && v.gender === 'male').sort(hindiFirst),
            },
            {
                label: 'Other',
                items: voices.filter((v) => !v.cloned && !v.gender).sort(hindiFirst),
            },
        ].filter((g) => g.items.length > 0);
    }, [voices]);
    const known = !!value && voices.some((v) => v.id === value);
    if (!voices.length || custom || (value && !known)) {
        return (
            <div className="flex items-center gap-2">
                <Input
                    value={value ?? ''}
                    placeholder={voices.length ? 'voice id' : inheritLabel}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value || undefined)}
                />
                {voices.length > 0 && (
                    <button
                        type="button"
                        className="shrink-0 text-xs text-primary-500 hover:underline"
                        onClick={() => {
                            setCustom(false);
                            onChange(undefined);
                        }}
                    >
                        Pick from list
                    </button>
                )}
            </div>
        );
    }
    return (
        <Select
            value={value || INHERIT}
            disabled={disabled}
            onValueChange={(v) => {
                if (v === CUSTOM) {
                    setCustom(true);
                    return;
                }
                onChange(v === INHERIT ? undefined : v);
            }}
        >
            <SelectTrigger>
                <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
                <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
                {groups.map((g) => (
                    <div key={g.label}>
                        <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            {g.label}
                        </div>
                        {g.items.map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                                <span>{v.name}</span>
                                {v.languages?.includes('hindi') && provider === 'smallest' && (
                                    <span className="ms-2 text-xs text-neutral-400">EN·HI</span>
                                )}
                                {v.age && (
                                    <span className="ms-2 text-xs text-neutral-400">{v.age}</span>
                                )}
                            </SelectItem>
                        ))}
                    </div>
                ))}
                <SelectItem value={CUSTOM}>Other (type a voice id)…</SelectItem>
            </SelectContent>
        </Select>
    );
};

/** Model dropdown over the chat-capable rows of the ai_models registry, grouped by provider. */
export const ModelPicker: React.FC<PickerCommon & { models: TutorModelOption[] }> = ({
    value,
    onChange,
    inheritLabel,
    models,
    disabled,
}) => {
    const [custom, setCustom] = useState(false);
    const groups = useMemo(() => {
        const map = new Map<string, TutorModelOption[]>();
        for (const m of models) {
            const list = map.get(m.provider) ?? [];
            list.push(m);
            map.set(m.provider, list);
        }
        return Array.from(map.entries());
    }, [models]);
    const known = !!value && models.some((m) => m.model_id === value);
    if (!models.length || custom || (value && !known)) {
        return (
            <div className="flex items-center gap-2">
                <Input
                    value={value ?? ''}
                    placeholder={models.length ? 'openrouter model id' : inheritLabel}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value || undefined)}
                />
                {models.length > 0 && (
                    <button
                        type="button"
                        className="shrink-0 text-xs text-primary-500 hover:underline"
                        onClick={() => {
                            setCustom(false);
                            onChange(undefined);
                        }}
                    >
                        Pick from list
                    </button>
                )}
            </div>
        );
    }
    return (
        <Select
            value={value || INHERIT}
            disabled={disabled}
            onValueChange={(v) => {
                if (v === CUSTOM) {
                    setCustom(true);
                    return;
                }
                onChange(v === INHERIT ? undefined : v);
            }}
        >
            <SelectTrigger>
                <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
                <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
                {groups.map(([provider, items]) => (
                    <div key={provider}>
                        <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            {provider}
                        </div>
                        {items.map((m) => (
                            <SelectItem key={m.model_id} value={m.model_id}>
                                <span>{m.name}</span>
                                <span className="ms-2 text-xs text-neutral-400">{m.model_id}</span>
                                {m.is_free && (
                                    <span className="ms-2 text-xs text-success-600">free</span>
                                )}
                            </SelectItem>
                        ))}
                    </div>
                ))}
                <SelectItem value={CUSTOM}>Other (type a model id)…</SelectItem>
            </SelectContent>
        </Select>
    );
};
