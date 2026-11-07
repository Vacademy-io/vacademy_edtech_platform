import mammoth from 'mammoth';
import type { TFunction } from 'i18next';

// This is a plain utility function (not a component/hook), so it cannot call
// useTranslation() itself — the guide's convention is to thread the caller's
// `t` in as a parameter. `t` is optional here because the only current caller,
// add-doc-dialog.tsx, is not yet wired for i18n (a separate batch of this
// rollout); until that caller passes its own `t`, this fallback resolves each
// call's defaultValue string so behavior (and the English copy shown via
// toast.error) stays exactly as before. Keys live under the
// `studyLibraryDocToHtml` namespace, matching the sibling fallbackT pattern in
// ai-copilot/course-outline/generating/services/contentGenerationService.ts.
const fallbackT: TFunction = ((_key: string, defaultValue?: unknown) =>
    typeof defaultValue === 'string' ? defaultValue : String(_key)) as unknown as TFunction;

const INLINE_TAGS = 'strong|em|b|i|u|code|span|mark|sub|sup|small';
const BLOCK_CONTAINERS = new Set([
    'P',
    'LI',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'BLOCKQUOTE',
]);

// Yoopta's Slate-based deserializer trims whitespace at the boundary between
// a text node and an inline element. Move any whitespace that sits
// immediately before an opening tag OR immediately after a closing tag INSIDE
// the tag as &nbsp;, so it survives deserialize → serialize.
const normalizeInlineWhitespace = (html: string): string => {
    let out = html;
    out = out.replace(
        new RegExp(
            `(&nbsp;|\\u00a0| )(<(?:${INLINE_TAGS})(?:\\s[^>]*)?>)`,
            'gi'
        ),
        '$2&nbsp;'
    );
    out = out.replace(
        new RegExp(
            `(</(?:${INLINE_TAGS})>)(&nbsp;|\\u00a0| )`,
            'gi'
        ),
        '&nbsp;$1'
    );
    return out;
};

const containsDeep = (node: Node, target: Node): boolean => {
    if (node === target) return true;
    if (node.nodeType !== 1) return false;
    for (const c of Array.from(node.childNodes)) {
        if (containsDeep(c, target)) return true;
    }
    return false;
};

const isEmpty = (node: Node | null): boolean => {
    if (!node) return true;
    if (node.childNodes.length === 0) return true;
    for (const c of Array.from(node.childNodes)) {
        if (c.nodeType === 1) {
            const el = c as Element;
            if (el.tagName === 'BR') continue;
            if (!isEmpty(el)) return false;
        } else if (c.nodeType === 3) {
            if ((c.textContent || '').replace(/\u00a0/g, ' ').trim()) return false;
        }
    }
    return true;
};

const splitInto = (original: Element, target: Element, before: Element, after: Element) => {
    let passed = false;
    const walk = (src: Node, bDst: Node, aDst: Node) => {
        const children = Array.from(src.childNodes);
        for (const child of children) {
            if (passed) {
                aDst.appendChild(child.cloneNode(true));
                continue;
            }
            if (child === target) {
                passed = true;
                continue;
            }
            if (child.nodeType === 1 && containsDeep(child, target)) {
                const bChild = (child as Element).cloneNode(false);
                const aChild = (child as Element).cloneNode(false);
                walk(child, bChild, aChild);
                if (bChild.childNodes.length > 0) bDst.appendChild(bChild);
                if (aChild.childNodes.length > 0) aDst.appendChild(aChild);
            } else {
                bDst.appendChild(child.cloneNode(true));
            }
        }
    };
    walk(original, before, after);
};

const hoistFromParagraphLike = (img: Element, block: Element) => {
    const parent = block.parentNode;
    if (!parent) {
        img.remove();
        return;
    }
    const before = block.cloneNode(false) as Element;
    const after = block.cloneNode(false) as Element;
    splitInto(block, img, before, after);

    const imgClone = img.cloneNode(true);
    if (!isEmpty(before)) parent.insertBefore(before, block);
    parent.insertBefore(imgClone, block);
    if (!isEmpty(after)) parent.insertBefore(after, block);
    block.remove();
};

const hoistFromListItem = (img: Element, li: Element, doc: Document) => {
    const list = li.parentElement;
    if (!list) {
        img.remove();
        return;
    }
    const listParent = list.parentNode;
    if (!listParent) {
        img.remove();
        return;
    }

    const liBefore = li.cloneNode(false) as Element;
    const liAfter = li.cloneNode(false) as Element;
    splitInto(li, img, liBefore, liAfter);

    const imgClone = img.cloneNode(true);
    const listTag = list.tagName.toLowerCase();
    const itemsBefore: Element[] = [];
    const itemsAfter: Element[] = [];
    let found = false;
    for (const child of Array.from(list.children)) {
        if (child === li) {
            found = true;
            continue;
        }
        if (!found) itemsBefore.push(child);
        else itemsAfter.push(child);
    }

    const frag = doc.createDocumentFragment();
    if (itemsBefore.length > 0 || !isEmpty(liBefore)) {
        const beforeList = doc.createElement(listTag);
        itemsBefore.forEach((c) => beforeList.appendChild(c));
        if (!isEmpty(liBefore)) beforeList.appendChild(liBefore);
        frag.appendChild(beforeList);
    }
    frag.appendChild(imgClone);
    if (itemsAfter.length > 0 || !isEmpty(liAfter)) {
        const afterList = doc.createElement(listTag);
        if (!isEmpty(liAfter)) afterList.appendChild(liAfter);
        itemsAfter.forEach((c) => afterList.appendChild(c));
        frag.appendChild(afterList);
    }

    listParent.replaceChild(frag, list);
};

const cleanupEmpties = (root: Element) => {
    let changed = true;
    while (changed) {
        changed = false;
        const candidates = Array.from(
            root.querySelectorAll('p, strong, em, b, i, u, span')
        );
        for (const el of candidates) {
            if (el.querySelectorAll('img').length > 0) continue;
            if (isEmpty(el)) {
                el.remove();
                changed = true;
            }
        }
    }
};

// Yoopta's NumberedList / BulletedList plugins drop <br> tags entirely when
// deserializing <li> content, so multi-paragraph list items (Word sub-paragraphs
// separated by <br><br>) lose their structure and sentences end up concatenated
// with no space (e.g. "block.This block is used..."). Split each <li> at every
// <br><br>+ sequence: the first chunk stays in the list item, the rest becomes
// a <p> sibling of the list, and any remaining items move to a new list after
// it. Single leftover <br> tags inside <li> get replaced with a space so
// Yoopta still renders a separator.
const splitListItemsOnDoubleBreaks = (html: string): string => {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(
            `<!DOCTYPE html><html><body><div id="__root__">${html}</div></body></html>`,
            'text/html'
        );
        const root = doc.getElementById('__root__');
        if (!root) return html;

        let safety = 0;
        while (safety++ < 1000) {
            let foundLi: Element | null = null;
            let foundIdx = -1;
            const lis = Array.from(root.querySelectorAll('li'));
            for (const li of lis) {
                const kids = Array.from(li.childNodes);
                for (let i = 0; i < kids.length - 1; i++) {
                    const a = kids[i];
                    const b = kids[i + 1];
                    if (!a || !b) continue;
                    if (
                        a.nodeType === 1 &&
                        (a as Element).tagName === 'BR' &&
                        b.nodeType === 1 &&
                        (b as Element).tagName === 'BR'
                    ) {
                        foundLi = li;
                        foundIdx = i;
                        break;
                    }
                }
                if (foundLi) break;
            }
            if (!foundLi) break;

            const li = foundLi;
            const list = li.parentElement;
            if (!list) break;
            const listParent = list.parentNode;
            if (!listParent) break;
            const listTag = list.tagName.toLowerCase();

            const beforeLi = li.cloneNode(false) as Element;
            const origKids = Array.from(li.childNodes);
            for (let i = 0; i < foundIdx; i++) {
                const k = origKids[i];
                if (k) beforeLi.appendChild(k.cloneNode(true));
            }

            // Skip consecutive <br> tags after the split point
            let j = foundIdx;
            while (j < origKids.length) {
                const k = origKids[j];
                if (
                    k &&
                    k.nodeType === 1 &&
                    (k as Element).tagName === 'BR'
                ) {
                    j++;
                } else {
                    break;
                }
            }

            const afterP = doc.createElement('p');
            while (j < origKids.length) {
                const k = origKids[j];
                if (k) afterP.appendChild(k.cloneNode(true));
                j++;
            }

            const itemsBefore: Element[] = [];
            const itemsAfter: Element[] = [];
            let passed = false;
            for (const c of Array.from(list.children)) {
                if (c === li) {
                    passed = true;
                    continue;
                }
                if (!passed) itemsBefore.push(c);
                else itemsAfter.push(c);
            }

            const frag = doc.createDocumentFragment();
            const preList = doc.createElement(listTag);
            itemsBefore.forEach((c) => preList.appendChild(c.cloneNode(true)));
            preList.appendChild(beforeLi);
            frag.appendChild(preList);
            if (afterP.childNodes.length > 0) frag.appendChild(afterP);
            if (itemsAfter.length > 0) {
                const postList = doc.createElement(listTag);
                itemsAfter.forEach((c) => postList.appendChild(c.cloneNode(true)));
                frag.appendChild(postList);
            }

            listParent.replaceChild(frag, list);
        }

        // Replace any leftover single <br> inside <li> with a space character,
        // because Yoopta's list plugins strip <br> but preserve text nodes.
        Array.from(root.querySelectorAll('li br')).forEach((br) => {
            const space = doc.createTextNode(' ');
            br.parentNode?.replaceChild(space, br);
        });

        return root.innerHTML;
    } catch (e) {
        console.error('splitListItemsOnDoubleBreaks failed:', e);
        return html;
    }
};

// Hoist every <img> that sits inside a block container (p, li, headings,
// blockquote) out to be a top-level sibling, preserving document order.
// Lists are split around images so numbered steps keep their position.
// Yoopta's plugins handle <img> at block level but drop them when nested
// inside text blocks — this transform makes the HTML round-trip cleanly.
const hoistImagesFromBlocks = (html: string): string => {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(
            `<!DOCTYPE html><html><body><div id="__root__">${html}</div></body></html>`,
            'text/html'
        );
        const root = doc.getElementById('__root__');
        if (!root) return html;

        let safety = 0;
        while (safety++ < 1000) {
            let target: Element | null = null;
            let container: Element | null = null;
            const imgs: Element[] = Array.from(root.querySelectorAll('img'));
            for (const img of imgs) {
                let cur: Element | null = img.parentElement;
                while (cur && cur !== root) {
                    if (BLOCK_CONTAINERS.has(cur.tagName)) {
                        target = img;
                        container = cur;
                        break;
                    }
                    cur = cur.parentElement;
                }
                if (target) break;
            }
            if (!target || !container) break;

            if (container.tagName === 'LI') {
                hoistFromListItem(target, container, doc);
            } else {
                hoistFromParagraphLike(target, container);
            }
        }

        cleanupEmpties(root);
        return root.innerHTML;
    } catch (e) {
        console.error('hoistImagesFromBlocks failed, returning original html:', e);
        return html;
    }
};

// Yoopta's NumberedList plugin renders each <li> as a standalone block and
// computes its display number by walking previous sibling blocks: the counter
// only increments across consecutive NumberedList blocks at the same depth and
// resets whenever any other block type (image, paragraph, etc.) appears in
// between. The `start` attribute on <ol> is not honored. Word documents that
// interleave numbered steps with descriptive paragraphs and images (the normal
// case) therefore render as "1." on every item. To get correct, continuous
// numbering we flatten every <ol> into plain <p> siblings with the number
// baked into the text, using one running counter for the whole document.
// Phase 2 will preserve alpha/roman formats and per-list resets by reading
// word/numbering.xml directly; for now everything is decimal and continuous.
const flattenOrderedListsToParagraphs = (html: string): string => {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(
            `<!DOCTYPE html><html><body><div id="__root__">${html}</div></body></html>`,
            'text/html'
        );
        const root = doc.getElementById('__root__');
        if (!root) return html;

        let counter = 0;

        const flattenOl = (ol: Element): DocumentFragment => {
            const frag = doc.createDocumentFragment();
            const directLis = Array.from(ol.children).filter(
                (c) => c.tagName === 'LI'
            );
            for (const li of directLis) {
                const nestedOls = Array.from(li.children).filter(
                    (c) => c.tagName === 'OL'
                );
                nestedOls.forEach((n) => n.remove());

                if (!isEmpty(li)) {
                    counter++;
                    const p = doc.createElement('p');
                    p.innerHTML = `${counter}. ${li.innerHTML}`;
                    frag.appendChild(p);
                }

                for (const nested of nestedOls) {
                    frag.appendChild(flattenOl(nested));
                }
            }
            return frag;
        };

        let safety = 0;
        while (safety++ < 1000) {
            const topOl = root.querySelector('ol');
            if (!topOl) break;
            const frag = flattenOl(topOl);
            topOl.parentNode?.replaceChild(frag, topOl);
        }

        return root.innerHTML;
    } catch (e) {
        console.error('flattenOrderedListsToParagraphs failed:', e);
        return html;
    }
};

export const convertDocToHtml = async (
    file: File,
    t: TFunction = fallbackT
): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = async () => {
            try {
                const arrayBuffer = reader.result as ArrayBuffer;
                const result = await mammoth.convertToHtml({ arrayBuffer });

                if (!result || !result.value) {
                    reject(
                        new Error(
                            t('errors.conversionFailedNoContent', 'Document conversion failed - no content')
                        )
                    );
                    return;
                }

                const whitespaceFixed = normalizeInlineWhitespace(result.value);
                const imagesHoisted = hoistImagesFromBlocks(whitespaceFixed);
                const listsFixed = splitListItemsOnDoubleBreaks(imagesHoisted);
                const olsFlattened = flattenOrderedListsToParagraphs(listsFixed);

                const processedHTML = `
                    <div>
                        ${olsFlattened}
                    </div>
                `;

                resolve(processedHTML);
            } catch (error) {
                console.error('Error during conversion:', error);
                reject(error);
            }
        };

        reader.readAsArrayBuffer(file);
    });
};
