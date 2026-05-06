import { buildVehicleName } from "./vehicle.utils.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const calcBookingDays = (pickupDate, returnDate) => {
  const start = new Date(pickupDate);
  const end = new Date(returnDate);
  const diffDays = Math.ceil((end - start) / MS_PER_DAY);
  return Math.max(1, diffDays);
};

/**
 * Calculate total booking amount = (dailyPrice * days) + insurance fee
 * Insurance: BASIC=0, STANDARD=10% dailyPrice, PREMIUM=20% dailyPrice (per booking)
 */
export const calculateTotalAmount = (vehicleDailyPrice, pickupDate, returnDate, insuranceType) => {
  const days = calcBookingDays(pickupDate, returnDate);
  let insuranceMultiplier = 0;
  switch (insuranceType.toUpperCase()) {
    case 'STANDARD':
      insuranceMultiplier = 0.1;
      break;
    case 'PREMIUM':
      insuranceMultiplier = 0.2;
      break;
    case 'BASIC':
    default:
      insuranceMultiplier = 0;
  }
  const baseAmount = vehicleDailyPrice * days;
  const insuranceAmount = baseAmount * insuranceMultiplier;
  return baseAmount + insuranceAmount;
};

/** Shared shape for seller/buyer dashboard "recent booking" rows. */
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

