const crypto = require("crypto");
const sdk = require("node-appwrite");

module.exports = async ({ req, res, log }) => {
  try {
    const body = JSON.parse(req.body);

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
      return res.json(
        { error: "Missing payment verification data" },
        400
      );
    }

    // 1️⃣ Verify Razorpay signature
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      log("❌ Invalid Razorpay signature");

      return res.json(
        { error: "Invalid payment signature" },
        401
      );
    }

    // 2️⃣ Init Appwrite SDK
    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const databases = new sdk.Databases(client);

    // 3️⃣ Update booking → PAID
    await databases.updateRow(
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

    log("✅ Payment verified & booking marked PAID");

    return res.json({ success: true });
  } catch (err) {
    log("🔥 Verification error", err);
    return res.json({ error: "Verification failed" }, 500);
  }
};