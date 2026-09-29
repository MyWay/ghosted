import type { ParsedPage } from '../types';
import { parseUserResult } from './user';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Depth-limited search for the timeline `instructions` array, wherever X nests it. */
function findInstructions(node: unknown, depth = 0): unknown[] | null {
  if (depth > 8 || !isObj(node)) return null;
  if (Array.isArray(node.instructions)) return node.instructions;
  for (const value of Object.values(node)) {
    const found = findInstructions(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function cursorValue(entry: Obj): string | undefined {
  const content = isObj(entry.content) ? entry.content : {};
  const item = isObj(content.itemContent) ? content.itemContent : {};
  const v = content.value ?? item.value;
  return typeof v === 'string' ? v : undefined;
}

/** X sometimes answers 200 with only an `errors` array (e.g. rate limits). */
export function parseApiErrors(body: unknown): { message: string; rateLimited: boolean } | null {
  if (!isObj(body) || !Array.isArray(body.errors) || body.errors.length === 0) return null;
  const first = isObj(body.errors[0]) ? body.errors[0] : {};
  const message = typeof first.message === 'string' ? first.message : 'unknown error';
  const rateLimited = first.code === 88 || /rate.?limit/i.test(message);
  return { message, rateLimited };
}

/**
 * Parse a Followers / Following response body into users and the bottom cursor.
 * Returns null when the body has no recognisable timeline (treat as a parse failure).
 */
export function parseTimelinePage(body: unknown): ParsedPage | null {
  const instructions = findInstructions(body);
  if (!instructions) return null;

  const page: ParsedPage = { users: [], warnings: 0, unavailable: 0 };
  const entries: Obj[] = [];
  for (const ins of instructions) {
    if (!isObj(ins)) continue;
    if (ins.type === 'TimelineAddEntries' && Array.isArray(ins.entries)) {
      entries.push(...ins.entries.filter(isObj));
    } else if (ins.type === 'TimelineReplaceEntry' && isObj(ins.entry)) {
      entries.push(ins.entry);
    }
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    const entryId = typeof entry.entryId === 'string' ? entry.entryId : '';
    if (entryId.startsWith('cursor-bottom')) {
      page.bottomCursor = cursorValue(entry) ?? page.bottomCursor;
      continue;
    }
    if (entryId.startsWith('cursor-top')) {
      page.topCursor = cursorValue(entry) ?? page.topCursor;
      continue;
    }
    if (!entryId.startsWith('user-')) continue;
    const content = isObj(entry.content) ? entry.content : {};
    const item = isObj(content.itemContent) ? content.itemContent : {};
    const results = isObj(item.user_results) ? item.user_results : {};
    const parsed = parseUserResult(results.result);
    if (parsed.kind === 'unavailable') page.unavailable++;
    else if (parsed.kind === 'invalid') page.warnings++;
    else if (!seen.has(parsed.user.id)) {
      seen.add(parsed.user.id);
      page.users.push(parsed.user);
    }
  }
  return page;
}
