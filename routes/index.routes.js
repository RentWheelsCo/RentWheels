import express from 'express';
import authRouter from "./auth.routes.js";
import vehicleRouter from "./vehicle.routes.js";
import bookingRouter from "./booking.routes.js";
import userRouter from "./user.routes.js";
import commentRouter from "./comment.routes.js";
import notificationRouter from "./notification.routes.js";
import adminRouter from "./admin.routes.js";
import recommendationRouter from "./recommendation.routes.js";

const mainRouter = express.Router();

mainRouter.use("/auth", authRouter);
mainRouter.use("/vehicles", vehicleRouter);
mainRouter.use("/bookings", bookingRouter);
mainRouter.use("/user", userRouter);
mainRouter.use("/admin", adminRouter);
mainRouter.use("/comments", commentRouter);
mainRouter.use("/notifications", notificationRouter);
mainRouter.use("/recommendations", recommendationRouter);

export default mainRouter;
