import React, { useEffect, useMemo, useState } from 'react';
import { Button, Collapse, Drawer, Grid, Space, Tooltip } from '@arco-design/web-react';
import Editor from '@monaco-editor/react';
import { AdvancedType, BasicType } from 'easy-email-core';
import {
    IconFont,
    Stack,
    TextStyle,
    useBlock,
    useEditorContext,
    useFocusIdx,
} from 'easy-email-editor';
import {
    Align,
    AttributesPanelWrapper,
    BlockAttributeConfigurationManager,
    ClassName,
    Color,
    ContainerBackgroundColor,
    FontFamily,
    FontSize,
    FontStyle,
    FontWeight,
    Height,
    InputWithUnitField,
    LetterSpacing,
    LineHeight,
    Padding,
    ShadowDom,
    TextDecoration,
    TextField,
} from 'easy-email-extensions';

/**
 * Attribute panel for the Text block: the library's own panel plus a "Border" section.
 *
 * easy-email-extensions ships its panels as closed components (and bundles its own copy
 * of arco, so its CollapseWrapper can't host an extra Collapse.Item from ours), which is
 * why the sections are rebuilt here from the exported attribute components rather than
 * wrapped. The rendering side of the border lives in textBorderFrame.ts.
 */

// Same widget as the Image block's Border section, so admins meet one convention.
function BorderSection() {
    const { focusIdx } = useFocusIdx();
    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            <Grid.Row>
                <Grid.Col span={11}>
                    <TextField
                        label="Border"
                        name={`${focusIdx}.attributes.border`}
                        helpText="e.g. 1px solid #cccccc"
                    />
                </Grid.Col>
                <Grid.Col offset={1} span={11}>
                    <InputWithUnitField
                        label="Border radius"
                        name={`${focusIdx}.attributes.border-radius`}
                        unitOptions="percent"
                    />
                </Grid.Col>
            </Grid.Row>
            {/* Space between the border and the text; the block's Padding stays outside the border. */}
            <Padding title="Inner padding" attributeName="inner-padding" />
        </Space>
    );
}

// Rebuild of the library's "Html mode" drawer: raw HTML on the left, live preview on the right.
function HtmlModeDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const { focusBlock, setValueByIdx } = useBlock();
    const { pageData } = useEditorContext();
    const { focusIdx } = useFocusIdx();
    const [content, setContent] = useState<string>(focusBlock?.data.value.content ?? '');

    useEffect(() => {
        setContent(focusBlock?.data.value.content ?? '');
    }, [focusBlock?.data.value.content]);

    const onSave = () => {
        if (!focusBlock) return;
        setValueByIdx(focusIdx, {
            ...focusBlock,
            data: { ...focusBlock.data, value: { ...focusBlock.data.value, content } },
        });
        onClose();
    };

    const previewStyle = useMemo<React.CSSProperties>(() => {
        const attributes = focusBlock?.attributes ?? {};
        const page = pageData.data.value;
        return {
            color: attributes.color || page['text-color'],
            fontSize: attributes['font-size'] || page['font-size'],
            fontFamily: attributes['font-family'] || page['font-family'],
            fontWeight: attributes['font-weight'] || page['font-weight'],
            backgroundColor: attributes['container-background-color'],
            padding: attributes.padding,
            width: pageData.attributes.width || '600px',
            margin: 'auto',
        };
    }, [focusBlock?.attributes, pageData]);

    return (
        <Drawer
            placement="left"
            width="100vw"
            visible={visible}
            closable={false}
            escToExit={false}
            footer={null}
            headerStyle={{ display: 'block', lineHeight: '48px' }}
            bodyStyle={{ padding: 0, overflow: 'hidden' }}
            title={
                <Stack distribution="equalSpacing">
                    <TextStyle variation="strong" size="large">
                        Html
                    </TextStyle>
                    <Stack>
                        <Button onClick={onClose}>Cancel</Button>
                        <Button type="primary" onClick={onSave}>
                            Save
                        </Button>
                    </Stack>
                </Stack>
            }
        >
            <div style={{ display: 'flex', height: '100%' }}>
                <div style={{ flex: 1, height: '100%' }}>
                    <Editor
                        height="100%"
                        language="html"
                        theme="vs-dark"
                        value={content}
                        onChange={(value) => setContent(value ?? '')}
                        options={{ minimap: { enabled: false }, wordWrap: 'on' }}
                    />
                </div>
                <div style={{ flex: 1, height: '100%', overflow: 'auto', marginRight: 10 }}>
                    <ShadowDom style={previewStyle}>
                        <div dangerouslySetInnerHTML={{ __html: content }} />
                    </ShadowDom>
                </div>
            </div>
        </Drawer>
    );
}

function TextAttributePanel() {
    const [htmlModeVisible, setHtmlModeVisible] = useState(false);

    return (
        <AttributesPanelWrapper
            extra={
                <Tooltip content="Html mode">
                    <Button
                        onClick={() => setHtmlModeVisible(true)}
                        icon={<IconFont iconName="icon-html" />}
                    />
                </Tooltip>
            }
        >
            {/* Bottom room so the last section can scroll clear of the panel edge, as the library's does. */}
            <Collapse
                defaultActiveKey={['dimension', 'color', 'typography', 'border']}
                style={{ marginBottom: 72 }}
            >
                <Collapse.Item name="dimension" header="Dimension">
                    <Space direction="vertical" style={{ width: '100%' }}>
                        <Height />
                        <Padding showResetAll />
                    </Space>
                </Collapse.Item>
                <Collapse.Item name="color" header="Color">
                    <Grid.Row>
                        <Grid.Col span={11}>
                            <Color />
                        </Grid.Col>
                        <Grid.Col offset={1} span={11}>
                            <ContainerBackgroundColor title="Background color" />
                        </Grid.Col>
                    </Grid.Row>
                </Collapse.Item>
                <Collapse.Item name="typography" header="Typography">
                    <Space direction="vertical" style={{ width: '100%' }}>
                        <Grid.Row>
                            <Grid.Col span={11}>
                                <FontFamily />
                            </Grid.Col>
                            <Grid.Col offset={1} span={11}>
                                <FontSize />
                            </Grid.Col>
                        </Grid.Row>
                        <Grid.Row>
                            <Grid.Col span={11}>
                                <LineHeight />
                            </Grid.Col>
                            <Grid.Col offset={1} span={11}>
                                <LetterSpacing />
                            </Grid.Col>
                        </Grid.Row>
                        <Grid.Row>
                            <Grid.Col span={11}>
                                <TextDecoration />
                            </Grid.Col>
                            <Grid.Col offset={1} span={11}>
                                <FontWeight />
                            </Grid.Col>
                        </Grid.Row>
                        <Align />
                        <FontStyle />
                    </Space>
                </Collapse.Item>
                <Collapse.Item name="border" header="Border">
                    <BorderSection />
                </Collapse.Item>
                <Collapse.Item name="extra" header="Extra">
                    <Grid.Col span={24}>
                        <ClassName />
                    </Grid.Col>
                </Collapse.Item>
            </Collapse>
            <HtmlModeDrawer visible={htmlModeVisible} onClose={() => setHtmlModeVisible(false)} />
        </AttributesPanelWrapper>
    );
}

let registered = false;

/** Replaces the library's Text panel (basic and advanced variants). Idempotent. */
export function registerTextAttributePanel(): void {
    if (registered) return;
    registered = true;
    BlockAttributeConfigurationManager.add({
        [BasicType.TEXT]: TextAttributePanel,
        [AdvancedType.TEXT]: TextAttributePanel,
    });
}
