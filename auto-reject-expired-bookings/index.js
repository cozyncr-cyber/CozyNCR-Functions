import { Client, Databases, Query } from "node-appwrite";

export default async ({ log }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

    const db = new Databases(client);

    // Calculate 24 hours ago timestamp
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    log("Checking bookings before:", twentyFourHoursAgo.toISOString());

    // Find pending bookings older than 24h
    const bookings = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.BOOKINGS_TABLE_ID,
      [
        Query.equal("status", "pending"),
        Query.lessThan("$createdAt", twentyFourHoursAgo.toISOString())
      ]
    );

    log("Expired bookings found:", bookings.documents.length);

    if (!bookings.documents.length) return;

    // Update each booking
    for (const booking of bookings.documents) {
      await db.updateDocument(
        process.env.DATABASE_ID,
        process.env.BOOKINGS_TABLE_ID,
        booking.$id,
        { status: "rejected" }
      );

      log(`Booking ${booking.$id} marked as rejected`);
    }

    log("Auto-reject job completed");

  } catch (err) {
    log("ERROR:", err);
  }
};