/**
 * Domain types and the mappers that turn database RPC payloads into them.
 *
 * The portfolio model deliberately lives in SQL (see
 * supabase/migrations/0001_init.sql). The database returns `numeric` values as
 * strings so no precision is lost in transit; the mappers below are the single
 * place that converts those strings to JavaScript numbers, and they are used for
 * display and charting only — never to decide a balance, a price, or a trade.
 */

export type AssetType = "stock" | "crypto";
export type Role = "teacher" | "student";
export type TradeSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type OrderStatus =
  | "pending"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "rejected"
  | "expired";

export type Profile = {
  id: string;
  role: Role;
  fullName: string;
  loginHandle: string | null;
  email: string | null;
};

export type Classroom = {
  id: string;
  teacherId: string;
  name: string;
  section: string | null;
  joinCode: string;
  createdAt: string;
};

export type ClassSettings = {
  classroomId: string;
  tradingEnabled: boolean;
  pausedReason: string | null;
  tradingOpensAt: string | null;
  tradingClosesAt: string | null;
  assetPolicy: "all" | "allowlist";
  maxTradeValue: number | null;
  maxPositionPercent: number | null;
  allowFractional: boolean;
  allowedOrderTypes: OrderType[];
  enforceMarketHours: boolean;
  allowExtendedHours: boolean;
  cryptoEnabled: boolean;
  shortSellingEnabled: boolean;
  optionsEnabled: boolean;
};

export type Holding = {
  assetId: string;
  symbol: string;
  displaySymbol: string;
  name: string;
  assetType: AssetType;
  quantity: number;
  avgCost: number;
  lastPrice: number;
  priceStale: boolean;
  priceUpdatedAt: string | null;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  realizedPnl: number;
};

export type Portfolio = {
  studentId: string;
  classroomId: string;
  cashBalance: number;
  initialCapital: number;
  holdingsMarketValue: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  realizedPnl: number;
  unrealizedPnl: number;
  tradeCount: number;
  lastTradeAt: string | null;
  pricesIncomplete: boolean;
  todayPnl: number | null;
  todayPnlPercent: number | null;
  todayBasisKind: "prior_close" | "first_snapshot" | "none";
  todayBasisAt: string | null;
  holdings: Holding[];
};

export type PortfolioSnapshot = {
  capturedAt: string;
  totalValue: number;
  totalPnl: number;
  cashBalance: number;
  holdingsMarketValue: number;
};

export type TradeRecord = {
  id: string;
  side: TradeSide;
  quantity: number;
  price: number;
  totalValue: number;
  realizedPnl: number | null;
  cashBalanceAfter: number;
  createdAt: string;
  symbol: string;
  displaySymbol: string;
  name: string;
  assetType: AssetType;
  studentId: string;
  studentLabel: string;
};

export type LeaderboardRow = {
  studentId: string;
  displayName: string;
  fullName: string;
  loginHandle: string | null;
  cashBalance: number;
  holdingsValue: number;
  totalValue: number;
  initialCapital: number;
  totalPnl: number;
  totalPnlPercent: number;
  realizedPnl: number;
  tradeCount: number;
  lastTradeAt: string | null;
  rank: number;
};

export type ClassOverview = {
  classroomId: string;
  studentCount: number;
  totalCapital: number;
  cashTotal: number;
  trades24h: number;
  leader: string | null;
  lagging: string | null;
  recentTrades: TradeRecord[];
};

export type Competition = {
  id: string;
  classroomId: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  status: "upcoming" | "active" | "ended";
};

export type CompetitionStanding = {
  studentId: string;
  label: string;
  openingValue: number;
  currentValue: number;
  returnAbs: number;
  returnPct: number;
  tradeCount: number;
  rank: number;
};

export type Asset = {
  id: string;
  symbol: string;
  displaySymbol: string;
  name: string;
  assetType: AssetType;
  exchange: string | null;
  currency: string;
};

export type Quote = {
  symbol: string;
  price: number;
  /** Null when the provider has no previous close to compare against. */
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayOpen: number | null;
  providerTime: string | null;
  fetchedAt: string;
  stale: boolean;
};

export type PricePoint = {
  capturedAt: string;
  price: number;
};

/** A working (resting) order on the student's book. */
export type OpenOrder = {
  id: string;
  symbol: string;
  displaySymbol: string;
  side: "buy" | "sell";
  quantity: number;
  filledQuantity: number;
  price: number;
  limitPrice: number | null;
  stopPrice: number | null;
  orderType: OrderType;
  status: OrderStatus;
  createdAt: string;
};

/** A student's request for more capital from the class bank. */
export type FundRequest = {
  id: string;
  classroomId: string;
  studentId: string;
  studentName: string;
  handle: string | null;
  amount: number;
  reason: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  decidedAt: string | null;
};

/** A student login the teacher has to hand out. Returned once, at creation. */
export type ProvisionedStudent = {
  studentId: string;
  fullName: string;
  handle: string;
  externalId: string | null;
  temporaryPassword: string;
};

// ---------------------------------------------------------------------------
// Raw payload shapes (numeric values arrive as strings)
// ---------------------------------------------------------------------------
type RawHolding = {
  asset_id: string;
  symbol: string;
  display_symbol: string;
  name: string;
  asset_type: AssetType;
  quantity: string;
  avg_cost: string;
  last_price: string;
  price_stale: boolean;
  price_updated_at: string | null;
  cost_basis: string;
  market_value: string;
  unrealized_pnl: string;
  unrealized_pnl_pct: string;
  realized_pnl: string;
};

type RawPortfolio = {
  student_id: string;
  classroom_id: string;
  cash_balance: string;
  initial_capital: string;
  holdings_market_value: string;
  total_value: string;
  total_pnl: string;
  total_pnl_percent: string;
  realized_pnl: string;
  unrealized_pnl: string;
  trade_count: number;
  last_trade_at: string | null;
  prices_incomplete: boolean;
  today_pnl: string | null;
  today_pnl_percent: string | null;
  today_basis_kind: "prior_close" | "first_snapshot" | "none";
  today_basis_at: string | null;
  holdings: RawHolding[];
};

export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function numOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapPortfolio(raw: unknown): Portfolio | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawPortfolio;
  if (!r.classroom_id) return null;

  return {
    studentId: r.student_id,
    classroomId: r.classroom_id,
    cashBalance: num(r.cash_balance),
    initialCapital: num(r.initial_capital),
    holdingsMarketValue: num(r.holdings_market_value),
    totalValue: num(r.total_value),
    totalPnl: num(r.total_pnl),
    totalPnlPercent: num(r.total_pnl_percent),
    realizedPnl: num(r.realized_pnl),
    unrealizedPnl: num(r.unrealized_pnl),
    tradeCount: r.trade_count ?? 0,
    lastTradeAt: r.last_trade_at,
    pricesIncomplete: Boolean(r.prices_incomplete),
    todayPnl: numOrNull(r.today_pnl),
    todayPnlPercent: numOrNull(r.today_pnl_percent),
    todayBasisKind: r.today_basis_kind ?? "none",
    todayBasisAt: r.today_basis_at,
    holdings: (r.holdings ?? []).map((h) => ({
      assetId: h.asset_id,
      symbol: h.symbol,
      displaySymbol: h.display_symbol,
      name: h.name,
      assetType: h.asset_type,
      quantity: num(h.quantity),
      avgCost: num(h.avg_cost),
      lastPrice: num(h.last_price),
      priceStale: Boolean(h.price_stale),
      priceUpdatedAt: h.price_updated_at,
      costBasis: num(h.cost_basis),
      marketValue: num(h.market_value),
      unrealizedPnl: num(h.unrealized_pnl),
      unrealizedPnlPct: num(h.unrealized_pnl_pct),
      realizedPnl: num(h.realized_pnl),
    })),
  };
}

export function mapLeaderboard(raw: unknown): LeaderboardRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, string | number | null>;
    return {
      studentId: String(r.student_id),
      displayName: String(r.display_name ?? "Student"),
      fullName: String(r.full_name ?? ""),
      loginHandle: (r.login_handle as string | null) ?? null,
      cashBalance: num(r.cash_balance as string),
      holdingsValue: num(r.holdings_value as string),
      totalValue: num(r.total_value as string),
      initialCapital: num(r.initial_capital as string),
      totalPnl: num(r.total_pnl as string),
      totalPnlPercent: num(r.total_pnl_percent as string),
      realizedPnl: num(r.realized_pnl as string),
      tradeCount: Number(r.trade_count ?? 0),
      lastTradeAt: (r.last_trade_at as string | null) ?? null,
      rank: Number(r.rank_position ?? 0),
    };
  });
}

function mapTrade(row: unknown): TradeRecord {
  const r = row as Record<string, string | number | null>;
  return {
    id: String(r.id),
    side: r.side as TradeSide,
    quantity: num(r.quantity as string),
    price: num(r.price as string),
    totalValue: num(r.total_value as string),
    realizedPnl: numOrNull(r.realized_pnl as string | null),
    cashBalanceAfter: num(r.cash_balance_after as string),
    createdAt: String(r.created_at),
    symbol: String(r.symbol),
    displaySymbol: String(r.display_symbol),
    name: String(r.name),
    assetType: r.asset_type as AssetType,
    studentId: String(r.student_id),
    studentLabel: String(r.student_label ?? "Student"),
  };
}

export function mapTradeHistory(raw: unknown): TradeRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(mapTrade);
}

export function mapFundRequest(row: Record<string, unknown>): FundRequest {
  return {
    id: String(row.id),
    classroomId: String(row.classroom_id),
    studentId: String(row.student_id),
    studentName: String(row.student_name ?? "Student"),
    handle: (row.handle as string | null) ?? null,
    amount: num(row.amount as string),
    reason: String(row.reason ?? ""),
    status: row.status as FundRequest["status"],
    createdAt: String(row.created_at),
    decidedAt: (row.decided_at as string | null) ?? null,
  };
}

export function mapClassOverview(raw: unknown): ClassOverview | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    classroomId: String(r.classroom_id),
    studentCount: Number(r.student_count ?? 0),
    totalCapital: num(r.total_capital as string),
    cashTotal: num(r.cash_total as string),
    trades24h: Number(r.trades_24h ?? 0),
    leader: (r.leader as string | null) ?? null,
    lagging: (r.lagging as string | null) ?? null,
    recentTrades: Array.isArray(r.recent_trades)
      ? (r.recent_trades as unknown[]).map(mapTrade)
      : [],
  };
}

export function mapCompetitionStandings(raw: unknown): CompetitionStanding[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, string | number | null>;
    return {
      studentId: String(r.student_id),
      label: String(r.label ?? "Student"),
      openingValue: num(r.opening_value as string),
      currentValue: num(r.current_value as string),
      returnAbs: num(r.return_abs as string),
      returnPct: num(r.return_pct as string),
      tradeCount: Number(r.trade_count ?? 0),
      rank: Number(r.rank_position ?? 0),
    };
  });
}

/** Client-side view of the market data service. */
export type MarketStatus =
  | { state: "ok" }
  | { state: "unavailable"; reason: string };
