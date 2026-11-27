import { describe, expect, it } from "vitest";

import {
  bareAddress,
  domainStateText,
  fromLineFor,
  gymMayUseCustomEmailDomain,
  readDomainInput,
  readSenderName,
  senderDisplayName,
} from "@/lib/gym-email-domain";
import type { GymEmailDomain } from "@/lib/gyms-schema";

const own = (over: Partial<GymEmailDomain> = {}): GymEmailDomain => ({ name: "ironworks.ie", resendId: "r1", status: "verified", fromLocal: "hello", records: [], createdAt: "", verifiedAt: null, ...over });

describe("which plans include an own email domain", () => {
  it("is the larger bands only", () => {
    expect(gymMayUseCustomEmailDomain({ platformBilling: { band: "b150" } })).toBe(true);
    expect(gymMayUseCustomEmailDomain({ platformBilling: { band: "b501" } })).toBe(true);
    expect(gymMayUseCustomEmailDomain({ platformBilling: { band: "b100" } })).toBe(false);
    expect(gymMayUseCustomEmailDomain({ platformBilling: {} })).toBe(false);
    expect(gymMayUseCustomEmailDomain(undefined)).toBe(false);
  });
});

describe("readDomainInput", () => {
  it("cleans what people type", () => {
    expect(readDomainInput("https://www.IronWorks.ie/contact")).toEqual({ domain: "ironworks.ie", error: null });
    expect(readDomainInput("hello@ironworks.ie")).toEqual({ domain: "ironworks.ie", error: null });
    expect(readDomainInput("  mail.ironworks.co.uk. ")).toEqual({ domain: "mail.ironworks.co.uk", error: null });
  });
  it("refuses free mail services with a helpful reason", () => {
    const r = readDomainInput("gym@gmail.com");
    expect(r.domain).toBeNull();
    expect(r.error).toMatch(/free email service/);
    expect(readDomainInput("outlook.com").domain).toBeNull();
  });
  it("refuses things that are not domains", () => {
    expect(readDomainInput("").domain).toBeNull();
    expect(readDomainInput("localhost").domain).toBeNull();
    expect(readDomainInput("not a domain").domain).toBeNull();
    expect(readDomainInput(42).domain).toBeNull();
    expect(readDomainInput("a..b.ie").domain).toBeNull();
  });
});

describe("readSenderName and senderDisplayName", () => {
  it("accepts a simple word and rejects anything else", () => {
    expect(readSenderName("Hello")).toEqual({ local: "hello", error: null });
    expect(readSenderName("book.ings-1")).toEqual({ local: "book.ings-1", error: null });
    expect(readSenderName("a b").local).toBeNull();
    expect(readSenderName("x@y").local).toBeNull();
    expect(readSenderName("").local).toBeNull();
  });
  it("makes a safe sender name", () => {
    expect(senderDisplayName('Iron "Works" <Gym>\r\nBcc: x')).toBe("Iron Works Gym Bcc: x");
    expect(senderDisplayName("", "Fallback")).toBe("Fallback");
    expect(senderDisplayName(undefined)).toBe("S&C Performance Coaching");
  });
});

describe("fromLineFor", () => {
  it("uses the gym's name on the platform address until the own domain is verified", () => {
    expect(fromLineFor({ name: "Iron Works" }, "S&C <no-reply@sandccoaching.com>")).toBe("Iron Works <no-reply@sandccoaching.com>");
    expect(fromLineFor({ name: "Iron Works", emailDomain: own({ status: "pending" }) }, "no-reply@sandccoaching.com")).toBe("Iron Works <no-reply@sandccoaching.com>");
  });
  it("uses the gym's own address once it is verified", () => {
    expect(fromLineFor({ name: "Iron Works", emailDomain: own() }, "no-reply@sandccoaching.com")).toBe("Iron Works <hello@ironworks.ie>");
  });
  it("bareAddress reads both forms", () => {
    expect(bareAddress("A <a@b.co>")).toBe("a@b.co");
    expect(bareAddress("a@b.co")).toBe("a@b.co");
  });
});

describe("domainStateText", () => {
  it("describes each state in plain words", () => {
    expect(domainStateText(undefined).state).toBe("none");
    expect(domainStateText(own({ status: "pending" })).state).toBe("waiting");
    expect(domainStateText(own({ status: "failed" })).state).toBe("problem");
    expect(domainStateText(own()).text).toContain("hello@ironworks.ie");
  });
});
