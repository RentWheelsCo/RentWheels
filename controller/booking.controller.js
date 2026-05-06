import prisma from "../utils/db.js";
import Stripe from "stripe";
import { StatusCodes } from "http-status-codes";
import { createCheckoutBookingSchema } from "../validations/booking.validation.js";
import { notifyUser } from "../utils/notification.js";
import { parsePositiveInt } from "../utils/pagination.js";
import { buildVehicleName } from "../utils/vehicle.utils.js";
import { mapBookingToDashboardRow, calculateTotalAmount } from "../utils/booking.utils.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export const createPaymentSession = async (req, res, next) => {
    try {
        const parsed = createCheckoutBookingSchema.parse(req.body);

        console.log('Parsed:', parsed);
        console.log('req.user:', req.user);

        const vehicle = await prisma.vehicle.findUnique({
            where: { id: parsed.vehicleId },
        });

        if (!vehicle) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                message: "Vehicle not found.",
            });
        }

        console.log('Vehicle found:', { id: vehicle.id, ownerId: vehicle.ownerId, dailyPrice: vehicle.dailyPrice });

        if (vehicle.ownerId === req.user.id) {
            return res.status(StatusCodes.FORBIDDEN).json({
                success: false,
                message: "You cannot book your own vehicle.",
            });
        }

        const pickupDate = new Date(parsed.pickupDate);
        const returnDate = new Date(parsed.returnDate);

        const conflicts = await prisma.booking.findFirst({
            where: {
                vehicleId: vehicle.id,
                status: { not: "CANCELLED" },
                AND: [
                    { pickupDate: { lte: returnDate } },
                    { returnDate: { gte: pickupDate } },
                ],
            },
        });

        if (conflicts) {
            return res.status(StatusCodes.CONFLICT).json({
                success: false,
                message: "Vehicle is already booked for the selected dates.",
            });
        }

        console.log('DEBUG checkout:', {
            vehicleId: vehicle.id,
            renterId: req.user.id,
            vehicleOwnerId: vehicle.ownerId,
            pickupDate: pickupDate.toISOString(),
            insuranceType: parsed.insuranceType
        });

        const bookingData = {
            vehicleId: vehicle.id,
            renterId: req.user.id,
            pickupDate,
            returnDate,
            insuranceType: parsed.insuranceType,
            status: "PENDING",
        };

        console.log('Booking data:', bookingData);

        const booking = await prisma.booking.create({
            data: bookingData,
        });

        console.log('Booking created:', booking.id);

        const totalAmount = calculateTotalAmount(vehicle.dailyPrice, pickupDate, returnDate, parsed.insuranceType);

        const payment = await prisma.payment.create({
            data: {
                bookingId: booking.id,
                amount: totalAmount,
                currency: "usd",
                status: "pending",
            },
        });

        console.log('Payment created:', payment.id);

        // Create Stripe session AFTER payment record
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: "usd",
                    product_data: {
                        name: `RentWheels Booking - Vehicle ${vehicle.id}`,
                    },
                    unit_amount: Math.round(totalAmount * 100),
                },
                quantity: 1,
            }],
            mode: "payment",
            success_url: `${process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/success'}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/cancel',
            metadata: {
                bookingId: booking.id.toString(),
            },
        });

        console.log('Stripe session:', session.id);

        // UPDATE payment with session ID (nullable field)
        await prisma.payment.update({
            where: { id: payment.id },
            data: {
                stripeCheckoutSession: session.id,
            },
        });

        res.status(StatusCodes.CREATED).json({
            success: true,
            message: "Stripe Checkout ready!",
            data: {
                bookingId: booking.id,
                totalAmount,
                stripeUrl: session.url
            },
        });
    } catch (error) {
        console.error('Full error:', {
            name: error.name,
            code: error.code,
            meta: error.meta,
            message: error.message,
        });
        res.status(500).json({
            success: false,
            error: error.code || error.message,
        });
    }
};

export const handleStripeWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook sig failed:', err.message);
        return res.status(400).send('Invalid signature');
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const bookingId = parseInt(session.metadata.bookingId);

        const payment = await prisma.payment.findFirst({
            where: { stripeCheckoutSession: session.id },
            include: { booking: true },
        });

        if (payment && payment.status === "pending") {
            await prisma.$transaction(async (tx) => {
                await tx.payment.update({
                    where: { id: payment.id },
                    data: {
                        status: "succeeded",
                        stripePaymentIntent: session.payment_intent,
                    },
                });
                await tx.booking.update({
                    where: { id: bookingId },
                    data: { status: "CONFIRMED" },
                });
            });
            console.log(`✅ Booking ${bookingId} confirmed!`);
        }
    }

    res.status(200).json({ received: true });
};

// Legacy
export const createBooking = async (req, res) => res.status(405).json({ message: "Use /checkout" });
export const getMyBookings = async (req, res) => res.json({ message: "OK" });
export const getBookingsForMyListings = async (req, res) => res.json({ message: "OK" });
export const getMyVehiclesAvailability = async (req, res) => res.json({ message: "OK" });

