import { Link } from '@tanstack/react-router';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface AccessPassGridEditorProps {
    component: { id: string; props: Record<string, any> };
    pageId: string;
    updateComponent: (pageId: string, componentId: string, patch: { props: Record<string, any> }) => void;
}

/**
 * Property panel of the `accessPassGrid` section: published access passes as cards,
 * optionally only those carrying one tag. Passes themselves are managed in
 * LMS → Access Passes; the section reads them live.
 */
export function AccessPassGridEditor({ component, pageId, updateComponent }: AccessPassGridEditorProps) {
    const props = component.props || {};
    const updateProp = (key: string, value: unknown) =>
        updateComponent(pageId, component.id, { props: { ...props, [key]: value } });

    return (
        <div className="flex flex-col gap-4">
            <div className="grid gap-1.5">
                <Label className="text-xs">Title</Label>
                <Input value={props.title ?? ''} onChange={(e) => updateProp('title', e.target.value)} />
            </div>
            <div className="grid gap-1.5">
                <Label className="text-xs">Subtitle</Label>
                <Input value={props.subtitle ?? ''} onChange={(e) => updateProp('subtitle', e.target.value)} />
            </div>
            <div className="grid gap-1.5">
                <Label className="text-xs">Only passes tagged (optional)</Label>
                <Input
                    value={props.tag ?? ''}
                    placeholder="e.g. NEET"
                    onChange={(e) => updateProp('tag', e.target.value)}
                />
                <p className="text-2xs text-neutral-500">Leave empty to show every published pass.</p>
            </div>
            <div className="grid gap-1.5">
                <Label className="text-xs">Columns (desktop)</Label>
                <Input
                    type="number"
                    min={2}
                    max={4}
                    value={props.columns ?? 3}
                    onChange={(e) => updateProp('columns', Math.min(4, Math.max(2, Number(e.target.value) || 3)))}
                />
            </div>
            <div className="grid gap-1.5">
                <Label className="text-xs">Button label</Label>
                <Input
                    value={props.buyLabel ?? ''}
                    placeholder="Get the pass"
                    onChange={(e) => updateProp('buyLabel', e.target.value)}
                />
            </div>
            <div className="flex items-center justify-between">
                <Label className="text-xs">Show included courses on the card</Label>
                <Switch
                    checked={props.showCourses !== false}
                    onCheckedChange={(v) => updateProp('showCourses', v)}
                />
            </div>
            <div className="flex items-center justify-between">
                <Label className="text-xs">Show price</Label>
                <Switch checked={props.showPrice !== false} onCheckedChange={(v) => updateProp('showPrice', v)} />
            </div>
            <p className="text-2xs text-neutral-500">
                Manage passes in{' '}
                <Link to="/access-passes" className="underline">
                    Access Passes
                </Link>
                . Only published passes appear on the site.
            </p>
        </div>
    );
}
