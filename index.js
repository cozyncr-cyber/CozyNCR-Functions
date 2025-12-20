const Razorpay = require("razorpay");

module.exports = async ({ req, res }) => {
  const { amount, bookingId } = JSON.parse(req.body);

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  const order = await razorpay.orders.create({
    amount: amount * 100,
    currency: "INR",
    receipt: bookingId
  });

  return res.json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency
  });
};
