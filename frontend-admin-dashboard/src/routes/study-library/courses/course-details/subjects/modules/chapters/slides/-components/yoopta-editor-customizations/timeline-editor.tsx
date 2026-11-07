import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { YooptaPlugin, useYooptaEditor, Elements, PluginElementRenderProps } from '@yoopta/editor';
import { encodeBlockData, decodeBlockData } from './RichTextField';

interface TimelineStep {
    title: string;
    description: string;
    color: string;
}

const DEFAULT_COLORS = ['#007acc', '#28a745', '#ff6b35', '#6f42c1', '#dc3545', '#17a2b8'];

export function TimelineBlock({ element, attributes, children, blockId }: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryTimelineEditor');
    const editor = useYooptaEditor();
    const [steps, setSteps] = useState<TimelineStep[]>(
        element?.props?.steps || [
            { title: t('defaultStepTitle', { number: 1 }), description: '', color: DEFAULT_COLORS[0]! },
        ]
    );
    const [isEditing, setIsEditing] = useState(!element?.props?.steps?.length);
    const isFirstRender = useRef(true);

    // Sync local state when element props change (e.g. after deserialization)
    useEffect(() => {
        const propSteps = element?.props?.steps;
        if (propSteps && JSON.stringify(propSteps) !== JSON.stringify(steps)) {
            setSteps(propSteps);
        }
    }, [element?.props?.steps]);

    // Persist state to Yoopta/Slate store
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        Elements.updateElement(editor, blockId, {
            type: 'timeline',
            props: {
                ...element.props,
                steps,
                editorType: 'timelineEditor',
            },
        });
    }, [steps]);

    const addStep = () => {
        setSteps((prev) => [
            ...prev,
            {
                title: t('defaultStepTitle', { number: prev.length + 1 }),
                description: '',
                color: DEFAULT_COLORS[prev.length % DEFAULT_COLORS.length]!,
            },
        ]);
    };

    const removeStep = (index: number) => {
        if (steps.length <= 1) return;
        setSteps((prev) => prev.filter((_, i) => i !== index));
    };

    const updateStep = (index: number, field: keyof TimelineStep, value: string) => {
        setSteps((prev) =>
            prev.map((step, i) => (i === index ? { ...step, [field]: value } : step))
        );
    };

    const moveStep = (index: number, direction: 'up' | 'down') => {
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= steps.length) return;
        setSteps((prev) => {
            const copy = [...prev];
            const temp = copy[newIndex]!;
            copy[newIndex] = copy[index]!;
            copy[index] = temp;
            return copy;
        });
    };

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Backspace') {
            const target = e.target as HTMLInputElement | HTMLTextAreaElement;
            if (target.value.length > 0 || target.selectionStart !== 0) {
                e.stopPropagation();
            }
        }
    };

    return (
        <div
            {...attributes}
            contentEditable={false}
            style={{
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                margin: '8px 0',
                overflow: 'hidden',
                backgroundColor: '#fafafa',
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    backgroundColor: '#f0f0f0',
                    borderBottom: '1px solid #e0e0e0',
                }}
            >
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#333' }}>
                    {t('blockLabel')}
                </span>
                <button
                    onClick={() => setIsEditing(!isEditing)}
                    style={{
                        padding: '3px 10px',
                        fontSize: '12px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        backgroundColor: 'white',
                        color: '#666',
                        cursor: 'pointer',
                    }}
                >
                    {isEditing ? t('preview') : t('edit')}
                </button>
            </div>

            <div style={{ padding: '16px' }}>
                {isEditing ? (
                    /* Edit mode */
                    <div>
                        {steps.map((step, index) => (
                            <div
                                key={index}
                                style={{
                                    display: 'flex',
                                    gap: '8px',
                                    marginBottom: '12px',
                                    padding: '10px',
                                    backgroundColor: '#fff',
                                    borderRadius: '6px',
                                    border: '1px solid #eee',
                                }}
                            >
                                {/* Step number + color */}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                    <div
                                        style={{
                                            width: '28px',
                                            height: '28px',
                                            borderRadius: '50%',
                                            backgroundColor: step.color,
                                            color: 'white',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '12px',
                                            fontWeight: 700,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {index + 1}
                                    </div>
                                    {/* Color picker */}
                                    <input
                                        type="color"
                                        value={step.color}
                                        onChange={(e) => updateStep(index, 'color', e.target.value)}
                                        style={{ width: '28px', height: '20px', border: 'none', cursor: 'pointer', padding: 0 }}
                                    />
                                </div>

                                {/* Title & description */}
                                <div style={{ flex: 1 }}>
                                    <input
                                        type="text"
                                        value={step.title}
                                        onChange={(e) => updateStep(index, 'title', e.target.value)}
                                        onKeyDown={handleInputKeyDown}
                                        placeholder={t('stepTitlePlaceholder')}
                                        style={{
                                            width: '100%',
                                            padding: '4px 8px',
                                            border: '1px solid #ddd',
                                            borderRadius: '4px',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            marginBottom: '4px',
                                        }}
                                    />
                                    <textarea
                                        value={step.description}
                                        onChange={(e) => updateStep(index, 'description', e.target.value)}
                                        onKeyDown={handleInputKeyDown}
                                        placeholder={t('stepDescriptionPlaceholder')}
                                        rows={2}
                                        style={{
                                            width: '100%',
                                            padding: '4px 8px',
                                            border: '1px solid #ddd',
                                            borderRadius: '4px',
                                            fontSize: '13px',
                                            resize: 'vertical',
                                        }}
                                    />
                                </div>

                                {/* Actions */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <button
                                        onClick={() => moveStep(index, 'up')}
                                        disabled={index === 0}
                                        style={{ padding: '2px 6px', fontSize: '11px', border: '1px solid #ddd', borderRadius: '3px', cursor: index === 0 ? 'default' : 'pointer', opacity: index === 0 ? 0.3 : 1, backgroundColor: '#fff' }}
                                    >
                                        ↑
                                    </button>
                                    <button
                                        onClick={() => moveStep(index, 'down')}
                                        disabled={index === steps.length - 1}
                                        style={{ padding: '2px 6px', fontSize: '11px', border: '1px solid #ddd', borderRadius: '3px', cursor: index === steps.length - 1 ? 'default' : 'pointer', opacity: index === steps.length - 1 ? 0.3 : 1, backgroundColor: '#fff' }}
                                    >
                                        ↓
                                    </button>
                                    <button
                                        onClick={() => removeStep(index)}
                                        disabled={steps.length <= 1}
                                        style={{ padding: '2px 6px', fontSize: '11px', border: '1px solid #ddd', borderRadius: '3px', cursor: steps.length <= 1 ? 'default' : 'pointer', opacity: steps.length <= 1 ? 0.3 : 1, backgroundColor: '#fff', color: '#dc3545' }}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ))}

                        <button
                            onClick={addStep}
                            style={{
                                padding: '6px 14px',
                                fontSize: '13px',
                                border: '1px dashed #ccc',
                                borderRadius: '6px',
                                backgroundColor: '#fff',
                                color: '#666',
                                cursor: 'pointer',
                                width: '100%',
                            }}
                        >
                            {t('addStep')}
                        </button>
                    </div>
                ) : (
                    /* Preview mode — vertical timeline */
                    <div style={{ position: 'relative', paddingLeft: '32px' }}>
                        {/* Vertical line */}
                        <div
                            style={{
                                position: 'absolute',
                                left: '13px',
                                top: '14px',
                                bottom: '14px',
                                width: '2px',
                                backgroundColor: '#ddd',
                            }}
                        />

                        {steps.map((step, index) => (
                            <div
                                key={index}
                                style={{
                                    position: 'relative',
                                    marginBottom: index < steps.length - 1 ? '24px' : '0',
                                }}
                            >
                                {/* Node */}
                                <div
                                    style={{
                                        position: 'absolute',
                                        left: '-25px',
                                        top: '2px',
                                        width: '24px',
                                        height: '24px',
                                        borderRadius: '50%',
                                        backgroundColor: step.color,
                                        color: 'white',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        zIndex: 1,
                                    }}
                                >
                                    {index + 1}
                                </div>
                                {/* Content */}
                                <div>
                                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#333', marginBottom: '2px' }}>
                                        {step.title}
                                    </div>
                                    {step.description && (
                                        <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.5 }}>
                                            {step.description}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {children}
        </div>
    );
}

// Timeline icon
const TimelineIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="2" x2="12" y2="22" />
        <circle cx="12" cy="6" r="3" fill="currentColor" />
        <circle cx="12" cy="14" r="3" fill="currentColor" />
        <line x1="15" y1="6" x2="22" y2="6" />
        <line x1="15" y1="14" x2="22" y2="14" />
    </svg>
);

// Helper to serialize steps to visual HTML
function serializeTimelineHtml(steps: TimelineStep[]): string {
    const esc = (v: unknown) =>
        String(v ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const stepsHtml = steps.map((step, i) => {
        const titleEsc = esc(step?.title);
        const descEsc = esc(step?.description);
        const color = step?.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] || DEFAULT_COLORS[0];
        return `<div style="position: relative; margin-bottom: ${i < steps.length - 1 ? '24px' : '0'}; padding-left: 32px;">
      <div style="position: absolute; left: 0; top: 2px; width: 24px; height: 24px; border-radius: 50%; background-color: ${color}; color: white; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; z-index: 1;">${i + 1}</div>
      <div style="font-size: 15px; font-weight: 600; color: #333; margin-bottom: 2px;">${titleEsc}</div>
      ${descEsc ? `<div style="font-size: 13px; color: #666; line-height: 1.5;">${descEsc}</div>` : ''}
    </div>`;
    }).join('');

    return stepsHtml;
}

// Yoopta Plugin Definition
export const TimelinePlugin = new YooptaPlugin<{ timeline: any }>({
    type: 'timeline',
    elements: {
        timeline: {
            render: TimelineBlock,
        },
    },
    options: {
        display: {
            title: 'Timeline / Steps',
            description: 'Add a step-by-step timeline',
            icon: <TimelineIcon />,
        },
        shortcuts: ['timeline', 'steps', 'process', 'flow'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'timeline') {
                        return undefined;
                    }
                    // decodeBlockData handles both the new base64 payload and any
                    // older escaped-JSON data-steps. Normalize every step so a
                    // missing title/description can never make serialize throw.
                    const raw = decodeBlockData<TimelineStep[]>(
                        element.getAttribute('data-steps'),
                        []
                    );
                    let steps: TimelineStep[] = (Array.isArray(raw) ? raw : []).map((s, i) => ({
                        title: String(s?.title ?? ''),
                        description: String(s?.description ?? ''),
                        color: s?.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] || DEFAULT_COLORS[0]!,
                    }));
                    if (steps.length === 0) {
                        steps = [{ title: 'Step 1', description: '', color: DEFAULT_COLORS[0]! }];
                    }
                    return {
                        id: `timeline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'timeline',
                        props: { steps, editorType: 'timelineEditor' },
                        children: [{ text: '' }],
                    };
                },
            },
            serialize: (element, _children) => {
                // Bulletproof: must NEVER throw, or the whole-document Save aborts
                // ("Could not read editor content") and the per-block fallback
                // silently drops this block. data-steps (source of truth) is
                // base64 so the document-wide HTML sanitizers can't corrupt it.
                let steps: TimelineStep[] = [];
                try {
                    const props = (element && element.props) || {};
                    steps = Array.isArray(props.steps) ? props.steps : [];
                } catch {
                    steps = [];
                }
                let stepsJson = '';
                let visualHtml = '';
                try {
                    stepsJson = encodeBlockData(steps);
                } catch {
                    stepsJson = encodeBlockData([]);
                }
                try {
                    visualHtml = serializeTimelineHtml(steps);
                } catch {
                    visualHtml = '';
                }
                return `<div data-yoopta-type="timeline" data-editor-type="timelineEditor" data-steps="${stepsJson}" style="position: relative; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 8px 0; background: #fafafa;"><div style="position: absolute; left: 29px; top: 32px; bottom: 32px; width: 2px; background-color: #ddd;"></div>${visualHtml}</div>`;
            },
        },
    },
});
