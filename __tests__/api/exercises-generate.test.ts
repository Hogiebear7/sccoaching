import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockIsAiConfigured, mockGenerateExerciseContent } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockIsAiConfigured: vi.fn(),
  mockGenerateExerciseContent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
}));

vi.mock("@/lib/ai", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai")>("@/lib/ai");
  return {
    ...actual,
    isAiConfigured: mockIsAiConfigured,
    generateExerciseContent: mockGenerateExerciseContent,
  };
});

import { parseExerciseContentResponse } from "@/lib/ai";

const STAFF_USER = { id: "staff-1", email: "coach@example.com", role: "staff" as const };
const MEMBER_USER = { id: "member-1", email: "member@example.com", role: "member" as const };

async function callGenerate(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/staff/exercises/generate/route");
  const request = new NextRequest("http://localhost/api/staff/exercises/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/staff/exercises/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockIsAiConfigured.mockReturnValue(true);
    mockGenerateExerciseContent.mockResolvedValue({
      description: "A hip hinge.",
      cues: "Brace hard\nPush the floor away",
    });
  });

  it("rejects non-staff and reports unconfigured AI honestly", async () => {
    mockFindUserById.mockReturnValue(MEMBER_USER);
    const forbidden = await callGenerate(
      { name: "Deadlift", section: "lower_pull" },
      signSession({ userId: MEMBER_USER.id })
    );
    expect(forbidden.status).toBe(403);

    mockFindUserById.mockReturnValue(STAFF_USER);
    mockIsAiConfigured.mockReturnValue(false);
    const unconfigured = await callGenerate(
      { name: "Deadlift", section: "lower_pull" },
      signSession({ userId: STAFF_USER.id })
    );
    expect(unconfigured.status).toBe(503);
    expect(mockGenerateExerciseContent).not.toHaveBeenCalled();
  });

  it("returns the draft for staff to review", async () => {
    const res = await callGenerate(
      { name: "Deadlift", section: "lower_pull" },
      signSession({ userId: STAFF_USER.id })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.description).toBe("A hip hinge.");
    expect(data.cues).toContain("Brace hard");
    expect(mockGenerateExerciseContent).toHaveBeenCalledWith({
      name: "Deadlift",
      sectionLabel: "Lower Body — Pull",
    });
  });

  it("requires a name and maps unknown exercises to 422", async () => {
    const noName = await callGenerate({ section: "core" }, signSession({ userId: STAFF_USER.id }));
    expect(noName.status).toBe(400);

    mockGenerateExerciseContent.mockResolvedValue(null);
    const unknown = await callGenerate(
      { name: "Zzzzz", section: "core" },
      signSession({ userId: STAFF_USER.id })
    );
    expect(unknown.status).toBe(422);
  });

  it("maps provider failures to 502", async () => {
    mockGenerateExerciseContent.mockRejectedValue(new Error("boom"));
    const res = await callGenerate(
      { name: "Deadlift", section: "lower_pull" },
      signSession({ userId: STAFF_USER.id })
    );
    expect(res.status).toBe(502);
  });
});

describe("parseExerciseContentResponse", () => {
  it("splits the two-block format and enforces caps", () => {
    const parsed = parseExerciseContentResponse(
      "A compound pull from the floor. Trains the whole posterior chain.\nCUES:\nBrace before you pull\nPush the floor away\nBar stays close\n\n"
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.description).toContain("posterior chain");
    expect(parsed!.cues.split("\n")).toHaveLength(3);
  });

  it("returns null for UNKNOWN, empty, and description-less replies", () => {
    expect(parseExerciseContentResponse("UNKNOWN")).toBeNull();
    expect(parseExerciseContentResponse("   ")).toBeNull();
    expect(parseExerciseContentResponse("CUES:\nOnly cues")).toBeNull();
  });

  it("caps cues at five lines", () => {
    const parsed = parseExerciseContentResponse(
      "Desc.\nCUES:\none\ntwo\nthree\nfour\nfive\nsix\nseven"
    );
    expect(parsed!.cues.split("\n")).toHaveLength(5);
  });
});
