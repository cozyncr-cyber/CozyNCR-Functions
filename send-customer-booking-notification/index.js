import sdk from "node-appwrite";
import fetch from "node-fetch";

export default async ({ req, log }) => {
  try {
    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

    const db = new sdk.Databases(client);

    const body = JSON.parse(req.body);

    const booking = body.payload || body;
    const previous = body.previous || null;

    // ✅ Only send when status becomes confirmed
    if (booking.status !== "confirmed") return;

    // Prevent duplicate notification
    if (previous && previous.status === "confirmed") return;

    const customerId = booking.customerId;

    // 1️⃣ Get ALL push tokens for customer
    const tokenList = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION,
      [
        sdk.Query.equal("userId", customerId)
      ]
    );

    if (!tokenList.documents.length) {
      log("No push tokens found for customer");
      return;
    }

    // 2️⃣ Create messages for all tokens
    const messages = tokenList.documents.map((doc) => ({
      to: doc.token,
      title: "Booking Confirmed ✅",
      body: "Your booking has been confirmed!"
    }));

    // 3️⃣ Send batch notification
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(messages)
    });

    log(`Sent confirmation notification to ${messages.length} devices`);

  } catch (err) {
    log("ERROR:", err);
  }
};