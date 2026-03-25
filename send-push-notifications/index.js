export default async ({ req, res, log, error }) => {
  log("Step 1: Starting dependency-free worker...");

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
    // --- TEST BLOCK: CHECK TOTAL TOKENS IN COLLECTION ---
    // This simple fetch checks the 'total' property Appwrite returns automatically
    const countRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/push_tokens/documents?queries[]=${encodeURIComponent('limit(1)')}`);
    const countData = await countRes.json();
    const totalInDatabase = countData.total || 0;
    log(`[TEST] Total tokens existing in DB: ${totalInDatabase}`);
    // ----------------------------------------------------

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
    
    log(`Notifications: Unsent: ${unsentDocs.length}`);

    if (unsentDocs.length === 0) {
      return res.json({ message: "No pending notifications.", totalTokensInDB: totalInDatabase });
    }
    
    // 2. Fetch ALL push tokens using Pagination
    let allTokensFromDB = [];
    let offset = 0;
    let hasMore = true;

    log("Step 2: Starting paginated token fetch...");

    while (hasMore) {
      const offsetQuery = encodeURIComponent(`offset(${offset})`);
      const tokenPath = `/databases/${DATABASE_ID}/collections/push_tokens/documents?queries[]=${offsetQuery}`;
      
      const tokenRes = await appwriteFetch(tokenPath);
      const tokenData = await tokenRes.json();

      if (tokenData.documents && tokenData.documents.length > 0) {
        allTokensFromDB = [...allTokensFromDB, ...tokenData.documents];
        offset += 25; 
        log(`Progress: Collected ${allTokensFromDB.length}/${totalInDatabase} tokens...`);
      } else {
        hasMore = false;
      }
      if (offset > 10000) break; // Infinite loop safety
    }

    const validTokens = allTokensFromDB
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token);

    log(`Step 3: Filtered to ${validTokens.length} valid Expo tokens.`);

    // 3. Process each notification
    for (const doc of unsentDocs) {
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

      // 4. Update isSent via PATCH (Corrected body structure)
      const updateRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 'PATCH', {
        isSent: true 
      });
      
      if (updateRes.ok) {
        log(`Successfully marked doc ${doc.$id} as sent.`);
      } else {
        error(`Failed to update doc ${doc.$id}`);
      }
    }

    return res.json({ 
      success: true, 
      processedCount: unsentDocs.length, 
      totalTokensUsed: validTokens.length 
    });

  } catch (err) {
    error(`Fetch Worker Error: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};