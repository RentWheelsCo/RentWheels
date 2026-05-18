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
    return { currency, unitAmount: Math.round(Number(amountNpr || 0) * 100), fxRate: null };
}

async function notifyVehicleOwnerBooked(bookingId) {
    if (!Number.isInteger(bookingId) || bookingId <= 0) return;

    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            renter: { select: { name: true, email: true, phone: true } },
            vehicle: {
                include: {
                    owner: { select: { email: true } },
                    type: true,
                    brand: true,
                    model: true,
                    category: true,
                    transmission: true,
                    fuelType: true,
                    location: true,
                },
            },
            payment: true,
        },
    });
    if (!booking?.vehicle?.ownerId) return;

    const formatDate = (d) => {
        try {
            return new Intl.DateTimeFormat("en-US", {
                year: "numeric",
                month: "long",
                day: "2-digit",
            }).format(d);
        } catch {
            return d ? new Date(d).toDateString() : "";
        }
    };

    const vehicleName = booking.vehicle ? buildVehicleName(booking.vehicle) : `Vehicle #${booking.vehicleId}`;
    const pickup = formatDate(booking.pickupDate);
    const dropoff = formatDate(booking.returnDate);
    const renterName = booking.renter?.name || "A user";
    const renterEmail = booking.renter?.email || "N/A";
    const renterPhone = booking.renter?.phone || "N/A";
    const amount = booking.payment?.amount;
    const currency = (booking.payment?.currency || "NPR").toUpperCase();
    const amountText =
        typeof amount === "number" && Number.isFinite(amount)
            ? `${currency} ${amount.toFixed(2)}`
            : "N/A";

    const subject = `Your vehicle has been booked (Booking #${booking.id})`;
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #eef2ff;border-radius:14px;overflow:hidden;">
        <div style="padding:18px 20px;background:#1d4ed8;color:#ffffff;">
          <div style="font-size:16px;font-weight:700;letter-spacing:0.2px;">RentWheels</div>
          <div style="margin-top:6px;font-size:13px;opacity:0.9;">Booking Notification</div>
        </div>
        <div style="padding:20px;">
          <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;">
            Dear Vehicle Owner,
          </p>
          <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;">
            Your vehicle has been booked successfully. Below are the booking details for your reference.
          </p>

          <div style="border:1px solid #f3f4f6;border-radius:10px;overflow:hidden;">
            <div style="padding:12px 14px;background:#f8fafc;border-bottom:1px solid #f3f4f6;">
              <span style="font-size:13px;font-weight:700;">Booking Details</span>
            </div>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:10px 14px;font-size:13px;color:#374151;width:40%;border-bottom:1px solid #f3f4f6;">Booking ID</td>
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;">#${booking.id}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:13px;color:#374151;width:40%;border-bottom:1px solid #f3f4f6;">Vehicle</td>
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;">${vehicleName}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:13px;color:#374151;width:40%;border-bottom:1px solid #f3f4f6;">Pick-up Date</td>
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;">${pickup}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:13px;color:#374151;width:40%;border-bottom:1px solid #f3f4f6;">Return Date</td>
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;">${dropoff}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:13px;color:#374151;width:40%;border-bottom:1px solid #f3f4f6;">Insurance Type</td>
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;">${booking.insuranceType || "N/A"}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:13px;color:#374151;width:40%;">Total Amount</td>
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#111827;">${amountText}</td>
              </tr>
            </table>
          </div>

          <div style="height:14px;"></div>

          <div style="border:1px solid #f3f4f6;border-radius:10px;overflow:hidden;">
            <div style="padding:12px 14px;background:#f8fafc;border-bottom:1px solid #f3f4f6;">
              <span style="font-size:13px;font-weight:700;">Renter Details</span>
            </div>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:10px 14px;font-size:13px;color:#374151;width:40%;border-bottom:1px solid #f3f4f6;">Name</td>
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;">${renterName}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:13px;color:#374151;width:40%;border-bottom:1px solid #f3f4f6;">Email</td>
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;">${renterEmail}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:13px;color:#374151;width:40%;">Phone</td>
                <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#111827;">${renterPhone}</td>
              </tr>
            </table>
          </div>

          <p style="margin:16px 0 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
            If you did not expect this booking or you need help, please contact RentWheels support.
          </p>
        </div>
        <div style="padding:14px 20px;background:#f8fafc;border-top:1px solid #f3f4f6;font-size:11px;color:#6b7280;">
          This is an automated email. Please do not reply to this message.
        </div>
      </div>
    </div>
  </body>
</html>`;

    try {
        await notifyUser({
            userId: booking.vehicle.ownerId,
            type: "VEHICLE_BOOKED",
            title: "Your vehicle has been booked",
            message: "Your vehicle has been booked.",
            email: booking.vehicle.owner?.email
                ? {
                      to: booking.vehicle.owner.email,
                      subject,
                      text: `Your vehicle has been booked.\n\nBooking ID: #${booking.id}\nVehicle: ${vehicleName}\nPick-up Date: ${pickup}\nReturn Date: ${dropoff}\nInsurance: ${booking.insuranceType || "N/A"}\nTotal Amount: ${amountText}\n\nRenter: ${renterName}\nEmail: ${renterEmail}\nPhone: ${renterPhone}`,
                      html,
                  }
                : null,
        });
    } catch (notifyError) {
        console.error(
            "Failed to send booking notification:",
            notifyError?.message || notifyError
        );
    }
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
            await notifyVehicleOwnerBooked(bookingId);
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

        await notifyVehicleOwnerBooked(payment.bookingId);

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
                select: {
                    id: true,
                    pickupDate: true,
                    returnDate: true,
                    insuranceType: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                    vehicle: {
                        select: {
                            id: true,
                            ownerId: true,
                            year: true,
                            dailyPrice: true,
                            seatingCapacity: true,
                            description: true,
                            availabilityStatus: true,
                            photos: true,
                            type: { select: { id: true, type: true, value: true } },
                            brand: { select: { id: true, type: true, value: true } },
                            model: { select: { id: true, type: true, value: true, parentId: true } },
                            category: { select: { id: true, type: true, value: true } },
                            transmission: { select: { id: true, type: true, value: true } },
                            fuelType: { select: { id: true, type: true, value: true } },
                            location: { select: { id: true, type: true, value: true } },
                            owner: { select: { id: true, name: true, email: true, phone: true } },
                        },
                    },
                    payment: {
                        select: {
                            id: true,
                            amount: true,
                            currency: true,
                            status: true,
                            stripeCheckoutSession: true,
                            stripePaymentIntent: true,
                        },
                    },
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
                    vehicle: {
                        include: {
                            type: true,
                            brand: true,
                            model: true,
                            category: true,
                            transmission: true,
                            fuelType: true,
                            location: true,
                        },
                    },
                },
            }),
        ]);

        const bookings = bookingsRaw.map((b) => {
            const v = b.vehicle || null;
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
                vehicle: v ? { ...v, name: buildVehicleName(v) } : null,
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

        let bookedSet = new Set();
        if (hasDateFilter) {
            const overlapping = await prisma.booking.findMany({
                where: {
                    status: "CONFIRMED",
                    vehicle: { ownerId: req.user.id },
                    AND: [
                        { pickupDate: { lte: returnDate } },
                        { returnDate: { gte: pickupDate } },
                    ],
                },
                select: { vehicleId: true },
            });
            bookedSet = new Set(overlapping.map((b) => b.vehicleId));
        }

        const vehicles = await prisma.vehicle.findMany({
            where: { ownerId: req.user.id },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                dailyPrice: true,
                seatingCapacity: true,
                availabilityStatus: true,
                type: { select: { value: true } },
                brand: { select: { value: true } },
                model: { select: { value: true } },
                category: { select: { value: true } },
                transmission: { select: { value: true } },
            },
        });

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

