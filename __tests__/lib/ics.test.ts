import { describe, expect, it } from "vitest";

import { buildClassIcsEvent, googleCalendarUrl, outlookCalendarUrl } from "@/lib/ics";

describe("buildClassIcsEvent", () => {
  it("produces a valid VEVENT with correct start/end derived from duration", () => {
    const ics = buildClassIcsEvent({
      uid: "class-1-member-1@sandccoaching.com",
      title: "Sunrise Strength",
      date: "2026-08-10",
      startTime: "07:00",
      durationMins: 45,
      location: "S&C Performance Coaching, Navan, Co. Meath",
    });

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:class-1-member-1@sandccoaching.com");
    expect(ics).toContain("SUMMARY:Sunrise Strength");
    expect(ics).toContain("DTSTART:20260810T070000");
    expect(ics).toContain("DTEND:20260810T074500");
    expect(ics).toContain("LOCATION:S&C Performance Coaching\\, Navan\\, Co. Meath");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("escapes commas and semicolons in text fields", () => {
    const ics = buildClassIcsEvent({
      uid: "u1",
      title: "Strength; Conditioning",
      date: "2026-01-01",
      startTime: "09:00",
      durationMins: 30,
    });
    expect(ics).toContain("SUMMARY:Strength\\; Conditioning");
  });

  it("omits LOCATION when none is given", () => {
    const ics = buildClassIcsEvent({
      uid: "u2",
      title: "Mobility",
      date: "2026-01-01",
      startTime: "10:00",
      durationMins: 30,
    });
    expect(ics).not.toContain("LOCATION:");
  });
});

describe("add-to-calendar links", () => {
  const event = { title: "Friday Class", date: "2026-11-20", startTime: "13:00", durationMins: 50, location: "S&C Performance Coaching, Navan, Co. Meath" };

  it("builds a Google Calendar link with local Irish time", () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Friday Class");
    expect(url.searchParams.get("dates")).toBe("20261120T130000/20261120T135000");
    expect(url.searchParams.get("ctz")).toBe("Europe/Dublin");
    expect(url.searchParams.get("location")).toContain("Navan");
  });

  it("builds an Outlook link with ISO start and end", () => {
    const url = new URL(outlookCalendarUrl(event));
    expect(url.host).toBe("outlook.live.com");
    expect(url.searchParams.get("rru")).toBe("addevent");
    expect(url.searchParams.get("subject")).toBe("Friday Class");
    expect(url.searchParams.get("startdt")).toBe("2026-11-20T13:00:00");
    expect(url.searchParams.get("enddt")).toBe("2026-11-20T13:50:00");
  });
});
