// Ambient declarations for the `bun:test` API surface used by the colocated
// test suites. The repo has no @types/bun dependency; `bun test` provides the
// real module at runtime and these declarations keep the typecheck guard
// (tsconfig.typecheck.json → src/**) honest about the names the tests use.
// If @types/bun is ever added, delete this file — the real types win.
declare module "bun:test" {
  export interface Matchers {
    toBe(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toMatch(expected: string | RegExp): void;
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    not: Matchers;
  }
  export function expect(actual: unknown): Matchers;
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void): void;
}
