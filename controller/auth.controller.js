import prisma from "../utils/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import { registerSchema, loginSchema } from "../validations/auth.validation.js";
import crypto from 'crypto';
import { OAuth2Client } from "google-auth-library";
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, role: user.role, isVerified: user.isVerified },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
};

export const register = async (req, res, next) => {
    try {
        const parsed = registerSchema.parse(req.body);

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

        const profilePhoto = req.files?.profilePhoto?.[0]?.path || null;
        const licenseFront = req.files?.licensePhoto?.[0]?.path || null;
        const licenseBack = req.files?.licensePhoto?.[1]?.path || null;
        const licensePhoto = licenseFront
            ? licenseBack
                ? [licenseFront, licenseBack]
                : [licenseFront]
            : null;

        const user = await prisma.user.create({
            data: {
                name: parsed.name,
                email: parsed.email,
                password: hashedPassword,
                profilePhoto,
                licensePhoto: licensePhoto ? JSON.stringify(licensePhoto) : null,
            },
        });

        const token = generateToken(user);

        res.status(StatusCodes.CREATED).json({
            success: true,
            status: StatusCodes.CREATED,
            message: "User registered successfully",
            data: {
                id: user.id,
                name: user.name,
                email: user.email,
                isVerified: user.isVerified,
                token,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const login = async (req, res, next) => {
    try {
        const parsed = loginSchema.parse(req.body);

        const user = await prisma.user.findUnique({
            where: { email: parsed.email },
        });

        if (!user) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid Credentials.",
            });
        }

        if (!user.password) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "This account uses google login. Please login with Google.",
            });
        }

        const isMatch = await bcrypt.compare(parsed.password, user.password);

        if (!isMatch) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid email or password",
            });
        }

        const token = generateToken(user);

        res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Login successful",
            data: {
                id: user.id,
                name: user.name,
                email: user.email,
                isVerified: user.isVerified,
                token,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getProfile = async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
        });

        if (!user) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "User not found",
            });
        }

        res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                id: user.id,
                name: user.name,
                email: user.email,
                profilePhoto: user.profilePhoto,
                licensePhoto: user.licensePhoto
                    ? JSON.parse(user.licensePhoto)
                    : null,
                isVerified: user.isVerified,
            },
        });
    } catch (error) {
        next(error);
    }
};


export const googleLogin = async (req, res, next) => {
    try {
        const { idToken } = req.body;

        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const { email, email_verified, name, sub } = payload;

        if (!email || !email_verified) {
            return res.status(StatusCodes.UNAUTHORIZED).json({
                success: false,
                status: StatusCodes.UNAUTHORIZED,
                message: "Google account email not verified",
            });
        }

        let user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    name,
                    email,
                    password: null,
                    googleId: sub,
                    isVerified: true,
                },
            });
        } else if (!user.googleId) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: { googleId: sub },
            });
        }

        const token = generateToken(user);

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Google login successful",
            data: {
                id: user.id,
                name: user.name,
                email: user.email,
                isVerified: user.isVerified,
                token,
            },
        });
    } catch (error) {
        next(error);
    }
};