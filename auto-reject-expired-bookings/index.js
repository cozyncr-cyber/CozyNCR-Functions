export default async ({ req, res, log }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

    const db = new Databases(client);

    const now = new Date();
    const twentyFourHoursAgo = new Date(
      now.getTime() - 24 * 60 * 60 * 1000
    );

    log("Checking bookings before:", twentyFourHoursAgo.toISOString());

    const bookings = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.BOOKINGS_TABLE_ID,
      [
        Query.equal("status", "pending"),
        Query.lessThan("$createdAt", twentyFourHoursAgo.toISOString()),
        Query.limit(100)
      ]
    );

    log("Expired bookings found:", bookings.documents.length);

    for (const booking of bookings.documents) {
      await db.updateDocument(
        process.env.DATABASE_ID,
        process.env.BOOKINGS_TABLE_ID,
        booking.$id,
        { status: "rejected" }
      );

      log(`Booking ${booking.$id} rejected`);
    }

    log("Auto-reject job completed");

    return res.json({
      processed: bookings.documents.length
    });

  } catch (err) {
    log("ERROR:", err);
    return res.json({ error: "Function failed" }, 500);
  }
};