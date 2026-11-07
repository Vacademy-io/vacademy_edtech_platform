import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash } from '@phosphor-icons/react';

const buildAggTypes = (t: TFunction) => [
    { value: 'COUNT', label: t('aggTypes.COUNT'), needsField: false },
    { value: 'SUM', label: t('aggTypes.SUM'), needsField: true },
    { value: 'AVG', label: t('aggTypes.AVG'), needsField: true },
    { value: 'MIN', label: t('aggTypes.MIN'), needsField: true },
    { value: 'MAX', label: t('aggTypes.MAX'), needsField: true },
];

interface AggOperation {
    type: string;
    field?: string;
    outputKey: string;
}

interface AggregateBuilderProps {
    value: AggOperation[];
    onChange: (ops: AggOperation[]) => void;
}

export function AggregateBuilder({ value, onChange }: AggregateBuilderProps) {
    const { t } = useTranslation('workflowAggregateBuilder');
    const AGG_TYPES = buildAggTypes(t);
    const ops: AggOperation[] = Array.isArray(value) && value.length > 0
        ? value
        : [{ type: 'COUNT', outputKey: 'total' }];

    const updateOp = (index: number, field: keyof AggOperation, val: string) => {
        const updated = [...ops];
        updated[index] = { ...updated[index]!, [field]: val };
        onChange(updated);
    };

    const addOp = () => {
        onChange([...ops, { type: 'COUNT', outputKey: '' }]);
    };

    const removeOp = (index: number) => {
        if (ops.length <= 1) return;
        onChange(ops.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-2">
            {ops.map((op, i) => {
                const typeMeta = AGG_TYPES.find((t) => t.value === op.type);
                return (
                    <div key={i} className="rounded-lg border border-gray-200 bg-gray-50/50 p-2.5 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase">{t('operationLabel', { index: i + 1 })}</span>
                            {ops.length > 1 && (
                                <Button variant="ghost" size="sm" onClick={() => removeOp(i)} className="h-5 w-5 p-0 text-gray-400 hover:text-red-500">
                                    <Trash size={12} />
                                </Button>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-[10px] text-gray-500">{t('typeLabel')}</label>
                                <select
                                    className="mt-0.5 w-full rounded-md border border-input bg-white px-2 py-1.5 text-xs"
                                    value={op.type}
                                    onChange={(e) => updateOp(i, 'type', e.target.value)}
                                >
                                    {AGG_TYPES.map((aggType) => (
                                        <option key={aggType.value} value={aggType.value}>{aggType.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] text-gray-500">{t('saveAsLabel')}</label>
                                <Input
                                    value={op.outputKey}
                                    onChange={(e) => updateOp(i, 'outputKey', e.target.value)}
                                    className="mt-0.5 h-7 text-xs"
                                    placeholder={t('saveAsPlaceholder')}
                                />
                            </div>
                        </div>
                        {typeMeta?.needsField && (
                            <div>
                                <label className="text-[10px] text-gray-500">{t('fieldToLabel', { operation: typeMeta.label.toLowerCase() })}</label>
                                <Input
                                    value={op.field ?? ''}
                                    onChange={(e) => updateOp(i, 'field', e.target.value)}
                                    className="mt-0.5 h-7 text-xs"
                                    placeholder={t('fieldPlaceholder')}
                                />
                            </div>
                        )}
                    </div>
                );
            })}

            <Button variant="ghost" size="sm" onClick={addOp} className="h-7 gap-1 text-xs text-gray-500 w-full justify-center border border-dashed border-gray-200">
                <Plus size={12} /> {t('addOperation')}
            </Button>
        </div>
    );
}
