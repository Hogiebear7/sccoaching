"use client";
import { useState } from "react";
import StrengthProgressChart from "@/components/member/StrengthProgressChart";
import BodyweightChart from "@/components/member/BodyweightChart";
import Badge from "@/components/ui/Badge";
import { currentMember, getStrengthProgression, bodyweightEntries } from "@/lib/mock-data";

const member = currentMember;
const bwEntries = bodyweightEntries.filter((e) => e.memberId === member.id);

const strengthSeries = [
  { label: "Squat",     color: "#0d9488", data: getStrengthProgression("Back Squat",   member.id) },
  { label: "Bench",     color: "#6366f1", data: getStrengthProgression("Bench Press",   member.id) },
  { label: "Deadlift",  color: "#f59e0b", data: getStrengthProgression("Deadlift",      member.id) },
  { label: "OHP",       color: "#ec4899", data: getStrengthProgression("Overhead Press",member.id) },
];

const SECTIONS = ["Progress", "Info"] as const;

export default function ProfilePage() {
  const [section, setSection] = useState<"Progress" | "Info">("Progress");
  const [newWeight, setNewWeight] = useState("");
  const [localBw, setLocalBw] = useState(bwEntries);

  function logWeight() {
    if (!newWeight.trim()) return;
    setLocalBw((prev) => [
      ...prev,
      { memberId: member.id, date: new Date().toISOString().slice(0, 10), weightKg: parseFloat(newWeight) },
    ]);
    setNewWeight("");
  }

  const tierVariant = member.tier.toLowerCase() as "basic" | "premium" | "elite";

  return (
    <div className="pb-4">
      {/* Hero */}
      <div className="px-4 pt-6 pb-4 flex flex-col items-center gap-3 text-center">
        <div className="w-16 h-16 rounded-full bg-teal-600 flex items-center justify-center text-2xl font-bold text-white">
          {member.initials}
        </div>
        <div>
          <h1 className="text-xl font-bold text-zinc-50">{member.name}</h1>
          <p className="text-sm text-zinc-500">{member.email}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <Badge variant={tierVariant}>{member.tier}</Badge>
          <Badge variant="active">Active</Badge>
          <span className="text-xs text-zinc-500">Member since {new Date(member.joinDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
        </div>
        <div className="flex gap-6 mt-1">
          <div className="text-center">
            <p className="text-lg font-bold text-zinc-50">{member.totalVisits}</p>
            <p className="text-[10px] text-zinc-500">Total visits</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-teal-400">{member.streak}</p>
            <p className="text-[10px] text-zinc-500">Day streak</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-zinc-50">{member.currentWeight}</p>
            <p className="text-[10px] text-zinc-500">Weight (kg)</p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex mx-4 mb-4 bg-zinc-900 border border-zinc-800 rounded-xl p-1 gap-1">
        {SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${section === s ? "bg-teal-600 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {section === "Progress" && (
        <div className="px-4 flex flex-col gap-5">
          {/* Strength chart */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
            <h3 className="text-sm font-semibold text-zinc-100 mb-1">Strength Progress</h3>
            <p className="text-xs text-zinc-500 mb-4">Max weight per session — last 6 months</p>
            <StrengthProgressChart series={strengthSeries} />
          </div>

          {/* Bodyweight chart */}
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-zinc-100">Bodyweight</h3>
              <span className="text-xs text-zinc-500">{localBw[localBw.length - 1]?.weightKg} kg</span>
            </div>
            <p className="text-xs text-zinc-500 mb-4">Weekly tracking · target {member.targetWeight} kg</p>
            <BodyweightChart entries={localBw} targetWeight={member.targetWeight} />
            <div className="flex gap-2 mt-4">
              <input
                type="number"
                inputMode="decimal"
                value={newWeight}
                onChange={(e) => setNewWeight(e.target.value)}
                placeholder="Log today's weight (kg)"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-teal-600"
              />
              <button
                onClick={logWeight}
                className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-teal-500 transition-colors"
              >
                Log
              </button>
            </div>
          </div>
        </div>
      )}

      {section === "Info" && (
        <div className="px-4 flex flex-col gap-4">
          {[
            { label: "Email", value: member.email },
            { label: "Phone", value: member.phone },
            { label: "Goals", value: member.goals },
            { label: "Current weight", value: `${member.currentWeight} kg` },
            { label: "Target weight", value: `${member.targetWeight} kg` },
            { label: "Membership tier", value: member.tier },
          ].map(({ label, value }) => (
            <div key={label} className="bg-zinc-900 rounded-2xl border border-zinc-800 px-4 py-3">
              <p className="text-xs text-zinc-500 mb-0.5">{label}</p>
              <p className="text-sm text-zinc-100">{value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
