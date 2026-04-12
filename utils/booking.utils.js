import { buildVehicleName } from "./vehicle.utils.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const calcBookingDays = (pickupDate, returnDate) => {
  const start = new Date(pickupDate);
  const end = new Date(returnDate);
  const diffDays = Math.ceil((end - start) / MS_PER_DAY);
  return Math.max(1, diffDays);
};

/** Shared shape for seller/buyer dashboard “recent booking” rows. */
export const mapBookingToDashboardRow = (booking) => {
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
};
