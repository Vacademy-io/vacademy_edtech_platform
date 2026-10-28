import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    VARIABLE_SOURCE_KINDS,
    joinSource,
    splitSource,
    type VariableSourceKind,
} from '../-types/templates';

/** Kinds that need a typed value after them (form field, link number, fixed text). */
const NEEDS_VALUE = new Set<VariableSourceKind>(['form', 'research', 'brief.link', 'static']);

/**
 * Where a template variable gets its value: the person's name, a form answer, the N-th link of
 * the brief, a fixed text, or a short AI-written line. Stored as one string ("form.course").
 */
export function VariableSourceField({
    variable,
    value,
    onChange,
}: {
    variable: string;
    value: string | undefined;
    onChange: (source: string) => void;
}) {
    const { t } = useTranslation('engagementEnginesTemplates');
    const { kind, value: typed } = splitSource(value);
    const isLink = /link|url|website/i.test(variable);

    return (
        <div className="flex min-w-0 flex-1 items-center gap-2">
            <Select
                value={kind}
                onValueChange={(k) => onChange(joinSource(k as VariableSourceKind, k === kind ? typed : ''))}
            >
                <SelectTrigger className="w-44 shrink-0" aria-label={t('sources.label', { variable })}>
                    <SelectValue placeholder={t('sources.pick')} />
                </SelectTrigger>
                <SelectContent>
                    {VARIABLE_SOURCE_KINDS.filter((k) => !isLink || k === 'brief.link').map((k) => (
                        <SelectItem key={k} value={k}>
                            {t(`sources.kinds.${k.replace('.', '_')}`)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {kind && NEEDS_VALUE.has(kind) && (
                <Input
                    value={typed}
                    placeholder={t(`sources.placeholders.${kind.replace('.', '_')}`)}
                    onChange={(e) => onChange(joinSource(kind, e.target.value))}
                />
            )}
        </div>
    );
}
