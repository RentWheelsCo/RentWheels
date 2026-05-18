import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";
import { mapBookingToDashboardRow } from "../utils/booking.utils.js";
import { aggregateMonthlyBookingTotals } from "../utils/dashboard.utils.js";

export const getBuyerDashboard = async (req, res, next) => {
    try {
        const startToday = new Date();
        startToday.setHours(0, 0, 0, 0);

        // Limit dashboard aggregates to the last 12 months to keep queries fast as data grows.
        const start12Months = new Date();
        start12Months.setHours(0, 0, 0, 0);
        start12Months.setMonth(start12Months.getMonth() - 12);

        const [totalBookings, ongoingBookings] = await Promise.all([
            prisma.booking.count({ where: { renterId: req.user.id } }),
            prisma.booking.count({
                where: {
                    renterId: req.user.id,
                    status: { not: "CANCELLED" },
                    returnDate: { gte: startToday },
                },
            }),
        ]);

        const recentBookingsRaw = await prisma.booking.findMany({
            where: { renterId: req.user.id },
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

        const spendBookings = await prisma.booking.findMany({
            where: {
                renterId: req.user.id,
                status: { not: "CANCELLED" },
                createdAt: { gte: start12Months },
            },
            select: {
                pickupDate: true,
                returnDate: true,
                vehicle: { select: { dailyPrice: true } },
            },
        });

        const monthlyTotals = aggregateMonthlyBookingTotals(spendBookings, 12);
        const monthlySpending = monthlyTotals.map(({ month, amount }) => ({
            month,
            spend: amount,
        }));

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                totalBookings,
                ongoingBookings,
                recentBookings,
                monthlySpending,
            },
        });
    } catch (error) {
        next(error);
    }
};
