const Razorpay = require("razorpay");

module.exports = async ({ req, res }) => {
  try {
    const { amount, bookingId } = JSON.parse(req.body);

    if (!amount || !bookingId) {
      return res.json({ error: "Invalid payload" }, 400);
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const order = await razorpay.orders.create({
      amount: amount * 100, // ✅ already in paise
      currency: "INR",
      receipt: bookingId,
    });

    return res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID, // 🚨 REQUIRED
    });
  } catch (err) {
    return res.json(
      { error: err.message },
      500
    );
  }
};
