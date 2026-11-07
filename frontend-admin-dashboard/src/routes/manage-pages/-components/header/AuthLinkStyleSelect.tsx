import { HeaderChoice } from './HeaderEditorFields';
import type { AuthLinkStyle } from './header-editor-utils';

type Choice = AuthLinkStyle | 'auto';

/**
 * Look of one header button. "Automatic" stores nothing and keeps the
 * original rule (first button filled, the others outlined).
 */
export const AuthLinkStyleSelect = ({
    value,
    onChange,
}: {
    value: unknown;
    onChange: (style: AuthLinkStyle | undefined) => void;
}) => {
    const current: Choice =
        value === 'primary' || value === 'outline' || value === 'text' ? value : 'auto';
    return (
        <HeaderChoice<Choice>
            label="Look"
            value={current}
            options={[
                { value: 'auto', label: 'Automatic' },
                { value: 'primary', label: 'Filled' },
                { value: 'outline', label: 'Outlined' },
                { value: 'text', label: 'Text link' },
            ]}
            onChange={(next) => onChange(next === 'auto' ? undefined : next)}
            hint={
                current === 'auto' ? 'The first button is filled, the others outlined.' : undefined
            }
        />
    );
};

export default AuthLinkStyleSelect;
