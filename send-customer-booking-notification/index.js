import { Client, Databases, Query } from "node-appwrite";
import fetch from "node-fetch";

export default async ({ req, res, log }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT) // fixed
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

    const db = new Databases(client);

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const booking = body.payload || body;
    const previous = body.previous || null;

    log("Customer notification triggered");
    log("New status:", booking.status);
    log("Previous status:", previous?.status);

    // Only when status becomes confirmed
    if (booking.status !== "confirmed") {
      log("Status is not confirmed. Exiting.");
      return res.empty();
    }

    if (previous && previous.status === "confirmed") {
      log("Already confirmed before. Skipping duplicate.");
      return res.empty();
    }

    const customerId = booking.customerId;
    log("Customer ID:", customerId);

    const tokenList = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION,
      [Query.equal("userId", customerId)]
    );

    log("Tokens found:", tokenList.documents.length);

    if (!tokenList.documents.length) {
      log("No push tokens found for customer");
      return res.empty();
    }

    const messages = tokenList.documents.map((doc) => ({
      to: doc.token,
      title: "Booking Confirmed ✅",
      body: "Your booking has been confirmed!"
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

    return res.json({ success: true });

  } catch (err) {
    log("ERROR:", err);
    return res.json({ error: "Function failed" }, 500);
  }
};