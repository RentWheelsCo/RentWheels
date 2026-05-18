import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";
import { vehicleRecommendationQuerySchema } from "../validations/recommendation.validation.js";
import { buildUserVehicleSignals, pickRecommendations } from "../utils/recommendation.utils.js";
import { isGeminiConfigured } from "../utils/gemini.js";

export const getVehicleRecommendations = async (req, res, next) => {
  try {
    const parsed = vehicleRecommendationQuerySchema.parse(req.query);
    const limit = Math.min(Number(parsed.limit || 10), 20);
    const explain = Boolean(parsed.explain);
    // Only use AI by default if it's actually configured; otherwise keep it fast.
    const useAI =
      parsed.useAI !== undefined ? Boolean(parsed.useAI) : Boolean(isGeminiConfigured());
    const userId = req.user?.id || null;

    const hasDateFilter = Boolean(parsed.pickupDate || parsed.returnDate);
    const pickupDate = hasDateFilter ? new Date(parsed.pickupDate || parsed.returnDate) : null;
    const returnDate = hasDateFilter ? new Date(parsed.returnDate || parsed.pickupDate) : null;

    const where = {};
    if (userId) where.ownerId = { not: userId };
    if (parsed.locationId) where.locationId = parsed.locationId;
    if (parsed.minPrice !== undefined || parsed.maxPrice !== undefined) {
      where.dailyPrice = {};
      if (parsed.minPrice !== undefined) where.dailyPrice.gte = parsed.minPrice;
      if (parsed.maxPrice !== undefined) where.dailyPrice.lte = parsed.maxPrice;
    }
    if (hasDateFilter && pickupDate && returnDate) {
      // Exclude vehicles with non-cancelled overlaps in the requested range.
      where.bookings = {
        none: {
          status: { not: "CANCELLED" },
          AND: [{ pickupDate: { lte: returnDate } }, { returnDate: { gte: pickupDate } }],
        },
      };
    }

    const rawCandidates = await prisma.vehicle.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        ownerId: true,
        typeId: true,
        brandId: true,
        modelId: true,
        categoryId: true,
        transmissionId: true,
        fuelTypeId: true,
        locationId: true,
        year: true,
        dailyPrice: true,
        seatingCapacity: true,
        description: true,
        availabilityStatus: true,
        photos: true,
        createdAt: true,
        type: { select: { id: true, type: true, value: true } },
        brand: { select: { id: true, type: true, value: true } },
        model: { select: { id: true, type: true, value: true, parentId: true } },
        category: { select: { id: true, type: true, value: true } },
        transmission: { select: { id: true, type: true, value: true } },
        fuelType: { select: { id: true, type: true, value: true } },
        location: { select: { id: true, type: true, value: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    });

    let candidates = rawCandidates;

    // Keep the prompt small and the key usage efficient.
    const candidatePool = candidates.slice(0, 30);

    const constraints = {
      pickupDate: parsed.pickupDate || null,
      returnDate: parsed.returnDate || null,
      minPrice: parsed.minPrice ?? null,
      maxPrice: parsed.maxPrice ?? null,
      locationId: parsed.locationId ?? null,
    };

    // Public mode: no auth -> generic recent vehicles (no AI, no signals).
    if (!userId) {
      return res.status(StatusCodes.OK).json({
        success: true,
        status: StatusCodes.OK,
        data: {
          aiUsed: false,
          cached: false,
          constraints,
          signals: null,
          vehicles: candidatePool.slice(0, limit),
          rationales: null,
        },
      });
    }

    const recentBookings = await prisma.booking.findMany({
      where: {
        renterId: userId,
        status: { not: "CANCELLED" },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        vehicle: {
          select: {
            id: true,
            typeId: true,
            brandId: true,
            modelId: true,
            categoryId: true,
            transmissionId: true,
            fuelTypeId: true,
            locationId: true,
            dailyPrice: true,
            seatingCapacity: true,
          },
        },
      },
    });
    const bookingVehicles = recentBookings.map((b) => b.vehicle).filter(Boolean);
    const signals = buildUserVehicleSignals(bookingVehicles);

    const picked = useAI
      ? await pickRecommendations({
          userId,
          limit,
          userSignals: signals,
          candidates: candidatePool,
          constraints,
        })
      : {
          aiUsed: false,
          recommendations: candidatePool.slice(0, limit).map((v) => ({
            vehicleId: v.id,
            score: 0.5,
            rationale: undefined,
          })),
        };

    const idOrder = picked.recommendations.map((r) => r.vehicleId);
    const byId = new Map(candidatePool.map((v) => [v.id, v]));
    const vehicles = idOrder.map((id) => byId.get(id)).filter(Boolean);

    const rationaleById = explain
      ? Object.fromEntries(picked.recommendations.map((r) => [r.vehicleId, r.rationale || null]))
      : null;

    return res.status(StatusCodes.OK).json({
      success: true,
      status: StatusCodes.OK,
      data: {
        aiUsed: picked.aiUsed,
        cached: Boolean(picked.cached),
        constraints,
        signals: {
          totalSignals: signals.totalSignals,
          avgDailyPrice: signals.avgDailyPrice,
        },
        vehicles,
        rationales: rationaleById,
      },
    });
  } catch (error) {
    next(error);
  }
};
