import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time secret comparison. A plain `===` returns on the first
 * mismatching byte, so response time leaks how much of the secret was right.
 * Length-guarded because `timingSafeEqual` throws on unequal buffers.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
