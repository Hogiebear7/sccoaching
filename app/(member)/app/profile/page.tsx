"use client";
import { useState } from "react";
import StrengthProgressChart from "@/components/member/StrengthProgressChart";
import BodyweightChart from "@/components/member/BodyweightChart";
import Badge from "@/components/ui/Badge";
import { currentMember, getStrengthProgression, bodyweightEntries } from "@/lib/mock-data";

const member = currentMember;
const bwEntries = bodyweightEntries.filter((e) => e.memberId === member.id);

const strengthSeries = [
  { label: "Squat", color: "#0d9488", data: getStrengthProgression("Back Squat", member.id) },
  { label: "Bench", color: "#6366f1", data: getStrengthProgression("Bench Press", member.id) },
  { label: "Deadlift", color: "#f59e0b", data: getStrengthProgression("Deadlift", member.id) },
  { label: "OHP", color: "#ec4899", data: getStrengthProgression("Overhead Press", member.id) },
];

const SECTIONS = ["Progress", "Info", "Recovery & Fuel", "Cycle Tracking"] as const;
type Section = (typeof SECTIONS)[number];

export default function ProfilePage() {
  const [section, setSection] = useState<Section>("Progress");
  const [newWeight, setNewWeight] = useState("");
  const [localBw, setLocalBw] = useState(bwEntries);

  function logWeight() {
    if (!newWeight.trim()) return;

    setLocalBw((prev) => [
      ...prev,
      {
        memberId: member.id,
        date: new Date().toISOString().slice(0, 10),
        weightKg: parseFloat(newWeight),
      },
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
          <span className="text-xs text-zinc-500">
            Member since{" "}
            {new Date(member.joinDate).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })}
          </span>
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

            {/* Tab grid */}
      <div
        role="tablist"
        aria-label="Profile sections"
        className="mx-4 mb-4 grid grid-cols-2 gap-2"
      >
        {SECTIONS.map((s) => {
          const selected = section === s;
          const tabId = `tab-${s}`;
          const panelId = `panel-${s}`;

          return (
            <button
              key={s}
              id={tabId}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={panelId}
              onClick={() => setSection(s)}
              className={`min-h-[52px] rounded-2xl border px-3 py-3 text-sm font-medium text-center leading-tight transition-colors ${
                selected
                  ? "border-teal-500 bg-teal-600 text-white"
                  : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>

      {section === "Progress" && (
        <div
          id="panel-Progress"
          role="tabpanel"
          aria-labelledby="tab-Progress"
          className="px-4 flex flex-col gap-5"
        >
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
            <h3 className="text-sm font-semibold text-zinc-100 mb-1">Strength Progress</h3>
            <p className="text-xs text-zinc-500 mb-4">Max weight per session — last 6 months</p>
            <StrengthProgressChart series={strengthSeries} />
          </div>

          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-zinc-100">Bodyweight</h3>
              <span className="text-xs text-zinc-500">
                {localBw[localBw.length - 1]?.weightKg} kg
              </span>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              Weekly tracking · target {member.targetWeight} kg
            </p>
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
        <div
          id="panel-Info"
          role="tabpanel"
          aria-labelledby="tab-Info"
          className="px-4 flex flex-col gap-4"
        >
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

      {section === "Recovery & Fuel" && (
        <div
          id="panel-Recovery & Fuel"
          role="tabpanel"
          aria-labelledby="tab-Recovery & Fuel"
          className="px-4 flex flex-col gap-4"
        >
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Recovery score</h3>
            <p className="text-xs text-zinc-500 mt-1">Based on sleep, soreness, hydration and readiness</p>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <p className="text-3xl font-bold text-teal-400">82%</p>
                <p className="text-xs text-zinc-500 mt-1">Good to train with moderate to high intensity</p>
              </div>
              <span className="text-xs bg-teal-600/15 text-teal-300 px-2 py-1 rounded-full">
                Trending up
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500">Sleep</p>
              <p className="mt-2 text-2xl font-bold text-zinc-100">7.8 hrs</p>
              <p className="text-xs text-zinc-500 mt-1">Target 8.0 hrs</p>
            </div>
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500">Hydration</p>
              <p className="mt-2 text-2xl font-bold text-zinc-100">2.3 L</p>
              <p className="text-xs text-zinc-500 mt-1">Target 2.7 L</p>
            </div>
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500">Protein</p>
              <p className="mt-2 text-2xl font-bold text-zinc-100">136 g</p>
              <p className="text-xs text-zinc-500 mt-1">Target 140 g</p>
            </div>
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500">Soreness</p>
              <p className="mt-2 text-2xl font-bold text-zinc-100">Low</p>
              <p className="text-xs text-zinc-500 mt-1">Legs slightly tight</p>
            </div>
          </div>

          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Fuel guidance</h3>
            <div className="mt-3 flex flex-col gap-3">
              <div className="rounded-xl bg-zinc-800 px-3 py-3">
                <p className="text-xs text-zinc-500">Pre-session</p>
                <p className="text-sm text-zinc-100 mt-1">Easy carbs 60–90 mins before training, plus water.</p>
              </div>
              <div className="rounded-xl bg-zinc-800 px-3 py-3">
                <p className="text-xs text-zinc-500">Post-session</p>
                <p className="text-sm text-zinc-100 mt-1">Protein + carbs within 1–2 hours to support recovery.</p>
              </div>
              <div className="rounded-xl bg-zinc-800 px-3 py-3">
                <p className="text-xs text-zinc-500">Coach note</p>
                <p className="text-sm text-zinc-100 mt-1">Aim to increase fluids earlier in the day before your next session.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {section === "Cycle Tracking" && (
        <div
          id="panel-Cycle Tracking"
          role="tabpanel"
          aria-labelledby="tab-Cycle Tracking"
          className="px-4 flex flex-col gap-4"
        >
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Current phase</h3>
                <p className="text-xs text-zinc-500 mt-1">Cycle-aware training and recovery guidance</p>
              </div>
              <span className="text-xs bg-violet-600/15 text-violet-300 px-2 py-1 rounded-full">
                Follicular
              </span>
            </div>
            <p className="text-sm text-zinc-100 mt-4">
              Energy is trending upward. This can be a strong window for progressive loading, higher output sessions and skill work.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500">Day</p>
              <p className="mt-2 text-2xl font-bold text-zinc-100">9</p>
              <p className="text-xs text-zinc-500 mt-1">of current cycle</p>
            </div>
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500">Symptoms</p>
              <p className="mt-2 text-base font-semibold text-zinc-100">Low</p>
              <p className="text-xs text-zinc-500 mt-1">Minimal fatigue reported</p>
            </div>
          </div>

          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Training recommendation</h3>
            <div className="mt-3 flex flex-col gap-3">
              <div className="rounded-xl bg-zinc-800 px-3 py-3">
                <p className="text-xs text-zinc-500">Intensity</p>
                <p className="text-sm text-zinc-100 mt-1">Good time for strength progression or slightly harder conditioning.</p>
              </div>
              <div className="rounded-xl bg-zinc-800 px-3 py-3">
                <p className="text-xs text-zinc-500">Recovery focus</p>
                <p className="text-sm text-zinc-100 mt-1">Keep sleep and fueling consistent to support the higher output window.</p>
              </div>
              <div className="rounded-xl bg-zinc-800 px-3 py-3">
                <p className="text-xs text-zinc-500">Coach note</p>
                <p className="text-sm text-zinc-100 mt-1">Use this section later for symptoms, calendar logging and cycle-aware programming suggestions.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}