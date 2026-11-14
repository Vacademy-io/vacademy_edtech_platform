import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash } from '@phosphor-icons/react';
import { VariablePicker } from './variable-picker';

interface KeyValueBuilderProps {
    value: Record<string, string>;
    onChange: (kv: Record<string, string>) => void;
    nodeId: string;
    valueMode?: 'text' | 'variable' | 'both';
    keyPlaceholder?: string;
    valuePlaceholder?: string;
}

export function KeyValueBuilder({
    value,
    onChange,
    nodeId,
    valueMode = 'both',
    keyPlaceholder,
    valuePlaceholder,
}: KeyValueBuilderProps) {
    const { t } = useTranslation('workflowKeyValueBuilder');
    const resolvedKeyPlaceholder = keyPlaceholder ?? t('defaultKeyPlaceholder');
    const resolvedValuePlaceholder = valuePlaceholder ?? t('defaultValuePlaceholder');
    const entries = Object.entries(value ?? {});
    if (entries.length === 0) {
        entries.push(['', '']);
    }

    const updateEntry = (index: number, part: 'key' | 'value', newVal: string) => {
        const updated: Record<string, string> = {};
        entries.forEach(([k, v], i) => {
            if (i === index) {
                if (part === 'key') {
                    updated[newVal] = v;
                } else {
                    updated[k] = newVal;
                }
            } else {
                updated[k] = v;
            }
        });
        onChange(updated);
    };

    const addEntry = () => {
        const updated = { ...value, '': '' };
        onChange(updated);
    };

    const removeEntry = (index: number) => {
        if (entries.length <= 1) return;
        const updated: Record<string, string> = {};
        entries.forEach(([k, v], i) => {
            if (i !== index) updated[k] = v;
        });
        onChange(updated);
    };

    return (
        <div className="space-y-2">
            {entries.map(([key, val], i) => (
                <div key={i} className="flex items-start gap-1.5">
                    <div className="w-[38%]">
                        <Input
                            value={key}
                            onChange={(e) => updateEntry(i, 'key', e.target.value)}
                            className="h-8 text-xs"
                            placeholder={resolvedKeyPlaceholder}
                        />
                    </div>
                    <span className="mt-1.5 text-xs text-gray-400">=</span>
                    <div className="flex-1">
                        {valueMode === 'variable' ? (
                            <VariablePicker
                                value={val}
                                onChange={(v) => updateEntry(i, 'value', v)}
                                placeholder={resolvedValuePlaceholder}
                                nodeId={nodeId}
                            />
                        ) : valueMode === 'text' ? (
                            <Input
                                value={val}
                                onChange={(e) => updateEntry(i, 'value', e.target.value)}
                                className="h-8 text-xs"
                                placeholder={resolvedValuePlaceholder}
                            />
                        ) : (
                            // 'both' mode — VariablePicker (which has advanced text mode built in)
                            <VariablePicker
                                value={val}
                                onChange={(v) => updateEntry(i, 'value', v)}
                                placeholder={resolvedValuePlaceholder}
                                nodeId={nodeId}
                            />
                        )}
                    </div>
                    {entries.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removeEntry(i)} className="h-8 w-8 p-0 text-gray-400 hover:text-red-500 shrink-0">
                            <Trash size={12} />
                        </Button>
                    )}
                </div>
            ))}

            <Button variant="ghost" size="sm" onClick={addEntry} className="h-7 gap-1 text-xs text-gray-500 w-full justify-center border border-dashed border-gray-200">
                <Plus size={12} /> {t('addField')}
            </Button>
        </div>
    );
}
