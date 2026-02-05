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

    // ✅ Only trigger when paid becomes "paid"
    if (booking.paid !== "paid") return;
    if (previous && previous.paid === "paid") return;

    // 1️⃣ Get listing → ownerId
    const listing = await db.getDocument(
      process.env.DATABASE_ID,
      process.env.LISTINGS_COLLECTION,
      booking.listingId
    );

    const ownerId = listing.ownerId;

    // 2️⃣ Get ALL push tokens for owner
    const tokenList = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION,
      [
        sdk.Query.equal("userId", ownerId)
      ]
    );

    if (!tokenList.documents.length) {
      log("No push tokens found");
      return;
    }

    // 3️⃣ Create messages for each token
    const messages = tokenList.documents.map((doc) => ({
      to: doc.token,
      title: "New Booking 🎉",
      body: "You received a paid booking!"
    }));

    // 4️⃣ Send batch notification
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(messages)
    });

    log(`Sent notification to ${messages.length} devices`);

  } catch (err) {
    log("ERROR:", err);
  }
};