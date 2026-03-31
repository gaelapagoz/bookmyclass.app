"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";

import { FontSize } from "@/components/admin/marketing/extensions/FontSize";
import { sanitizePastedRichHtml, sanitizeRichHtml, type RichTextVariant } from "@/lib/marketing/marketing-rich-text";

type Props = {
  value: string;
  onChange: (html: string) => void;
  variant: RichTextVariant;
  placeholder?: string;
};

const FONT_SIZE_PRESETS = {
  heading: ["28px", "32px", "40px"] as const,
  paragraph: ["14px", "16px", "18px"] as const,
} as const;

function supportsLinks(variant: RichTextVariant): boolean {
  return variant === "paragraph";
}

function supportsAlignment(variant: RichTextVariant): boolean {
  return variant === "heading" || variant === "paragraph";
}

function supportsFontSize(variant: RichTextVariant): boolean {
  return variant === "heading" || variant === "paragraph";
}

function getFontSizeOptions(variant: RichTextVariant): readonly string[] {
  return variant === "heading" ? FONT_SIZE_PRESETS.heading : FONT_SIZE_PRESETS.paragraph;
}

export default function RichTextField({ value, onChange, variant, placeholder }: Props) {
  const [isActive, setIsActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialContent = useMemo(() => sanitizeRichHtml(value, variant), [value, variant]);
  const fontSizeOptions = useMemo(() => getFontSizeOptions(variant), [variant]);
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        link: false,
        underline: false,
      }),
      TextStyle,
      FontSize.configure({
        allowedSizes: fontSizeOptions,
      }),
      Underline,
      TextAlign.configure({ types: ["paragraph"] }),
      Link.configure({
        autolink: false,
        openOnClick: false,
        linkOnPaste: true,
        protocols: ["http", "https", "mailto", "tel"],
      }),
    ],
    [fontSizeOptions],
  );

  const editorProps = useMemo(
    () => ({
      attributes: {
        class: "min-h-[74px] rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm text-[#1f2735] focus:outline-none",
      },
      transformPastedHTML: (html: string) => sanitizePastedRichHtml(html, variant),
      transformPastedText: (text: string) => sanitizePastedRichHtml(text, variant),
    }),
    [variant],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: initialContent,
    editorProps,
    onUpdate: ({ editor: instance }) => {
      onChange(sanitizeRichHtml(instance.getHTML(), variant));
    },
  }, [variant]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const normalized = sanitizeRichHtml(value, variant);
    if (normalized !== sanitizeRichHtml(editor.getHTML(), variant)) {
      editor.commands.setContent(normalized, { emitUpdate: false });
    }
  }, [editor, value, variant]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current?.contains(target)) {
        return;
      }
      setIsActive(false);
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  }, [isActive]);

  if (!editor) {
    return <div className="rounded-md border border-[#d3dbe5] px-3 py-2 text-sm text-[#64748b]">Loading editor...</div>;
  }

  const applyLink = () => {
    if (!supportsLinks(variant)) {
      return;
    }

    const current = editor.getAttributes("link").href as string | undefined;
    const next = window.prompt("Enter link URL", current ?? "https://");
    if (!next) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().setLink({ href: next }).run();
  };

  return (
    <div
      ref={containerRef}
      className="space-y-1"
      onPointerDownCapture={() => setIsActive(true)}
      onFocusCapture={() => setIsActive(true)}
    >
      {isActive ? (
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-[#d3dbe5] bg-white p-1 text-xs">
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()} className={`rounded px-2 py-1 ${editor.isActive("bold") ? "bg-[#1d3652] text-white" : "hover:bg-[#f3f6fb]"}`}>
            B
          </button>
          {variant !== "button" ? (
            <>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()} className={`rounded px-2 py-1 ${editor.isActive("italic") ? "bg-[#1d3652] text-white" : "hover:bg-[#f3f6fb]"}`}>
                I
              </button>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleUnderline().run()} className={`rounded px-2 py-1 ${editor.isActive("underline") ? "bg-[#1d3652] text-white" : "hover:bg-[#f3f6fb]"}`}>
                U
              </button>
            </>
          ) : null}

          {supportsAlignment(variant) ? (
            <>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().setTextAlign("left").run()} className={`rounded px-2 py-1 ${editor.isActive({ textAlign: "left" }) ? "bg-[#1d3652] text-white" : "hover:bg-[#f3f6fb]"}`}>
                Left
              </button>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().setTextAlign("center").run()} className={`rounded px-2 py-1 ${editor.isActive({ textAlign: "center" }) ? "bg-[#1d3652] text-white" : "hover:bg-[#f3f6fb]"}`}>
                Center
              </button>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().setTextAlign("right").run()} className={`rounded px-2 py-1 ${editor.isActive({ textAlign: "right" }) ? "bg-[#1d3652] text-white" : "hover:bg-[#f3f6fb]"}`}>
                Right
              </button>
            </>
          ) : null}

          {supportsFontSize(variant) ? (
            <select
              onMouseDown={(event) => event.stopPropagation()}
              value={(editor.getAttributes("textStyle").fontSize as string | undefined) ?? ""}
              onChange={(event) => {
                const next = event.target.value;
                if (!next) {
                  editor.chain().focus().unsetFontSize().run();
                  return;
                }
                editor.chain().focus().setFontSize(next).run();
              }}
              className="rounded border border-[#d3dbe5] px-2 py-1 text-xs"
            >
              <option value="">Default size</option>
              {fontSizeOptions.map((preset) => (
                <option key={preset} value={preset}>{preset}</option>
              ))}
            </select>
          ) : null}

          {supportsLinks(variant) ? (
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={applyLink} className={`rounded px-2 py-1 ${editor.isActive("link") ? "bg-[#1d3652] text-white" : "hover:bg-[#f3f6fb]"}`}>
              Link
            </button>
          ) : null}
        </div>
      ) : null}

      <EditorContent editor={editor} />
      {placeholder ? <p className="text-xs text-[#64748b]">{placeholder}</p> : null}
    </div>
  );
}
