type Event = { time: number; type: string; data: Record<string, unknown> };
const events: Event[] = [];
let state: Record<string, unknown> = {};
export function chatDebug(type: string, data: Record<string, unknown>) {
  if (
    typeof window === "undefined" ||
    !new URLSearchParams(window.location.search).has("chatDebug")
  )
    return;
  events.push({ time: performance.now(), type, data });
  if (events.length > 300) events.shift();
  if (type === "viewport") state = data;
  Object.assign(window, {
    __jevboxChatDebug: {
      snapshot: () => ({ ...state, events: events.slice() }),
    },
  });
}
