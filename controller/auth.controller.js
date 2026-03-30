import prisma from "../utils/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, adminCreateUserSchema } from "../validations/auth.validation.js";
import crypto from 'crypto';
import { OAuth2Client } from "google-auth-library";
import { sendEmail } from "../utils/email.js";
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, role: user.role, isVerified: user.isVerified },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
};

const createResetToken = () => {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    return { rawToken, hashedToken };
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

export const forgotPassword = async (req, res, next) => {
    try {
        const parsed = forgotPasswordSchema.parse(req.body);
        const isDev = process.env.NODE_ENV !== "production";

        const user = await prisma.user.findUnique({
            where: { email: parsed.email },
        });

        if (!user) {
            return res.status(StatusCodes.OK).json({
                success: true,
                status: StatusCodes.OK,
                message: isDev
                    ? `No account found for ${parsed.email}.`
                    : "If the email exists, a reset link has been sent.",
            });
        }

        if (!user.password) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "This account uses google login. Please login with Google.",
            });
        }

        const { rawToken, hashedToken } = createResetToken();
        const expires = new Date(Date.now() + 1000 * 60 * 15);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetPasswordToken: hashedToken,
                resetPasswordExpires: expires,
            },
        });

        const appUrl = process.env.APP_URL || "http://localhost:3000";
        const resetUrl = `${appUrl.replace(/\/$/, "")}/reset-password?token=${rawToken}`;

        const subject = "Reset your password";
        const text = `You requested a password reset. Use this link to reset your password: ${resetUrl}. This link will expire in 15 minutes.`;
        const html = `
            <p>You requested a password reset.</p>
            <p><a href="${resetUrl}">Click here to reset your password</a></p>
            <p>This link will expire in 15 minutes.</p>
        `;

        try {
            await sendEmail({
                to: user.email,
                subject,
                text,
                html,
            });
        } catch (mailError) {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    resetPasswordToken: null,
                    resetPasswordExpires: null,
                },
            });

            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                success: false,
                status: StatusCodes.INTERNAL_SERVER_ERROR,
                message: isDev
                    ? `Failed to send reset email: ${mailError?.message || "Unknown error"}`
                    : "Failed to send reset email. Please try again later.",
            });
        }

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: isDev
                ? `Reset link sent to ${user.email}.`
                : "If the email exists, a reset link has been sent.",
        });
    } catch (error) {
        next(error);
    }
};

export const resetPassword = async (req, res, next) => {
    try {
        const parsed = resetPasswordSchema.parse(req.body);

        const hashedToken = crypto.createHash("sha256").update(parsed.token).digest("hex");

        const user = await prisma.user.findFirst({
            where: {
                resetPasswordToken: hashedToken,
                resetPasswordExpires: {
                    gt: new Date(),
                },
            },
        });

        if (!user) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid or expired reset token.",
            });
        }

        const hashedPassword = await bcrypt.hash(parsed.password, 10);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                resetPasswordToken: null,
                resetPasswordExpires: null,
            },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Password reset successful.",
        });
    } catch (error) {
        next(error);
    }
};

export const uploadUserDocuments = async (req, res, next) => {
    try {
        const profilePhoto = req.files?.profilePhoto?.[0]?.path || null;
        const licenseFront = req.files?.licensePhoto?.[0]?.path || null;
        const licenseBack = req.files?.licensePhoto?.[1]?.path || null;
        const licensePhoto = licenseFront
            ? licenseBack
                ? [licenseFront, licenseBack]
                : [licenseFront]
            : null;

        if (!profilePhoto && !licensePhoto) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "At least one file is required (profilePhoto or licensePhoto).",
            });
        }

        const data = {};
        if (profilePhoto) data.profilePhoto = profilePhoto;
        if (licensePhoto) data.licensePhoto = JSON.stringify(licensePhoto);

        const user = await prisma.user.update({
            where: { id: req.user.id },
            data,
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Documents uploaded successfully.",
            data: {
                id: user.id,
                profilePhoto: user.profilePhoto,
                licensePhoto: user.licensePhoto ? JSON.parse(user.licensePhoto) : null,
            },
        });
    } catch (error) {
        next(error);
    }
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
