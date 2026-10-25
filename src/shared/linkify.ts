/**
 * Split a task title into plain-text and URL segments so the Spotlight task
 * tree can render clickable links. Pure — exported for testing.
 *
 * Token rules (tuned for titles that mix URLs with prose):
 * - A token starts at http:// or https:// and runs until whitespace or a CJK
 *   punctuation/bracket char (，。！？；：、（）「」etc.) — Chinese prose almost
 *   always leans on those instead of spaces to end a URL.
 * - Trailing ASCII punctuation (. , ; : ! ? ") is trimmed back into the text,
 *   and a trailing ')' only when its '(' is not inside the URL itself, so
 *   wrapped-in-parens links like Wikipedia's Foo_(bar) survive intact.
 */

export type TitleSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string };

const URL_TOKEN = /https?:\/\/[^\s"'，。！？；：、（）「」『』【】《》…—]+/gi;
const TRAILING_ASCII_PUNCT = /[.,;:!?"']+$/

export function parseTitleSegments(title: string): TitleSegment[] {
  if (!title) return [];
  const segments: TitleSegment[] = [];
  let cursor = 0;

  for (const match of title.matchAll(URL_TOKEN)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ kind: 'text', text: title.slice(cursor, start) });

    let url = match[0];
    let trailing = '';
    // A ')' belongs to the surrounding prose unless the URL itself opened it.
    while (
      url.endsWith(')') &&
      (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)
    ) {
      url = url.slice(0, -1);
      trailing = ')' + trailing;
    }
    const punct = url.match(TRAILING_ASCII_PUNCT);
    if (punct) {
      trailing = url.slice(-punct[0].length) + trailing;
      url = url.slice(0, -punct[0].length);
    }

    if (url.length > 8) segments.push({ kind: 'link', text: url, url });
    else segments.push({ kind: 'text', text: url });
    if (trailing) segments.push({ kind: 'text', text: trailing });
    cursor = start + match[0].length;
  }

  if (cursor < title.length) segments.push({ kind: 'text', text: title.slice(cursor) });
  return segments;
}
