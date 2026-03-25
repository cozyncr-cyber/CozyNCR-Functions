export default async ({ req, res, log, error }) => {
  log("Step 1: Initializing Worker...");

  const { 
    APPWRITE_FUNCTION_ENDPOINT, 
    APPWRITE_FUNCTION_PROJECT_ID, 
    APPWRITE_FUNCTION_API_KEY,
    DATABASE_ID
  } = process.env;

  // Helper for Syntax-Safe requests using headers instead of URL queries
  const appwriteFetch = (path, method = 'GET', body = null, queries = []) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': APPWRITE_FUNCTION_PROJECT_ID,
      'X-Appwrite-Key': APPWRITE_FUNCTION_API_KEY
    };

    if (queries.length > 0) {
      headers['x-appwrite-queries'] = JSON.stringify(queries);
    }

    return fetch(`${APPWRITE_FUNCTION_ENDPOINT}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });
  };

  try {
    // --- PRE-RUN TEST: VERIFY TOTAL TOKENS ---
    log("Running Pre-check: Verifying Token Collection...");
    const testRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/push_tokens/documents`);
    const testData = await testRes.json();
    
    if (!testRes.ok) {
        throw new Error(`Pre-check failed: ${testData.message}`);
    }

    const totalInDB = testData.total || 0;
    log(`[TEST] Database reports ${totalInDB} total tokens exist.`);

    if (totalInDB === 0) {
        return res.json({ error: "Test Failed", details: "No tokens found in database. Check permissions." }, 400);
    }
    // -----------------------------------------

    // 1. Fetch Notifications
    const notifRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents`);
    const notifData = await notifRes.json();
    const unsentDocs = (notifData.documents || []).filter(doc => doc.isSent === false);

    log(`Step 2: Found ${unsentDocs.length} unsent notifications.`);
    if (unsentDocs.length === 0) return res.json({ message: "No notifications to process." });

    // 2. Paginated Token Fetch
    let allTokens = [];
    let offset = 0;
    let hasMore = true;

    log("Step 3: Collecting all tokens via pagination...");

    while (hasMore) {
      // Using the header-based query to avoid URL syntax errors
      const queryArray = [`limit(100)`, `offset(${offset})`];
      const tokenRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/push_tokens/documents`, 'GET', null, queryArray);
      const tokenData = await tokenRes.json();

      if (tokenData.documents && tokenData.documents.length > 0) {
        allTokens = [...allTokens, ...tokenData.documents];
        offset += 100;
        log(`Progress: ${allTokens.length} / ${totalInDB} collected.`);
      } else {
        hasMore = false;
      }
      
      if (offset > 10000) break; // Infinite loop safety
    }

    const validTokens = allTokens
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token);

    log(`Step 4: Success. Filtered to ${validTokens.length} valid Expo tokens.`);

    // 3. Process Notifications
    for (const doc of unsentDocs) {
      // EXPO LIMIT: Max 100 per request
      for (let i = 0; i < validTokens.length; i += 100) {
        const chunk = validTokens.slice(i, i + 100);
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk.map(t => ({ 
            to: t, 
            title: doc.title, 
            body: doc.body,
            sound: "default"
          })))
        });
      }

      // 4. Update Status (PATCH)
      await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 'PATCH', {
        isSent: true
      });
      log(`Notification ${doc.$id} marked as sent.`);
    }

    return res.json({ 
      success: true, 
      tokensProcessed: validTokens.length, 
      notificationsSent: unsentDocs.length 
    });

  } catch (err) {
    error(`Critical Worker Error: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};