import { Client, Databases, Query } from "node-appwrite";
import fetch from "node-fetch";

export default async ({ req, res, log }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

    const db = new Databases(client);

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const booking = body; // Tables update sends full row

    log("Owner notification triggered");
    log("Paid value:", booking.paid);
    log("ownerNotified:", booking.ownerNotified);

    // Only send when paid AND not already notified
    if (booking.paid !== "paid") {
      log("Not paid yet. Exiting.");
      return res.empty();
    }

    if (booking.ownerNotified === true) {
      log("Owner already notified. Skipping.");
      return res.empty();
    }

    const listing = await db.getDocument(
      process.env.DATABASE_ID,
      process.env.LISTINGS_COLLECTION,
      booking.listingId
    );

    const ownerId = listing.ownerId;
    log("Owner ID:", ownerId);

    const tokenList = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION,
      [Query.equal("userId", ownerId)]
    );

    log("Tokens found:", tokenList.documents.length);

    if (!tokenList.documents.length) {
      log("No push tokens found for owner");
      return res.empty();
    }

    const messages = tokenList.documents.map((doc) => ({
      to: doc.token,
      title: "New Booking 🎉",
      body: "You received a paid booking!"
    }));

    const response = await fetch(
      "https://exp.host/--/api/v2/push/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages)
      }
    );

    const result = await response.json();
    log("Expo response:", JSON.stringify(result));

    // ✅ Mark as notified (prevents duplicates)
    await db.updateRow(
      process.env.DATABASE_ID,
      process.env.BOOKINGS_TABLE_ID,
      booking.$id,
      { ownerNotified: true }
    );

    log("ownerNotified set to true");

    return res.json({ success: true });

  } catch (err) {
    log("ERROR:", err);
    return res.json({ error: "Function failed" }, 500);
  }
};