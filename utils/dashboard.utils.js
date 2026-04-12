import { calcBookingDays } from "./booking.utils.js";

/**
 * Buckets non-cancelled booking totals by calendar month of pickup (same logic for renter spend and host revenue).
 */
export const aggregateMonthlyBookingTotals = (bookings, monthsBack = 12) => {
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

    return Array.from(buckets.entries()).map(([month, amount]) => ({ month, amount }));
};
