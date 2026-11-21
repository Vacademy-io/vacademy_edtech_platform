import useFabric, { EvaluationTool } from './canvas';
import {
    Check,
    Trash as Trash2,
    TextT as Type,
    X,
    Pen,
    Circle,
    Rectangle,
    Cursor,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

// Takes the SAME canvasUtils instance the caller already created (rather than
// building its own via useFabric) so the toolbar's active-tool state and the
// tool actions below always agree on what's currently armed.
const useCanvasTools = (canvasUtils: ReturnType<typeof useFabric>) => {
    const { t } = useTranslation('evaluationTools');
    const tools: {
        key: EvaluationTool;
        icon: typeof Cursor;
        label: string;
        color: string;
        action: () => void;
    }[] = [
        {
            key: 'select',
            icon: Cursor,
            label: t('select'),
            color: 'text-neutral-600',
            action: () => {
                canvasUtils.enableSelection();
            },
        },
        {
            key: 'pen',
            icon: Pen,
            label: t('pen'),
            color: 'text-green-600',
            action: () => {
                canvasUtils.addPenTool();
            },
        },
        {
            key: 'tick',
            icon: Check,
            label: t('tick'),
            color: 'text-green-600',
            action: () => {
                canvasUtils.addTick();
            },
        },
        {
            key: 'cross',
            icon: X,
            label: t('cross'),
            color: 'text-red-600',
            action: () => {
                canvasUtils.addCross();
            },
        },
        {
            key: 'text',
            icon: Type,
            label: t('text'),
            color: 'text-black',
            action: () => {
                canvasUtils.addTextBox();
            },
        },
        {
            key: 'box',
            icon: Rectangle,
            label: t('box'),
            color: 'text-black',
            action: () => {
                canvasUtils.addRectangle();
            },
        },
        {
            key: 'circle',
            icon: Circle,
            label: t('circle'),
            color: 'text-black',
            action: () => {
                canvasUtils.addCircle();
            },
        },
    ];

    const deleteTool = {
        icon: Trash2,
        label: t('delete'),
        color: 'text-red-600',
        action: () => {
            canvasUtils.deleteSelectedShape();
        },
    };

    const numbers = [
        ...Array.from({ length: 10 }, (_, i) => ({
            value: i.toString(),
            action: () => canvasUtils.addNumber(i.toString()),
        })),
        { value: '1/2', action: () => canvasUtils.addNumber('1/2') },
        { value: '3/4', action: () => canvasUtils.addNumber('3/4') },
        { value: '0.25', action: () => canvasUtils.addNumber('0.25') },
        { value: '0.5', action: () => canvasUtils.addNumber('0.5') },
        { value: '0.75', action: () => canvasUtils.addNumber('0.75') },
        { value: '/', action: () => canvasUtils.addNumber('/') },
        { value: '-', action: () => canvasUtils.addNumber('-') },
        { value: '.', action: () => canvasUtils.addNumber('.') },
    ];

    return { tools, deleteTool, numbers };
};

export default useCanvasTools;
