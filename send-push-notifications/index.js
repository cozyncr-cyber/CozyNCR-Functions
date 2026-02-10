import sdk from "node-appwrite";

export default async ({ req, res, log, error }) => {
  log("Step 1: Starting scheduled worker...");

  const client = new sdk.Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

  const db = new sdk.Databases(client);

  try {
    // 1. Fetch unsent notifications
    const unsentNotifications = await db.listDocuments(
      process.env.DATABASE_ID,
      'notifications', // Use your collection ID
      [sdk.Query.equal("isSent", false)]
    );

    if (unsentNotifications.documents.length === 0) {
      log("No new notifications to send.");
      return res.json({ message: "Nothing to process" });
    }

    // 2. Fetch push tokens
    const tokenList = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION,
      [sdk.Query.limit(100)]
    );

    const validTokens = tokenList.documents
      .filter((d) => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token);

    if (validTokens.length === 0) {
      error("No valid tokens found in the database.");
      return res.json({ error: "No tokens" });
    }

    // 3. Process each unsent notification
    for (const doc of unsentNotifications.documents) {
      log(`Processing notification: ${doc.title}`);

      const messages = validTokens.map(token => ({
        to: token,
        title: doc.title,
        body: doc.body,
        sound: "default"
      }));

      // Send to Expo
      const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages)
      });

      if (expoRes.ok) {
        // 4. Mark as sent in Appwrite
        await db.updateDocument(
          process.env.DATABASE_ID,
          'notifications',
          doc.$id,
          { isSent: true }
        );
        log(`Successfully sent and updated: ${doc.$id}`);
      } else {
        error(`Failed to send ${doc.$id} to Expo.`);
      }
    }

    return res.json({ processed: unsentNotifications.documents.length });

  } catch (err) {
    error(`Worker Error: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};