export default async ({ req, res, log, error }) => {
  log("Step 1: Starting dependency-free worker...");

  const { 
    APPWRITE_FUNCTION_ENDPOINT, 
    APPWRITE_FUNCTION_PROJECT_ID, 
    APPWRITE_FUNCTION_API_KEY,
    DATABASE_ID,
    PUSH_TOKENS_COLLECTION 
  } = process.env;

  // Helper for Appwrite REST calls
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
    // 1. Fetch unsent notifications using REST Query
    // Query format: equal("isSent", [false])
    const notifQuery = encodeURIComponent('equal("isSent", false)');
    const notifRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents?queries[]=${notifQuery}`);
    const { documents: unsentDocs } = await notifRes.json();

    if (!unsentDocs || unsentDocs.length === 0) {
      log("No new notifications.");
      return res.json({ message: "Nothing to process" });
    }

    // 2. Fetch push tokens
    const tokenRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/${PUSH_TOKENS_COLLECTION}/documents?queries[]=limit(100)`);
    const { documents: tokenDocs } = await tokenRes.json();

    const validTokens = tokenDocs
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token);

    log(`Step 5: Found ${validTokens.length} valid tokens.`);

    // 3. Process each
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
        // 4. Mark as sent via PATCH
        await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 'PATCH', {
          data: { isSent: true }
        });
        log(`Updated doc: ${doc.$id}`);
      }
    }

    return res.json({ success: true, count: unsentDocs.length });

  } catch (err) {
    error(`Fetch Worker Error: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};