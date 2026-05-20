import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";
import { parsePositiveInt } from "../utils/pagination.js";
import {
    createVehicleSchema,
    updateVehicleSchema,
    listVehiclesSchema,
    createVehicleOptionSchema,
    updateVehicleOptionSchema,
    vehicleOptionTypeEnum,
} from "../validations/vehicle.validation.js";

const REQUIRED_OPTION_TYPES = {
    typeId: "VEHICLE_TYPE",
    brandId: "BRAND",
    modelId: "MODEL",
    categoryId: "CATEGORY",
    transmissionId: "TRANSMISSION",
    fuelTypeId: "FUEL_TYPE",
    locationId: "LOCATION",
};

const assertOptionTypes = (parsed, optionsById) => {
    for (const [field, expectedType] of Object.entries(REQUIRED_OPTION_TYPES)) {
        const option = optionsById.get(parsed[field]);
        if (!option) {
            return `Invalid or inactive option for ${field}.`;
        }
        if (option.type !== expectedType) {
            return `Option for ${field} must be type ${expectedType}.`;
        }
    }
    return null;
};

const ensureModelMatchesBrand = (parsed, optionsById) => {
    const brand = optionsById.get(parsed.brandId);
    const model = optionsById.get(parsed.modelId);
    if (!brand || !model) return "Invalid brand or model option.";
    if (model.parentId !== brand.id) {
        return "Model does not belong to the selected brand.";
    }
    return null;
};

export const createVehicle = async (req, res, next) => {
    try {
        const parsed = createVehicleSchema.parse(req.body);

        const photos = Array.isArray(req.files) ? req.files.map((file) => file.path) : [];
        if (photos.length === 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "At least one vehicle photo is required.",
            });
        }
        if (photos.length > 10) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "You can only upload up to 10 photos.",
            });
        }

        const optionIds = Object.keys(REQUIRED_OPTION_TYPES).map((field) => parsed[field]);
        const options = await prisma.vehicleOption.findMany({
            where: {
                id: { in: optionIds },
                isActive: true,
            },
        });
        const optionsById = new Map(options.map((opt) => [opt.id, opt]));

        const optionError = assertOptionTypes(parsed, optionsById);
        if (optionError) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: optionError,
            });
        }
        const modelError = ensureModelMatchesBrand(parsed, optionsById);
        if (modelError) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: modelError,
            });
        }

        const vehicle = await prisma.vehicle.create({
            data: {
                ownerId: req.user.id,
                typeId: parsed.typeId,
                brandId: parsed.brandId,
                modelId: parsed.modelId,
                categoryId: parsed.categoryId,
                transmissionId: parsed.transmissionId,
                fuelTypeId: parsed.fuelTypeId,
                locationId: parsed.locationId,
                year: parsed.year,
                dailyPrice: parsed.dailyPrice,
                seatingCapacity: parsed.seatingCapacity,
                description: parsed.description || null,
                photos,
            },
        });

        return res.status(StatusCodes.CREATED).json({
            success: true,
            status: StatusCodes.CREATED,
            message: "Vehicle created successfully.",
            data: vehicle,
        });
    } catch (error) {
        next(error);
    }
};

export const getVehicleOptions = async (req, res, next) => {
    try {
        const type = req.query.type ? String(req.query.type).toUpperCase() : null;
        const parentId = req.query.parentId ? Number(req.query.parentId) : null;
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(parsePositiveInt(req.query.limit, 20), 50);
        const skip = (page - 1) * limit;
        if (type) {
            const parsedType = vehicleOptionTypeEnum.safeParse(type);
            if (!parsedType.success) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    status: StatusCodes.BAD_REQUEST,
                    message: "Invalid option type.",
                });
            }
        }
        if (req.query.parentId && (!Number.isInteger(parentId) || parentId <= 0)) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid parentId.",
            });
        }

        const where = {
            ...(type ? { type } : {}),
            ...(parentId ? { parentId } : {}),
            isActive: true,
        };

        const options = await prisma.vehicleOption.findMany({
            where,
            orderBy: { value: "asc" },
            skip,
            take: limit,
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                page,
                limit,
                options,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getVehicles = async (req, res, next) => {
    try {
        const parsed = listVehiclesSchema.parse(req.query);
        const page = parsePositiveInt(parsed.page, 1);
        const limit = Math.min(parsePositiveInt(parsed.limit, 20), 50);
        const skip = (page - 1) * limit;
        const hasDateFilter = Boolean(parsed.pickupDate || parsed.returnDate);
        const pickupDate = hasDateFilter
            ? new Date(parsed.pickupDate || parsed.returnDate)
            : null;
        const returnDate = hasDateFilter
            ? new Date(parsed.returnDate || parsed.pickupDate)
            : null;

        const where = {
            availabilityStatus: "AVAILABLE",
        };
        if (parsed.minPrice !== undefined || parsed.maxPrice !== undefined) {
            where.dailyPrice = {};
            if (parsed.minPrice !== undefined) where.dailyPrice.gte = parsed.minPrice;
            if (parsed.maxPrice !== undefined) where.dailyPrice.lte = parsed.maxPrice;
        }
        if (hasDateFilter && pickupDate && returnDate) {
            where.bookings = {
                none: {
                    status: "CONFIRMED",
                    AND: [
                        { pickupDate: { lte: returnDate } },
                        { returnDate: { gte: pickupDate } },
                    ],
                },
            };
        }

        const vehicles = await prisma.vehicle.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            select: {
                id: true,
                ownerId: true,
                typeId: true,
                brandId: true,
                modelId: true,
                categoryId: true,
                transmissionId: true,
                fuelTypeId: true,
                locationId: true,
                year: true,
                dailyPrice: true,
                seatingCapacity: true,
                description: true,
                availabilityStatus: true,
                photos: true,
                createdAt: true,
                updatedAt: true,
                type: { select: { id: true, type: true, value: true } },
                brand: { select: { id: true, type: true, value: true } },
                model: { select: { id: true, type: true, value: true, parentId: true } },
                category: { select: { id: true, type: true, value: true } },
                transmission: { select: { id: true, type: true, value: true } },
                fuelType: { select: { id: true, type: true, value: true } },
                location: { select: { id: true, type: true, value: true } },
                owner: { select: { id: true, name: true, email: true } },
            },
        });

        const vehiclesWithAvailability = vehicles.map((vehicle) => {
            const manualUnavailable =
                String(vehicle.availabilityStatus || "AVAILABLE").toUpperCase() === "NOT_AVAILABLE";
            // If a date filter was provided, confirmed overlaps were already excluded in the query.
            return { ...vehicle, isAvailable: !manualUnavailable };
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                pickupDate: parsed.pickupDate || null,
                returnDate: parsed.returnDate || null,
                page,
                limit,
                vehicles: vehiclesWithAvailability,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getVehicleById = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid vehicle id.",
            });
        }

        const vehicle = await prisma.vehicle.findUnique({
            where: { id },
            include: {
                type: true,
                brand: true,
                model: true,
                category: true,
                transmission: true,
                fuelType: true,
                location: true,
                owner: {
                    select: { id: true, name: true, email: true, phone: true },
                },
            },
        });

        if (!vehicle) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Vehicle not found.",
            });
        }

        const manualUnavailable =
            String(vehicle.availabilityStatus || "AVAILABLE").toUpperCase() === "NOT_AVAILABLE";
        if (manualUnavailable) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Vehicle not found.",
            });
        }

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: vehicle,
        });
    } catch (error) {
        next(error);
    }
};

export const getMyVehicles = async (req, res, next) => {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(parsePositiveInt(req.query.limit, 20), 50);
        const skip = (page - 1) * limit;

        const where = { ownerId: req.user.id };
        const vehicles = await prisma.vehicle.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            select: {
                id: true,
                ownerId: true,
                typeId: true,
                brandId: true,
                modelId: true,
                categoryId: true,
                transmissionId: true,
                fuelTypeId: true,
                locationId: true,
                year: true,
                dailyPrice: true,
                seatingCapacity: true,
                description: true,
                availabilityStatus: true,
                photos: true,
                createdAt: true,
                updatedAt: true,
                type: { select: { id: true, type: true, value: true } },
                brand: { select: { id: true, type: true, value: true } },
                model: { select: { id: true, type: true, value: true, parentId: true } },
                category: { select: { id: true, type: true, value: true } },
                transmission: { select: { id: true, type: true, value: true } },
                fuelType: { select: { id: true, type: true, value: true } },
                location: { select: { id: true, type: true, value: true } },
                owner: { select: { id: true, name: true, email: true, phone: true } },
            },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                page,
                limit,
                vehicles,
            },
        });
    } catch (error) {
        next(error);
    }
};

const canManageVehicle = (req, vehicle) =>
    req.user?.role === "admin" || vehicle.ownerId === req.user?.id;

export const updateVehicle = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid vehicle id.",
            });
        }

        const parsed = updateVehicleSchema.parse(req.body);
        if (Object.keys(parsed).length === 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "No fields provided to update.",
            });
        }

        const existing = await prisma.vehicle.findUnique({ where: { id } });
        if (!existing) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Vehicle not found.",
            });
        }
        if (!canManageVehicle(req, existing)) {
            return res.status(StatusCodes.FORBIDDEN).json({
                success: false,
                status: StatusCodes.FORBIDDEN,
                message: "You can only manage your own vehicles.",
            });
        }

        const optionFields = [
            "typeId",
            "brandId",
            "modelId",
            "categoryId",
            "transmissionId",
            "fuelTypeId",
            "locationId",
        ];
        const isUpdatingOptions = optionFields.some((field) => parsed[field] !== undefined);
        if (isUpdatingOptions) {
            const mergedOptionIds = {
                typeId: parsed.typeId ?? existing.typeId,
                brandId: parsed.brandId ?? existing.brandId,
                modelId: parsed.modelId ?? existing.modelId,
                categoryId: parsed.categoryId ?? existing.categoryId,
                transmissionId: parsed.transmissionId ?? existing.transmissionId,
                fuelTypeId: parsed.fuelTypeId ?? existing.fuelTypeId,
                locationId: parsed.locationId ?? existing.locationId,
            };

            const optionIds = Object.values(mergedOptionIds);
            const options = await prisma.vehicleOption.findMany({
                where: {
                    id: { in: optionIds },
                    isActive: true,
                },
            });
            const optionsById = new Map(options.map((opt) => [opt.id, opt]));

            const optionError = assertOptionTypes(mergedOptionIds, optionsById);
            if (optionError) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    status: StatusCodes.BAD_REQUEST,
                    message: optionError,
                });
            }
            const modelError = ensureModelMatchesBrand(mergedOptionIds, optionsById);
            if (modelError) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    status: StatusCodes.BAD_REQUEST,
                    message: modelError,
                });
            }
        }

        const vehicle = await prisma.vehicle.update({
            where: { id },
            data: {
                ...parsed,
            },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Vehicle updated successfully.",
            data: vehicle,
        });
    } catch (error) {
        next(error);
    }
};

export const deleteVehicle = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid vehicle id.",
            });
        }

        const vehicle = await prisma.vehicle.findUnique({ where: { id } });
        if (!vehicle) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Vehicle not found.",
            });
        }
        if (!canManageVehicle(req, vehicle)) {
            return res.status(StatusCodes.FORBIDDEN).json({
                success: false,
                status: StatusCodes.FORBIDDEN,
                message: "You can only manage your own vehicles.",
            });
        }

        const bookingCount = await prisma.booking.count({
            where: { vehicleId: id, status: "CONFIRMED" },
        });
        if (bookingCount > 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Vehicle has active bookings and cannot be deleted.",
            });
        }

        // Delete dependents first to avoid foreign-key violations (P2003) when bookings/comments exist.
        await prisma.$transaction(async (tx) => {
            const bookings = await tx.booking.findMany({
                where: { vehicleId: id },
                select: { id: true },
            });
            const bookingIds = bookings.map((b) => b.id);

            if (bookingIds.length > 0) {
                await tx.payment.deleteMany({
                    where: { bookingId: { in: bookingIds } },
                });
                await tx.booking.deleteMany({
                    where: { vehicleId: id },
                });
            }

            const comments = await tx.comment.findMany({
                where: { vehicleId: id },
                select: { id: true },
            });
            const commentIds = comments.map((c) => c.id);

            if (commentIds.length > 0) {
                await tx.commentLike.deleteMany({
                    where: { commentId: { in: commentIds } },
                });
                await tx.comment.deleteMany({
                    where: { vehicleId: id },
                });
            }

            await tx.vehicle.delete({ where: { id } });
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Vehicle deleted successfully.",
        });
    } catch (error) {
        next(error);
    }
};

export const getVehicleOwnerContact = async (req, res, next) => {
    try {
        const vehicleId = Number(req.params.id);
        if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid vehicle id.",
            });
        }

        const vehicle = await prisma.vehicle.findUnique({
            where: { id: vehicleId },
            include: {
                owner: {
                    select: { id: true, name: true, email: true, phone: true },
                },
            },
        });

        if (!vehicle) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Vehicle not found.",
            });
        }

        const manualUnavailable =
            String(vehicle.availabilityStatus || "AVAILABLE").toUpperCase() === "NOT_AVAILABLE";
        if (manualUnavailable) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Vehicle not found.",
            });
        }

        const owner = vehicle.owner;
        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                ownerId: owner.id,
                name: owner.name,
                email: owner.email,
                phone: owner.phone || null,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const createVehicleOption = async (req, res, next) => {
    try {
        const parsed = createVehicleOptionSchema.parse(req.body);

        if (parsed.type === "MODEL") {
            if (!parsed.parentId) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    status: StatusCodes.BAD_REQUEST,
                    message: "MODEL options require parentId (brand).",
                });
            }
            const parent = await prisma.vehicleOption.findFirst({
                where: { id: parsed.parentId, type: "BRAND", isActive: true },
            });
            if (!parent) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    status: StatusCodes.BAD_REQUEST,
                    message: "parentId must reference an active BRAND option.",
                });
            }
        } else if (parsed.parentId) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "parentId is only allowed for MODEL options.",
            });
        }

        const option = await prisma.vehicleOption.create({
            data: {
                type: parsed.type,
                value: parsed.value,
                parentId: parsed.parentId || null,
            },
        });

        return res.status(StatusCodes.CREATED).json({
            success: true,
            status: StatusCodes.CREATED,
            message: "Option created successfully.",
            data: option,
        });
    } catch (error) {
        next(error);
    }
};

export const updateVehicleOption = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid option id.",
            });
        }

        const parsed = updateVehicleOptionSchema.parse(req.body);
        if (Object.keys(parsed).length === 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "No fields provided to update.",
            });
        }

        const option = await prisma.vehicleOption.update({
            where: { id },
            data: parsed,
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Option updated successfully.",
            data: option,
        });
    } catch (error) {
        next(error);
    }
};

export const deactivateVehicleOption = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid option id.",
            });
        }

        const option = await prisma.vehicleOption.update({
            where: { id },
            data: { isActive: false },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Option deactivated successfully.",
            data: option,
        });
    } catch (error) {
        next(error);
    }
};
