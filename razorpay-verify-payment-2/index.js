const crypto = require("crypto");
const sdk = require("node-appwrite");

module.exports = async ({ req, res, log }) => {
  try {
    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const databases = new sdk.Databases(client);

    // 1. Get Secret and Payload
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    let orderId, paymentId, signature, bookingId;

    // 2. Identify Source: Webhook OR App Call
    const isWebhook = req.headers["x-razorpay-signature"];

    if (isWebhook) {
      log("⚓ Webhook detected");
      // Razorpay Webhooks send data in a different structure
      const webhookSignature = req.headers["x-razorpay-signature"];
      
      // Verify Webhook Signature
      const expectedSig = crypto
        .createHmac("sha256", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (expectedSig !== webhookSignature) {
        return res.json({ error: "Invalid Webhook Signature" }, 401);
      }

      // Extract details from Webhook Payload
      const payment = body.payload.payment.entity;
      paymentId = payment.id;
      orderId = payment.order_id;
      // Note: You must pass bookingId in "notes" when creating the order in Razorpay
      bookingId = payment.notes.bookingId; 
    } else {
      log("📱 App call detected");
      // Standard call from your React Native code
      ({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature, bookingId } = body);

      const expectedSig = crypto
        .createHmac("sha256", secret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      if (expectedSig !== signature) {
        return res.json({ error: "Invalid Signature" }, 401);
      }
    }

    if (!bookingId) {
        log("❌ No bookingId found. Ensure you pass bookingId in Razorpay notes.");
        return res.json({ error: "No bookingId" }, 400);
    }

    // 3. Update Database (Idempotent - won't break if called twice)
    log(`📝 Updating booking ${bookingId} to PAID`);
    
    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_BOOKINGS_TABLE_ID,
      bookingId,
      {
        paid: "paid",
        paymentId: paymentId,
        orderId: orderId,
        paidAt: new Date().toISOString(),
      }
    );

    return res.json({ success: true, message: "Booking confirmed" });

  } catch (err) {
    log("🔥 Error:", err.message);
    return res.json({ error: err.message }, 500);
  }
};