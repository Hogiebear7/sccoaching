"use client";

import { useEffect, useState } from "react";

import { currentSeason, type SeasonNow } from "@/lib/seasons";

// The season for this visitor. Worked out in the browser first from the Irish date (so there is no flash, and statically built pages don't freeze the date at
// build time), then confirmed with the server (GET /api/season) so the SEASONS_ENABLED kill switch and SEASON_FORCE apply. ?season=christmas in the address
// bar previews a season, and ?season=new-year the New Year overlay, on any day.
export function useSeason(): SeasonNow {
  const [now, setNow] = useState<SeasonNow>(() => currentSeason(new Date()));

  useEffect(() => {
    const force = new URLSearchParams(window.location.search).get("season");
    const url = force ? `/api/season?force=${encodeURIComponent(force === "new-year" ? "christmas" : force)}` : "/api/season";
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.data) return;
        const data = d.data as SeasonNow;
        setNow(force === "new-year" && data.season ? currentSeason(new Date(), { forceKey: "new-year" }) : data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return now;
}
