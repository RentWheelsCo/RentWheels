export const buildVehicleName = (vehicle) => {
  const brand = vehicle?.brand?.value;
  const model = vehicle?.model?.value;
  if (brand && model) return `${brand} ${model}`;
  return vehicle?.type?.value || "Vehicle";
};

