import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";
import { createBookingSchema, availabilityQuerySchema } from "../validations/booking.validation.js";
import { notifyUser } from "../utils/notification.js";
import { parsePositiveInt } from "../utils/pagination.js";
import { buildVehicleName } from "../utils/vehicle.utils.js";
import { mapBookingToDashboardRow } from "../utils/booking.utils.js";

const normalizeAvailabilityRange = (query) => {
    const parsed = availabilityQuerySchema.parse(query);
    if (!parsed.pickupDate && !parsed.returnDate) return null;
    const pickupStr = parsed.pickupDate || parsed.returnDate;
    const returnStr = parsed.returnDate || parsed.pickupDate;
    return {
        pickupDate: new Date(pickupStr),
        returnDate: new Date(returnStr),
    };
};

const findOverlappingBookings = async (vehicleIds, pickupDate, returnDate) => {
    if (!vehicleIds.length) return [];
    return prisma.booking.findMany({
        where: {
            vehicleId: { in: vehicleIds },
            status: { not: "CANCELLED" },
            AND: [
                { pickupDate: { lte: returnDate } },
                { returnDate: { gte: pickupDate } },
            ],
        },
        select: { vehicleId: true },
    });
};

export const createBooking = async (req, res, next) => {
    try {
        const parsed = createBookingSchema.parse(req.body);

        const vehicle = await prisma.vehicle.findUnique({
            where: { id: parsed.vehicleId },
            include: {
                owner: { select: { id: true, name: true, email: true } },
                type: true,
                brand: true,
                model: true,
            },
        });

        if (!vehicle) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Vehicle not found.",
            });
        }

        if (vehicle.ownerId === req.user.id) {
            return res.status(StatusCodes.FORBIDDEN).json({
                success: false,
                status: StatusCodes.FORBIDDEN,
                message: "You cannot book your own vehicle.",
            });
        }

        const pickupDate = new Date(parsed.pickupDate);
        const returnDate = new Date(parsed.returnDate);

        const conflicts = await prisma.booking.findFirst({
            where: {
                vehicleId: vehicle.id,
                status: { not: "CANCELLED" },
                AND: [
                    { pickupDate: { lte: returnDate } },
                    { returnDate: { gte: pickupDate } },
                ],
            },
        });

        if (conflicts) {
            return res.status(StatusCodes.CONFLICT).json({
                success: false,
                status: StatusCodes.CONFLICT,
                message: "Vehicle is already booked for the selected dates.",
            });
        }

        const booking = await prisma.booking.create({
            data: {
                vehicleId: vehicle.id,
                renterId: req.user.id,
                pickupDate,
                returnDate,
                insuranceType: parsed.insuranceType,
            },
        });

        try {
            const renter = await prisma.user.findUnique({
                where: { id: req.user.id },
                select: { id: true, name: true, email: true },
            });
            const vehicleName = buildVehicleName(vehicle);
            const pickupLabel = pickupDate.toISOString().split("T")[0];
            const returnLabel = returnDate.toISOString().split("T")[0];

            if (vehicle.ownerId !== req.user.id) {
                await notifyUser({
                    userId: vehicle.ownerId,
                    type: "BOOKING_CREATED",
                    title: "New booking received",
                    message: `${renter?.name || "A renter"} booked your ${vehicleName} from ${pickupLabel} to ${returnLabel}.`,
                    email: vehicle.owner?.email || null,
                });
            }

            await notifyUser({
                userId: req.user.id,
                type: "BOOKING_CONFIRMED",
                title: "Booking confirmed",
                message: `Your booking for ${vehicleName} is confirmed from ${pickupLabel} to ${returnLabel}.`,
                email: renter?.email || null,
            });
        } catch (notifyError) {
            console.error("Failed to send booking notifications:", notifyError?.message || notifyError);
        }

        return res.status(StatusCodes.CREATED).json({
            success: true,
            status: StatusCodes.CREATED,
            message: "Booking created successfully.",
            data: booking,
        });
    } catch (error) {
        next(error);
    }
};

export const getMyBookings = async (req, res, next) => {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(parsePositiveInt(req.query.limit, 20), 50);
        const skip = (page - 1) * limit;

        const where = { renterId: req.user.id };

        const bookings = await prisma.booking.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            include: {
                vehicle: {
                    include: {
                        type: true,
                        brand: true,
                        model: true,
                        category: true,
                        transmission: true,
                        fuelType: true,
                        location: true,
                        owner: { select: { id: true, name: true, email: true } },
                    },
                },
            },
        });

        const data = bookings.map((booking) => {
            const row = mapBookingToDashboardRow(booking);
            return {
                id: row.id,
                pickupDate: row.pickupDate,
                returnDate: row.returnDate,
                insuranceType: booking.insuranceType,
                bookingStatus: booking.status,
                totalAmount: row.totalAmount,
                createdAt: row.createdAt,
                vehicle: {
                    id: booking.vehicle.id,
                    name: row.vehicleName,
                    year: booking.vehicle.year,
                    seatingCapacity: booking.vehicle.seatingCapacity,
                    transmission: booking.vehicle.transmission?.value || null,
                    category: booking.vehicle.category?.value || null,
                    dailyPrice: booking.vehicle.dailyPrice,
                    owner: booking.vehicle.owner,
                },
            };
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                page,
                limit,
                bookings: data,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getMyVehiclesAvailability = async (req, res, next) => {
    try {
        const range = normalizeAvailabilityRange(req.query);
        const pickupDate = range?.pickupDate || new Date();
        const returnDate = range?.returnDate || pickupDate;

        const vehicles = await prisma.vehicle.findMany({
            where: { ownerId: req.user.id },
            orderBy: { createdAt: "desc" },
            include: {
                type: true,
                brand: true,
                model: true,
                category: true,
                transmission: true,
                fuelType: true,
                location: true,
            },
        });

        const vehicleIds = vehicles.map((v) => v.id);
        const overlapping = await findOverlappingBookings(vehicleIds, pickupDate, returnDate);
        const bookedSet = new Set(overlapping.map((b) => b.vehicleId));

        const data = vehicles.map((vehicle) => ({
            id: vehicle.id,
            name: buildVehicleName(vehicle),
            seatingCapacity: vehicle.seatingCapacity,
            transmission: vehicle.transmission?.value || null,
            category: vehicle.category?.value || null,
            dailyPrice: vehicle.dailyPrice,
            availabilityStatus: bookedSet.has(vehicle.id) ? "NOT_AVAILABLE" : "AVAILABLE",
        }));

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                pickupDate,
                returnDate,
                vehicles: data,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getBookingsForMyListings = async (req, res, next) => {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(parsePositiveInt(req.query.limit, 20), 50);
        const skip = (page - 1) * limit;

        const bookings = await prisma.booking.findMany({
            where: { vehicle: { ownerId: req.user.id } },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            include: {
                renter: {
                    select: { id: true, name: true, email: true, phone: true },
                },
                vehicle: {
                    include: {
                        type: true,
                        brand: true,
                        model: true,
                        photos: true,
                    },
                },
            },
        });

        const data = bookings.map((booking) => {
            const row = mapBookingToDashboardRow(booking);
            return {
                id: row.id,
                pickupDate: row.pickupDate,
                returnDate: row.returnDate,
                status: booking.status,
                insuranceType: booking.insuranceType,
                totalAmount: row.totalAmount,
                renter: booking.renter,
                vehicle: {
                    id: booking.vehicle.id,
                    name: row.vehicleName,
                    photos: booking.vehicle.photos,
                },
            };
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                page,
                limit,
                bookings: data,
            },
        });
    } catch (error) {
        next(error);
    }
};

