import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Editor from '@monaco-editor/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';
import { LANGUAGE_REGISTRY, type LangId } from '../constants/code-editor';
import type { CodingQuestionConfig } from '../utils/code-editor-types';

interface Props {
    question: CodingQuestionConfig;
    onChange: (next: CodingQuestionConfig) => void;
    disabled?: boolean;
}

export function StarterCodeEditor({ question, onChange, disabled }: Props) {
    const { t } = useTranslation('studyLibraryStarterCodeEditor');
    const langs = useMemo<LangId[]>(
        () =>
            question.allowedLanguages.length ? question.allowedLanguages : (['python'] as LangId[]),
        [question.allowedLanguages]
    );
    const [active, setActive] = useState<LangId>(langs[0]!);

    // If the active language gets removed from allowedLanguages, fall back.
    const activeLang = useMemo<LangId>(
        () => (langs.includes(active) ? active : langs[0]!),
        [active, langs]
    );

    const def = LANGUAGE_REGISTRY[activeLang];
    const value = question.starterCode[activeLang] ?? '';

    const setStarter = (code: string) => {
        onChange({
            ...question,
            starterCode: { ...question.starterCode, [activeLang]: code },
        });
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{t('description')}</p>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStarter(def.starter)}
                    disabled={disabled}
                >
                    <RotateCcw className="mr-1 size-3" />
                    {t('resetToDefault')}
                </Button>
            </div>

            <Tabs value={activeLang} onValueChange={(v) => setActive(v as LangId)}>
                <TabsList className="flex-wrap">
                    {langs.map((l) => (
                        <TabsTrigger key={l} value={l}>
                            {LANGUAGE_REGISTRY[l].label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                <TabsContent value={activeLang} className="mt-2">
                    <div className="h-[260px] rounded border">
                        <Editor
                            height="100%"
                            language={def.monacoLang}
                            value={value}
                            theme="vs-dark"
                            onChange={(v) => setStarter(v ?? '')}
                            options={{
                                readOnly: disabled,
                                minimap: { enabled: false },
                                fontSize: 13,
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                lineNumbers: 'on',
                                padding: { top: 12 },
                            }}
                        />
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
