import { z } from "zod";

const dateString = z.string().refine((value) => {
    const d = new Date(value);
    return !Number.isNaN(d.getTime());
}, { message: "Invalid date format." });

export const INSURANCE_TYPES = ["BASIC", "STANDARD", "PREMIUM"];
export const insuranceTypeEnum = z.enum(INSURANCE_TYPES);

export const createBookingSchema = z.object({
    vehicleId: z.coerce.number().int().positive(),
    pickupDate: dateString,
    returnDate: dateString,
    insuranceType: insuranceTypeEnum,
}).refine((data) => {
    const pickup = new Date(data.pickupDate);
    const ret = new Date(data.returnDate);
    return pickup <= ret;
}, { message: "returnDate must be on or after pickupDate." });

export const createCheckoutBookingSchema = createBookingSchema;

export const availabilityQuerySchema = z.object({
    pickupDate: dateString.optional(),
    returnDate: dateString.optional(),
}).refine((data) => {
    if (data.pickupDate && data.returnDate) {
        const pickup = new Date(data.pickupDate);
        const ret = new Date(data.returnDate);
        return pickup <= ret;
    }
    return true;
}, { message: "returnDate must be on or after pickupDate." });

