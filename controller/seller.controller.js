import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";
import { calcBookingDays } from "../utils/booking.utils.js";
import { buildVehicleName } from "../utils/vehicle.utils.js";

const getMonthlyRevenue = (bookings, monthsBack = 12) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
    const buckets = new Map();

    for (let i = 0; i < monthsBack; i += 1) {
        const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        buckets.set(key, 0);
    }

    for (const booking of bookings) {
        const d = new Date(booking.pickupDate);
        if (d < start) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!buckets.has(key)) continue;
        const days = calcBookingDays(booking.pickupDate, booking.returnDate);
        const amount = days * booking.vehicle.dailyPrice;
        buckets.set(key, buckets.get(key) + amount);
    }

    return Array.from(buckets.entries()).map(([month, revenue]) => ({
        month,
        revenue,
    }));
};

export const getSellerDashboard = async (req, res, next) => {
    try {
        const [totalVehicles, totalBookings] = await Promise.all([
            prisma.vehicle.count({ where: { ownerId: req.user.id } }),
            prisma.booking.count({
                where: { vehicle: { ownerId: req.user.id } },
            }),
        ]);

        const recentBookingsRaw = await prisma.booking.findMany({
            where: { vehicle: { ownerId: req.user.id } },
            orderBy: { createdAt: "desc" },
            take: 10,
            include: {
                vehicle: {
                    include: {
                        type: true,
                        brand: true,
                        model: true,
                    },
                },
            },
        });

        const recentBookings = recentBookingsRaw.map((booking) => {
            const days = calcBookingDays(booking.pickupDate, booking.returnDate);
            const totalAmount = days * booking.vehicle.dailyPrice;
            return {
                id: booking.id,
                vehicleName: buildVehicleName(booking.vehicle),
                pickupDate: booking.pickupDate,
                returnDate: booking.returnDate,
                totalAmount,
                status: booking.status,
                createdAt: booking.createdAt,
            };
        });

        const revenueBookings = await prisma.booking.findMany({
            where: {
                status: { not: "CANCELLED" },
                vehicle: { ownerId: req.user.id },
            },
            select: {
                pickupDate: true,
                returnDate: true,
                vehicle: { select: { dailyPrice: true } },
            },
        });

        const monthlyRevenue = getMonthlyRevenue(revenueBookings, 12);

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                totalVehicles,
                totalBookings,
                recentBookings,
                monthlyRevenue,
            },
        });
    } catch (error) {
        next(error);
    }
};
