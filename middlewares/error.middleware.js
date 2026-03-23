import { StatusCodes } from "http-status-codes";

export const errorMiddleware = (err, req, res, next) => {
    const statusCode = err.status || StatusCodes.INTERNAL_SERVER_ERROR;
    const message = err.message || "Internal Server Error";

    return res.status(statusCode).json({
        success: false,
        status: statusCode,
        message,
    });
};