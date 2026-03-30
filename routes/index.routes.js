import express from 'express';
import authRouter from "./auth.routes.js";
import vehicleRouter from "./vehicle.routes.js";
import bookingRouter from "./booking.routes.js";
const mainRouter = express.Router();

mainRouter.use("/auth", authRouter);
mainRouter.use("/vehicles", vehicleRouter);
mainRouter.use("/bookings", bookingRouter);
export default mainRouter;
