export default async ({ req, res, log, error }) => {
  log("Step 1: Starting dependency-free worker with pagination...");

  const { 
    APPWRITE_FUNCTION_ENDPOINT, 
    APPWRITE_FUNCTION_PROJECT_ID, 
    APPWRITE_FUNCTION_API_KEY,
    DATABASE_ID
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
    // 1. Fetch Notifications (Unsent Only)
    const notifPath = `/databases/${DATABASE_ID}/collections/notifications/documents`;
    const notifRes = await appwriteFetch(notifPath);
    const notifData = await notifRes.json();

    if (!notifRes.ok) {
      error(`Appwrite API Error: ${JSON.stringify(notifData)}`);
      return res.json({ error: "Notification fetch failed", details: notifData }, 500);
    }

    const allNotifications = notifData.documents || [];
    const unsentDocs = allNotifications.filter(doc => doc.isSent === false);
    
    log(`Notifications: Found ${allNotifications.length} total docs. Unsent: ${unsentDocs.length}`);

    if (unsentDocs.length === 0) {
      return res.json({ message: "No pending notifications." });
    }
    
    // 2. Fetch ALL push tokens using Pagination (Default limit is 25)
    let allTokensFromDB = [];
    let offset = 0;
    let hasMore = true;

    log("Step 2: Starting paginated token fetch...");

    while (hasMore) {
      // We append offset(X) to the URL. The limit stays at default (25).
      const offsetQuery = encodeURIComponent(`offset(${offset})`);
      const tokenPath = `/databases/${DATABASE_ID}/collections/push_tokens/documents?queries[]=${offsetQuery}`;
      
      const tokenRes = await appwriteFetch(tokenPath);
      const tokenData = await tokenRes.json();

      if (tokenData.documents && tokenData.documents.length > 0) {
        allTokensFromDB = [...allTokensFromDB, ...tokenData.documents];
        offset += 25; // Move to the next batch of 25
        log(`Fetched ${allTokensFromDB.length} tokens so far...`);
      } else {
        hasMore = false; // No more tokens left to fetch
      }

      // Safety break to prevent infinite loops
      if (offset > 10000) break;
    }

    const validTokens = allTokensFromDB
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token);

    log(`Step 3: Filtered down to ${validTokens.length} valid tokens.`);

    if (validTokens.length === 0) {
      log("ABORTING: No valid tokens found.");
      return res.json({ error: "No valid tokens" }, 400);
    }

    // 3. Process each notification
    for (const doc of unsentDocs) {
      // EXPO SAFETY: Chunk validTokens into groups of 100
      for (let i = 0; i < validTokens.length; i += 100) {
        const chunk = validTokens.slice(i, i + 100);
        
        const messages = chunk.map(token => ({
          to: token,
          title: doc.title,
          body: doc.body,
          sound: "default"
        }));

        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(messages)
        });
      }

      // 4. Update isSent via PATCH
      await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 'PATCH', {
        data: { isSent: true }
      });
      log(`Successfully processed doc: ${doc.$id}`);
    }

    return res.json({ success: true, processedCount: unsentDocs.length });

  } catch (err) {
    error(`Fetch Worker Error: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};