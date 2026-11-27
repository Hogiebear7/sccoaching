import { describe, expect, it } from "vitest";

import { BULK_INVITE_MAX, parseInviteList } from "@/lib/bulk-invite-parse";

describe("parseInviteList", () => {
  it("reads one email per line, lower-cased", () => {
    const r = parseInviteList("Ann@Example.com\nbob@example.com\n");
    expect(r.rows.map((x) => x.email)).toEqual(["ann@example.com", "bob@example.com"]);
    expect(r.invalid).toEqual([]);
  });

  it("reads a CSV with a header, names, quotes and semicolons", () => {
    const r = parseInviteList('Email,Name\nann@example.com,"Ann Byrne"\nbob@example.com;Bob Murphy\n');
    expect(r.rows).toEqual([
      { email: "ann@example.com", name: "Ann Byrne", line: 2 },
      { email: "bob@example.com", name: "Bob Murphy", line: 3 },
    ]);
    expect(r.invalid).toEqual([]);
  });

  it("reads several addresses on one line, with no names", () => {
    const r = parseInviteList("ann@example.com bob@example.com, cat@example.com");
    expect(r.rows.map((x) => x.email)).toEqual(["ann@example.com", "bob@example.com", "cat@example.com"]);
    expect(r.rows.every((x) => x.name === null)).toBe(true);
  });

  it("counts repeats once and reports lines with no email", () => {
    const r = parseInviteList("ann@example.com\nANN@example.com\nnot an email\nbob@example\n");
    expect(r.rows.map((x) => x.email)).toEqual(["ann@example.com"]);
    expect(r.duplicates).toEqual([{ line: 2, email: "ann@example.com" }]);
    expect(r.invalid.map((x) => x.line)).toEqual([3, 4]);
  });

  it("keeps only the first BULK_INVITE_MAX and counts the rest", () => {
    const text = Array.from({ length: BULK_INVITE_MAX + 7 }, (_, i) => `p${i}@example.com`).join("\n");
    const r = parseInviteList(text);
    expect(r.rows).toHaveLength(BULK_INVITE_MAX);
    expect(r.overLimit).toBe(7);
  });

  it("copes with a byte-order mark, Windows line endings and blank lines", () => {
    const r = parseInviteList("﻿Email\r\n\r\nann@example.com\r\n");
    expect(r.rows.map((x) => x.email)).toEqual(["ann@example.com"]);
    expect(r.invalid).toEqual([]);
  });
});
