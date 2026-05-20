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
 * Insurance: NO_INSURANCE=0, HALF_INSURANCE=2.5%, FULL_INSURANCE=5% (per day)
 */
export const calculateTotalAmount = (vehicleDailyPrice, pickupDate, returnDate, insuranceType) => {
  const days = calcBookingDays(pickupDate, returnDate);
  let insuranceMultiplier = 0;
  switch (String(insuranceType || "").toUpperCase()) {
    case 'HALF_INSURANCE':
      insuranceMultiplier = 0.025;
      break;
    case 'FULL_INSURANCE':
      insuranceMultiplier = 0.05;
      break;
    case 'NO_INSURANCE':
    default:
      insuranceMultiplier = 0;
  }
  const baseAmount = vehicleDailyPrice * days;
  const insuranceAmount = baseAmount * insuranceMultiplier;
  return baseAmount + insuranceAmount;
};

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

