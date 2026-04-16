import prisma from "./db.js";
import { emitToUser } from "./socket.js";
import { sendEmail } from "./email.js";

/**
 * Notification utility.
 * Saves notifications to the database, emits realtime events, and can send email.
 */

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

/**
 * Creates a notification for a user.
 * Also emits a socket event and optionally sends an email.
 */
export const notifyUser = async ({ userId, type, title, message, email }) => {
    // Save to DB so it can be shown in the user's notification list
    const notification = await prisma.notification.create({
        data: {
            userId,
            type,
            title,
            message: message || null,
        },
    });

    // Realtime notification push
    emitToUser(userId, "notification:new", notification);

    // Email notification
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
