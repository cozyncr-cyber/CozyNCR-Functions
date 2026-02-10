import sdk from "node-appwrite";

export default async ({ req, res, log, error }) => {
  log("Step 1: Function triggered.");

  try {
    // 1. Check Payload
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; 
    log(`Step 2: Payload parsed. Data: ${JSON.stringify(payload)}`);

    const { title, body } = payload;

    if (!title || !body) {
      error("FAILED: Payload missing title or body attributes.");
      return res.json({ error: "Missing title or body" }, 400);
    }

    // 2. Initialize SDK
    log("Step 3: Initializing Appwrite SDK...");
    if (!process.env.APPWRITE_FUNCTION_ENDPOINT) {
        error("FAILED: APPWRITE_FUNCTION_ENDPOINT is missing from Environment Variables.");
    }

    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

    const db = new sdk.Databases(client);
    
    // 3. Database Fetch
    log(`Step 4: Fetching documents from DB: ${process.env.DATABASE_ID}, Col: ${process.env.PUSH_TOKENS_COLLECTION}`);
    
    let list;
    try {
        list = await db.listDocuments(
          process.env.DATABASE_ID,
          process.env.PUSH_TOKENS_COLLECTION,
          [sdk.Query.limit(100)] 
        );
        log(`Step 5: Successfully fetched ${list.documents.length} raw documents.`);
    } catch (dbErr) {
        error(`FAILED at Step 4 (DB Fetch): ${dbErr.message}`);
        throw dbErr;
    }

    // 4. Filtering Logic
    const validMessages = list.documents
      .filter((d) => {
          const isValid = d.token && d.token.startsWith("ExponentPushToken");
          if (!isValid) log(`Skipping invalid token found in doc ID: ${d.$id} (Value: "${d.token}")`);
          return isValid;
      })
      .map((d) => ({
        to: d.token,
        title,
        body,
        sound: "default",
      }));

    log(`Step 6: Filter complete. Sending to ${validMessages.length} valid Expo tokens.`);

    if (validMessages.length === 0) {
      log("Step 7: No valid tokens to send. Exiting.");
      return res.json({ success: true, sent: 0, message: "No valid tokens found" });
    }

    // 5. External API Call
    log("Step 8: Posting to Expo API...");
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validMessages)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        error(`Step 9 FAILED: Expo API returned status ${response.status}. Body: ${errorBody}`);
        return res.json({ error: "Expo API Error", details: errorBody }, 500);
    }

    const result = await response.json();
    log(`Step 10: Expo Response received: ${JSON.stringify(result)}`);

    return res.json({ success: true, sentCount: validMessages.length, expoResponse: result });

  } catch (err) {
    error(`CRITICAL SYSTEM ERROR: ${err.stack || err.message}`);
    return res.json({ error: err.message }, 500);
  }
};