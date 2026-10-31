'use client';

import { useState, useEffect, useRef } from 'react';
import { useExportSettings } from '../contexts/export-settings-context';
import { processHtmlString, getBase64FromUrl } from '../utils/utils';
import { Question } from '../types/question';
import { Resizable } from 're-resizable';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

// Add answerSpacing parameter to your props
interface QuestionComponentProps {
    question: Question;
    questionNumber: number;
    showMarks?: boolean;
    showCheckboxes?: boolean;
    answerSpacing?: number; // Added this
    /**
     * When true, highlights the correct option(s) (parsed from
     * question.marking_json -> data.correctOptionIds) and renders the
     * optional `question.explanation_text` below the options. Used by
     * answer-key PDF exports; regular question-paper exports leave this
     * false so the printable is suitable for handing out to learners.
     */
    showAnswers?: boolean;
}

const parseJsonData = (json: string | undefined) => {
    if (!json) return undefined;
    try {
        return JSON.parse(json)?.data;
    } catch {
        return undefined;
    }
};

// Assessments carry the key in evaluation_json (auto_evaluation_json);
// flows that build questions client-side put correctOptionIds in marking_json.
const parseCorrectOptionIds = (question: Question): string[] => {
    const ids =
        parseJsonData(question.evaluation_json)?.correctOptionIds ??
        parseJsonData(question.marking_json)?.correctOptionIds;
    return Array.isArray(ids) ? ids.map(String) : [];
};

// Model answer for question types that have no options to highlight.
const parseTextAnswer = (question: Question): string => {
    const data = parseJsonData(question.evaluation_json);
    if (!data) return '';
    if (Array.isArray(data.validAnswers)) return data.validAnswers.join(', ');
    if (typeof data.answer === 'string') return data.answer;
    if (typeof data.answer?.content === 'string') return data.answer.content;
    return '';
};

interface CodingTestCase {
    id?: string;
    stdin?: string;
    expectedStdout?: string;
    visible?: boolean;
}

interface CodingData {
    problemHtml?: string;
    allowedLanguages?: string[];
    testCases?: CodingTestCase[];
}

export function QuestionComponent({
    question,
    showMarks = true,
    showCheckboxes = false,
    answerSpacing, // Added this
    showAnswers = false,
}: QuestionComponentProps) {
    const { settings, updateSettings } = useExportSettings();
    const marks = JSON.parse(question.marking_json)?.data?.totalMark || 0;
    const correctOptionIds = showAnswers ? parseCorrectOptionIds(question) : [];
    const correctOptionLetters = question.options_with_explanation
        .map((option, index) =>
            correctOptionIds.includes(String(option.id ?? index))
                ? String.fromCharCode(97 + index)
                : null
        )
        .filter(Boolean)
        .join(', ');
    const textAnswer = showAnswers ? parseTextAnswer(question) : '';
    // CODING keeps no reference solution: the key is the test cases' expected output.
    const coding: CodingData | undefined =
        question.question_type === 'CODING' ? parseJsonData(question.evaluation_json) : undefined;
    const codingTestCases = (coding?.testCases ?? []).filter(
        (testCase) => showAnswers || testCase.visible
    );
    const [base64Images, setBase64Images] = useState<{ [key: string]: string }>({});
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [aspectRatios, setAspectRatios] = useState<{ [key: string]: number }>({});
    const imageRefs = useRef<{ [key: string]: HTMLImageElement | null }>({});

    // Determine font size class
    const getFontSizeClass = () => {
        switch (settings.fontSize) {
            case 'small':
                return 'text-xs';
            case 'large':
                return 'text-base';
            default:
                return 'text-sm';
        }
    };

    // Get initial image dimensions
    const getInitialDimensions = (imageUrl: string) => {
        // If custom size is saved, use that first
        if (settings.customImageSizes && settings.customImageSizes[imageUrl]) {
            return settings.customImageSizes[imageUrl];
        }

        // If we have loaded the image and know its natural dimensions
        const imageRef = imageRefs.current[imageUrl];
        if (imageRef && imageRef.naturalWidth && imageRef.naturalHeight) {
            // Apply max constraints for reasonable sizing
            const maxWidth = 400;
            const maxHeight = 300;

            let width = imageRef.naturalWidth;
            let height = imageRef.naturalHeight;

            // Scale down if image is too large
            if (width > maxWidth) {
                const scale = maxWidth / width;
                width = maxWidth;
                height = height * scale;
            }

            if (height > maxHeight) {
                const scale = maxHeight / height;
                height = maxHeight;
                width = width * scale;
            }

            return { width, height };
        }

        // Default dimensions as fallback until image loads
        return { width: 250, height: 250 };
    };

    // Save image dimensions to settings
    const saveImageDimensions = (
        imageUrl: string,
        dimensions: { width: number; height: number }
    ) => {
        const newCustomSizes = {
            ...(settings.customImageSizes || {}),
            [imageUrl]: dimensions,
        };

        updateSettings({
            ...settings,
            customImageSizes: newCustomSizes,
        });
    };

    // Reset image to default size
    const resetImage = (e: React.MouseEvent, imageUrl: string) => {
        e.stopPropagation();

        const newCustomSizes = { ...settings.customImageSizes };
        delete newCustomSizes[imageUrl];

        updateSettings({
            ...settings,
            customImageSizes: newCustomSizes,
        });
    };

    // Calculate and store aspect ratios for images
    const calculateAspectRatio = (imageUrl: string, img: HTMLImageElement) => {
        const ratio = img.naturalWidth / img.naturalHeight;
        setAspectRatios((prev) => ({ ...prev, [imageUrl]: ratio }));
    };

    // Convert image URLs to base64
    useEffect(() => {
        const convertImagesToBase64 = async () => {
            const images = processHtmlString(question.question.content)
                .filter((item) => item.type === 'image')
                .map((item) => item.content);

            const optionImages = question.options_with_explanation.flatMap((option) =>
                processHtmlString(option.text.content)
                    .filter((item) => item.type === 'image')
                    .map((item) => item.content)
            );

            const allImages = [...images, ...optionImages];
            const base64Map: { [key: string]: string } = {};

            for (const imageUrl of allImages) {
                try {
                    const base64 = await getBase64FromUrl(imageUrl);
                    base64Map[imageUrl] = base64 as string;
                } catch (error) {
                    console.error(`Failed to convert image to base64: ${imageUrl}`, error);
                }
            }

            setBase64Images(base64Map);
        };

        convertImagesToBase64();
    }, [question]);

    // Reset selection when question changes
    useEffect(() => {
        setSelectedImage(null);
    }, [question]);

    // Render an image with resize functionality
    const renderImage = (imageUrl: string, index: number) => {
        const isSelected = selectedImage === imageUrl;
        const initialSize = getInitialDimensions(imageUrl);

        const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
            const img = e.currentTarget;
            imageRefs.current[imageUrl] = img;
            calculateAspectRatio(imageUrl, img);
        };

        return (
            <div
                key={index}
                className="relative inline-block align-middle"
                onClick={(e) => {
                    e.stopPropagation();
                    setSelectedImage(isSelected ? null : imageUrl);
                }}
            >
                <Resizable
                    size={{ width: initialSize?.width, height: initialSize?.height }}
                    onResizeStop={(e, direction, ref, d) => {
                        const newWidth = initialSize?.width ? initialSize.width + d.width : d.width;
                        const newHeight = initialSize?.height
                            ? initialSize.height + d.height
                            : d.height;
                        saveImageDimensions(imageUrl, { width: newWidth, height: newHeight });
                    }}
                    lockAspectRatio={
                        settings.maintainImageAspectRatio ? aspectRatios[imageUrl] || true : false
                    }
                    maxWidth={450}
                    maxHeight={450}
                    className={`${isSelected ? 'ring-2 ring-primary-500' : ''}`}
                    handleStyles={{
                        right: {
                            width: '6px',
                            height: '40px',
                            right: '-3px',
                            top: 'calc(50% - 20px)',
                            background: '#3b82f6',
                            borderRadius: '3px',
                            cursor: 'ew-resize',
                            visibility: isSelected ? 'visible' : 'hidden',
                        },
                        bottom: {
                            width: '40px',
                            height: '6px',
                            bottom: '-3px',
                            left: 'calc(50% - 20px)',
                            background: '#3b82f6',
                            borderRadius: '3px',
                            cursor: 'ns-resize',
                            visibility: isSelected ? 'visible' : 'hidden',
                        },
                        bottomRight: {
                            width: '12px',
                            height: '12px',
                            bottom: '-6px',
                            right: '-6px',
                            background: '#3b82f6',
                            borderRadius: '50%',
                            cursor: 'nwse-resize',
                            visibility: isSelected ? 'visible' : 'hidden',
                        },
                    }}
                    handleClasses={{
                        right: 'data-html2canvas-ignore',
                        bottom: 'data-html2canvas-ignore',
                        bottomRight: 'data-html2canvas-ignore',
                    }}
                    enable={{
                        top: false,
                        right: isSelected,
                        bottom: isSelected,
                        left: false,
                        topRight: false,
                        bottomRight: isSelected,
                        bottomLeft: false,
                        topLeft: false,
                    }}
                >
                    <img
                        src={base64Images[imageUrl] || imageUrl}
                        alt={`Question image ${index + 1}`}
                        className="size-full"
                        onLoad={handleImageLoad}
                    />

                    {/* Reset button and size indicator - will be excluded from screenshots */}
                    {isSelected && (
                        <>
                            <button
                                className="absolute right-0 top-0 z-10 rounded-full bg-white p-1 shadow-md hover:bg-gray-100"
                                onClick={(e) => resetImage(e, imageUrl)}
                            >
                                <RefreshCw size={14} />
                            </button>

                            <div className="absolute -top-7 left-0 z-10 rounded bg-primary-200 px-2 py-0.5 text-xs shadow-md">
                                {Math.round(initialSize?.width ?? 0)} ×{' '}
                                {Math.round(initialSize?.height ?? 0)}
                            </div>
                        </>
                    )}
                </Resizable>
            </div>
        );
    };

    return (
        <div className={`space-y-4 ${getFontSizeClass()}`} onClick={() => setSelectedImage(null)}>
            <div className="flex items-start justify-between gap-4">
                <div className="text-slate-800">
                    <p className="flex gap-x-1 font-bold">
                        <p className="min-w-fit">
                            Q: {question.question_order}
                            {')'}{' '}
                        </p>
                        <div className="">
                            {processHtmlString(question.question.content).map((item, index) => {
                                if (item.type === 'text') {
                                    return (
                                        <span
                                            key={index}
                                            dangerouslySetInnerHTML={{
                                                __html: item.content,
                                            }}
                                        />
                                    );
                                } else if (item.type === 'image') {
                                    return renderImage(item.content, index);
                                } else if (item.type === 'formula') {
                                    // Use dangerouslySetInnerHTML for formula elements
                                    return (
                                        <span
                                            key={`formula-${index}`}
                                            className="inline-block align-middle"
                                            dangerouslySetInnerHTML={{ __html: item.content }}
                                        />
                                    );
                                }
                                return null;
                            })}
                        </div>
                    </p>
                </div>
                {showMarks && Number(marks) > 0 && (
                    <div className="whitespace-nowrap rounded-md px-1 text-sm font-semibold text-gray-600">
                        [{marks} {Number(marks) === 1 ? 'mark' : 'marks'}]
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 pl-4">
                {question.options_with_explanation.map((option, index) => {
                    const isCorrect = correctOptionIds.includes(String(option.id ?? index));
                    return (
                        <p
                            key={option.id}
                            className={cn(
                                'flex gap-x-2 rounded-sm px-2 py-1',
                                // Multi-signal correct-answer styling: color
                                // (bg + green text) + weight (bold) + shape
                                // (2px ring) + the filled checkbox below.
                                // The ring + bold + filled box survive a B&W
                                // photocopy where the green tint would be
                                // lost, so the answer key still reads
                                // correctly after printing.
                                isCorrect &&
                                    'bg-success-50 font-semibold text-success-800 ring-2 ring-success-500'
                            )}
                        >
                            {showCheckboxes && (
                                <span
                                    aria-hidden
                                    className={cn(
                                        'mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border-2 border-black text-xs leading-none',
                                        // Print-safe inline checkbox — using
                                        // Radix Checkbox here would lose its
                                        // checked state through html2canvas
                                        // capture. A styled <span> always
                                        // renders predictably.
                                        isCorrect &&
                                            'border-primary-500 bg-primary-500 text-white'
                                    )}
                                >
                                    {isCorrect ? '✓' : ''}
                                </span>
                            )}

                            <p>
                                {String.fromCharCode(97 + index)}
                                {')'}{' '}
                            </p>
                            <div className="mr-2">
                                {processHtmlString(option.text.content).map(
                                    (item, index) => {
                                        if (item.type === 'text') {
                                            return (
                                                <span
                                                    key={
                                                        item.content.slice(
                                                            0,
                                                            10
                                                        ) + index
                                                    }
                                                    id="text-content"
                                                    dangerouslySetInnerHTML={{
                                                        __html: item.content,
                                                    }}
                                                />
                                            );
                                        } else if (item.type === 'image') {
                                            return (
                                                <img
                                                    key={index}
                                                    src={
                                                        base64Images[
                                                            item.content
                                                        ] || item.content
                                                    }
                                                    alt={`Question image ${index + 1}`}
                                                    className=""
                                                />
                                            );
                                        } else if (item.type === 'formula') {
                                            return (
                                                <span
                                                    key={`formula-${index}`}
                                                    className="inline-block align-middle"
                                                    dangerouslySetInnerHTML={{
                                                        __html: item.content,
                                                    }}
                                                />
                                            );
                                        }
                                        return null;
                                    }
                                )}
                            </div>
                        </p>
                    );
                })}
            </div>

            {coding && (
                <div className="space-y-2 pl-4">
                    {!question.question.content?.trim() && coding.problemHtml && (
                        <div dangerouslySetInnerHTML={{ __html: coding.problemHtml }} />
                    )}
                    {!!coding.allowedLanguages?.length && (
                        <p className="text-xs text-gray-600">
                            <span className="font-semibold">Languages:</span>{' '}
                            {coding.allowedLanguages.join(', ')}
                        </p>
                    )}
                    {codingTestCases.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-xs font-semibold text-gray-700">
                                {showAnswers ? 'Test cases (expected output)' : 'Sample test cases'}
                            </p>
                            <table className="w-full border-collapse text-xs">
                                <thead>
                                    <tr className="bg-gray-100 text-left">
                                        <th className="w-10 border border-gray-300 px-2 py-1">#</th>
                                        <th className="border border-gray-300 px-2 py-1">Input</th>
                                        <th className="border border-gray-300 px-2 py-1">
                                            Expected output
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {codingTestCases.map((testCase, index) => (
                                        <tr key={testCase.id ?? index} className="align-top">
                                            <td className="border border-gray-300 px-2 py-1">
                                                {index + 1}
                                                {showAnswers && !testCase.visible && (
                                                    <span className="block text-gray-500">
                                                        hidden
                                                    </span>
                                                )}
                                            </td>
                                            <td className="border border-gray-300 px-2 py-1">
                                                <pre className="whitespace-pre-wrap font-mono">
                                                    {testCase.stdin || '—'}
                                                </pre>
                                            </td>
                                            <td className="border border-gray-300 px-2 py-1">
                                                <pre className="whitespace-pre-wrap font-mono">
                                                    {testCase.expectedStdout || '—'}
                                                </pre>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {showAnswers && (correctOptionLetters || textAnswer) && (
                <div className="text-success-800 flex gap-x-2 pl-4 font-semibold">
                    <span className="min-w-fit">Ans:</span>
                    {correctOptionLetters ? (
                        <span>{correctOptionLetters}</span>
                    ) : (
                        <span dangerouslySetInnerHTML={{ __html: textAnswer }} />
                    )}
                </div>
            )}

            {showAnswers && question.explanation_text && (
                <div className="rounded-sm border-l-4 border-success-300 bg-success-50/60 px-3 py-2 text-sm italic text-success-900">
                    <span className="font-semibold not-italic">Explanation: </span>
                    <span dangerouslySetInnerHTML={{ __html: question.explanation_text }} />
                </div>
            )}

            {/* Add this for answer spacing */}
            {(question.question_type === 'LONG_ANSWER' ||
                question.question_type === 'ONE_WORD' ||
                question.question_type === 'NUMERIC') &&
                !showAnswers &&
                answerSpacing &&
                answerSpacing > 0 && (
                    <div
                        className="mt-1 border-b border-dashed border-gray-200"
                        style={{ height: `${answerSpacing}mm` }}
                    />
                )}
        </div>
    );
}
