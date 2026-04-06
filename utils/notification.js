import prisma from "./db.js";
import { emitToUser } from "./socket.js";
import { sendEmail } from "./email.js";

const canSendEmail = () =>
    Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const safeSendEmail = async ({ to, subject, text, html }) => {
    if (!canSendEmail() || !to) return;
    try {
        await sendEmail({ to, subject, text, html });
    } catch (error) {
        console.error("Failed to send notification email:", error?.message || error);
    }
};

export const notifyUser = async ({ userId, type, title, message, email }) => {
    const notification = await prisma.notification.create({
        data: {
            userId,
            type,
            title,
            message: message || null,
        },
    });

    emitToUser(userId, "notification:new", notification);

    if (email) {
        const text = message || title;
        const html = message ? `<p>${message}</p>` : `<p>${title}</p>`;
        await safeSendEmail({
            to: email,
            subject: title,
            text,
            html,
        });
    }

    return notification;
};
