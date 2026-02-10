import sdk from "node-appwrite";
import fetch from "node-fetch";

export default async ({ req, res, log, error }) => {
  // 1. Log the moment the function starts
  log("Function triggered by event.");

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; 

    // 2. Log the incoming data to verify attributes
    log(`Payload received: Title="${payload.title}", Body="${payload.body}"`);

    const title = payload.title; 
    const body = payload.body;

    if (!title || !body) {
      error("Payload missing title or body. Skipping execution.");
      return res.json({ error: "Missing title or body" }, 400);
    }

    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

    const db = new sdk.Databases(client);

    // 3. Log that we are fetching tokens
    log(`Fetching tokens from collection: ${process.env.PUSH_TOKENS_COLLECTION}`);
    
    const list = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION,
      [sdk.Query.limit(100)] 
    );

    log(`Found ${list.documents.length} token(s).`);

    if (!list.documents.length) {
      return res.json({ sent: 0 });
    }

    const messages = list.documents.map((d) => ({
      to: d.token,
      title,
      body,
      sound: "default",
    }));

    // 4. Log the request to Expo
    log("Sending request to Expo API...");
    
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json" 
      },
      body: JSON.stringify(messages)
    });

    const result = await response.json();
    
    // 5. Log the final result from Expo
    log(`Expo Response: ${JSON.stringify(result)}`);

    return res.json({ 
      success: true, 
      sentCount: messages.length, 
      expoResponse: result 
    });

  } catch (err) {
    // 6. Detailed error logging
    error(`CRITICAL ERROR: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};