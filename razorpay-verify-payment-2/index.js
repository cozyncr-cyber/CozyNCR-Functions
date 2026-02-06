const crypto = require("crypto");
const sdk = require("node-appwrite");

module.exports = async ({ req, res, log }) => {
  try {
    log("🔵 Payment verification function started");

    // 🔎 Validate ENV variables first
    const requiredEnv = [
      "APPWRITE_ENDPOINT",
      "APPWRITE_PROJECT_ID",
      "APPWRITE_API_KEY",
      "APPWRITE_DATABASE_ID",
      "APPWRITE_BOOKINGS_TABLE_ID",
      "RAZORPAY_KEY_SECRET"
    ];

    for (const key of requiredEnv) {
      if (!process.env[key]) {
        log(`❌ Missing ENV variable: ${key}`);
        return res.json(
          { error: `Server misconfiguration: ${key} missing` },
          500
        );
      }
    }

    // 🧾 Parse body safely
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    log("📦 Incoming body:", JSON.stringify(body));

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingId
    } = body;

    // 🛑 Hard validation
    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      !bookingId
    ) {
      log("❌ Missing required payment fields");
      return res.json(
        { error: "Missing payment verification data" },
        400
      );
    }

    log("🔐 Verifying Razorpay signature...");

    // 🔐 Verify signature
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      log("❌ Invalid Razorpay signature");
      log("Expected:", expectedSignature);
      log("Received:", razorpay_signature);

      return res.json(
        { error: "Invalid payment signature" },
        401
      );
    }

    log("✅ Signature verified successfully");

    // 🗄 Init Appwrite SDK
    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const databases = new sdk.Databases(client);

    log("🗄 Updating booking:", bookingId);

    // 📝 Update booking
    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_BOOKINGS_TABLE_ID,
      bookingId,
      {
        paid: "paid",
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        paidAt: new Date().toISOString(),
      }
    );

    log("🎉 Booking marked as PAID successfully");

    return res.json({ success: true });

  } catch (err) {
    log("🔥 Verification error:", err?.message);
    log("🔥 Full error object:", JSON.stringify(err));

    return res.json(
      { error: "Verification failed" },
      500
    );
  }
};