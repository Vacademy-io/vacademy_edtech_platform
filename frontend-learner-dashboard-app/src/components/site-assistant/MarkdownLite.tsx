import React, { useMemo } from "react";
import { parseMarkdownLite, type MdInline } from "./markdown-lite";
import { AssistantLink } from "./AssistantLink";

const renderInline = (nodes: MdInline[], keyPrefix: string): React.ReactNode[] =>
  nodes.map((n, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (n.t) {
      case "text":
        return <React.Fragment key={key}>{n.v}</React.Fragment>;
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            {renderInline(n.c, key)}
          </strong>
        );
      case "em":
        return <em key={key}>{renderInline(n.c, key)}</em>;
      case "link":
        return (
          <AssistantLink key={key} href={n.href} className="break-all font-medium text-catalogue-brand-ink underline underline-offset-2">
            {renderInline(n.c, key)}
          </AssistantLink>
        );
    }
  });

/** Assistant text as elements (never HTML). See markdown-lite.ts. */
export const MarkdownLite: React.FC<{ text: string }> = ({ text }) => {
  const blocks = useMemo(() => parseMarkdownLite(text), [text]);
  return (
    <div className="flex flex-col gap-2 break-words">
      {blocks.map((b, i) => {
        if (b.t === "p") {
          return (
            <p key={i}>
              {b.lines.map((line, j) => (
                <React.Fragment key={j}>
                  {j > 0 && <br />}
                  {renderInline(line, `${i}-${j}`)}
                </React.Fragment>
              ))}
            </p>
          );
        }
        const items = b.items.map((item, j) => <li key={j}>{renderInline(item, `${i}-${j}`)}</li>);
        return b.t === "ul" ? (
          <ul key={i} className="list-disc space-y-1 ps-5">
            {items}
          </ul>
        ) : (
          <ol key={i} start={b.start} className="list-decimal space-y-1 ps-5">
            {items}
          </ol>
        );
      })}
    </div>
  );
};
