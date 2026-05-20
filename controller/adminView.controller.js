import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";
import { parsePositiveInt } from "../utils/pagination.js";
import { calcBookingDays } from "../utils/booking.utils.js";
import { buildVehicleName } from "../utils/vehicle.utils.js";

const mapVehicle = (vehicle) => {
  if (!vehicle) return null;

  return {
    id: vehicle.id,
    ownerId: vehicle.ownerId,
    year: vehicle.year,
    dailyPrice: vehicle.dailyPrice,
    seatingCapacity: vehicle.seatingCapacity,
    description: vehicle.description,
    photos: vehicle.photos,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
    name: buildVehicleName(vehicle),
    type: vehicle.type ? { id: vehicle.type.id, value: vehicle.type.value } : null,
    brand: vehicle.brand ? { id: vehicle.brand.id, value: vehicle.brand.value } : null,
    model: vehicle.model ? { id: vehicle.model.id, value: vehicle.model.value } : null,
    category: vehicle.category ? { id: vehicle.category.id, value: vehicle.category.value } : null,
    transmission: vehicle.transmission ? { id: vehicle.transmission.id, value: vehicle.transmission.value } : null,
    fuelType: vehicle.fuelType ? { id: vehicle.fuelType.id, value: vehicle.fuelType.value } : null,
    location: vehicle.location ? { id: vehicle.location.id, value: vehicle.location.value } : null,
    owner: vehicle.owner
      ? {
          id: vehicle.owner.id,
          name: vehicle.owner.name,
          email: vehicle.owner.email,
          phone: vehicle.owner.phone,
          role: vehicle.owner.role,
        }
      : null,
  };
};

export const adminGetAllBookings = async (req, res, next) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;

    const [total, bookingsRaw] = await Promise.all([
      prisma.booking.count(),
      prisma.booking.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          renter: {
            select: { id: true, name: true, email: true, phone: true, role: true },
          },
          vehicle: {
            include: {
              owner: {
                select: { id: true, name: true, email: true, phone: true, role: true },
              },
              type: true,
              brand: true,
              model: true,
              category: true,
              transmission: true,
              fuelType: true,
              location: true,
            },
          },
        },
      }),
    ]);

    const bookings = bookingsRaw.map((booking) => {
      const days = calcBookingDays(booking.pickupDate, booking.returnDate);
      const dailyPrice = booking.vehicle?.dailyPrice || 0;
      const totalAmount = days * dailyPrice;

      return {
        id: booking.id,
        vehicleId: booking.vehicleId,
        renterId: booking.renterId,
        pickupDate: booking.pickupDate,
        returnDate: booking.returnDate,
        insuranceType: booking.insuranceType,
        status: booking.status,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        totalDays: days,
        totalAmount,
        renter: booking.renter,
        vehicle: mapVehicle(booking.vehicle),
      };
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      status: StatusCodes.OK,
      data: {
        page,
        limit,
        total,
        bookings,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const adminGetBookingById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        status: StatusCodes.BAD_REQUEST,
        message: "Invalid booking id.",
      });
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        renter: {
          select: { id: true, name: true, email: true, phone: true, role: true },
        },
        vehicle: {
          include: {
            owner: {
              select: { id: true, name: true, email: true, phone: true, role: true },
            },
            type: true,
            brand: true,
            model: true,
            category: true,
            transmission: true,
            fuelType: true,
            location: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        status: StatusCodes.NOT_FOUND,
        message: "Booking not found.",
      });
    }

    const days = calcBookingDays(booking.pickupDate, booking.returnDate);
    const dailyPrice = booking.vehicle?.dailyPrice || 0;
    const totalAmount = days * dailyPrice;

    return res.status(StatusCodes.OK).json({
      success: true,
      status: StatusCodes.OK,
      data: {
        id: booking.id,
        vehicleId: booking.vehicleId,
        renterId: booking.renterId,
        pickupDate: booking.pickupDate,
        returnDate: booking.returnDate,
        insuranceType: booking.insuranceType,
        status: booking.status,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        totalDays: days,
        totalAmount,
        renter: booking.renter,
        vehicle: mapVehicle(booking.vehicle),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const adminGetAllVehicles = async (req, res, next) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;
    const now = new Date();

    const [total, vehiclesRaw] = await Promise.all([
      prisma.vehicle.count(),
      prisma.vehicle.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          owner: {
            select: { id: true, name: true, email: true, phone: true, role: true },
          },
          type: true,
          brand: true,
          model: true,
          category: true,
          transmission: true,
          fuelType: true,
          location: true,
        },
      }),
    ]);

    const ids = vehiclesRaw.map((v) => v.id);
    const activeWhere =
      ids.length
        ? {
            vehicleId: { in: ids },
            status: "CONFIRMED",
            pickupDate: { lte: now },
            returnDate: { gte: now },
          }
        : null;

    const [activeCountsRaw, activeBookingsRaw] = await Promise.all([
      activeWhere
        ? prisma.booking.groupBy({
            by: ["vehicleId"],
            where: activeWhere,
            _count: { _all: true },
          })
        : [],
      activeWhere
        ? prisma.booking.findMany({
            where: activeWhere,
            orderBy: { createdAt: "desc" },
            include: {
              renter: { select: { id: true, name: true, email: true, phone: true } },
            },
          })
        : [],
    ]);

    const activeCountByVehicleId = new Map(
      activeCountsRaw.map((row) => [row.vehicleId, row._count?._all ?? 0])
    );

    const activeRenterByVehicleId = new Map();
    for (const booking of activeBookingsRaw) {
      if (!activeRenterByVehicleId.has(booking.vehicleId)) {
        activeRenterByVehicleId.set(booking.vehicleId, booking.renter || null);
      }
    }

    const vehicles = vehiclesRaw.map((vehicle) => ({
      ...mapVehicle(vehicle),
      activeBookingsCount: activeCountByVehicleId.get(vehicle.id) ?? 0,
      activeRenter: activeRenterByVehicleId.get(vehicle.id) ?? null,
    }));

    return res.status(StatusCodes.OK).json({
      success: true,
      status: StatusCodes.OK,
      data: {
        page,
        limit,
        total,
        vehicles,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const adminGetVehicleById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        status: StatusCodes.BAD_REQUEST,
        message: "Invalid vehicle id.",
      });
    }

    const vehicleRaw = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, name: true, email: true, phone: true, role: true },
        },
        type: true,
        brand: true,
        model: true,
        category: true,
        transmission: true,
        fuelType: true,
        location: true,
      },
    });

    if (!vehicleRaw) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        status: StatusCodes.NOT_FOUND,
        message: "Vehicle not found.",
      });
    }

    const [activeBooking, commentsPayload] = await Promise.all([
      prisma.booking.findFirst({
        where: {
          vehicleId: id,
          status: "CONFIRMED",
        },
        orderBy: { createdAt: "desc" },
        include: {
          renter: { select: { id: true, name: true, email: true, phone: true } },
        },
      }),
      prisma.comment.findMany({
        where: { vehicleId: id, parentId: null },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          user: { select: { id: true, name: true, profilePhoto: true } },
          _count: { select: { likes: true, replies: true } },
        },
      }),
    ]);

    return res.status(StatusCodes.OK).json({
      success: true,
      status: StatusCodes.OK,
      data: {
        vehicle: mapVehicle(vehicleRaw),
        activeBooking: activeBooking
          ? {
              id: activeBooking.id,
              status: activeBooking.status,
              pickupDate: activeBooking.pickupDate,
              returnDate: activeBooking.returnDate,
              insuranceType: activeBooking.insuranceType,
              createdAt: activeBooking.createdAt,
              renter: activeBooking.renter,
            }
          : null,
        comments: commentsPayload.map((c) => ({
          id: c.id,
          content: c.content,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          user: c.user,
          likeCount: c._count?.likes ?? 0,
          replyCount: c._count?.replies ?? 0,
          parentId: c.parentId || null,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};
