export const parsePositiveInt = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num <= 0) return fallback;
  return num;
};

