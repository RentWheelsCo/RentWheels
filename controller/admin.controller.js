import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const calcBookingDays = (pickupDate, returnDate) => {
    const start = new Date(pickupDate);
    const end = new Date(returnDate);
    const diffDays = Math.ceil((end - start) / MS_PER_DAY);
    return Math.max(1, diffDays);
};

const buildVehicleName = (vehicle) => {
    const brand = vehicle.brand?.value;
    const model = vehicle.model?.value;
    if (brand && model) return `${brand} ${model}`;
    return vehicle.type?.value || "Vehicle";
};

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

export const getAdminDashboard = async (req, res, next) => {
    try {
        const [totalVehicles, totalBookings] = await Promise.all([
            prisma.vehicle.count(),
            prisma.booking.count(),
        ]);

        const recentBookingsRaw = await prisma.booking.findMany({
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
            where: { status: { not: "CANCELLED" } },
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

