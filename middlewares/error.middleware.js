import { StatusCodes } from "http-status-codes";

export const errorMiddleware = (err, req, res, next) => {
    if (err?.name === "ZodError") {
        return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            status: StatusCodes.BAD_REQUEST,
            message: err.issues?.[0]?.message || "Validation error",
        });
    }

    const statusCode = err.status || StatusCodes.INTERNAL_SERVER_ERROR;
    const message = err.message || "Internal Server Error";

    return res.status(statusCode).json({
        success: false,
        status: statusCode,
        message,
    });
};
