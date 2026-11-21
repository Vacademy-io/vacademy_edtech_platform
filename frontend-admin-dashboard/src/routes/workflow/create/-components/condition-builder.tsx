import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Code, MagicWand, Plus, Trash } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { VariablePicker } from './variable-picker';

function buildOperators(t: TFunction) {
    return [
        { value: '==', label: t('operators.equals'), types: ['String', 'Number', 'Boolean'] },
        { value: '!=', label: t('operators.notEquals'), types: ['String', 'Number', 'Boolean'] },
        { value: '>', label: t('operators.greaterThan'), types: ['Number'] },
        { value: '<', label: t('operators.lessThan'), types: ['Number'] },
        { value: '>=', label: t('operators.greaterOrEqual'), types: ['Number'] },
        { value: '<=', label: t('operators.lessOrEqual'), types: ['Number'] },
        { value: 'contains', label: t('operators.contains'), types: ['String', 'List'] },
        { value: 'isEmpty', label: t('operators.isEmpty'), types: ['String', 'List'] },
        { value: 'isNotEmpty', label: t('operators.isNotEmpty'), types: ['String', 'List'] },
        { value: '== true', label: t('operators.isTrue'), types: ['Boolean'] },
        { value: '== false', label: t('operators.isFalse'), types: ['Boolean'] },
    ];
}

interface ConditionRow {
    variable: string;
    operator: string;
    value: string;
    joiner: 'AND' | 'OR';
}

function parseSpelToRows(spel: string, itemMode: boolean): ConditionRow[] | null {
    if (!spel || spel.trim() === '') return [{ variable: '', operator: '==', value: '', joiner: 'AND' }];

    const prefix = itemMode ? '#item' : '#ctx';
    // Try to split by && or ||
    const parts: { expr: string; joiner: 'AND' | 'OR' }[] = [];
    let remaining = spel.trim();
    let lastJoiner: 'AND' | 'OR' = 'AND';

    // Simple split — won't handle nested parens but covers 90% of cases
    const andParts = remaining.split(/\s*&&\s*/);
    if (andParts.length > 1) {
        andParts.forEach((part, i) => {
            parts.push({ expr: part.trim(), joiner: i === 0 ? 'AND' : 'AND' });
        });
    } else {
        const orParts = remaining.split(/\s*\|\|\s*/);
        if (orParts.length > 1) {
            orParts.forEach((part, i) => {
                parts.push({ expr: part.trim(), joiner: i === 0 ? 'OR' : 'OR' });
            });
        } else {
            parts.push({ expr: remaining, joiner: 'AND' });
        }
    }

    const rows: ConditionRow[] = [];
    for (const { expr, joiner } of parts) {
        // Match: #ctx['key'] op value  or  #item['key'] op value
        const varPattern = itemMode
            ? /#item\['([^']+)'\]/
            : /#ctx\['([^']+)'\]/;

        // Check for isEmpty / isNotEmpty
        const isEmptyMatch = expr.match(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\['([^']+)'\\]\\.isEmpty\\(\\)`));
        if (isEmptyMatch) {
            rows.push({ variable: `${prefix}['${isEmptyMatch[1]}']`, operator: 'isEmpty', value: '', joiner });
            continue;
        }
        const isNotEmptyMatch = expr.match(new RegExp(`!${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\['([^']+)'\\]\\.isEmpty\\(\\)`));
        if (isNotEmptyMatch) {
            rows.push({ variable: `${prefix}['${isNotEmptyMatch[1]}']`, operator: 'isNotEmpty', value: '', joiner });
            continue;
        }
        // Check for contains
        const containsMatch = expr.match(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\['([^']+)'\\]\\.contains\\((.+)\\)`));
        if (containsMatch) {
            rows.push({ variable: `${prefix}['${containsMatch[1]}']`, operator: 'contains', value: containsMatch[2]!.replace(/^'|'$/g, ''), joiner });
            continue;
        }
        // Match standard comparison: variable op value
        const compMatch = expr.match(new RegExp(`(${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\['[^']+('\\](?:\\.[\\w]+)*)?)\\s*(==|!=|>=|<=|>|<)\\s*(.+)`));
        if (compMatch) {
            rows.push({ variable: compMatch[1]!, operator: compMatch[3]!, value: compMatch[4]!.trim().replace(/^'|'$/g, ''), joiner });
            continue;
        }
        // Couldn't parse this part — return null to fall back to advanced
        return null;
    }

    return rows.length > 0 ? rows : null;
}

function rowsToSpel(rows: ConditionRow[], itemMode: boolean): string {
    const prefix = itemMode ? '#item' : '#ctx';

    const parts = rows
        .filter((r) => r.variable)
        .map((row) => {
            const varExpr = row.variable;

            switch (row.operator) {
                case 'isEmpty':
                    return `${varExpr}.isEmpty()`;
                case 'isNotEmpty':
                    return `!${varExpr}.isEmpty()`;
                case 'contains':
                    return `${varExpr}.contains('${row.value}')`;
                case '== true':
                case '== false':
                    return `${varExpr} ${row.operator}`;
                default: {
                    // Determine if value is numeric
                    const isNumeric = !isNaN(Number(row.value)) && row.value.trim() !== '';
                    const formattedValue = isNumeric ? row.value : `'${row.value}'`;
                    return `${varExpr} ${row.operator} ${formattedValue}`;
                }
            }
        });

    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0]!;

    const joiner = rows[1]?.joiner === 'OR' ? ' || ' : ' && ';
    return parts.join(joiner);
}

interface ConditionBuilderProps {
    value: string;
    onChange: (spel: string) => void;
    nodeId: string;
    itemMode?: boolean;
}

export function ConditionBuilder({ value, onChange, nodeId, itemMode = false }: ConditionBuilderProps) {
    const { t } = useTranslation('workflowConditionBuilder');
    const OPERATORS = buildOperators(t);
    const [advanced, setAdvanced] = useState(false);
    const [rows, setRows] = useState<ConditionRow[]>([{ variable: '', operator: '==', value: '', joiner: 'AND' }]);

    // Parse existing SpEL into rows on mount
    useEffect(() => {
        const parsed = parseSpelToRows(value, itemMode);
        if (parsed) {
            setRows(parsed);
            setAdvanced(false);
        } else if (value) {
            // Unparseable — switch to advanced mode
            setAdvanced(true);
        }
    }, []); // Only on mount

    const updateRow = useCallback((index: number, field: keyof ConditionRow, val: string) => {
        setRows((prev) => {
            const updated = [...prev];
            updated[index] = { ...updated[index]!, [field]: val };
            const spel = rowsToSpel(updated, itemMode);
            onChange(spel);
            return updated;
        });
    }, [onChange, itemMode]);

    const addRow = useCallback(() => {
        setRows((prev) => {
            const updated = [...prev, { variable: '', operator: '==', value: '', joiner: prev[0]?.joiner ?? 'AND' }];
            return updated;
        });
    }, []);

    const removeRow = useCallback((index: number) => {
        setRows((prev) => {
            if (prev.length <= 1) return prev;
            const updated = prev.filter((_, i) => i !== index);
            const spel = rowsToSpel(updated, itemMode);
            onChange(spel);
            return updated;
        });
    }, [onChange, itemMode]);

    const needsValueInput = (op: string) =>
        !['isEmpty', 'isNotEmpty', '== true', '== false'].includes(op);

    // Advanced mode: raw SpEL
    if (advanced) {
        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1">
                    <Input
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={itemMode ? "#item['field'] > 10" : "#ctx['variable'] == 'value'"}
                        className="font-mono text-xs"
                    />
                    <Button
                        variant="ghost" size="sm"
                        onClick={() => {
                            const parsed = parseSpelToRows(value, itemMode);
                            if (parsed) { setRows(parsed); setAdvanced(false); }
                        }}
                        title={t('switchToVisual')}
                        className="h-8 w-8 p-0 shrink-0"
                    >
                        <MagicWand size={14} />
                    </Button>
                </div>
                <p className="text-[10px] text-gray-400">{t('rawSpelMode')}</p>
            </div>
        );
    }

    // Visual mode
    return (
        <div className="space-y-2">
            {rows.map((row, i) => (
                <div key={i} className="space-y-1.5">
                    {i > 0 && (
                        <div className="flex items-center gap-2 pl-1">
                            <select
                                className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600 uppercase"
                                value={row.joiner}
                                onChange={(e) => updateRow(i, 'joiner', e.target.value)}
                            >
                                <option value="AND">{t('joinerAnd')}</option>
                                <option value="OR">{t('joinerOr')}</option>
                            </select>
                            <div className="flex-1 border-t border-dashed border-gray-200" />
                        </div>
                    )}
                    <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-2 space-y-1.5">
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase w-6 shrink-0">{i === 0 ? t('ifLabel') : ''}</span>
                            <div className="flex-1">
                                <VariablePicker
                                    value={row.variable}
                                    onChange={(v) => updateRow(i, 'variable', v)}
                                    placeholder={t('pickVariablePlaceholder')}
                                    nodeId={nodeId}
                                />
                            </div>
                            {rows.length > 1 && (
                                <Button variant="ghost" size="sm" onClick={() => removeRow(i)} className="h-6 w-6 p-0 text-gray-400 hover:text-red-500 shrink-0">
                                    <Trash size={12} />
                                </Button>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 pl-6">
                            <select
                                className="rounded-md border border-input bg-white px-2 py-1 text-xs"
                                value={row.operator}
                                onChange={(e) => updateRow(i, 'operator', e.target.value)}
                            >
                                {OPERATORS.map((op) => (
                                    <option key={op.value} value={op.value}>
                                        {op.label}
                                    </option>
                                ))}
                            </select>
                            {needsValueInput(row.operator) && (
                                <Input
                                    value={row.value}
                                    onChange={(e) => updateRow(i, 'value', e.target.value)}
                                    placeholder={t('valuePlaceholder')}
                                    className="h-7 flex-1 text-xs"
                                />
                            )}
                        </div>
                    </div>
                </div>
            ))}

            <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" size="sm" onClick={addRow} className="h-7 gap-1 text-xs text-gray-500">
                    <Plus size={12} /> {t('addCondition')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAdvanced(true)} className="h-7 gap-1 text-xs text-gray-400" title={t('switchToRawSpel')}>
                    <Code size={12} /> {t('advanced')}
                </Button>
            </div>

            {/* Live preview */}
            {value && (
                <div className="rounded border border-dashed border-gray-200 bg-gray-50 px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[9px] shrink-0">{t('spelBadge')}</Badge>
                        <code className="text-[10px] text-gray-500 break-all">{value}</code>
                    </div>
                </div>
            )}
        </div>
    );
}
