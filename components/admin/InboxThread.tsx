import type { Message } from "@/lib/mock-data";

function formatTime(ts: string) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface Props {
  message: Message;
  active?: boolean;
  onClick?: () => void;
}

export default function InboxThread({ message, active, onClick }: Props) {
  const isMine = message.fromId === "coach";
  const person = isMine ? message.toName : message.fromName;
  const initials = person.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div
      onClick={onClick}
      className={`relative flex cursor-pointer items-start gap-3 border-b border-white/[0.05] px-4 py-3.5 transition-colors duration-150 ${active ? "bg-white/[0.05]" : "hover:bg-white/[0.03]"}`}
    >
      <span className={`absolute left-0 top-1/2 h-8 w-0.5 -translate-y-1/2 rounded-full bg-teal-400 transition-opacity duration-150 ${active ? "opacity-100" : "opacity-0"}`} />
      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-semibold text-zinc-300 ring-1 ring-white/10">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={`truncate text-sm ${message.read ? "font-medium text-zinc-300" : "font-semibold text-zinc-50"}`}>{person}</p>
          <span className="flex-shrink-0 text-[10px] text-zinc-500 tabular-nums">{formatTime(message.timestamp)}</span>
        </div>
        <p className={`mt-0.5 truncate text-xs ${message.read ? "text-zinc-500" : "font-medium text-zinc-300"}`}>{message.subject}</p>
        <p className="mt-0.5 truncate text-xs text-zinc-600">{message.body.slice(0, 60)}…</p>
      </div>
      {!message.read && <div className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-teal-400" />}
    </div>
  );
}
