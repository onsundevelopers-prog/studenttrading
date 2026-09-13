import { z } from "zod";

/**
 * Every value that crosses from the browser into the server is parsed here
 * before it touches business logic. The trading engine additionally re-validates
 * inside SQL, because a server action is not the only thing that could ever call
 * it.
 */

/** Matches the CHECK constraint on profiles.login_handle. */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HANDLE_PATTERN, "Use 2–32 characters: letters, numbers, dot, dash or underscore.");

/** Quantities are parsed as strings so they can be handed to `numeric` intact. */
export const quantitySchema = z
  .string()
  .trim()
  .min(1, "Enter how much you want to trade.")
  .regex(
    /^\d{1,12}(\.\d{1,8})?$/,
    "Enter a number with up to 8 decimal places.",
  )
  .refine((value) => Number(value) > 0, "Enter an amount greater than zero.");

export const credentialsSchema = z.object({
  identifier: z.string().trim().min(2, "Enter your email or student handle."),
  password: z.string().min(1, "Enter your password."),
});

/**
 * Starting capital is never assumed. The default is zero everywhere — a student
 * only has money because a teacher explicitly gave it to them. The field is
 * still optional so an absent form field cannot be read as a chosen 0.
 */
const startingCapitalSchema = z.coerce
  .number()
  .min(0, "Starting capital cannot be negative.")
  .max(100_000_000, "That is larger than this simulator supports.")
  .optional();

export const teacherSignupSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(200, "That password is too long."),
  classroomName: z
    .string()
    .trim()
    .min(2, "Name your classroom.")
    .max(80),
  section: z.string().trim().max(40).optional().default(""),
  startingCapital: startingCapitalSchema,
  // Optional in the schema because the codes list itself is optional (local
  // dev). Whether it is required is decided server-side, where the codes live.
  inviteCode: z.string().trim().max(80).optional().default(""),
});

export const signInSchema = credentialsSchema;

/** Class codes are uppercase, ambiguity-free, 4–10 characters (matches the DB CHECK). */
export const joinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,10}$/, "Enter the class code your teacher gave you.");

/** Self-serve student signup: the class code plus the credentials the student picks. */
export const studentSignupByCodeSchema = z.object({
  classCode: joinCodeSchema,
  fullName: z.string().trim().min(2, "Enter your name.").max(80),
  handle: handleSchema,
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(200, "That password is too long."),
});

export const createClassroomSchema = z.object({
  name: z.string().trim().min(2, "Name your classroom.").max(80),
  section: z.string().trim().max(40).optional().default(""),
  startingCapital: startingCapitalSchema,
});

export const addStudentSchema = z.object({
  fullName: z.string().trim().min(1, "Enter the student's name.").max(80),
  handle: handleSchema,
  externalId: z.string().trim().max(40).optional().default(""),
  startingCapital: z.coerce.number().min(0).max(100_000_000).optional(),
});

export const bulkAddStudentsSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  students: z
    .array(addStudentSchema)
    .min(1, "Add at least one student.")
    .max(200, "Add at most 200 students at a time."),
});

export const tradeSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  symbol: z.string().trim().min(1, "Choose an investment.").max(60),
  side: z.enum(["buy", "sell"], {
    error: "Choose whether you want to buy or sell.",
  }),
  quantity: quantitySchema,
  /** Client-generated, so a double-click cannot place two identical orders. */
  idempotencyKey: z.uuid("That request couldn't be read. Please try again."),
});

export const classSettingsSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  tradingEnabled: z.coerce.boolean(),
  pausedReason: z.string().trim().max(200).optional().default(""),
  tradingOpensAt: z.string().trim().optional().default(""),
  tradingClosesAt: z.string().trim().optional().default(""),
  assetPolicy: z.enum(["all", "allowlist"]),
  maxTradeValue: z
    .union([
      z.literal(""),
      z.coerce.number().positive("The order limit must be greater than zero."),
    ])
    .optional()
    .default(""),
  maxPositionPercent: z
    .union([
      z.literal(""),
      z.coerce
        .number()
        .gt(0, "The limit must be greater than zero.")
        .lte(100, "The limit cannot be more than 100% of a portfolio."),
    ])
    .optional()
    .default(""),
  allowFractional: z.coerce.boolean(),
  // Extended controls (spec §7): at least one order type must stay enabled,
  // otherwise no order could ever be placed.
  allowedOrderTypes: z
    .array(z.enum(["market", "limit", "stop", "stop_limit"]))
    .max(4)
    .default(["market"]),
  enforceMarketHours: z.coerce.boolean(),
  allowExtendedHours: z.coerce.boolean(),
  cryptoEnabled: z.coerce.boolean(),
  shortSellingEnabled: z.coerce.boolean(),
  optionsEnabled: z.coerce.boolean(),
});

export const classPermissionsSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  assetIds: z.array(z.uuid()).max(500).default([]),
});

export const adjustCashSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  studentId: z.uuid("That student couldn't be found."),
  delta: z.coerce
    .number()
    .refine((value) => value !== 0, "Enter an amount other than zero.")
    .refine((value) => Math.abs(value) <= 10_000_000, "That amount is too large."),
  reason: z.string().trim().max(200).optional().default(""),
});

export const resetStudentSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  studentId: z.uuid("That student couldn't be found."),
  startingCapital: z.coerce.number().min(0).max(100_000_000).optional(),
});

export const resetClassroomSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  startingCapital: z.coerce.number().min(0).max(100_000_000).optional(),
});

export const competitionSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  name: z.string().trim().min(2, "Name the competition.").max(80),
  description: z.string().trim().max(400).optional().default(""),
  startsAt: z.string().trim().min(1, "Choose a start time."),
  endsAt: z.string().trim().min(1, "Choose an end time."),
});

export const watchlistSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  symbol: z.string().trim().min(1).max(60),
});

/**
 * A student asking the class bank for capital. The amount is parsed as a string
 * so it reaches the numeric column intact, and the server caps it per class
 * settings — never an assumed limit.
 */
export const requestFundsSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount with up to two decimal places."),
  reason: z.string().trim().max(200, "Keep the reason under 200 characters.").optional().default(""),
});

export const decideFundRequestSchema = z.object({
  requestId: z.uuid("That request couldn't be found."),
  decision: z.enum(["approved", "denied"]),
});

/** Prices are parsed as strings so they reach the numeric columns intact. */
const orderPriceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,4})?$/, "Enter a valid price.");

/** Extended order intake: market, limit, stop, stop-limit (spec §4). */
export const placeOrderSchema = z
  .object({
    classroomId: z.uuid("That classroom couldn't be found."),
    symbol: z.string().trim().min(1, "Choose an investment.").max(60),
    side: z.enum(["buy", "sell"]),
    orderType: z.enum(["market", "limit", "stop", "stop_limit"]),
    quantity: quantitySchema,
    limitPrice: orderPriceSchema.optional().or(z.literal("")),
    stopPrice: orderPriceSchema.optional().or(z.literal("")),
    idempotencyKey: z.string().trim().max(64).optional(),
  })
  .refine(
    (data) => !(data.orderType === "limit" || data.orderType === "stop_limit") ||
      Boolean(data.limitPrice),
    { message: "Enter a limit price for this order.", path: ["limitPrice"] },
  )
  .refine(
    (data) => !(data.orderType === "stop" || data.orderType === "stop_limit") ||
      Boolean(data.stopPrice),
    { message: "Enter a stop price for this order.", path: ["stopPrice"] },
  );

export const removeWatchlistItemSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  itemId: z.uuid("That watchlist item couldn't be found."),
});

export const searchSchema = z
  .string()
  .trim()
  .min(1, "Type something to search for.")
  .max(60, "That search is too long.");

export const selectClassroomSchema = z.object({
  classroomId: z.uuid("That classroom couldn't be found."),
  next: z.string().trim().max(300).optional().default(""),
});

/**
 * Returns the first human-readable message from a Zod failure. Deliberately does
 * not use `error.flatten()`, which moved between Zod major versions.
 */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? "That input was not valid.";
}

/** Parses an HTML datetime-local value into an ISO timestamp. */
export function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
