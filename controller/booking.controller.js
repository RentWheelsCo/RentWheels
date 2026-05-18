import prisma from "../utils/db.js";
import Stripe from "stripe";
import { StatusCodes } from "http-status-codes";
import { createCheckoutBookingSchema, availabilityQuerySchema } from "../validations/booking.validation.js";
import { notifyUser } from "../utils/notification.js";
import { parsePositiveInt } from "../utils/pagination.js";
import { buildVehicleName } from "../utils/vehicle.utils.js";
import { mapBookingToDashboardRow, calculateTotalAmount } from "../utils/booking.utils.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

function getFxRateNprPerUsd() {
    const raw = process.env.NPR_PER_USD ?? process.env.STRIPE_NPR_PER_USD ?? "";
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 133;
}

function toStripeAmount({ amountNpr, chargeCurrency }) {
    const currency = String(chargeCurrency || "usd").toLowerCase();
    if (currency === "usd") {
        const nprPerUsd = getFxRateNprPerUsd();
        const amountUsd = Number(amountNpr || 0) / nprPerUsd;
        return { currency: "usd", unitAmount: Math.round(amountUsd * 100), fxRate: nprPerUsd };
    }
    // If you set STRIPE_CHARGE_CURRENCY to a supported currency, we assume your prices are already in that currency.
    return { currency, unitAmount: Math.round(Number(amountNpr || 0) * 100), fxRate: null };
}

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
                status: "CONFIRMED",
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

        const totalAmountNpr = calculateTotalAmount(vehicle.dailyPrice, pickupDate, returnDate, parsed.insuranceType);

        const chargeCurrency = process.env.STRIPE_CHARGE_CURRENCY || "usd";
        const stripeAmount = toStripeAmount({ amountNpr: totalAmountNpr, chargeCurrency });

        const payment = await prisma.payment.create({
            data: {
                bookingId: booking.id,
                amount: totalAmountNpr,
                currency: "npr",
                status: "pending",
            },
        });

        console.log('Payment created:', payment.id);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: stripeAmount.currency,
                    product_data: {
                        name: `RentWheels Booking - Vehicle ${vehicle.id}`,
                    },
                    // Stripe uses the smallest currency unit (cents for USD).
                    unit_amount: Math.max(1, stripeAmount.unitAmount),
                },
                quantity: 1,
            }],
            mode: "payment",
            success_url: process.env.STRIPE_SUCCESS_URL || 'http://localhost:5500/payment-success.html?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: process.env.STRIPE_CANCEL_URL || 'http://localhost:5500/payment-cancel.html',
            metadata: {
                bookingId: booking.id.toString(),
                amountNpr: String(totalAmountNpr),
                chargeCurrency: String(stripeAmount.currency),
                fxRateNprPerUsd: stripeAmount.fxRate ? String(stripeAmount.fxRate) : "",
            },
        });

        console.log('Stripe session:', session.id);

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
                totalAmount: totalAmountNpr,
                displayCurrency: "NPR",
                chargeCurrency: stripeAmount.currency.toUpperCase(),
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
            console.log(`Booking ${bookingId} confirmed!`);
        }
    }

    res.status(200).json({ received: true });
};

export const confirmBookingBySession = async (req, res, next) => {
    try {
        const sessionId = String(req.query.session_id || "").trim();
        if (!sessionId) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "session_id is required.",
            });
        }

        const payment = await prisma.payment.findFirst({
            where: { stripeCheckoutSession: sessionId },
            include: { booking: true },
        });

        if (!payment || !payment.booking) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Payment session not found.",
            });
        }

        if (payment.booking.renterId !== req.user.id && req.user.role !== "admin") {
            return res.status(StatusCodes.FORBIDDEN).json({
                success: false,
                status: StatusCodes.FORBIDDEN,
                message: "Forbidden.",
            });
        }

        if (payment.booking.status === "CONFIRMED" || payment.booking.status === "COMPLETED") {
            return res.status(StatusCodes.OK).json({
                success: true,
                status: StatusCodes.OK,
                message: "Booking already confirmed.",
                data: { bookingId: payment.bookingId, status: payment.booking.status },
            });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const isPaid = session?.payment_status === "paid";
        if (!isPaid) {
            return res.status(StatusCodes.OK).json({
                success: true,
                status: StatusCodes.OK,
                message: "Payment not completed.",
                data: { bookingId: payment.bookingId, status: payment.booking.status },
            });
        }

        await prisma.$transaction(async (tx) => {
            await tx.payment.update({
                where: { id: payment.id },
                data: {
                    status: "succeeded",
                    stripePaymentIntent: String(session.payment_intent || payment.stripePaymentIntent || ""),
                },
            });
            await tx.booking.update({
                where: { id: payment.bookingId },
                data: { status: "CONFIRMED" },
            });
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Booking confirmed.",
            data: { bookingId: payment.bookingId, status: "CONFIRMED" },
        });
    } catch (error) {
        next(error);
    }
};

export const getMyBookings = async (req, res, next) => {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
        const skip = (page - 1) * limit;
        const where = {
            renterId: req.user.id,
            status: { in: ["CONFIRMED", "COMPLETED", "CANCELLED"] },
        };

        const [total, bookingsRaw] = await Promise.all([
            prisma.booking.count({ where }),
            prisma.booking.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
                include: {
                    vehicle: {
                        include: {
                            type: true,
                            brand: true,
                            model: true,
                            category: true,
                            transmission: true,
                            fuelType: true,
                            location: true,
                            owner: { select: { id: true, name: true, email: true, phone: true } },
                        },
                    },
                    payment: true,
                },
            }),
        ]);

        const bookings = bookingsRaw.map((b) => ({
            id: b.id,
            pickupDate: b.pickupDate,
            returnDate: b.returnDate,
            insuranceType: b.insuranceType,
            status: b.status,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
            totalAmount: calculateTotalAmount(b.vehicle?.dailyPrice || 0, b.pickupDate, b.returnDate, b.insuranceType),
            vehicle: b.vehicle
                ? {
                    ...b.vehicle,
                    name: buildVehicleName(b.vehicle),
                }
                : null,
            payment: b.payment
                ? {
                    id: b.payment.id,
                    amount: b.payment.amount,
                    currency: b.payment.currency,
                    status: b.payment.status,
                    stripeCheckoutSession: b.payment.stripeCheckoutSession,
                    stripePaymentIntent: b.payment.stripePaymentIntent,
                }
                : null,
        }));

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: { page, limit, total, bookings },
        });
    } catch (error) {
        next(error);
    }
};

export const getBookingsForMyListings = async (req, res, next) => {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
        const skip = (page - 1) * limit;

        const where = { vehicle: { ownerId: req.user.id } };

        const [total, bookingsRaw] = await Promise.all([
            prisma.booking.count({ where }),
            prisma.booking.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
                include: {
                    renter: { select: { id: true, name: true, email: true, phone: true } },
                    vehicle: { select: { id: true, photos: true, dailyPrice: true, year: true, ownerId: true } },
                },
            }),
        ]);

        const vehicleIds = Array.from(new Set(bookingsRaw.map((b) => b.vehicleId)));
        const vehiclesFull = await prisma.vehicle.findMany({
            where: { id: { in: vehicleIds } },
            include: { brand: true, model: true, type: true, category: true, transmission: true, fuelType: true, location: true },
        });
        const vById = new Map(vehiclesFull.map((v) => [v.id, v]));

        const bookings = bookingsRaw.map((b) => {
            const v = vById.get(b.vehicleId);
            return {
                id: b.id,
                pickupDate: b.pickupDate,
                returnDate: b.returnDate,
                insuranceType: b.insuranceType,
                status: b.status,
                createdAt: b.createdAt,
                updatedAt: b.updatedAt,
                totalAmount: v ? calculateTotalAmount(v.dailyPrice, b.pickupDate, b.returnDate, b.insuranceType) : 0,
                renter: b.renter,
                vehicle: v ? { ...v, photos: b.vehicle?.photos || v.photos, name: buildVehicleName(v) } : null,
            };
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: { page, limit, total, bookings },
        });
    } catch (error) {
        next(error);
    }
};

export const getBookingById = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid booking id.",
            });
        }

        const booking = await prisma.booking.findUnique({
            where: { id },
            include: {
                renter: { select: { id: true, name: true, email: true, phone: true } },
                vehicle: { include: { owner: { select: { id: true, name: true, email: true, phone: true } }, type: true, brand: true, model: true, category: true, transmission: true, fuelType: true, location: true } },
                payment: true,
            },
        });
        if (!booking) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Booking not found.",
            });
        }

        const isRenter = booking.renterId === req.user.id;
        const isOwner = booking.vehicle?.ownerId === req.user.id;
        if (!isRenter && !isOwner && req.user.role !== "admin") {
            return res.status(StatusCodes.FORBIDDEN).json({
                success: false,
                status: StatusCodes.FORBIDDEN,
                message: "Forbidden.",
            });
        }

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: {
                id: booking.id,
                pickupDate: booking.pickupDate,
                returnDate: booking.returnDate,
                insuranceType: booking.insuranceType,
                status: booking.status,
                createdAt: booking.createdAt,
                updatedAt: booking.updatedAt,
                totalAmount: calculateTotalAmount(booking.vehicle?.dailyPrice || 0, booking.pickupDate, booking.returnDate, booking.insuranceType),
                renter: booking.renter,
                vehicle: booking.vehicle ? { ...booking.vehicle, name: buildVehicleName(booking.vehicle) } : null,
                payment: booking.payment,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const cancelBooking = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid booking id.",
            });
        }

        const booking = await prisma.booking.findUnique({
            where: { id },
            include: { vehicle: { select: { ownerId: true } } },
        });
        if (!booking) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Booking not found.",
            });
        }

        const isRenter = booking.renterId === req.user.id;
        const isOwner = booking.vehicle?.ownerId === req.user.id;
        if (!isRenter && !isOwner && req.user.role !== "admin") {
            return res.status(StatusCodes.FORBIDDEN).json({
                success: false,
                status: StatusCodes.FORBIDDEN,
                message: "Forbidden.",
            });
        }

        if (booking.status === "CANCELLED") {
            return res.status(StatusCodes.OK).json({ success: true, status: StatusCodes.OK, data: { id, status: "CANCELLED" } });
        }

        const updated = await prisma.booking.update({
            where: { id },
            data: { status: "CANCELLED" },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Booking cancelled.",
            data: { id: updated.id, status: updated.status },
        });
    } catch (error) {
        next(error);
    }
};

export const returnBooking = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: "Invalid booking id.",
            });
        }

        const booking = await prisma.booking.findUnique({
            where: { id },
            include: { vehicle: { select: { ownerId: true } } },
        });
        if (!booking) {
            return res.status(StatusCodes.NOT_FOUND).json({
                success: false,
                status: StatusCodes.NOT_FOUND,
                message: "Booking not found.",
            });
        }

        const isOwner = booking.vehicle?.ownerId === req.user.id;
        if (!isOwner && req.user.role !== "admin") {
            return res.status(StatusCodes.FORBIDDEN).json({
                success: false,
                status: StatusCodes.FORBIDDEN,
                message: "Only the vehicle owner can mark a booking as returned.",
            });
        }

        const updated = await prisma.booking.update({
            where: { id },
            data: { status: "COMPLETED" },
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            message: "Booking marked as returned.",
            data: { id: updated.id, status: updated.status },
        });
    } catch (error) {
        next(error);
    }
};

export const getMyVehiclesAvailability = async (req, res, next) => {
    try {
        const parsed = availabilityQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                status: StatusCodes.BAD_REQUEST,
                message: parsed.error?.issues?.[0]?.message || "Invalid query.",
            });
        }

        const pickupDate = parsed.data.pickupDate ? new Date(parsed.data.pickupDate) : null;
        const returnDate = parsed.data.returnDate ? new Date(parsed.data.returnDate) : null;
        const hasDateFilter = Boolean(pickupDate && returnDate);

        const vehicles = await prisma.vehicle.findMany({
            where: { ownerId: req.user.id },
            orderBy: { createdAt: "desc" },
            include: {
                type: true,
                brand: true,
                model: true,
                category: true,
                transmission: true,
                fuelType: true,
                location: true,
            },
        });

        let bookedSet = new Set();
        if (hasDateFilter) {
            const vehicleIds = vehicles.map((v) => v.id);
            const overlapping = await prisma.booking.findMany({
                where: {
                    vehicleId: { in: vehicleIds },
                    status: "CONFIRMED",
                    AND: [
                        { pickupDate: { lte: returnDate } },
                        { returnDate: { gte: pickupDate } },
                    ],
                },
                select: { vehicleId: true },
            });
            bookedSet = new Set(overlapping.map((b) => b.vehicleId));
        }

        const rows = vehicles.map((v) => {
            const manualUnavailable =
                String(v.availabilityStatus || "AVAILABLE").toUpperCase() === "NOT_AVAILABLE";
            const bookedInRange = hasDateFilter ? bookedSet.has(v.id) : false;
            const notAvailable = manualUnavailable || bookedInRange;
            return {
                id: v.id,
                name: buildVehicleName(v),
                dailyPrice: v.dailyPrice,
                seatingCapacity: v.seatingCapacity,
                transmission: v.transmission?.value || null,
                category: v.category?.value || null,
                availabilityStatus: notAvailable ? "NOT_AVAILABLE" : "AVAILABLE",
            };
        });

        return res.status(StatusCodes.OK).json({
            success: true,
            status: StatusCodes.OK,
            data: { vehicles: rows },
        });
    } catch (error) {
        next(error);
    }
};

