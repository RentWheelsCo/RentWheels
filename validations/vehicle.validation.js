import { z } from "zod";

export const vehicleOptionTypeEnum = z.enum([
    "VEHICLE_TYPE",
    "BRAND",
    "MODEL",
    "CATEGORY",
    "TRANSMISSION",
    "FUEL_TYPE",
    "LOCATION",
]);

export const createVehicleSchema = z.object({
    typeId: z.coerce.number().int().positive(),
    brandId: z.coerce.number().int().positive(),
    modelId: z.coerce.number().int().positive(),
    categoryId: z.coerce.number().int().positive(),
    transmissionId: z.coerce.number().int().positive(),
    fuelTypeId: z.coerce.number().int().positive(),
    locationId: z.coerce.number().int().positive(),
    year: z.coerce.number().int().min(1900).max(2100),
    dailyPrice: z.coerce.number().positive(),
    seatingCapacity: z.coerce.number().int().positive(),
    description: z.string().trim().max(2000).optional(),
});

export const createVehicleOptionSchema = z.object({
    type: vehicleOptionTypeEnum,
    value: z.string().trim().min(1).max(100),
});

export const updateVehicleOptionSchema = z.object({
    value: z.string().trim().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
});

export const listVehiclesSchema = z.object({
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    pickupDate: z.string().optional(),
    returnDate: z.string().optional(),
}).refine((data) => {
    if (data.minPrice !== undefined && data.maxPrice !== undefined) {
        return data.minPrice <= data.maxPrice;
    }
    return true;
}, { message: "minPrice must be less than or equal to maxPrice" })
  .refine((data) => {
    if (data.pickupDate && data.returnDate) {
        const pickup = new Date(data.pickupDate);
        const ret = new Date(data.returnDate);
        return !Number.isNaN(pickup.getTime()) && !Number.isNaN(ret.getTime()) && pickup <= ret;
    }
    if (data.pickupDate) {
        const pickup = new Date(data.pickupDate);
        return !Number.isNaN(pickup.getTime());
    }
    if (data.returnDate) {
        const ret = new Date(data.returnDate);
        return !Number.isNaN(ret.getTime());
    }
    return true;
}, { message: "Invalid pickupDate/returnDate (returnDate must be on or after pickupDate)" });
