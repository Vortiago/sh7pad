// Shared types and helpers for the per-domain validators. The validator
// driver builds a single Ctx, threads it through each domain check, and
// collects PASS / WARN / FAIL Results into one flat list.

export type Severity = 'PASS' | 'WARN' | 'FAIL';

export interface Result {
  rule: string;
  severity: Severity;
  detail: string;
  ref?: string;
}

export interface Ctx {
  buf: Uint8Array;
  results: Result[];
}

export function pass(ctx: Ctx, rule: string, detail: string, ref?: string): void {
  ctx.results.push({ rule, severity: 'PASS', detail, ref });
}

export function warn(ctx: Ctx, rule: string, detail: string, ref?: string): void {
  ctx.results.push({ rule, severity: 'WARN', detail, ref });
}

export function fail(ctx: Ctx, rule: string, detail: string, ref?: string): void {
  ctx.results.push({ rule, severity: 'FAIL', detail, ref });
}
