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

    // Only send when status becomes confirmed
    if (booking.status !== "confirmed") return;
    if (previous && previous.status === "confirmed") return;

    const customerId = booking.customerId;

    const tokenList = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION,
      [
        Query.equal("userId", customerId)
      ]
    );

    if (!tokenList.documents.length) {
      log("No push tokens found for customer");
      return;
    }

    const messages = tokenList.documents.map((doc) => ({
      to: doc.token,
      title: "Booking Confirmed ✅",
      body: "Your booking has been confirmed!"
    }));

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages)
    });

    log(`Sent confirmation notification to ${messages.length} devices`);

  } catch (err) {
    log("ERROR:", err);
  }
};