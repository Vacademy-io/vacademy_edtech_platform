import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { YooptaPlugin, useYooptaEditor, Elements, PluginElementRenderProps } from '@yoopta/editor';

export function JupyterNotebook({
    element,
    attributes,
    children,
    blockId,
}: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryJupyterNotebook');
    const editor = useYooptaEditor();
    const [projectName, setProjectName] = useState(element?.props?.projectName || '');
    const [contentUrl, setContentUrl] = useState(element?.props?.contentUrl || '');
    const [contentBranch, setContentBranch] = useState(element?.props?.contentBranch || 'main');
    const [notebookLocation, setNotebookLocation] = useState(
        element?.props?.notebookLocation || 'root'
    );
    const [isDeploying, setIsDeploying] = useState(false);
    const [activeTab, setActiveTab] = useState<'preview' | 'settings'>(
        element?.props?.activeTab || 'settings'
    );

    const isFirstRender = useRef(true);

    // Sync local state when element props change (e.g. after deserialization)
    useEffect(() => {
        const propName = element?.props?.projectName || '';
        const propUrl = element?.props?.contentUrl || '';
        const propBranch = element?.props?.contentBranch || 'main';
        const propLocation = element?.props?.notebookLocation || 'root';
        if (propName !== projectName) setProjectName(propName);
        if (propUrl !== contentUrl) setContentUrl(propUrl);
        if (propBranch !== contentBranch) setContentBranch(propBranch);
        if (propLocation !== notebookLocation) setNotebookLocation(propLocation);
    }, [element?.props?.projectName, element?.props?.contentUrl, element?.props?.contentBranch, element?.props?.notebookLocation]);

    // Sync with Yoopta block state - save complete editor state
    // NOTE: Do NOT include Date.now() — it causes infinite re-render loops.
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        Elements.updateElement(editor, blockId, {
            type: 'jupyterNotebook',
            props: {
                ...element.props,
                projectName,
                contentUrl,
                contentBranch,
                notebookLocation,
                activeTab,
                editorType: 'jupyterEditor',
            },
        });
    }, [projectName, contentUrl, contentBranch, notebookLocation, activeTab]);

    const handleDeploy = () => {
        if (!projectName || !contentUrl) {
            alert(t('alerts.fillRequired'));
            return;
        }

        setIsDeploying(true);
        // Simulate deployment process
        setTimeout(() => {
            setIsDeploying(false);
            alert(t('alerts.deploySuccess'));
        }, 3000);
    };

    // Handle backspace prevention for input fields
    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        const target = e.target as HTMLInputElement;

        // Only handle input elements (not select)
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
            {/*
              Non-editable island. This block renders native <input>/<select>
              controls and static labels *inside* Slate's contentEditable region.
              Without contentEditable={false}, two things break:
                1. Typing in a field fires a native `beforeinput` that bubbles to
                   Slate's editable handler, which calls toSlatePoint on the
                   input's DOM node (not in Slate's model) and throws
                   "Cannot resolve a Slate point from DOM point" on every keystroke.
                2. Slate treats the labels as editable document text, so clicking a
                   label and typing corrupts it (e.g. "notebook" -> "noteboasdfok").
              Marking this subtree non-editable makes Slate's hasEditableTarget
              check bail out, fixing both. The `{children}` text anchor Slate
              requires is kept OUTSIDE this wrapper so Slate still manages it.
            */}
            <div contentEditable={false} suppressContentEditableWarning>
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
                        📓 {t('header.configuration')}
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
                                backgroundColor: activeTab === 'preview' ? '#007acc' : 'white',
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
                                backgroundColor: activeTab === 'settings' ? '#007acc' : 'white',
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
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '16px',
                            marginBottom: '20px',
                        }}
                    >
                        {/* Project Name */}
                        <div>
                            <label
                                style={{
                                    display: 'block',
                                    marginBottom: '6px',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: '#555',
                                }}
                            >
                                {t('form.projectName.label')}
                            </label>
                            <input
                                type="text"
                                value={projectName}
                                onChange={(e) => setProjectName(e.target.value)}
                                placeholder={t('form.projectName.placeholder')}
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
                        </div>

                        {/* Content URL */}
                        <div>
                            <label
                                style={{
                                    display: 'block',
                                    marginBottom: '6px',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: '#555',
                                }}
                            >
                                {t('form.contentUrl.label')}
                            </label>
                            <input
                                type="url"
                                value={contentUrl}
                                onChange={(e) => setContentUrl(e.target.value)}
                                placeholder={t('form.contentUrl.placeholder')}
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
                        </div>

                        {/* Content Branch */}
                        <div>
                            <label
                                style={{
                                    display: 'block',
                                    marginBottom: '6px',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: '#555',
                                }}
                            >
                                {t('form.contentBranch.label')}
                            </label>
                            <select
                                value={contentBranch}
                                onChange={(e) => setContentBranch(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                    backgroundColor: 'white',
                                }}
                                onKeyDown={handleInputKeyDown}
                            >
                                <option value="main">main</option>
                                <option value="master">master</option>
                                <option value="develop">develop</option>
                                <option value="staging">staging</option>
                            </select>
                        </div>

                        {/* Notebook Location */}
                        <div>
                            <label
                                style={{
                                    display: 'block',
                                    marginBottom: '6px',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: '#555',
                                }}
                            >
                                {t('form.notebookLocation.label')}
                            </label>
                            <select
                                value={notebookLocation}
                                onChange={(e) => setNotebookLocation(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                    backgroundColor: 'white',
                                }}
                                onKeyDown={handleInputKeyDown}
                            >
                                <option value="root">root</option>
                                <option value="notebooks">notebooks</option>
                                <option value="src">src</option>
                                <option value="examples">examples</option>
                            </select>
                        </div>
                    </div>

                    {/* Deploy Button */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '16px',
                            backgroundColor: '#f5f5f5',
                            borderRadius: '6px',
                            border: '1px solid #e0e0e0',
                        }}
                    >
                        <button
                            onClick={handleDeploy}
                            disabled={isDeploying || !projectName || !contentUrl}
                            style={{
                                padding: '12px 24px',
                                fontSize: '14px',
                                fontWeight: '500',
                                borderRadius: '6px',
                                border: 'none',
                                backgroundColor: isDeploying ? '#f0f0f0' : '#007acc',
                                color: isDeploying ? '#666' : 'white',
                                cursor:
                                    isDeploying || !projectName || !contentUrl
                                        ? 'not-allowed'
                                        : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'background-color 0.2s ease',
                            }}
                        >
                            {isDeploying ? (
                                <>
                                    <div
                                        style={{
                                            width: '16px',
                                            height: '16px',
                                            border: '2px solid #666',
                                            borderTop: '2px solid transparent',
                                            borderRadius: '50%',
                                            animation: 'spin 1s linear infinite',
                                        }}
                                    />
                                    {t('deploy.deploying')}
                                </>
                            ) : (
                                <>🚀 {t('deploy.button')}</>
                            )}
                        </button>
                    </div>

                    {/* Status Display */}
                    {projectName && contentUrl && (
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
                            <strong>{t('status.readyToDeploy')}</strong> {t('status.summary', {
                                projectName,
                                contentUrl,
                                contentBranch,
                                notebookLocation,
                            })}
                        </div>
                    )}
                </>
            ) : (
                /* Preview Mode */
                <div style={{ minHeight: '400px' }}>
                    {projectName && contentUrl ? (
                        <div
                            style={{
                                width: '100%',
                                height: '500px',
                                border: '1px solid #ddd',
                                borderRadius: '6px',
                                overflow: 'hidden',
                            }}
                        >
                            <iframe
                                src={`https://mybinder.org/v2/gh/${contentUrl.replace('https://github.com/', '')}/${contentBranch}?labpath=${notebookLocation}`}
                                width="100%"
                                height="100%"
                                style={{ border: 'none' }}
                                title={t('preview.iframeTitle')}
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
                            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📓</div>
                            <p style={{ fontSize: '16px', marginBottom: '8px' }}>
                                {t('preview.notConfigured')}
                            </p>
                            <p style={{ fontSize: '14px', color: '#999' }}>
                                {t('preview.switchToSettingsHint')}
                            </p>
                        </div>
                    )}
                </div>
            )}
            </div>
            {/* end non-editable island */}

            {/* Slate requires {children} in the DOM for the block to stay valid,
                but Yoopta paints its default "Type / for commands" placeholder
                over it. Keep it mounted but visually hidden — same pattern as
                tabs-editor / mermaid-editor / table-of-contents. */}
            <div
                aria-hidden
                className="pointer-events-none absolute size-0 overflow-hidden opacity-0"
            >
                {children}
            </div>

            <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    );
}

// Jupyter Notebook Icon
const JupyterIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
            d="M12 2L2 7v10l10 5 10-5V7l-10-5zM12 4.3l7.5 3.75L12 11.8 4.5 8.05 12 4.3zM4 9.5l7 3.5v7.5l-7-3.5V9.5zm16 0v7.5l-7 3.5V13l7-3.5z"
            fill="currentColor"
        />
    </svg>
);

// Yoopta Plugin Definition
export const JupyterNotebookPlugin = new YooptaPlugin<{ jupyterNotebook: any }>({
    type: 'jupyterNotebook',
    elements: {
        jupyterNotebook: {
            render: JupyterNotebook,
        },
    },
    options: {
        display: {
            title: 'Jupyter Notebook',
            description: 'Interactive Jupyter notebook configuration',
            icon: <JupyterIcon />,
        },
        shortcuts: ['jupyter', 'notebook', 'ipynb'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'jupyterNotebook') {
                        return undefined;
                    }
                    const projectName = element.getAttribute('data-project-name') || '';
                    const contentUrl = element.getAttribute('data-content-url') || '';
                    const contentBranch = element.getAttribute('data-content-branch') || 'main';
                    const notebookLocation = element.getAttribute('data-notebook-location') || 'root';
                    const activeTab = element.getAttribute('data-active-tab') || 'settings';
                    return {
                        id: `jupyter-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'jupyterNotebook',
                        props: { projectName, contentUrl, contentBranch, notebookLocation, activeTab, editorType: 'jupyterEditor' },
                        children: [{ text: '' }],
                    };
                },
            },
            serialize: (element, children) => {
                const props = element.props || {};
                const projectName = props.projectName || '';
                const contentUrl = props.contentUrl || '';
                const contentBranch = props.contentBranch || 'main';
                const notebookLocation = props.notebookLocation || 'root';
                const activeTab = props.activeTab || 'settings';

                if (!projectName || !contentUrl) {
                    return `<div
            data-yoopta-type="jupyterNotebook"
            data-editor-type="jupyterEditor"
            data-project-name="${projectName}"
            data-content-url="${contentUrl}"
            data-content-branch="${contentBranch}"
            data-notebook-location="${notebookLocation}"
            data-active-tab="${activeTab}"
            style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 16px 0; background-color: #fafafa;"
          >
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #333;">📓 Jupyter Notebook Configuration</h3>
              <div style="padding: 4px 8px; background: #007acc; color: white; border-radius: 4px; font-size: 12px; font-weight: bold;">
                ${activeTab.toUpperCase()} MODE
              </div>
            </div>
            <div style="display: flex; align-items: center; color: #666;">
              <span style="font-size: 48px; margin-right: 16px;">📓</span>
              <div>
                <p style="font-size: 16px; margin: 0 0 8px 0;">No notebook configured</p>
                <p style="font-size: 14px; color: #999; margin: 0;">Project name and content URL needed to display Jupyter notebook</p>
              </div>
            </div>
          </div>`;
                }

                const binderUrl = `https://mybinder.org/v2/gh/${contentUrl.replace('https://github.com/', '')}/${contentBranch}?labpath=${notebookLocation}`;

                return `<div
          data-yoopta-type="jupyterNotebook"
          data-editor-type="jupyterEditor"
          data-project-name="${projectName}"
          data-content-url="${contentUrl}"
          data-content-branch="${contentBranch}"
          data-notebook-location="${notebookLocation}"
          data-active-tab="${activeTab}"
          style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 16px 0; background-color: #fafafa;"
        >
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #333;">📓 Jupyter Notebook: ${projectName}</h3>
            <div style="display: flex; gap: 8px; align-items: center;">
              <div style="padding: 4px 8px; background: #007acc; color: white; border-radius: 4px; font-size: 12px; font-weight: bold;">
                JUPYTER EDITOR
              </div>
              <div style="padding: 4px 8px; background: ${activeTab === 'preview' ? '#28a745' : '#6c757d'}; color: white; border-radius: 4px; font-size: 12px;">
                ${activeTab.toUpperCase()} MODE
              </div>
            </div>
          </div>
          <div style="margin-bottom: 16px; padding: 12px; background: #e8f5e8; border-radius: 4px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 14px; color: #2d5a2d;">
              <div><strong>Repository:</strong> ${contentUrl}</div>
              <div><strong>Branch:</strong> ${contentBranch}</div>
              <div><strong>Location:</strong> ${notebookLocation}</div>
              <div><strong>Status:</strong> Ready to deploy</div>
            </div>
          </div>
          ${
              activeTab === 'preview'
                  ? `<div style="width: 100%; height: 500px; border: 1px solid #ddd; border-radius: 6px; overflow: hidden;">
              <iframe src="${binderUrl}" width="100%" height="100%" style="border: none;" title="Jupyter Notebook Preview"></iframe>
            </div>`
                  : `<div style="padding: 16px; background: #f9f9f9; border-radius: 6px; border: 1px solid #ddd; text-align: center;">
              <div style="font-size: 24px; margin-bottom: 8px;">⚙️</div>
              <p style="margin: 0; color: #666;">Settings mode - Configure Jupyter notebook</p>
            </div>`
          }
        </div>`;
            },
        },
    },
});
