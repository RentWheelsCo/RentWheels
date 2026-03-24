import { StatusCodes } from "http-status-codes";
export const validateGoogleLogin = (req, res, next) => {
    const { idToken } = req.body;

    if (!idToken) {
        return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            status: StatusCodes.BAD_REQUEST,
            message: "idToken is required",
        });
    }
    next();
};
