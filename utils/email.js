import nodemailer from "nodemailer";

const getTransportConfig = () => {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        throw new Error("SMTP configuration is incomplete.");
    }

    const port = Number(process.env.SMTP_PORT || 587);
    const secure =
        typeof process.env.SMTP_SECURE === "string"
            ? process.env.SMTP_SECURE.toLowerCase() === "true"
            : port === 465;

    return {
        host: process.env.SMTP_HOST,
        port,
        secure,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    };
};

export const sendEmail = async ({ to, subject, html, text }) => {
    const transporter = nodemailer.createTransport(getTransportConfig());

    const from =
        process.env.SMTP_FROM ||
        (process.env.SMTP_USER ? `Vehicle Rental <${process.env.SMTP_USER}>` : undefined);

    return transporter.sendMail({
        from,
        to,
        subject,
        text,
        html,
    });
};
