import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { CourseLanguageOption, CourseLanguageSettings } from '../../-types/editor-types';
import {
    blankLanguage,
    courseLanguageIssues,
    effectiveCourseLanguages,
    languageOfLevel,
    moveLanguage,
    parseMatchWords,
    removeLanguageAt,
    sanitizeLanguageCode,
    updateLanguageAt,
    usesDefaultLanguages,
} from './course-languages';

/**
 * Global Settings → Course languages (globalSettings.courseLanguages).
 *
 * A course's language versions are its levels ("Hindi", "English", "Beginner
 * Hindi"). Switched on, the site folds them into one card per course with
 * EN / हिं chips and offers a language filter; the list below says how a
 * level name is recognised. Until the admin edits it, the site follows the
 * built-in English / Hindi rules — nothing is written for them.
 */

interface CourseLanguagesSettingsCardProps {
    value: CourseLanguageSettings | undefined;
    onChange: (next: CourseLanguageSettings) => void;
}

/** Comma-separated words, committed on blur so the comma being typed is not swallowed. */
const MatchWordsInput = ({ words, onCommit, id }: { words: string[]; onCommit: (w: string[]) => void; id: string }) => {
    const joined = words.join(', ');
    const [text, setText] = useState(joined);
    useEffect(() => setText(joined), [joined]);
    return (
        <Input
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
                const next = parseMatchWords(text);
                if (next.join(', ') !== joined) onCommit(next);
                else setText(joined);
            }}
            placeholder="hindi, हिन्दी"
        />
    );
};

export const CourseLanguagesSettingsCard = ({ value, onChange }: CourseLanguagesSettingsCardProps) => {
    const enabled = !!value?.enabled;
    const languages = effectiveCourseLanguages(value);
    const followingDefaults = usesDefaultLanguages(value);
    const issues = courseLanguageIssues(languages);
    const [sample, setSample] = useState('');
    const detected = sample.trim() ? languageOfLevel(sample, languages) : null;

    const writeLanguages = (next: CourseLanguageOption[]) => onChange({ ...value, enabled, languages: next });

    return (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-center justify-between gap-3">
                <h4 className="font-medium text-neutral-700">Course languages</h4>
                <Switch
                    checked={enabled}
                    onCheckedChange={(c) => onChange({ ...value, enabled: c })}
                    aria-label="Merge language versions of a course"
                />
            </div>
            <p className="text-caption text-neutral-500">
                One card per course: a course&apos;s language versions (levels named &ldquo;Hindi&rdquo;,
                &ldquo;English&rdquo;, &ldquo;Beginner Hindi&rdquo;…) show as one card with language chips, and the
                Courses page can filter by language. The visitor picks the language on the course page. Then switch
                on &ldquo;One card per course&rdquo; in each Courses section that should merge them — this setting
                alone changes nothing on the site.
            </p>

            {enabled && (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-caption text-neutral-600">
                            {followingDefaults
                                ? 'Using the built-in English and Hindi rules. Edit any field to make the list your own.'
                                : 'How a level name tells its language — the first match wins, top to bottom.'}
                        </p>
                        {!followingDefaults && (
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={() => onChange({ ...value, enabled, languages: undefined })}
                            >
                                Reset to English / Hindi
                            </MyButton>
                        )}
                    </div>

                    {languages.map((lang, i) => {
                        const rowId = `course-lang-${i}`;
                        return (
                            <div key={i} className="space-y-2 rounded-md border border-neutral-200 bg-white p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-caption font-semibold text-neutral-600">
                                        {lang.label || `Language ${i + 1}`}
                                    </p>
                                    <div className="flex items-center gap-0.5">
                                        <button
                                            type="button"
                                            aria-label="Move up"
                                            disabled={i === 0}
                                            onClick={() => writeLanguages(moveLanguage(languages, i, -1))}
                                            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                                        >
                                            <ArrowUp className="size-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label="Move down"
                                            disabled={i === languages.length - 1}
                                            onClick={() => writeLanguages(moveLanguage(languages, i, 1))}
                                            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                                        >
                                            <ArrowDown className="size-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Remove ${lang.label || `language ${i + 1}`}`}
                                            disabled={languages.length <= 1}
                                            onClick={() => writeLanguages(removeLanguageAt(languages, i))}
                                            className="rounded p-1 text-neutral-400 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-30"
                                        >
                                            <Trash className="size-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <div>
                                        <Label htmlFor={`${rowId}-label`} className="text-caption">
                                            Name
                                        </Label>
                                        <Input
                                            id={`${rowId}-label`}
                                            value={lang.label}
                                            onChange={(e) =>
                                                writeLanguages(updateLanguageAt(languages, i, { label: e.target.value }))
                                            }
                                            placeholder="Hindi"
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor={`${rowId}-code`} className="text-caption">
                                            Code
                                        </Label>
                                        <Input
                                            id={`${rowId}-code`}
                                            value={lang.code}
                                            onChange={(e) =>
                                                writeLanguages(
                                                    updateLanguageAt(languages, i, {
                                                        code: sanitizeLanguageCode(e.target.value),
                                                    })
                                                )
                                            }
                                            placeholder="hi"
                                            className="font-mono"
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor={`${rowId}-chip`} className="text-caption">
                                            Chip
                                        </Label>
                                        <Input
                                            id={`${rowId}-chip`}
                                            value={lang.chip || ''}
                                            maxLength={12}
                                            onChange={(e) =>
                                                writeLanguages(updateLanguageAt(languages, i, { chip: e.target.value }))
                                            }
                                            placeholder="हिं"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <Label htmlFor={`${rowId}-match`} className="text-caption">
                                        Words in level names
                                    </Label>
                                    <MatchWordsInput
                                        id={`${rowId}-match`}
                                        words={lang.match || []}
                                        onCommit={(match) => writeLanguages(updateLanguageAt(languages, i, { match }))}
                                    />
                                    <p className="mt-1 text-caption text-neutral-400">
                                        Comma-separated. The name and code count too.
                                    </p>
                                </div>
                            </div>
                        );
                    })}

                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => writeLanguages([...languages, blankLanguage()])}
                    >
                        <Plus className="size-3.5" /> Add language
                    </MyButton>

                    {issues.length > 0 && (
                        <ul className="space-y-0.5 rounded-md border border-warning-200 bg-warning-50 p-2 text-caption text-warning-700">
                            {issues.map((issue) => (
                                <li key={issue}>{issue}</li>
                            ))}
                        </ul>
                    )}

                    <div className="space-y-1 rounded-md border border-dashed border-neutral-300 bg-white p-3">
                        <Label htmlFor="course-lang-sample" className="text-caption">
                            Try a level name
                        </Label>
                        <Input
                            id="course-lang-sample"
                            value={sample}
                            onChange={(e) => setSample(e.target.value)}
                            placeholder="e.g. Beginner Hindi"
                        />
                        {sample.trim() && (
                            <p className="text-caption text-neutral-600">
                                {detected
                                    ? `→ ${detected.label} (${detected.chip || detected.label})`
                                    : 'No language recognised — this version shows without a language chip.'}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
