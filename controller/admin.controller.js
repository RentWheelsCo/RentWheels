import prisma from "../utils/db.js";
import bcrypt from "bcryptjs";
import { StatusCodes } from "http-status-codes";
import { adminCreateUserSchema, adminUpdateUserSchema } from "../validations/auth.validation.js";

const parsePositiveInt = (value, fallback) => {
    if (value === undefined || value === null || value === "") return fallback;
    const num = Number.parseInt(value, 10);
    if (Number.isNaN(num) || num <= 0) return fallback;
    return num;
};

export const adminCreateUser = async (req, res, next) => {
    try {
        const parsed = adminCreateUserSchema.parse(req.body);

        const existingUser = await prisma.user.findUnique({
            where: { email: parsed.email },
        });

        if (existingUser) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Email already exists",
            });
        }

        const hashedPassword = await bcrypt.hash(parsed.password, 10);

        const user = await prisma.user.create({
            data: {
                name: parsed.name,
                email: parsed.email,
                password: hashedPassword,
                role: parsed.role || "user",
                isVerified: true,
                phone: parsed.phone || null,
            },
        });

        return res.status(StatusCodes.CREATED).json({
            success: true,
            status: StatusCodes.CREATED,
            message: "User created successfully",
            data: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                isVerified: user.isVerified,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const adminUpdateUser = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid user id.",
            });
        }

        const parsed = adminUpdateUserSchema.parse(req.body);
        if (Object.keys(parsed).length === 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "No fields provided to update.",
            });
        }

        if (id === req.user.id && parsed.role === "user") {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "You cannot downgrade your own admin role.",
            });
        }

        const existing = await prisma.user.findUnique({ where: { id } });
        if (!existing) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "User not found",
            });
        }

        if (parsed.email) {
            const emailOwner = await prisma.user.findUnique({
                where: { email: parsed.email },
            });
            if (emailOwner && emailOwner.id !== id) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    status: StatusCodes.BAD_REQUEST,
                    message: "Email already exists",
                });
            }
        }

        const data = { ...parsed };
        if (parsed.password) {
            data.password = await bcrypt.hash(parsed.password, 10);
        }

        const user = await prisma.user.update({
            where: { id },
            data,
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "User updated successfully",
            data: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                isVerified: user.isVerified,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const adminDeleteUser = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid user id.",
            });
        }

        if (id === req.user.id) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "You cannot delete your own account.",
            });
        }

        const existing = await prisma.user.findUnique({ where: { id } });
        if (!existing) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "User not found",
            });
        }

        const [vehicleCount, bookingCount] = await Promise.all([
            prisma.vehicle.count({ where: { ownerId: id } }),
            prisma.booking.count({ where: { renterId: id } }),
        ]);

        if (vehicleCount > 0 || bookingCount > 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "User has related vehicles or bookings and cannot be deleted.",
            });
        }

        await prisma.user.delete({ where: { id } });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "User deleted successfully",
        });
    } catch (error) {
        next(error);
    }
};

export const adminGetAllUsers = async (req, res, next) => {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(parsePositiveInt(req.query.limit, 20), 50);
        const skip = (page - 1) * limit;

        const users = await prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                isVerified: true,
                createdAt: true,
                _count: {
                    select: {
                        vehicles: true,
                        bookings: true,
                    },
                },
            },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                page,
                limit,
                users: users.map((user) => ({
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    isVerified: user.isVerified,
                    createdAt: user.createdAt,
                    vehiclesCount: user._count?.vehicles ?? 0,
                    bookingsCount: user._count?.bookings ?? 0,
                })),
            },
        });
    } catch (error) {
        next(error);
    }
};

export const adminGetUserById = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid user id.",
            });
        }

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                profilePhoto: true,
                licensePhoto: true,
                role: true,
                googleId: true,
                isVerified: true,
                createdAt: true,
                bookings: true,
                vehicles: true,
            },
        });

        if (!user) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "User not found",
            });
        }

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: user,
        });
    } catch (error) {
        next(error);
    }
};
