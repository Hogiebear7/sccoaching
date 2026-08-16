"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ExerciseMediaSlot } from "@/components/ui/ExerciseMediaSlot";
import type { ExerciseLibraryRecord } from "@/lib/exercise-library/types";

type Item = ExerciseLibraryRecord & { thumbnailUrl: string | null; favorited: boolean };

type FilterKey = "bodyPart" | "equipment" | "category";

export function ExerciseLibraryView({
  items,
  filters,
}: {
  items: Item[];
  filters: { bodyParts: string[]; equipment: string[]; categories: string[] };
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Partial<Record<FilterKey, string>>>({});
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set(items.filter((i) => i.favorited).map((i) => i.id)));
  const [pendingFavoriteId, setPendingFavoriteId] = useState<string | null>(null);
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q) && !item.aliases.some((a) => a.toLowerCase().includes(q))) return false;
      if (active.bodyPart && item.bodyPart !== active.bodyPart) return false;
      if (active.equipment && item.equipment !== active.equipment) return false;
      if (active.category && item.category !== active.category) return false;
      if (onlyFavorites && !favoritedIds.has(item.id)) return false;
      return true;
    });
  }, [items, query, active, onlyFavorites, favoritedIds]);

  async function toggleFavorite(item: Item) {
    const nextFavorited = !favoritedIds.has(item.id);
    setPendingFavoriteId(item.id);
    setFavoritedIds((prev) => {
      const next = new Set(prev);
      if (nextFavorited) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
    try {
      const res = await fetch("/api/exercise-library/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId: item.id, favorited: nextFavorited }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      // Revert on failure — the toggle above was optimistic.
      setFavoritedIds((prev) => {
        const next = new Set(prev);
        if (nextFavorited) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
    } finally {
      setPendingFavoriteId(null);
    }
  }

  function setFilter(key: FilterKey, value: string) {
    setActive((prev) => (prev[key] === value ? { ...prev, [key]: undefined } : { ...prev, [key]: value }));
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-mono text-[11px] uppercase tracking-[0.24em] text-gold">Training</p>
        <h1 className="text-editorial mt-2 text-[32px] leading-[1.05] text-zinc-50 sm:text-[36px]">
          Exercise Library
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Browse demonstrations, cues, and muscle targets for every exercise in the library.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the library…"
            aria-label="Search the exercise library"
            className="w-full max-w-sm rounded-lg border border-border bg-input px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
          />
          <button
            onClick={() => setOnlyFavorites((v) => !v)}
            aria-pressed={onlyFavorites}
            className={`chip label-caps ${onlyFavorites ? "border-primary bg-primary/10 !text-primary" : ""}`}
          >
            ★ Favorites
          </button>
        </div>

        {filters.bodyParts.length > 0 ? (
          <FilterRow label="Body part" options={filters.bodyParts} active={active.bodyPart} onSelect={(v) => setFilter("bodyPart", v)} />
        ) : null}
        {filters.equipment.length > 0 ? (
          <FilterRow label="Equipment" options={filters.equipment} active={active.equipment} onSelect={(v) => setFilter("equipment", v)} />
        ) : null}
        {filters.categories.length > 0 ? (
          <FilterRow label="Category" options={filters.categories} active={active.category} onSelect={(v) => setFilter("category", v)} />
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">
          {items.length === 0
            ? "No exercises are approved yet — staff can import and approve exercises from Staff → Exercise Library."
            : "No exercises match your search/filters."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((item) => (
            <Link
              key={item.id}
              href={`/dashboard/exercise-library/${item.slug}`}
              className="panel hover-lift group block overflow-hidden"
            >
              <ExerciseMediaSlot seed={item.id} name={item.name} gifUrl={item.thumbnailUrl} className="aspect-square w-full" />
              <div className="space-y-1 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium capitalize text-foreground">{item.name}</p>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      void toggleFavorite(item);
                    }}
                    disabled={pendingFavoriteId === item.id}
                    aria-label={favoritedIds.has(item.id) ? "Remove favorite" : "Add favorite"}
                    className={`shrink-0 text-sm ${favoritedIds.has(item.id) ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                  >
                    {favoritedIds.has(item.id) ? "★" : "☆"}
                  </button>
                </div>
                <p className="truncate text-xs capitalize text-muted-foreground">
                  {[item.bodyPart, item.equipment].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  label,
  options,
  active,
  onSelect,
}: {
  label: string;
  options: string[];
  active?: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div>
      <p className="label-caps mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Filter by ${label.toLowerCase()}`}>
        {options.map((opt) => (
          <button
            key={opt}
            aria-pressed={active === opt}
            onClick={() => onSelect(opt)}
            className={`truncate rounded-full border px-2 py-1.5 text-center text-xs font-medium capitalize transition ${
              active === opt
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
