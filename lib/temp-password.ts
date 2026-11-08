import { randomInt } from "crypto";

// A temporary password a gym admin can read out or type for a member who can't
// use email (see app/api/staff/members/set-password/route.ts). Shape: Kmtr-bqhs-4827.
// Easy to say aloud: no I/l/1/O/0 lookalikes, no symbols other than the dashes. It
// still satisfies validatePasswordStrength (upper, lower, digit, special, 14
// chars) and carries about 49 bits of randomness from crypto.randomInt.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";

function pick(set: string, count: number): string {
  let out = "";
  for (let i = 0; i < count; i += 1) out += set[randomInt(set.length)];
  return out;
}

export function generateTempPassword(): string {
  return `${pick(UPPER, 1)}${pick(LOWER, 3)}-${pick(LOWER, 4)}-${pick(DIGITS, 4)}`;
}
