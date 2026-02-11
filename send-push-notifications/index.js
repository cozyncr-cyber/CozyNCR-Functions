export default async ({ req, res, log, error }) => {
  log("Step 1: Starting dependency-free worker...");

  const { 
    APPWRITE_FUNCTION_ENDPOINT, 
    APPWRITE_FUNCTION_PROJECT_ID, 
    APPWRITE_FUNCTION_API_KEY,
    DATABASE_ID,
    PUSH_TOKENS_COLLECTION 
  } = process.env;

  const appwriteFetch = (path, method = 'GET', body = null) => fetch(`${APPWRITE_FUNCTION_ENDPOINT}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': APPWRITE_FUNCTION_PROJECT_ID,
      'X-Appwrite-Key': APPWRITE_FUNCTION_API_KEY
    },
    body: body ? JSON.stringify(body) : null
  });

  try {
    // 1. Fetch unsent notifications
    // RECHECKED: Appwrite 1.8.1 REST Query for Booleans
    const queryStr = 'equal("isSent", [false])'; 
    const notifPath = `/databases/${DATABASE_ID}/collections/notifications/documents?queries[]=${encodeURIComponent(queryStr)}`;
    
    const notifRes = await appwriteFetch(notifPath);
    const data = await notifRes.json();

    if (!notifRes.ok) {
      error(`Appwrite API Error: ${JSON.stringify(data)}`);
      return res.json({ error: "API Failure", details: data }, 500);
    }

    const unsentDocs = data.documents || [];

    if (unsentDocs.length === 0) {
      log("No new notifications found.");
      return res.json({ message: "Nothing to process" });
    }

    // 2. Fetch push tokens
    const tokenPath = `/databases/${DATABASE_ID}/collections/${PUSH_TOKENS_COLLECTION}/documents?queries[]=${encodeURIComponent('limit(100)')}`;
    const tokenRes = await appwriteFetch(tokenPath);
    const tokenData = await tokenRes.json();

    // FILTERING: Removes literal "token" strings seen in your DB screenshot
    const validTokens = (tokenData.documents || [])
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token);

    log(`Step 2: Found ${validTokens.length} valid tokens.`);

    if (validTokens.length === 0) {
      return res.json({ message: "No valid tokens found" });
    }

    // 3. Process each notification
    for (const doc of unsentDocs) {
      const messages = validTokens.map(token => ({
        to: token,
        title: doc.title,
        body: doc.body,
        sound: "default"
      }));

      const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages)
      });

      if (expoRes.ok) {
        // 4. Update isSent via PATCH
        await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 'PATCH', {
          data: { isSent: true }
        });
        log(`Successfully processed: ${doc.$id}`);
      }
    }

    return res.json({ success: true, processedCount: unsentDocs.length });

  } catch (err) {
    error(`Fetch Worker Error: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};