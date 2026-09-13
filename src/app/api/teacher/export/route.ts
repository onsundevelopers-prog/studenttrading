import { isClassroomTeacher } from "@/lib/auth/guards";
import { getSessionContext } from "@/lib/auth/session";
import {
  loadClassroomSettings,
  loadStudents,
  loadTradeHistory,
} from "@/lib/data/queries";

/**
 * CSV export of a classroom's results: one file, two sections (standings then
 * the full trade ledger). Streamed as an attachment so it works from a plain
 * link.
 *
 * Authorisation is enforced here rather than by hiding the link.
 */
export async function GET(request: Request) {
  const session = await getSessionContext();
  if (!session) {
    return new Response("You don't have permission to access this resource.", {
      status: 401,
    });
  }

  const classroomId = new URL(request.url).searchParams.get("classroomId") ?? "";
  if (!classroomId) return new Response("Missing classroomId.", { status: 400 });

  if (!(await isClassroomTeacher(classroomId, session.userId))) {
    return new Response("You don't have permission to access this resource.", {
      status: 403,
    });
  }

  const [students, trades, settings] = await Promise.all([
    loadStudents(classroomId),
    loadTradeHistory({ classroomId, limit: 500 }),
    loadClassroomSettings(classroomId),
  ]);

  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines: string[] = [];

  lines.push("PaperDesk classroom results");
  lines.push(`${escape("Generated")},${escape(new Date().toISOString())}`);
  lines.push(`${escape("Trading enabled")},${escape(settings?.tradingEnabled ?? "")}`);
  lines.push(`${escape("Permitted assets")},${escape(settings?.assetPolicy ?? "")}`);
  lines.push("");

  lines.push("Standings");
  lines.push(
    [
      "Rank",
      "Student",
      "Handle",
      "Student ID",
      "Portfolio value",
      "Available cash",
      "Investments value",
      "Profit and loss",
      "Return %",
      "Trades placed",
      "Last activity",
    ]
      .map(escape)
      .join(","),
  );
  for (const student of students) {
    lines.push(
      [
        student.rank,
        student.displayName,
        student.handle ?? "",
        student.externalId ?? "",
        student.totalValue.toFixed(4),
        student.cashBalance.toFixed(4),
        student.holdingsValue.toFixed(4),
        student.totalPnl.toFixed(4),
        student.totalPnlPercent.toFixed(4),
        student.tradeCount,
        student.lastTradeAt ?? "",
      ]
        .map(escape)
        .join(","),
    );
  }

  lines.push("");
  lines.push("Trades");
  lines.push(
    [
      "Time",
      "Student",
      "Buy or sell",
      "Symbol",
      "Name",
      "Shares",
      "Price each",
      "Total value",
      "Profit/loss from sold investments",
    ]
      .map(escape)
      .join(","),
  );
  for (const trade of trades) {
    lines.push(
      [
        trade.createdAt,
        trade.studentLabel,
        trade.side,
        trade.symbol,
        trade.name,
        trade.quantity,
        trade.price,
        trade.totalValue,
        trade.realizedPnl ?? "",
      ]
        .map(escape)
        .join(","),
    );
  }

  const filename = `paperdesk-results-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(`\uFEFF${lines.join("\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
