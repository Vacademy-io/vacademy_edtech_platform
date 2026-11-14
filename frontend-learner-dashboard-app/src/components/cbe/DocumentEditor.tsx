/**
 * Written-answer editor for DOCUMENT parts: TipTap with bold / italic /
 * underline, lists, alignment and tables (insert, add / delete row and column).
 * `value` is HTML; `onChange` receives HTML.
 */
import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Columns,
  ColumnsPlusRight,
  ListBullets,
  ListNumbers,
  Rows,
  RowsPlusBottom,
  Table as TableIcon,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextItalic,
  TextUnderline,
  Trash,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useCbeStrings } from "./cbe-strings";
import { ToolButton, ToolDivider, Toolbar } from "./cbe-toolbar";
import "./cbe-doc.css";

export type DocumentEditorProps = {
  value: string | null | undefined;
  onChange?: (html: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  /** Accessible name of the editing area. */
  label?: string;
};

/** TipTap's empty document serialises as "<p></p>"; report it as "". */
const normalise = (html: string) => (html === "<p></p>" ? "" : html);

function DocToolbar({ editor }: { editor: Editor }) {
  const tools = useCbeStrings().tools;
  const chain = () => editor.chain().focus();
  const inTable = editor.isActive("table");
  return (
    <Toolbar label={tools.textToolbar}>
      <ToolButton label={tools.undo} onClick={() => chain().undo().run()} disabled={!editor.can().undo()}>
        <ArrowCounterClockwise size={16} />
      </ToolButton>
      <ToolButton label={tools.redo} onClick={() => chain().redo().run()} disabled={!editor.can().redo()}>
        <ArrowClockwise size={16} />
      </ToolButton>
      <ToolDivider />
      <ToolButton label={tools.bold} active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}>
        <TextB size={16} weight="bold" />
      </ToolButton>
      <ToolButton label={tools.italic} active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}>
        <TextItalic size={16} />
      </ToolButton>
      <ToolButton label={tools.underline} active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}>
        <TextUnderline size={16} />
      </ToolButton>
      <ToolDivider />
      <ToolButton label={tools.bulletList} active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}>
        <ListBullets size={16} />
      </ToolButton>
      <ToolButton label={tools.numberedList} active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}>
        <ListNumbers size={16} />
      </ToolButton>
      <ToolDivider />
      <ToolButton label={tools.alignLeft} active={editor.isActive({ textAlign: "left" })} onClick={() => chain().setTextAlign("left").run()}>
        <TextAlignLeft size={16} />
      </ToolButton>
      <ToolButton label={tools.alignCentre} active={editor.isActive({ textAlign: "center" })} onClick={() => chain().setTextAlign("center").run()}>
        <TextAlignCenter size={16} />
      </ToolButton>
      <ToolButton label={tools.alignRight} active={editor.isActive({ textAlign: "right" })} onClick={() => chain().setTextAlign("right").run()}>
        <TextAlignRight size={16} />
      </ToolButton>
      <ToolDivider />
      <ToolButton
        label={tools.insertTable}
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        disabled={inTable}
      >
        <TableIcon size={16} />
      </ToolButton>
      <ToolButton label={tools.addRowBelow} onClick={() => chain().addRowAfter().run()} disabled={!inTable}>
        <RowsPlusBottom size={16} />
      </ToolButton>
      <ToolButton label={tools.addColumnRight} onClick={() => chain().addColumnAfter().run()} disabled={!inTable}>
        <ColumnsPlusRight size={16} />
      </ToolButton>
      <ToolButton label={tools.deleteRow} onClick={() => chain().deleteRow().run()} disabled={!inTable}>
        <Rows size={16} />
      </ToolButton>
      <ToolButton label={tools.deleteColumn} onClick={() => chain().deleteColumn().run()} disabled={!inTable}>
        <Columns size={16} />
      </ToolButton>
      <ToolButton label={tools.deleteTable} onClick={() => chain().deleteTable().run()} disabled={!inTable}>
        <Trash size={16} />
      </ToolButton>
    </Toolbar>
  );
}

export function DocumentEditor({
  value,
  onChange,
  readOnly = false,
  placeholder: placeholderProp,
  className,
  label: labelProp,
}: DocumentEditorProps) {
  const strings = useCbeStrings();
  // Read once by TipTap at creation (like the rest of its config).
  const placeholder = placeholderProp ?? strings.documentPlaceholder;
  const label = labelProp ?? strings.writtenAnswer;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmitted = useRef<string>(value ?? "");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value ?? "",
    editable: !readOnly,
    editorProps: {
      attributes: {
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        class: "min-h-40 px-3 py-2 text-body focus:outline-none",
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = normalise(ed.getHTML());
      lastEmitted.current = html;
      onChangeRef.current?.(html);
    },
  });

  // Follow external value changes (template seeding, reset) without fighting typing.
  useEffect(() => {
    if (!editor) return;
    const next = value ?? "";
    if (next === lastEmitted.current || next === normalise(editor.getHTML())) return;
    lastEmitted.current = next;
    editor.commands.setContent(next, false);
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  return (
    <div
      className={cn("flex w-full flex-col overflow-hidden rounded-md border border-border bg-card", className)}
      data-cbe-document-editor=""
      // The learner's own answer surface: proctoring lets copy / select work here (lib/cbe/workspace-dom).
      data-cbe-workspace=""
    >
      {editor && !readOnly && <DocToolbar editor={editor} />}
      <EditorContent editor={editor} className="cbe-doc min-h-40 flex-1 overflow-auto" />
    </div>
  );
}

export default DocumentEditor;
