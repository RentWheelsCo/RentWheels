const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const calcBookingDays = (pickupDate, returnDate) => {
  const start = new Date(pickupDate);
  const end = new Date(returnDate);
  const diffDays = Math.ceil((end - start) / MS_PER_DAY);
  return Math.max(1, diffDays);
};

