import sdk from "node-appwrite";
import fetch from "node-fetch";

export default async ({ req, res, log, error }) => {
  try {
    // 1. Appwrite sends the payload as an object in newer versions, 
    // but it's safer to check if it needs parsing.
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; 

    const title = payload.title; 
    const body = payload.body;

    if (!title || !body) {
      log("Payload missing title or body. Skipping.");
      return res.json({ error: "Missing title or body" }, 400);
    }

    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

    const db = new sdk.Databases(client);

    // 2. Fetch tokens (Note: listDocuments has a default limit of 25)
    // Use Query.limit(100) if you have more users.
    const list = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION,
      [sdk.Query.limit(100)] 
    );

    if (!list.documents.length) {
      log("No tokens found in collection");
      return res.json({ sent: 0 });
    }

    const messages = list.documents.map((d) => ({
      to: d.token,
      title,
      body,
      sound: "default", // Recommended for Expo
    }));

    // 3. Expo Batching: Expo accepts max 100 messages per request
    // For now, we'll send the first 100.
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json" 
      },
      body: JSON.stringify(messages)
    });

    const result = await response.json();
    log("Expo Response:", JSON.stringify(result));

    return res.json({ sent: messages.length });

  } catch (err) {
    error("CRITICAL ERROR:", err.message);
    return res.json({ error: err.message }, 500);
  }
};