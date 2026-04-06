import { Server } from "socket.io";
import jwt from "jsonwebtoken";

let io = null;

const getTokenFromHandshake = (socket) => {
    const authToken = socket.handshake?.auth?.token;
    if (authToken) return authToken;
    const header = socket.handshake?.headers?.authorization;
    if (header && header.startsWith("Bearer ")) {
        return header.split(" ")[1];
    }
    return null;
};

export const initSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: process.env.APP_URL || "http://localhost:3000",
            methods: ["GET", "POST"],
        },
    });

    io.use((socket, next) => {
        const token = getTokenFromHandshake(socket);
        if (!token) {
            return next(new Error("Unauthorized"));
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded;
            socket.join(`user:${decoded.id}`);
            return next();
        } catch (error) {
            return next(new Error("Unauthorized"));
        }
    });

    io.on("connection", (socket) => {
        socket.emit("connected", { userId: socket.user?.id });
        socket.on("disconnect", () => {});
    });

    return io;
};

export const getIO = () => io;

export const emitToUser = (userId, event, payload) => {
    if (!io || !userId) return;
    io.to(`user:${userId}`).emit(event, payload);
};
