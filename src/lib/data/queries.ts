import { createAdminClient } from "@/lib/supabase/admin";
import {
  mapClassOverview,
  mapCompetitionStandings,
  mapLeaderboard,
  mapPortfolio,
  mapTradeHistory,
  num,
  type Asset,
  type AssetType,
  type ClassOverview,
  type ClassSettings,
  type Competition,
  type CompetitionStanding,
  type LeaderboardRow,
  type Portfolio,
  type PortfolioSnapshot,
  type PricePoint,
  type TradeRecord,
} from "@/lib/types";

/**
 * Read-only loaders shared by both dashboards.
 *
 * These use the service-role client, so authorisation has to happen before the
 * call: every page/action that reaches one of these has already been through
 * `requireTeacher`/`requireStudent` plus an ownership check. The portfolio
 * figures themselves are computed by SQL, not here.
 */

/**
 * How recently any price was sampled. Shown in the top bar so nobody has to
 * guess whether the figures on screen are current.
 */
export async function loadPriceFreshness(): Promise<{
  fetchedAt: string | null;
  stale: boolean;
}> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("price_cache")
    .select("fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fetchedAt = data?.fetched_at ?? null;
  if (!fetchedAt) return { fetchedAt: null, stale: true };

  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  return { fetchedAt, stale: ageMs > 5 * 60 * 1000 };
}

export async function loadClassroomSettings(
  classroomId: string,
): Promise<ClassSettings | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("class_settings")
    .select(
      "classroom_id, trading_enabled, paused_reason, trading_opens_at, trading_closes_at, asset_policy, max_trade_value, max_position_percent, allow_fractional, default_starting_capital",
    )
    .eq("classroom_id", classroomId)
    .maybeSingle();

  if (!data) return null;

  return {
    classroomId: data.classroom_id,
    tradingEnabled: data.trading_enabled,
    pausedReason: data.paused_reason,
    tradingOpensAt: data.trading_opens_at,
    tradingClosesAt: data.trading_closes_at,
    assetPolicy: data.asset_policy as "all" | "allowlist",
    maxTradeValue: data.max_trade_value === null ? null : num(data.max_trade_value),
    maxPositionPercent:
      data.max_position_percent === null ? null : num(data.max_position_percent),
    allowFractional: data.allow_fractional,
  };
}

export async function loadDefaultStartingCapital(classroomId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("class_settings")
    .select("default_starting_capital")
    .eq("classroom_id", classroomId)
    .maybeSingle();
  // No silent fallback: an unconfigured classroom starts students at zero,
  // never at an invented balance.
  return num(data?.default_starting_capital ?? 0);
}

export async function loadPortfolio(
  classroomId: string,
  studentId: string,
): Promise<Portfolio | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_portfolio", {
    p_classroom_id: classroomId,
    p_student_id: studentId,
  });
  if (error) return null;
  return mapPortfolio(data);
}

export async function loadLeaderboard(classroomId: string): Promise<LeaderboardRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_leaderboard", {
    p_classroom_id: classroomId,
  });
  if (error) return [];
  return mapLeaderboard(data);
}

export async function loadClassOverview(
  classroomId: string,
): Promise<ClassOverview | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_class_overview", {
    p_classroom_id: classroomId,
  });
  if (error) return null;
  return mapClassOverview(data);
}

export async function loadTradeHistory(options: {
  classroomId: string;
  studentId?: string | null;
  limit?: number;
}): Promise<TradeRecord[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_trade_history", {
    p_classroom_id: options.classroomId,
    p_student_id: options.studentId ?? null,
    p_limit: options.limit ?? 100,
  });
  if (error) return [];
  return mapTradeHistory(data);
}

export async function loadSnapshots(
  classroomId: string,
  studentId: string,
  limit = 400,
): Promise<PortfolioSnapshot[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("portfolio_snapshots")
    .select("captured_at, total_value, total_pnl, cash_balance, holdings_market_value")
    .eq("classroom_id", classroomId)
    .eq("student_id", studentId)
    .order("captured_at", { ascending: true })
    .limit(limit);

  return (data ?? []).map((row) => ({
    capturedAt: row.captured_at,
    totalValue: num(row.total_value),
    totalPnl: num(row.total_pnl),
    cashBalance: num(row.cash_balance),
    holdingsMarketValue: num(row.holdings_market_value),
  }));
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------
export type StudentSummary = {
  studentId: string;
  displayName: string;
  fullName: string;
  handle: string | null;
  externalId: string | null;
  joinedAt: string;
  cashBalance: number;
  holdingsValue: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  tradeCount: number;
  lastTradeAt: string | null;
  rank: number;
};

export async function loadStudents(classroomId: string): Promise<StudentSummary[]> {
  const admin = createAdminClient();

  const [{ data: members }, leaderboard] = await Promise.all([
    admin
      .from("class_members")
      .select(
        "student_id, display_name, external_id, joined_at, profiles ( full_name, login_handle )",
      )
      .eq("classroom_id", classroomId)
      .eq("status", "active")
      .order("joined_at", { ascending: true }),
    loadLeaderboard(classroomId),
  ]);

  const byId = new Map(leaderboard.map((row) => [row.studentId, row]));

  return (members ?? []).map((member) => {
    const profile = Array.isArray(member.profiles)
      ? member.profiles[0]
      : member.profiles;
    const stats = byId.get(member.student_id);

    return {
      studentId: member.student_id,
      displayName:
        member.display_name ||
        profile?.full_name ||
        stats?.displayName ||
        "Student",
      fullName: profile?.full_name ?? "",
      handle: profile?.login_handle ?? null,
      externalId: member.external_id,
      joinedAt: member.joined_at,
      cashBalance: stats?.cashBalance ?? 0,
      holdingsValue: stats?.holdingsValue ?? 0,
      totalValue: stats?.totalValue ?? 0,
      totalPnl: stats?.totalPnl ?? 0,
      totalPnlPercent: stats?.totalPnlPercent ?? 0,
      tradeCount: stats?.tradeCount ?? 0,
      lastTradeAt: stats?.lastTradeAt ?? null,
      rank: stats?.rank ?? 0,
    } satisfies StudentSummary;
  });
}

/** Held symbols across a classroom, for refreshing prices before rendering. */
export async function loadHeldSymbols(classroomId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("holdings")
    .select("assets ( symbol )")
    .eq("classroom_id", classroomId)
    .gt("quantity", 0)
    .limit(500);

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => {
          const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
          return asset?.symbol as string | undefined;
        })
        .filter((symbol): symbol is string => Boolean(symbol)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Assets and market
// ---------------------------------------------------------------------------
type AssetRow = {
  id: string;
  symbol: string;
  display_symbol: string;
  name: string;
  asset_type: string;
  exchange: string | null;
  currency: string;
};

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    symbol: row.symbol,
    displaySymbol: row.display_symbol,
    name: row.name,
    assetType: row.asset_type as AssetType,
    exchange: row.exchange,
    currency: row.currency,
  };
}

const ASSET_COLUMNS = "id, symbol, display_symbol, name, asset_type, exchange, currency";

export async function loadTradeableAssets(limit = 200): Promise<Asset[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("assets")
    .select(ASSET_COLUMNS)
    .eq("is_active", true)
    .order("symbol", { ascending: true })
    .limit(limit);

  return (data ?? []).map((row) => toAsset(row as AssetRow));
}

export async function loadCryptoAssets(limit = 60): Promise<Asset[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("assets")
    .select(ASSET_COLUMNS)
    .eq("is_active", true)
    .eq("asset_type", "crypto")
    .order("symbol", { ascending: true })
    .limit(limit);

  return (data ?? []).map((row) => toAsset(row as AssetRow));
}

export async function loadAssetBySymbol(symbol: string): Promise<Asset | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("assets")
    .select(ASSET_COLUMNS)
    .eq("symbol", symbol.trim().toUpperCase())
    .maybeSingle();

  return data ? toAsset(data as AssetRow) : null;
}

export async function loadAssetById(assetId: string): Promise<Asset | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("assets")
    .select(ASSET_COLUMNS)
    .eq("id", assetId)
    .maybeSingle();

  return data ? toAsset(data as AssetRow) : null;
}

/** The classroom's allow-list, as asset ids. Empty means "no restriction". */
export async function loadClassroomAssetIds(classroomId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("classroom_assets")
    .select("asset_id")
    .eq("classroom_id", classroomId);

  return (data ?? []).map((row) => row.asset_id);
}

export async function isAssetPermitted(
  classroomId: string,
  symbol: string,
): Promise<boolean> {
  const settings = await loadClassroomSettings(classroomId);
  if (!settings) return false;
  if (settings.assetPolicy === "all") return true;

  const admin = createAdminClient();
  const { data } = await admin
    .from("classroom_assets")
    .select("assets!inner ( symbol )")
    .eq("classroom_id", classroomId)
    .eq("assets.symbol", symbol.trim().toUpperCase())
    .maybeSingle();

  return Boolean(data);
}

/**
 * One query for the price history of many assets, so the market list can draw
 * sparklines without N+1 round trips.
 */
export async function loadPriceHistoryForAssets(
  assetIds: string[],
  sinceHours = 48,
): Promise<Map<string, PricePoint[]>> {
  const result = new Map<string, PricePoint[]>();
  if (assetIds.length === 0) return result;

  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();
  const { data } = await admin
    .from("price_history")
    .select("asset_id, captured_at, price")
    .in("asset_id", assetIds)
    .gte("captured_at", since)
    .order("captured_at", { ascending: true })
    .limit(4000);

  for (const row of data ?? []) {
    const list = result.get(row.asset_id) ?? [];
    list.push({ capturedAt: row.captured_at, price: num(row.price) });
    result.set(row.asset_id, list);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------
export type WatchlistEntry = {
  itemId: string;
  asset: Asset;
  addedAt: string;
};

export async function loadWatchlist(
  classroomId: string,
  studentId: string,
): Promise<WatchlistEntry[]> {
  const admin = createAdminClient();

  const { data: list } = await admin
    .from("watchlists")
    .select("id")
    .eq("classroom_id", classroomId)
    .eq("student_id", studentId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!list?.id) return [];

  const { data } = await admin
    .from("watchlist_items")
    .select(`id, created_at, assets ( ${ASSET_COLUMNS} )`)
    .eq("watchlist_id", list.id)
    .order("created_at", { ascending: true });

  return (data ?? [])
    .map((row) => {
      const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
      if (!asset) return null;
      return {
        itemId: row.id,
        asset: toAsset(asset as AssetRow),
        addedAt: row.created_at,
      } satisfies WatchlistEntry;
    })
    .filter((entry): entry is WatchlistEntry => entry !== null);
}

// ---------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------
export type CompetitionWithStandings = Competition & {
  standings: CompetitionStanding[];
};

export function competitionStatus(
  competition: Pick<Competition, "startsAt" | "endsAt">,
): Competition["status"] {
  const now = Date.now();
  if (now < new Date(competition.startsAt).getTime()) return "upcoming";
  if (now > new Date(competition.endsAt).getTime()) return "ended";
  return "active";
}

export async function loadCompetitions(
  classroomId: string,
  withStandings = false,
): Promise<CompetitionWithStandings[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("competitions")
    .select("id, classroom_id, name, description, starts_at, ends_at, created_at")
    .eq("classroom_id", classroomId)
    .order("starts_at", { ascending: false })
    .limit(50);

  const competitions: CompetitionWithStandings[] = (data ?? []).map((row) => ({
    id: row.id,
    classroomId: row.classroom_id,
    name: row.name,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    status: competitionStatus({ startsAt: row.starts_at, endsAt: row.ends_at }),
    standings: [],
  }));

  if (!withStandings) return competitions;

  await Promise.all(
    competitions.map(async (competition) => {
      const { data: standings } = await admin.rpc("get_competition_standings", {
        p_competition_id: competition.id,
      });
      competition.standings = mapCompetitionStandings(standings);
    }),
  );

  return competitions;
}

export async function loadCompetitionsForStudent(
  classroomId: string,
): Promise<CompetitionWithStandings[]> {
  return loadCompetitions(classroomId, true);
}
