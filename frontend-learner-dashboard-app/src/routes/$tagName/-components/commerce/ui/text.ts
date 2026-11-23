/** Authored text of a content block in the visitor's language (ContentSections, News, Banner). */
import { str } from '../logic/content';
import { useCommerceSite } from './site';

/** The page's own words, cut to `max` and translated by the site dictionary. */
export const useText = () => {
    const { siteT } = useCommerceSite();
    return (value: unknown, max?: number) => siteT(str(value, max));
};
