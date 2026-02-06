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

    const booking = body;

    log("Owner notification triggered");
    log("Paid value:", booking.paid);
    log("ownerNotified:", booking.ownerNotified);

    if (booking.paid !== "paid") return res.empty();
    if (booking.ownerNotified === true) return res.empty();

    const listing = await db.getRow(
      process.env.DATABASE_ID,
      process.env.LISTINGS_TABLE_ID,
      booking.listingId
    );

    const ownerId =
      typeof listing.ownerId === "object"
        ? listing.ownerId.$id
        : listing.ownerId;

    log("Owner ID:", ownerId);

    const tokenList = await db.listRows(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_TABLE_ID,
      [Query.equal("userId", ownerId)]
    );

    log("Tokens found:", tokenList.rows.length);

    if (!tokenList.rows.length) return res.empty();

    const messages = tokenList.rows.map((doc) => ({
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