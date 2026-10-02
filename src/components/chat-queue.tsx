import { useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ChatTurn } from "../../shared/chat";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { Field, FieldLabel, FieldError } from "./coss/field";
import { Form } from "./coss/form";
import { Textarea } from "./coss/textarea";
import { ScrollArea } from "./coss/scroll-area";
import { Ellipsis, Compose2, ArrowUp, Trash2, GripVertical } from "./icons";
import { validateRequiredText } from "@/lib/form-validation";

type QueueProps = {
  turns: ChatTurn[];
  busy: boolean;
  loading?: boolean;
  onUpdate: (
    id: string,
    change: { content?: string; action?: "retry" | "send" | "up" | "down" },
  ) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onReorder: (id: string, overId: string) => Promise<void>;
};

function QueueRow({
  turn,
  index,
  animateEntry,
  busy,
  run,
  onUpdate,
  onRemove,
}: Pick<QueueProps, "busy" | "onUpdate" | "onRemove"> & {
  turn: ChatTurn;
  index: number;
  animateEntry: boolean;
  run: (work: () => Promise<void>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [entering] = useState(animateEntry);
  const sortable = useSortable({
    id: turn.id,
    disabled: busy || editing || turn.status !== "queued",
  });
  return (
    <li
      ref={sortable.setNodeRef}
      className="chat-queue-item"
      data-entering={entering || undefined}
      data-dragging={sortable.isDragging || undefined}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      {editing ? (
        <Form
          className="chat-queue-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await onUpdate(turn.id, { content: draft });
              setEditing(false);
            });
          }}
        >
          <Field
            name="queuedContent"
            validate={(value) => validateRequiredText(value, "Message", 4000)}
          >
            <FieldLabel className="sr-only">Edit queued message</FieldLabel>
            <Textarea
              autoFocus
              name="queuedContent"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={4000}
            />
            <FieldError />
          </Field>
          <div className="chat-queue-edit-actions">
            <Button variant="ghost" size="xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="xs" disabled={busy || !draft.trim()}>
              Save changes
            </Button>
          </div>
        </Form>
      ) : (
        <>
          <Button
            ref={sortable.setActivatorNodeRef}
            variant="ghost"
            size="icon-xs"
            className="chat-queue-handle"
            {...sortable.attributes}
            {...sortable.listeners}
            aria-label={`Reorder queued message ${index + 1}`}
            disabled={busy || turn.status !== "queued"}
          >
            <GripVertical size={13} />
          </Button>
          <div className="chat-queue-body">
            <p className="chat-queue-content" title={turn.content}>
              {turn.regenerating ? "Regenerate answer" : turn.content}
            </p>
            {turn.status === "cancelled" && (
              <span className="chat-queue-state">Stopped · queue paused</span>
            )}
            {turn.error && turn.status === "failed" && (
              <p className="chat-queue-error">{turn.error}</p>
            )}
          </div>
          {["queued", "failed", "cancelled"].includes(turn.status) && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="chat-queue-send"
              aria-label={`Send queued message ${index + 1} now`}
              title="Send now"
              disabled={busy}
              onClick={() =>
                void run(() => onUpdate(turn.id, { action: "send" }))
              }
            >
              <ArrowUp size={13} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove queued message ${index + 1}`}
            disabled={busy}
            onClick={() => void run(() => onRemove(turn.id))}
          >
            <Trash2 size={13} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Actions for queued message ${index + 1}`}
                  disabled={busy}
                />
              }
            >
              <Ellipsis size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={turn.regenerating}
                onClick={() => {
                  setDraft(turn.content);
                  setEditing(true);
                }}
              >
                <Compose2 size={14} /> Edit message
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void run(() => onRemove(turn.id))}
              >
                <Trash2 size={14} /> Remove from queue
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </li>
  );
}

export function ChatQueue({
  turns,
  busy,
  loading = false,
  onUpdate,
  onRemove,
  onReorder,
}: QueueProps) {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<ChatTurn[] | null>(null);
  const [animateEntries, setAnimateEntries] = useState(false);
  useEffect(() => {
    if (!loading) setAnimateEntries(true);
  }, [loading]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const rows = optimistic ?? turns;
  const dragged = turns.find((turn) => turn.id === dragging);
  const run = async (work: () => Promise<void>) => {
    setError("");
    setWorking(true);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the queue.");
    } finally {
      setWorking(false);
    }
  };
  if (!turns.length) return null;
  return (
    <section
      className="chat-queue"
      aria-label="Queued messages"
      aria-busy={working}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => setDragging(String(active.id))}
        onDragCancel={() => setDragging(null)}
        onDragEnd={({ active, over }) => {
          setDragging(null);
          if (!over || active.id === over.id || working || busy) return;
          const from = turns.findIndex((turn) => turn.id === active.id);
          const to = turns.findIndex((turn) => turn.id === over.id);
          if (
            from < 0 ||
            to < 0 ||
            turns
              .slice(Math.min(from, to), Math.max(from, to) + 1)
              .some((turn) => turn.status !== "queued")
          )
            return;
          setOptimistic(arrayMove(turns, from, to));
          void run(async () => {
            try {
              await onReorder(String(active.id), String(over.id));
            } finally {
              setOptimistic(null);
            }
          });
        }}
      >
        <ScrollArea
          className="chat-queue-scroll"
          scrollFade
          orientation="vertical"
        >
          <SortableContext
            items={rows.map((turn) => turn.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="chat-queue-list">
              {rows.map((turn, index) => (
                <QueueRow
                  key={turn.id}
                  turn={turn}
                  index={index}
                  animateEntry={animateEntries}
                  busy={busy || working}
                  run={run}
                  onUpdate={onUpdate}
                  onRemove={onRemove}
                />
              ))}
            </ol>
          </SortableContext>
        </ScrollArea>
        <DragOverlay>
          {dragged ? (
            <div className="chat-queue-drag-preview">
              <GripVertical size={13} />
              <span>{dragged.content}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
