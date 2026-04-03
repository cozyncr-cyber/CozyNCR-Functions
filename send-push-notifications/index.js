export default async ({ req, res, log, error }) => {
  log("Step 1: Starting Worker (Token-First Test Mode)...");

  const { 
    APPWRITE_FUNCTION_ENDPOINT, 
    APPWRITE_FUNCTION_PROJECT_ID, 
    APPWRITE_FUNCTION_API_KEY,
    DATABASE_ID
  } = process.env;

  const appwriteFetch = (path, method = 'GET', body = null, queryArray = []) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': APPWRITE_FUNCTION_PROJECT_ID,
      'X-Appwrite-Key': APPWRITE_FUNCTION_API_KEY
    };

    if (queryArray.length > 0) {
      headers['x-appwrite-queries'] = JSON.stringify(queryArray);
    }

    return fetch(`${APPWRITE_FUNCTION_ENDPOINT}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });
  };

  try {
    // --- STEP 1: TOKEN COLLECTION TEST (Always runs) ---
    const totalRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/push_tokens/documents`);
    const totalData = await totalRes.json();
    const totalInDB = totalData.total || 0;
    
    log(`[TEST] Database reports ${totalInDB} total tokens.`);

    let allTokens = [];
    let offset = 0;

    log("Step 2: Testing Paginated Token Collection...");

    while (allTokens.length < totalInDB) {
      const queryInstructions = [`limit(100)`, `offset(${offset})`];
      const tokenRes = await appwriteFetch(
        `/databases/${DATABASE_ID}/collections/push_tokens/documents`, 
        'GET', 
        null, 
        queryInstructions
      );
      
      const tokenData = await tokenRes.json();

      if (tokenData.documents && tokenData.documents.length > 0) {
        // Safety check for ignored headers
        if (allTokens.length > 0 && tokenData.documents[0].$id === allTokens[0].$id) {
          throw new Error("Pagination Failed: Server is returning duplicate pages (check header support).");
        }

        allTokens = [...allTokens, ...tokenData.documents];
        offset += 100;
        log(`Token Fetch Progress: ${allTokens.length} / ${totalInDB}`);
      } else {
        break;
      }
      if (offset > 10000) break;
    }

    const uniqueTokens = Array.from(new Set(allTokens
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token)));

    log(`[TEST RESULT] Successfully collected ${uniqueTokens.length} unique Expo tokens.`);

    // --- STEP 2: NOTIFICATION LOGIC ---
    log("Step 3: Checking for unsent notifications...");
    const notifRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents`);
    const notifData = await notifRes.json();
    const unsentDocs = (notifData.documents || []).filter(doc => doc.isSent === false);

    if (unsentDocs.length === 0) {
      log("No unsent notifications found. Task complete.");
      return res.json({ 
        success: true, 
        testPassed: true, 
        tokensFound: uniqueTokens.length, 
        message: "Token test passed, 0 notifications to send." 
      });
    }

    // --- STEP 3: SENDING ---
    log(`Step 4: Sending ${unsentDocs.length} notifications to ${uniqueTokens.length} devices.`);

    for (const doc of unsentDocs) {
      for (let i = 0; i < uniqueTokens.length; i += 100) {
        const chunk = uniqueTokens.slice(i, i + 100);
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

      // Mark as sent
      await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 'PATCH', {
        isSent: true
      });
    }

    return res.json({ 
      success: true, 
      processed: unsentDocs.length, 
      tokens: uniqueTokens.length 
    });

  } catch (err) {
    error(`Worker Error: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};