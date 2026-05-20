import { z } from "zod";
import { geminiGenerateText, isGeminiConfigured } from "./gemini.js";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export const buildUserVehicleSignals = (bookingVehicles = []) => {
  const tally = (arr) => {
    const map = new Map();
    for (const v of arr) {
      map.set(v, (map.get(v) || 0) + 1);
    }
    return map;
  };

  const safeIds = bookingVehicles
    .map((v) => ({
      typeId: v?.typeId,
      brandId: v?.brandId,
      modelId: v?.modelId,
      categoryId: v?.categoryId,
      transmissionId: v?.transmissionId,
      fuelTypeId: v?.fuelTypeId,
      locationId: v?.locationId,
      dailyPrice: typeof v?.dailyPrice === "number" ? v.dailyPrice : null,
      seatingCapacity: typeof v?.seatingCapacity === "number" ? v.seatingCapacity : null,
    }))
    .filter((x) => x.typeId && x.categoryId && x.locationId);

  const prices = safeIds.map((x) => x.dailyPrice).filter((p) => typeof p === "number");
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

  return {
    counts: {
      typeId: tally(safeIds.map((x) => x.typeId)),
      categoryId: tally(safeIds.map((x) => x.categoryId)),
      locationId: tally(safeIds.map((x) => x.locationId)),
      brandId: tally(safeIds.map((x) => x.brandId).filter(Boolean)),
      transmissionId: tally(safeIds.map((x) => x.transmissionId).filter(Boolean)),
      fuelTypeId: tally(safeIds.map((x) => x.fuelTypeId).filter(Boolean)),
    },
    avgDailyPrice: avgPrice,
    totalSignals: safeIds.length,
  };
};

export const scoreVehicle = (vehicle, signals) => {
  const c = signals?.counts;
  if (!c) return 0;

  const pick = (map, id) => (id ? map.get(id) || 0 : 0);
  const type = pick(c.typeId, vehicle.typeId);
  const category = pick(c.categoryId, vehicle.categoryId);
  const location = pick(c.locationId, vehicle.locationId);
  const brand = pick(c.brandId, vehicle.brandId);
  const transmission = pick(c.transmissionId, vehicle.transmissionId);
  const fuel = pick(c.fuelTypeId, vehicle.fuelTypeId);

  const base =
    type * 4 +
    category * 3 +
    location * 2 +
    brand * 1 +
    transmission * 1 +
    fuel * 1;

  const avg = signals.avgDailyPrice;
  let priceBoost = 0;
  if (typeof avg === "number" && typeof vehicle.dailyPrice === "number" && avg > 0) {
    const diffRatio = Math.abs(vehicle.dailyPrice - avg) / avg; // 0 is best
    priceBoost = clamp(1 - diffRatio, 0, 1) * 2;
  }

  return base + priceBoost;
};

const GeminiRecoSchema = z.object({
  recommendations: z
    .array(
      z.object({
        vehicleId: z.number().int().positive(),
        score: z.number().min(0).max(1),
        rationale: z.string().max(280).optional(),
      }),
    )
    .min(1),
});

const normalizeJsonText = (text) => {
  if (typeof text !== "string") return "";
  let t = text.trim();

  // Remove markdown code fences if the model included them.
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // If the model added extra text around JSON, try to slice out the JSON object.
  const firstBrace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    t = t.slice(firstBrace, lastBrace + 1).trim();
  }

  return t;
};

const safeJsonParse = (text) => {
  const normalized = normalizeJsonText(text);
  if (!normalized) throw new Error("Gemini returned empty text.");

  try {
    return JSON.parse(normalized);
  } catch (e) {
    // Common failure: output got cut off mid-JSON. Try parsing up to the last closing brace.
    const lastBrace = normalized.lastIndexOf("}");
    if (lastBrace !== -1) {
      const sliced = normalized.slice(0, lastBrace + 1);
      try {
        return JSON.parse(sliced);
      } catch {}
    }
    throw e;
  }
};

const toPrompt = ({ limit, userSignals, candidates, constraints }) => {
  const topCounts = (map, max = 4) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([id, count]) => ({ id, count }));

  const safeCandidates = candidates.map((v) => ({
    id: v.id,
    type: v.type?.value,
    brand: v.brand?.value,
    model: v.model?.value,
    category: v.category?.value,
    transmission: v.transmission?.value,
    fuelType: v.fuelType?.value,
    location: v.location?.value,
    year: v.year,
    dailyPrice: v.dailyPrice,
    seatingCapacity: v.seatingCapacity,
    description: typeof v.description === "string" ? v.description.slice(0, 140) : null,
  }));

  const signalsSummary = {
    totalSignals: userSignals.totalSignals,
    avgDailyPrice: userSignals.avgDailyPrice,
    topTypeIds: topCounts(userSignals.counts.typeId),
    topCategoryIds: topCounts(userSignals.counts.categoryId),
    topLocationIds: topCounts(userSignals.counts.locationId),
  };

  return [
    "You are a recommendation engine for a vehicle rental platform.",
    "Goal: choose the best vehicle rentals for the user from the provided candidates only.",
    "Rules:",
    `- Output JSON ONLY matching exactly: { \"recommendations\": [{\"vehicleId\": number, \"score\": number (0..1), \"rationale\": string}] }`,
    `- Choose exactly ${limit} items if possible; otherwise return as many as you can from candidates (still in the same array).`,
    "- rationale must be short (max 80 characters).",
    "- Do NOT use unescaped quotes inside rationale.",
    "- Do NOT include any ids not in candidates.",

    "",
    `Constraints: ${JSON.stringify(constraints)}`,
    `UserSignals: ${JSON.stringify(signalsSummary)}`,
    `Candidates: ${JSON.stringify(safeCandidates)}`,
  ].join("\n");
};

const recoCache = new Map(); // key -> { expiresAt:number, value:any }
const geminiCooldown = new Map(); // key -> { until:number, reason:string }
const getCache = (key) => {
  const hit = recoCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    recoCache.delete(key);
    return null;
  }
  return hit.value;
};
const setCache = (key, value, ttlMs) => {
  recoCache.set(key, { expiresAt: Date.now() + ttlMs, value });
};

const getCooldown = (key) => {
  const hit = geminiCooldown.get(key);
  if (!hit) return null;
  if (Date.now() > hit.until) {
    geminiCooldown.delete(key);
    return null;
  }
  return hit;
};

const setCooldown = (key, ttlMs, reason) => {
  geminiCooldown.set(key, { until: Date.now() + ttlMs, reason: String(reason || "") });
};

export const pickRecommendations = async ({
  userId,
  limit,
  userSignals,
  candidates,
  constraints,
  cacheTtlMs = 5 * 60 * 1000,
}) => {
  const fallbackRanked = [...candidates]
    .map((v) => ({ v, s: scoreVehicle(v, userSignals) }))
    .sort((a, b) => b.s - a.s);

  const geminiConfigured = isGeminiConfigured();
  const shouldUseGemini = geminiConfigured && userSignals.totalSignals >= 1;

  console.debug("gemini usage", {
    geminiConfigured,
    geminiEnabled: geminiConfigured,
    userSignalsTotal: userSignals.totalSignals,
    shouldUseGemini,
  });

  if (!shouldUseGemini) {
    // fallback - average-popularity ranking for recommendations
    const avgSignals = {
      counts: {
        typeId: new Map(),
        categoryId: new Map(),
        locationId: new Map(),
        brandId: new Map(),
        transmissionId: new Map(),
        fuelTypeId: new Map(),
      },
      avgDailyPrice: null,
      totalSignals: 0,
    };

    const inc = (map, id) => {
      if (!id) return;
      map.set(id, (map.get(id) || 0) + 1);
    };

    for (const v of candidates) {
      inc(avgSignals.counts.typeId, v?.typeId);
      inc(avgSignals.counts.categoryId, v?.categoryId);
      inc(avgSignals.counts.locationId, v?.locationId);
      inc(avgSignals.counts.brandId, v?.brandId);
      inc(avgSignals.counts.transmissionId, v?.transmissionId);
      inc(avgSignals.counts.fuelTypeId, v?.fuelTypeId);
    }

    avgSignals.totalSignals =
      [...avgSignals.counts.typeId.values()].reduce((a, b) => a + b, 0) || 1;

    const popularityRanked = [...candidates]
      .map((v) => ({ v, s: scoreVehicle(v, avgSignals) }))
      .sort((a, b) => b.s - a.s);

    return {
      aiUsed: false,
      recommendations: popularityRanked.slice(0, limit).map(({ v, s }) => ({
        vehicleId: v.id,
        score: clamp(s / 20, 0, 1),
        rationale: undefined,
      })),
    };
  }

  const cacheKey = JSON.stringify({
    userId,
    limit,
    constraints,
    candidates: candidates.map((c) => c.id),
    signals: {
      total: userSignals.totalSignals,
      avg: userSignals.avgDailyPrice,
      topType: [...userSignals.counts.typeId.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      topCat: [...userSignals.counts.categoryId.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      topLoc: [...userSignals.counts.locationId.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    },
  });
  const cached = getCache(cacheKey);
  if (cached) return { ...cached, aiUsed: true, cached: true };

  const prompt = toPrompt({ limit, userSignals, candidates, constraints });

  // If we recently hit quota/rate limits, don't keep hammering Gemini on every request.
  // Serve fallback quickly until the cooldown expires.
  const cooldownKey = "gemini-global";
  const cooldown = getCooldown(cooldownKey);
  if (cooldown) {
    return {
      aiUsed: false,
      cached: true,
      recommendations: fallbackRanked.slice(0, limit).map(({ v, s }) => ({
        vehicleId: v.id,
        score: clamp(s / 20, 0, 1),
        rationale: undefined,
      })),
    };
  }

  try {
    const text = await geminiGenerateText({
      prompt,
      temperature: 0.2,
      maxOutputTokens: 2000,
    });

    console.debug("gemini extracted text", {
      textLength: text?.length,
      textPreview: typeof text === "string" ? text.slice(0, 300) : null,
    });

    let parsedJson;
    try {
      parsedJson = safeJsonParse(text);
    } catch (e) {
      throw new Error(`Failed to JSON.parse Gemini text: ${String(e?.message || e)}`);
    }


    const parsed = GeminiRecoSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(
        `Gemini response did not match schema: ${parsed.error?.issues?.[0]?.message || "unknown schema error"}`,
      );
    }

    const candidateIdSet = new Set(candidates.map((c) => c.id));
    const cleaned = parsed.data.recommendations
      .filter((r) => candidateIdSet.has(r.vehicleId))
      .slice(0, limit);

    if (cleaned.length === 0) throw new Error("Gemini returned no valid candidate ids.");

    const value = { recommendations: cleaned };
    setCache(cacheKey, value, cacheTtlMs);
    return { aiUsed: true, cached: false, recommendations: cleaned };
  } catch (err) {
    // Prevent repeated 429s from slowing the whole endpoint.
    if (Number(err?.status) === 429 || String(err?.message || "").includes(" 429")) {
      // Gemini often tells us a retry-after in the message; without parsing it,
      // a short cooldown is enough to stop the spam.
      setCooldown(cooldownKey, 45_000, err?.message || "quota exceeded");
    }
    console.error("gemini failed; falling back", {
      userId,
      limit,
      errorMessage: String(err?.message || err),
      errorName: err?.name,
      cached: false,
    });

    return {
      aiUsed: false,
      recommendations: fallbackRanked.slice(0, limit).map(({ v, s }) => ({
        vehicleId: v.id,
        score: clamp(s / 20, 0, 1),
        rationale: undefined,
      })),
    };
  }
};
