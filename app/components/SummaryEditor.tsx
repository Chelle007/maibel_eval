"use client";

import { useRef, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

type SummaryEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
};

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-stone-200 border-b-0 bg-stone-50 px-2 py-1.5">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`rounded p-1.5 text-sm font-medium transition ${editor.isActive("bold") ? "bg-stone-200 text-stone-900" : "text-stone-600 hover:bg-stone-100 hover:text-stone-800"}`}
        title="Bold"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`rounded p-1.5 text-sm transition ${editor.isActive("italic") ? "bg-stone-200 text-stone-900 italic" : "text-stone-600 hover:bg-stone-100 hover:text-stone-800"}`}
        title="Italic"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={`rounded p-1.5 font-mono text-sm transition ${editor.isActive("code") ? "bg-stone-200 text-stone-900" : "text-stone-600 hover:bg-stone-100 hover:text-stone-800"}`}
        title="Inline code"
      >
        &lt;/&gt;
      </button>
      <span className="mx-1 h-4 w-px bg-stone-200" aria-hidden />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={`rounded px-2 py-1.5 text-sm font-semibold transition ${editor.isActive("heading", { level: 1 }) ? "bg-stone-200 text-stone-900" : "text-stone-600 hover:bg-stone-100 hover:text-stone-800"}`}
        title="Heading 1"
      >
        H1
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={`rounded px-2 py-1.5 text-sm font-semibold transition ${editor.isActive("heading", { level: 2 }) ? "bg-stone-200 text-stone-900" : "text-stone-600 hover:bg-stone-100 hover:text-stone-800"}`}
        title="Heading 2"
      >
        H2
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={`rounded px-2 py-1.5 text-sm font-semibold transition ${editor.isActive("heading", { level: 3 }) ? "bg-stone-200 text-stone-900" : "text-stone-600 hover:bg-stone-100 hover:text-stone-800"}`}
        title="Heading 3"
      >
        H3
      </button>
    </div>
  );
}

export function SummaryEditor({ value, onChange, placeholder, className = "" }: SummaryEditorProps) {
  const ignoreNextValueRef = useRef(false);

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[12rem] max-h-[32rem] overflow-y-auto rounded-b-lg border border-stone-200 border-t-0 bg-white px-3 py-2 text-stone-900 placeholder:text-stone-400 focus:outline-none prose prose-stone prose-sm max-w-none " +
          "[&_.ProseMirror]:min-h-[12rem] [&_.ProseMirror]:outline-none " +
          "[&_.ProseMirror_h1]:text-base [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:text-stone-900 [&_.ProseMirror_h1]:mt-0 [&_.ProseMirror_h1]:mb-1 [&_.ProseMirror_h1]:pb-2 [&_.ProseMirror_h1]:border-b [&_.ProseMirror_h1]:border-stone-200 " +
          "[&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-stone-900 [&_.ProseMirror_h2]:mt-5 [&_.ProseMirror_h2]:mb-1.5 [&_.ProseMirror_h2]:first:mt-0 " +
          "[&_.ProseMirror_h3]:text-sm [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:text-stone-800 [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1 " +
          "[&_.ProseMirror_p]:mt-1 [&_.ProseMirror_p]:text-sm [&_.ProseMirror_p]:leading-relaxed " +
          "[&_.ProseMirror_ul]:mt-1.5 [&_.ProseMirror_ul]:!list-disc [&_.ProseMirror_ul]:list-outside [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ul_li]:pl-1 " +
          "[&_.ProseMirror_ol]:mt-1.5 [&_.ProseMirror_ol]:!list-decimal [&_.ProseMirror_ol]:list-outside [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_ol_li]:pl-1 " +
          "[&_.ProseMirror_strong]:font-semibold [&_.ProseMirror_strong]:text-stone-800 " +
          "[&_.ProseMirror_em]:italic " +
          "[&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-sm [&_.ProseMirror_code]:bg-stone-100 [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:rounded " +
          (className ? className : ""),
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = typeof ed.getMarkdown === "function" ? ed.getMarkdown() : "";
      ignoreNextValueRef.current = true;
      onChange(md);
    },
  });

  // When value changes from parent (e.g. after Refine), sync into editor
  useEffect(() => {
    if (!editor) return;
    if (ignoreNextValueRef.current) {
      ignoreNextValueRef.current = false;
      return;
    }
    const current = typeof editor.getMarkdown === "function" ? editor.getMarkdown() : "";
    if (value !== current) {
      editor.commands.setContent(value || "", { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <div className="rounded-lg summary-editor">
      <style dangerouslySetInnerHTML={{ __html: `
        .summary-editor .ProseMirror ul {
          list-style-type: disc !important;
          padding-left: 1.5rem !important;
        }
        .summary-editor .ProseMirror ul li {
          display: list-item !important;
        }
        .summary-editor .ProseMirror ol {
          list-style-type: decimal !important;
          padding-left: 1.5rem !important;
        }
        .summary-editor .ProseMirror ol li {
          display: list-item !important;
        }
        .summary-editor .ProseMirror h1 {
          font-size: 1.125rem !important;
          font-weight: 700 !important;
          margin-top: 0 !important;
          margin-bottom: 0.25rem !important;
          padding-bottom: 0.5rem !important;
          border-bottom: 1px solid #e7e5e4 !important;
          color: #1c1917 !important;
        }
        .summary-editor .ProseMirror h2 {
          font-size: 1rem !important;
          font-weight: 600 !important;
          margin-top: 1.25rem !important;
          margin-bottom: 0.375rem !important;
          color: #1c1917 !important;
        }
        .summary-editor .ProseMirror h2:first-child {
          margin-top: 0 !important;
        }
        .summary-editor .ProseMirror h3 {
          font-size: 0.875rem !important;
          font-weight: 600 !important;
          margin-top: 0.75rem !important;
          margin-bottom: 0.25rem !important;
          color: #292524 !important;
        }
        .summary-editor .ProseMirror code {
          font-family: ui-monospace, monospace !important;
          font-size: 0.875em !important;
          background: #f5f5f4 !important;
          padding: 0.125em 0.375em !important;
          border-radius: 0.25rem !important;
          color: #1c1917 !important;
        }
      ` }} />
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
