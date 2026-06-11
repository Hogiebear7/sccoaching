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
      className={`flex items-start gap-3 px-4 py-3.5 cursor-pointer border-b border-zinc-800 transition-colors ${active ? "bg-zinc-800" : "hover:bg-zinc-800/50"}`}
    >
      <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 flex-shrink-0 mt-0.5">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-sm font-medium truncate ${message.read ? "text-zinc-300" : "text-zinc-50"}`}>{person}</p>
          <span className="text-[10px] text-zinc-500 flex-shrink-0">{formatTime(message.timestamp)}</span>
        </div>
        <p className={`text-xs truncate mt-0.5 ${message.read ? "text-zinc-500" : "text-zinc-300 font-medium"}`}>{message.subject}</p>
        <p className="text-xs text-zinc-600 truncate mt-0.5">{message.body.slice(0, 60)}…</p>
      </div>
      {!message.read && <div className="w-2 h-2 rounded-full bg-teal-400 flex-shrink-0 mt-2" />}
    </div>
  );
}
