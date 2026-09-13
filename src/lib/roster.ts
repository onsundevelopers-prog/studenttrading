import { slugifyHandle } from "@/lib/credentials";

/**
 * Parses a pasted class roster.
 *
 * One student per line. Accepted forms:
 *   Ada Lovelace
 *   Ada Lovelace, ada.lovelace
 *   Ada Lovelace, ada.lovelace, 1023847
 * Tabs are accepted as separators too, because that is what pasting out of a
 * spreadsheet produces. Blank lines and `#` comments are ignored, and the first
 * occurrence of a handle wins.
 */

export type RosterLine = {
  fullName: string;
  handle: string;
  externalId: string;
};

export function parseRosterInput(raw: string): RosterLine[] {
  const seen = new Set<string>();
  const lines: RosterLine[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const cells = line.split(/[,\t]/).map((cell) => cell.trim());
    const fullName = cells[0] ?? "";
    if (!fullName) continue;

    const handle = (cells[1] || slugifyHandle(fullName)).toLowerCase();
    if (!handle) continue;

    const externalId = cells[2] ?? "";
    if (seen.has(handle)) continue;
    seen.add(handle);

    lines.push({ fullName, handle, externalId });
  }

  return lines;
}
