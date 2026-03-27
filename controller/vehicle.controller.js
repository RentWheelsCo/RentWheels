import prisma from "../utils/db.js";
import { StatusCodes } from "http-status-codes";
import {
    createVehicleSchema,
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

        const options = await prisma.vehicleOption.findMany({
            where: {
                ...(type ? { type } : {}),
                ...(parentId ? { parentId } : {}),
                isActive: true,
            },
            orderBy: { value: "asc" },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: options,
        });
    } catch (error) {
        next(error);
    }
};

export const getVehicles = async (req, res, next) => {
    try {
        const parsed = listVehiclesSchema.parse(req.query);

        const where = {};
        if (parsed.minPrice !== undefined || parsed.maxPrice !== undefined) {
            where.dailyPrice = {};
            if (parsed.minPrice !== undefined) where.dailyPrice.gte = parsed.minPrice;
            if (parsed.maxPrice !== undefined) where.dailyPrice.lte = parsed.maxPrice;
        }

        const vehicles = await prisma.vehicle.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                type: true,
                brand: true,
                model: true,
                category: true,
                transmission: true,
                fuelType: true,
                location: true,
                owner: {
                    select: { id: true, name: true, email: true },
                },
            },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                pickupDate: parsed.pickupDate || null,
                returnDate: parsed.returnDate || null,
                vehicles,
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
