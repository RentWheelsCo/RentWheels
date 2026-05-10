import { z } from "zod";

export const vehicleRecommendationQuerySchema = z
  .object({
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    pickupDate: z.string().optional(),
    returnDate: z.string().optional(),
    locationId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
    explain: z.coerce.boolean().optional(),
    useAI: z.coerce.boolean().optional(),
  })
  .refine((data) => {
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

