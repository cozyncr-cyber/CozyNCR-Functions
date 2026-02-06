import { Client, Databases, Query } from "node-appwrite";
import fetch from "node-fetch";

export default async ({ req, log }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

    const db = new Databases(client);

    const body = JSON.parse(req.body);

    const booking = body.payload || body;
    const previous = body.previous || null;

    // Only trigger when paid becomes "paid"
    if (booking.paid !== "paid") return;
    if (previous && previous.paid === "paid") return;

    // Get listing
    const listing = await db.getDocument(
      process.env.DATABASE_ID,
      process.env.LISTINGS_COLLECTION,
      booking.listingId
    );

    const ownerId = listing.ownerId;

    // Get ALL push tokens
    const tokenList = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION,
      [
        Query.equal("userId", ownerId)
      ]
    );

    if (!tokenList.documents.length) {
      log("No push tokens found");
      return;
    }

    const messages = tokenList.documents.map((doc) => ({
      to: doc.token,
      title: "New Booking 🎉",
      body: "You received a paid booking!"
    }));

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages)
    });

    log(`Sent notification to ${messages.length} devices`);

  } catch (err) {
    log("ERROR:", err);
  }
};