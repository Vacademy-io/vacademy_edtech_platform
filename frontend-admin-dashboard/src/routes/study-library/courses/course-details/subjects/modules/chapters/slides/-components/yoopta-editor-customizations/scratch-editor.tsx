import { useState, useEffect, useRef } from 'react';
import { YooptaPlugin, useYooptaEditor, Elements, PluginElementRenderProps } from '@yoopta/editor';
import { useTranslation } from 'react-i18next';

export function ScratchEditor({ element, attributes, children, blockId }: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryScratchEditor');
    const editor = useYooptaEditor();
    const [scratchId, setScratchId] = useState(element?.props?.scratchId || '');
    const [activeTab, setActiveTab] = useState<'preview' | 'settings'>(
        element?.props?.activeTab || 'settings'
    );
    const isFirstRender = useRef(true);

    // Sync local state when element props change (e.g. after deserialization)
    useEffect(() => {
        const propId = element?.props?.scratchId || '';
        if (propId !== scratchId) setScratchId(propId);
    }, [element?.props?.scratchId]);

    // Persist state to Yoopta/Slate store
    // NOTE: Do NOT include Date.now() — it causes infinite re-render loops.
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        Elements.updateElement(editor, blockId, {
            type: 'scratchProject',
            props: {
                ...element.props,
                scratchId,
                activeTab,
                editorType: 'scratchEditor',
            },
        });
    }, [scratchId, activeTab]);

    // Handle backspace prevention for input fields
    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        const target = e.target as HTMLInputElement;

        // Only handle input elements
        if (!(target instanceof HTMLInputElement)) return;

        if (e.key === 'Backspace') {
            if (target.value.length > 0 || target.selectionStart !== 0) {
                return; // Allow normal Backspace behavior
            }

            // Prevent block deletion when empty and at start
            e.stopPropagation();
        }
    };

    return (
        <div
            {...attributes}
            style={{
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                padding: '20px',
                margin: '16px 0',
                backgroundColor: '#fafafa',
            }}
        >
            <div style={{ marginBottom: '16px' }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '16px',
                    }}
                >
                    <h3 style={{ margin: '0', fontSize: '18px', fontWeight: '600', color: '#333' }}>
                        🐱 {t('heading')}
                    </h3>

                    {/* Tab Navigation */}
                    <div
                        style={{
                            display: 'flex',
                            border: '1px solid #ddd',
                            borderRadius: '6px',
                            overflow: 'hidden',
                        }}
                    >
                        <button
                            onClick={() => setActiveTab('preview')}
                            style={{
                                padding: '6px 16px',
                                fontSize: '14px',
                                border: 'none',
                                backgroundColor: activeTab === 'preview' ? '#FF6B35' : 'white',
                                color: activeTab === 'preview' ? 'white' : '#666',
                                cursor: 'pointer',
                            }}
                        >
                            {t('tabs.preview')}
                        </button>
                        <button
                            onClick={() => setActiveTab('settings')}
                            style={{
                                padding: '6px 16px',
                                fontSize: '14px',
                                border: 'none',
                                backgroundColor: activeTab === 'settings' ? '#FF6B35' : 'white',
                                color: activeTab === 'settings' ? 'white' : '#666',
                                cursor: 'pointer',
                            }}
                        >
                            {t('tabs.settings')}
                        </button>
                    </div>
                </div>
            </div>

            {activeTab === 'settings' ? (
                <>
                    <div style={{ marginBottom: '20px' }}>
                        {/* Scratch Project ID */}
                        <div style={{ maxWidth: '400px' }}>
                            <label
                                style={{
                                    display: 'block',
                                    marginBottom: '6px',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: '#555',
                                }}
                            >
                                {t('form.label')}
                            </label>
                            <input
                                type="text"
                                value={scratchId}
                                onChange={(e) => setScratchId(e.target.value)}
                                placeholder={t('form.placeholder')}
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                    backgroundColor: 'white',
                                }}
                                onKeyDown={handleInputKeyDown}
                            />
                            <small
                                style={{
                                    color: '#666',
                                    fontSize: '12px',
                                    marginTop: '4px',
                                    display: 'block',
                                }}
                            >
                                {t('form.hint')}
                            </small>
                        </div>
                    </div>

                    {/* Information Panel */}
                    <div
                        style={{
                            padding: '16px',
                            backgroundColor: '#fff3e0',
                            borderRadius: '6px',
                            border: '1px solid #ffcc80',
                            marginBottom: '16px',
                        }}
                    >
                        <h4
                            style={{
                                margin: '0 0 8px 0',
                                fontSize: '14px',
                                fontWeight: '600',
                                color: '#e65100',
                            }}
                        >
                            {t('infoPanel.title')}
                        </h4>
                        <ol
                            style={{
                                margin: '0',
                                paddingLeft: '16px',
                                fontSize: '13px',
                                color: '#bf360c',
                            }}
                        >
                            <li>{t('infoPanel.step1')}</li>
                            <li>{t('infoPanel.step2')}</li>
                            <li>{t('infoPanel.step3')}</li>
                            <li>{t('infoPanel.step4')}</li>
                        </ol>
                    </div>

                    {/* Status Display */}
                    {scratchId && (
                        <div
                            style={{
                                marginTop: '16px',
                                padding: '12px',
                                backgroundColor: '#e8f5e8',
                                borderRadius: '4px',
                                fontSize: '14px',
                                color: '#2d5a2d',
                            }}
                        >
                            <strong>{t('status.ready')}</strong>{' '}
                            {t('status.readyDetail', { id: scratchId })}
                        </div>
                    )}
                </>
            ) : (
                /* Preview Mode */
                <div style={{ minHeight: '400px' }}>
                    {scratchId ? (
                        <div
                            style={{
                                width: '100%',
                                height: '500px',
                                border: '1px solid #ddd',
                                borderRadius: '6px',
                                overflow: 'hidden',
                                backgroundColor: 'white',
                            }}
                        >
                            <iframe
                                src={`https://scratch.mit.edu/projects/${scratchId}/embed`}
                                width="100%"
                                height="100%"
                                style={{ border: 'none' }}
                                title={t('preview.iframeTitle', { id: scratchId })}
                                allowFullScreen
                            />
                        </div>
                    ) : (
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '400px',
                                color: '#666',
                                backgroundColor: '#f9f9f9',
                                borderRadius: '6px',
                                border: '1px solid #ddd',
                            }}
                        >
                            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🐱</div>
                            <p style={{ fontSize: '16px', marginBottom: '8px' }}>
                                {t('preview.empty.title')}
                            </p>
                            <p style={{ fontSize: '14px', color: '#999' }}>
                                {t('preview.empty.subtitle')}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {children}

            <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    );
}

// Scratch Icon
const ScratchIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v-.07zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
            fill="currentColor"
        />
    </svg>
);

// Yoopta Plugin Definition
export const ScratchPlugin = new YooptaPlugin<{ scratchProject: any }>({
    type: 'scratchProject',
    elements: {
        scratchProject: {
            render: ScratchEditor,
        },
    },
    options: {
        display: {
            title: 'Scratch Project',
            description: 'Embed interactive Scratch projects',
            icon: <ScratchIcon />,
        },
        shortcuts: ['scratch', 'cat', 'project'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'scratchProject') {
                        return undefined;
                    }
                    const scratchId = element.getAttribute('data-scratch-id') || '';
                    const activeTab = element.getAttribute('data-active-tab') || 'settings';
                    return {
                        id: `scratch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'scratchProject',
                        props: { scratchId, activeTab, editorType: 'scratchEditor' },
                        children: [{ text: '' }],
                    };
                },
            },
            serialize: (element, children) => {
                const props = element.props || {};
                const scratchId = props.scratchId || '';
                const activeTab = props.activeTab || 'settings';

                if (!scratchId) {
                    return `<div
            data-yoopta-type="scratchProject"
            data-editor-type="scratchEditor"
            data-scratch-id="${scratchId}"
            data-active-tab="${activeTab}"
            style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 16px 0; background-color: #fafafa;"
          >
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #333;">🐱 Scratch Project</h3>
              <div style="padding: 4px 8px; background: #ff6b35; color: white; border-radius: 4px; font-size: 12px; font-weight: bold;">
                ${activeTab.toUpperCase()} MODE
              </div>
            </div>
            <div style="display: flex; align-items: center; color: #666;">
              <span style="font-size: 48px; margin-right: 16px;">🐱</span>
              <div>
                <p style="font-size: 16px; margin: 0 0 8px 0;">No Scratch project configured</p>
                <p style="font-size: 14px; color: #999; margin: 0;">Project ID needed to display Scratch project</p>
              </div>
            </div>
          </div>`;
                }

                return `<div
          data-yoopta-type="scratchProject"
          data-editor-type="scratchEditor"
          data-scratch-id="${scratchId}"
          data-active-tab="${activeTab}"
          style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 16px 0; background-color: #fafafa;"
        >
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #333;">🐱 Scratch Project</h3>
            <div style="display: flex; gap: 8px; align-items: center;">
              <div style="padding: 4px 8px; background: #ff6b35; color: white; border-radius: 4px; font-size: 12px; font-weight: bold;">
                SCRATCH EDITOR
              </div>
              <div style="padding: 4px 8px; background: ${activeTab === 'preview' ? '#28a745' : '#6c757d'}; color: white; border-radius: 4px; font-size: 12px;">
                ${activeTab.toUpperCase()} MODE
              </div>
            </div>
          </div>
          <div style="margin-bottom: 16px; padding: 12px; background: #fff3e0; border-radius: 6px; border: 1px solid #ffcc80;">
            <strong style="color: #e65100;">Project ID:</strong> <span style="color: #bf360c; font-family: monospace;">${scratchId}</span>
          </div>
          ${
              activeTab === 'preview'
                  ? `<div style="width: 100%; height: 500px; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; background-color: white;">
              <iframe src="https://scratch.mit.edu/projects/${scratchId}/embed" width="100%" height="100%" style="border: none;" title="Scratch Project ${scratchId}" allowfullscreen></iframe>
            </div>`
                  : `<div style="padding: 16px; background: #f9f9f9; border-radius: 6px; border: 1px solid #ddd; text-align: center;">
              <div style="font-size: 24px; margin-bottom: 8px;">⚙️</div>
              <p style="margin: 0; color: #666;">Settings mode - Configure Scratch project</p>
            </div>`
          }
        </div>`;
            },
        },
    },
});
