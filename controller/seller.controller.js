import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";
import { mapBookingToDashboardRow } from "../utils/booking.utils.js";
import { aggregateMonthlyBookingTotals } from "../utils/dashboard.utils.js";

export const getSellerDashboard = async (req, res, next) => {
    try {
        // Limit dashboard to the past 12 months to improve speed.
        const start12Months = new Date();
        start12Months.setHours(0, 0, 0, 0);
        start12Months.setMonth(start12Months.getMonth() - 12);

        const [totalVehicles, totalBookings, activeBookings, pendingBookings] = await Promise.all([
            prisma.vehicle.count({ where: { ownerId: req.user.id } }),
            prisma.booking.count({ where: { vehicle: { ownerId: req.user.id } } }),
            prisma.booking.count({
                where: { status: "CONFIRMED", vehicle: { ownerId: req.user.id } },
            }),
            prisma.booking.count({
                where: { status: "PENDING", vehicle: { ownerId: req.user.id } },
            }),
        ]);

        const recentBookingsRaw = await prisma.booking.findMany({
            where: { vehicle: { ownerId: req.user.id } },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
                id: true,
                pickupDate: true,
                returnDate: true,
                status: true,
                createdAt: true,
                vehicle: {
                    select: {
                        id: true,
                        year: true,
                        dailyPrice: true,
                        photos: true,
                        type: { select: { id: true, value: true } },
                        brand: { select: { id: true, value: true } },
                        model: { select: { id: true, value: true } },
                    },
                },
            },
        });

        const recentBookings = recentBookingsRaw.map(mapBookingToDashboardRow);

        const revenueBookings = await prisma.booking.findMany({
            where: {
                status: { not: "CANCELLED" },
                vehicle: { ownerId: req.user.id },
                createdAt: { gte: start12Months },
            },
            select: {
                pickupDate: true,
                returnDate: true,
                vehicle: { select: { dailyPrice: true } },
            },
        });

        const monthlyTotals = aggregateMonthlyBookingTotals(revenueBookings, 12);
        const monthlyRevenue = monthlyTotals.map(({ month, amount }) => ({
            month,
            revenue: amount,
        }));

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                totalVehicles,
                totalBookings,
                activeBookings,
                pendingBookings,
                recentBookings,
                monthlyRevenue,
            },
        });
    } catch (error) {
        next(error);
    }
};
