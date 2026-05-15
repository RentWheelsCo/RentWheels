import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";

function readBearerToken(authorizationHeader) {
    const raw = String(authorizationHeader || "").trim();
    if (!raw) return null;

    const parts = raw.split(/\s+/);
    if (parts.length < 2) return null;

    const [scheme, token] = parts;
    if (!scheme || !token) return null;
    if (scheme.toLowerCase() !== "bearer") return null;
    return token.trim() || null;
}

function getTokenFromRequest(req) {
    return req.cookies?.authToken || readBearerToken(req.headers?.authorization);
}

/**
 * Authentication middleware.
 * Validates token
 */
export const authMiddleware = (req, res, next) => {
    try {
        const token = getTokenFromRequest(req);
        if (!token) {
            return res.status(StatusCodes.UNAUTHORIZED).json({
                success: false,
                status: StatusCodes.UNAUTHORIZED,
                message: "Unauthorized. Token not provided.",
            });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            next();
        } catch (err) {
            return res.status(StatusCodes.UNAUTHORIZED).json({
                success: false,
                status: StatusCodes.UNAUTHORIZED,
                message: "Unauthorized. Invalid or expired token.",
            });
        }
    } catch (error) {
        return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            status: StatusCodes.INTERNAL_SERVER_ERROR,
            message: "Something went wrong in authentication middleware.",
        });
    }
};


export const optionalAuthMiddleware = (req, _res, next) => {
    try {
        const token = getTokenFromRequest(req);
        if (!token) return next();

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
        } catch {
            // ignore invalid/expired token for optional auth
        }
        return next();
    } catch {
        return next();
    }
};

/**
 * Role authorization middleware.
 */
export const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(StatusCodes.UNAUTHORIZED).json({
                success: false,
                status: StatusCodes.UNAUTHORIZED,
                message: "Unauthorized",
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(StatusCodes.FORBIDDEN).json({
                success: false,
                status: StatusCodes.FORBIDDEN,
                message: "Forbidden. You do not have access to this resource",
            });
        }

        next();
    };
};
