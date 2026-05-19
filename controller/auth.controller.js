import prisma from "../utils/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from "../validations/auth.validation.js";
import crypto from 'crypto';
import { OAuth2Client } from "google-auth-library";
import { sendEmail } from "../utils/email.js";

function getGoogleAudiences() {
    const ids = String(
        process.env.GOOGLE_CLIENT_IDS ||
        process.env.GOOGLE_CLIENT_ID ||
        "",
    )
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return ids;
}

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, role: user.role, isVerified: user.isVerified },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
};

function getAuthCookieOptions(req) {
    const isHttps =
        Boolean(req?.secure) ||
        String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase() === "https";

    const isProd = process.env.NODE_ENV === "production";

    const sameSite = isProd ? "none" : String(process.env.COOKIE_SAMESITE || "strict").toLowerCase();
    const cookieSameSite =
        sameSite === "none" ? "none" : sameSite === "lax" ? "lax" : "strict";

    const secureOverride = process.env.COOKIE_SECURE;
    const cookieSecure =
        secureOverride !== undefined
            ? String(secureOverride).toLowerCase() === "true"
            : cookieSameSite === "none"
                ? true
                : (isProd ? true : isHttps);

    return {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        path: "/",
        maxAge: 1000 * 60 * 60 * 24, // 24h
    };
}

function toUserData(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
    };
}

const createResetToken = () => {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    return { rawToken, hashedToken };
};

function generateOtp6() {
    // OTP must be 6 digits, allow leading zeros
    return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

function hashOtp(otp) {
    return crypto.createHash("sha256").update(String(otp)).digest("hex");
}

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
                phone: parsed.phone,
                role: parsed.role || "user",
                profilePhoto,
                licensePhoto: licensePhoto ? JSON.stringify(licensePhoto) : null,
            },
        });

        const token = generateToken(user);
        res.cookie("authToken", token, getAuthCookieOptions(req));

        return res.status(StatusCodes.CREATED).json({ success: true, token, user: toUserData(user) });
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
        res.cookie("authToken", token, getAuthCookieOptions(req));

        return res.status(StatusCodes.OK).json({ success: true, token, user: toUserData(user) });
    } catch (error) {
        next(error);
    }
};

export const logout = async (req, res, next) => {
    try {
        // COOKIE AUTH IMPLEMENTED
        res.clearCookie("authToken", { ...getAuthCookieOptions(req), maxAge: undefined });
        return res.status(StatusCodes.OK).json({ success: true });
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
                role: user.role,
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
        console.log("[auth/google] hit", {
            hasIdToken: Boolean(req?.body?.idToken),
            origin: req.headers?.origin,
            userAgent: req.headers?.["user-agent"],
        });

        const { idToken } = req.body;
        const audiences = getGoogleAudiences();
        if (!audiences.length) {
            return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                success: false,
                status: StatusCodes.INTERNAL_SERVER_ERROR,
                message: "Google login is not configured (missing GOOGLE_CLIENT_ID).",
            });
        }

        const ticket = await client.verifyIdToken({
            idToken,
            audience: audiences,
        });

        const payload = ticket.getPayload();
        if (!payload) {
            return res.status(StatusCodes.UNAUTHORIZED).json({
                success: false,
                status: StatusCodes.UNAUTHORIZED,
                message: "Invalid Google token payload.",
            });
        }

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
        res.cookie("authToken", token, getAuthCookieOptions(req));

        // <!-- FULL API INTEGRATION ADDED -->
        return res.status(StatusCodes.OK).json({ success: true, token, user: toUserData(user) });
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
                    : "If the email exists, an OTP has been sent.",
            });
        }

        if (!user.password) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "This account uses google login. Please login with Google.",
            });
        }

        // OTP FLOW (frontend)
        const otp = generateOtp6();
        const hashedToken = hashOtp(otp);
        const expires = new Date(Date.now() + 1000 * 60 * 10); // 10 minutes

        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetPasswordToken: hashedToken,
                resetPasswordExpires: expires,
            },
        });

        const subject = "Your RentWheels OTP Code";
        const text = `Your OTP code is: ${otp}. It will expire in 10 minutes.`;
        const html = `
            <p>Your OTP code is:</p>
            <p style="font-size:20px;font-weight:700;letter-spacing:2px;">${otp}</p>
            <p>This code will expire in 10 minutes.</p>
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

        const body = {
            success: true,
            status: StatusCodes.OK,
            message: isDev
                ? `OTP sent to ${user.email}.`
                : "If the email exists, an OTP has been sent.",
        };
        if (isDev) {
            body.data = { otp };
        }
        return res.status(StatusCodes.OK).json(body);
    } catch (error) {
        next(error);
    }
};

export const resetPassword = async (req, res, next) => {
    try {
        const parsed = resetPasswordSchema.parse(req.body);

        const hashedToken = hashOtp(parsed.otp);

        const user = await prisma.user.findFirst({
            where: {
                email: parsed.email,
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
                message: "Invalid or expired OTP.",
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

