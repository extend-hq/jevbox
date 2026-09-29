import {
  useEffect,
  useId,
  useRef,
  useState,
  useImperativeHandle,
  type Ref,
} from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import Placeholder from "@tiptap/extension-placeholder";
import {
  promptExtensions,
  pastedSpreadsheet,
  isMarkdownTable,
  promptLink,
  promptLimit,
} from "@/lib/chat-editor";
import { Button } from "./coss/button";
import { Input } from "./coss/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "./coss/select";
import { Bold, Italic, Link2, X, Check } from "./icons";

const blockStyles = [
  { value: "paragraph", label: "Text" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "bullet", label: "Bullet list" },
  { value: "numbered", label: "Numbered list" },
];
export type ChatPromptEditorHandle = {
  completeMention: () => void;
  dismissMention: () => void;
};
export function ChatPromptEditor({
  ref,
  onMentionChange,
  onMentionKeyDown,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  ref?: Ref<ChatPromptEditorHandle>;
  onMentionChange?: (query: string | null) => void;
  onMentionKeyDown?: (event: KeyboardEvent) => boolean;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  const id = useId();
  const callbacks = useRef({
    onChange,
    disabled,
    placeholder,
    onMentionChange,
    onMentionKeyDown,
  });
  callbacks.current = {
    onChange,
    disabled,
    placeholder,
    onMentionChange,
    onMentionKeyDown,
  };
  const lastEmitted = useRef(value);
  const toolbar = useRef<HTMLDivElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const [selectOpen, setSelectOpen] = useState(false);
  const menuState = useRef({ linkOpen, selectOpen });
  menuState.current = { linkOpen, selectOpen };
  const mentionRange = useRef<{
    from: number;
    to: number;
    query: string;
  } | null>(null);
  const dismissedMention = useRef<string | null>(null);
  function updateMention(editor: import("@tiptap/react").Editor) {
    const { $from, empty } = editor.state.selection;
    const match =
      empty && $from.parent.isTextblock
        ? $from.parent
            .textBetween(0, $from.parentOffset, " ")
            .match(/(?:^|\s)@([^\s@]*)$/)
        : null;
    const mention = match
      ? {
          from: $from.pos - match[1].length - 1,
          to: $from.pos,
          query: match[1],
        }
      : null;
    mentionRange.current = mention;
    const key = mention ? `${mention.from}:${mention.query}` : null;
    if (dismissedMention.current !== key) dismissedMention.current = null;
    callbacks.current.onMentionChange?.(
      mention && dismissedMention.current !== key ? mention.query : null,
    );
  }
  const editor = useEditor({
    extensions: [
      ...promptExtensions(),
      Placeholder.configure({
        placeholder: () => callbacks.current.placeholder,
      }),
    ],
    content: value,
    contentType: "markdown",
    editable: !disabled,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: "chat-prompt-content",
        role: "textbox",
        "aria-label": "Ask a question",
        "aria-multiline": "true",
        "aria-describedby": `${id}-error`,
      },
      handleKeyDown(view, event) {
        if (!event.isComposing && callbacks.current.onMentionKeyDown?.(event)) {
          event.preventDefault();
          return true;
        }
        if (
          event.key !== "Enter" ||
          event.isComposing ||
          view.composing ||
          event.shiftKey
        )
          return false;
        const inStructure = Array.from(
          { length: view.state.selection.$from.depth },
          (_, index) => view.state.selection.$from.node(index + 1).type.name,
        ).some((name) =>
          ["listItem", "tableCell", "tableHeader", "codeBlock"].includes(name),
        );
        if (inStructure && !event.metaKey && !event.ctrlKey) return false;
        event.preventDefault();
        if (!callbacks.current.disabled)
          view.dom.closest("form")?.requestSubmit();
        return true;
      },
      handlePaste(_view, event) {
        const clipboard = event.clipboardData;
        if (!clipboard || clipboard.getData("text/html")) return false;
        const text = clipboard.getData("text/plain");
        const table = pastedSpreadsheet(text);
        if (!table && !isMarkdownTable(text)) return false;
        event.preventDefault();
        if (table) editor?.commands.insertContent(table);
        else editor?.commands.insertContent(text, { contentType: "markdown" });
        return true;
      },
    },
    onUpdate({ editor }) {
      const markdown = editor.isEmpty ? "" : editor.getMarkdown();
      lastEmitted.current = markdown;
      callbacks.current.onChange(markdown);
      updateMention(editor);
    },
    onSelectionUpdate({ editor }) {
      updateMention(editor);
    },
  });
  useImperativeHandle(ref, () => ({
    completeMention() {
      const range = mentionRange.current;
      if (range) editor.chain().focus().deleteRange(range).run();
      mentionRange.current = null;
      callbacks.current.onMentionChange?.(null);
    },
    dismissMention() {
      const range = mentionRange.current;
      dismissedMention.current = range ? `${range.from}:${range.query}` : null;
      callbacks.current.onMentionChange?.(null);
    },
  }));
  const formatting = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      link: editor.isActive("link"),
      block: editor.isActive("bulletList")
        ? "bullet"
        : editor.isActive("orderedList")
          ? "numbered"
          : [1, 2, 3].find((level) => editor.isActive("heading", { level }))
            ? `h${editor.getAttributes("heading").level}`
            : "paragraph",
    }),
  });
  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, {
      contentType: "markdown",
      emitUpdate: false,
    });
    setLinkOpen(false);
  }, [editor, value]);
  useEffect(() => {
    if (linkOpen) linkInput.current?.focus();
  }, [linkOpen]);
  useEffect(() => {
    editor.view.dom.setAttribute(
      "aria-invalid",
      String(value.length > promptLimit),
    );
  }, [editor, value.length]);
  const applyLink = () => {
    const href = promptLink(link);
    if (href === null) {
      setLinkError("Enter an http, https, or email link.");
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (href) chain.setLink({ href }).run();
    else chain.unsetLink().run();
    setLinkOpen(false);
  };
  return (
    <div className="chat-prompt-editor">
      <EditorContent editor={editor} />
      <input type="hidden" name="content" value={value} />
      <BubbleMenu
        editor={editor}
        ref={toolbar}
        className="prompt-format-menu"
        options={{ placement: "top", offset: 8 }}
        shouldShow={({ editor, state }) =>
          editor.isEditable &&
          !state.selection.empty &&
          (editor.isFocused ||
            !!toolbar.current?.contains(document.activeElement) ||
            menuState.current.linkOpen ||
            menuState.current.selectOpen)
        }
      >
        {linkOpen ? (
          <div className="prompt-link-editor">
            <div className="flex items-center gap-1">
              <Input
                ref={linkInput}
                size="sm"
                aria-label="Link URL"
                placeholder="https://"
                value={link}
                aria-invalid={!!linkError}
                onChange={(event) => {
                  setLink(event.target.value);
                  setLinkError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    applyLink();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setLinkOpen(false);
                    editor.commands.focus();
                  }
                }}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Apply link"
                onClick={applyLink}
              >
                <Check size={15} />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Cancel link"
                onClick={() => {
                  setLinkOpen(false);
                  editor.commands.focus();
                }}
              >
                <X size={15} />
              </Button>
            </div>
            {formatting.link && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .unsetLink()
                    .run();
                  setLinkOpen(false);
                }}
              >
                Remove link
              </Button>
            )}
            {linkError && (
              <p className="error text-xs" role="alert">
                {linkError}
              </p>
            )}
          </div>
        ) : (
          <div
            className="flex items-center gap-0.5"
            role="toolbar"
            aria-label="Text formatting"
          >
            <Select
              value={formatting.block}
              open={selectOpen}
              onOpenChange={setSelectOpen}
              items={blockStyles}
              onValueChange={(value) => {
                if (!value) return;
                const chain = editor.chain().focus();
                if (value === "bullet") chain.toggleBulletList().run();
                else if (value === "numbered") chain.toggleOrderedList().run();
                else if (value === "paragraph")
                  chain.clearNodes().setParagraph().run();
                else
                  chain
                    .clearNodes()
                    .setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 })
                    .run();
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="Text style"
                className="min-w-28 prompt-format-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectPopup positionerClassName="z-[90]">
                {blockStyles.map((style) => (
                  <SelectItem key={style.value} value={style.value}>
                    {style.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <span className="h-4 border-l mx-1" />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Bold"
              aria-pressed={formatting.bold}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold size={15} />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Italic"
              aria-pressed={formatting.italic}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic size={15} />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Add or edit link"
              aria-pressed={formatting.link}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setLink(editor.getAttributes("link").href ?? "");
                setLinkError("");
                setLinkOpen(true);
              }}
            >
              <Link2 size={15} />
            </Button>
          </div>
        )}
      </BubbleMenu>
      {value.length > promptLimit && (
        <p id={`${id}-error`} className="error text-xs" role="alert">
          Message is too long ({value.length.toLocaleString()}/
          {promptLimit.toLocaleString()} characters). Shorten it before sending.
        </p>
      )}
    </div>
  );
}
