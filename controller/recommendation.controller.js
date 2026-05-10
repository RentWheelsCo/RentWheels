import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";
import { vehicleRecommendationQuerySchema } from "../validations/recommendation.validation.js";
import { buildUserVehicleSignals, pickRecommendations } from "../utils/recommendation.utils.js";

export const getVehicleRecommendations = async (req, res, next) => {
  try {
    const parsed = vehicleRecommendationQuerySchema.parse(req.query);
    const limit = Math.min(Number(parsed.limit || 10), 20);
    const explain = Boolean(parsed.explain);
    const useAI = parsed.useAI !== undefined ? Boolean(parsed.useAI) : true;

    const hasDateFilter = Boolean(parsed.pickupDate || parsed.returnDate);
    const pickupDate = hasDateFilter ? new Date(parsed.pickupDate || parsed.returnDate) : null;
    const returnDate = hasDateFilter ? new Date(parsed.returnDate || parsed.pickupDate) : null;

    const recentBookings = await prisma.booking.findMany({
      where: {
        renterId: req.user.id,
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

    const where = {
      ownerId: { not: req.user.id },
    };
    if (parsed.locationId) where.locationId = parsed.locationId;
    if (parsed.minPrice !== undefined || parsed.maxPrice !== undefined) {
      where.dailyPrice = {};
      if (parsed.minPrice !== undefined) where.dailyPrice.gte = parsed.minPrice;
      if (parsed.maxPrice !== undefined) where.dailyPrice.lte = parsed.maxPrice;
    }

    const rawCandidates = await prisma.vehicle.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 60,
      include: {
        type: true,
        brand: true,
        model: true,
        category: true,
        transmission: true,
        fuelType: true,
        location: true,
        owner: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    let candidates = rawCandidates;
    if (hasDateFilter && pickupDate && returnDate && candidates.length) {
      const overlapping = await prisma.booking.findMany({
        where: {
          vehicleId: { in: candidates.map((v) => v.id) },
          status: { not: "CANCELLED" },
          AND: [{ pickupDate: { lte: returnDate } }, { returnDate: { gte: pickupDate } }],
        },
        select: { vehicleId: true },
      });
      const bookedSet = new Set(overlapping.map((b) => b.vehicleId));
      candidates = candidates.filter((v) => !bookedSet.has(v.id));
    }

    // Keep the prompt small and the key usage efficient.
    const candidatePool = candidates.slice(0, 30);

    const constraints = {
      pickupDate: parsed.pickupDate || null,
      returnDate: parsed.returnDate || null,
      minPrice: parsed.minPrice ?? null,
      maxPrice: parsed.maxPrice ?? null,
      locationId: parsed.locationId ?? null,
    };

    const picked = useAI
      ? await pickRecommendations({
          userId: req.user.id,
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

