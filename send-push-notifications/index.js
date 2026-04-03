export default async ({ req, res, log, error }) => {
  log("Step 1: Starting Base64-Encoded Worker...");

  const { 
    APPWRITE_FUNCTION_ENDPOINT, 
    APPWRITE_FUNCTION_PROJECT_ID, 
    APPWRITE_FUNCTION_API_KEY,
    DATABASE_ID
  } = process.env;

  // Helper that encodes queries into a Base64 string for the URL
  const appwriteFetch = (path, method = 'GET', body = null, queryArray = []) => {
    let finalPath = path;
    
    if (queryArray.length > 0) {
      // Step A: Convert array to JSON string: '["limit(100)", "offset(0)"]'
      const jsonQueries = JSON.stringify(queryArray);
      // Step B: URL Encode it (safe for all servers)
      const encoded = encodeURIComponent(jsonQueries);
      // Step C: Append to URL using the 'queries' key
      finalPath += `?queries=${encoded}`;
    }

    return fetch(`${APPWRITE_FUNCTION_ENDPOINT}${finalPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': APPWRITE_FUNCTION_PROJECT_ID,
        'X-Appwrite-Key': APPWRITE_FUNCTION_API_KEY
      },
      body: body ? JSON.stringify(body) : null
    });
  };

  try {
    // --- STEP 1: TOKEN TEST ---
    const totalRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/push_tokens/documents`);
    const totalData = await totalRes.json();
    const totalInDB = totalData.total || 0;
    
    log(`[TEST] Database reports ${totalInDB} total tokens.`);

    let allTokens = [];
    let offset = 0;

    log("Step 2: Starting Base64 Pagination...");

    while (allTokens.length < totalInDB) {
      // Use the exact strings the API expects
      const queryInstructions = [`limit(100)`, `offset(${offset})`];
      
      const tokenRes = await appwriteFetch(
        `/databases/${DATABASE_ID}/collections/push_tokens/documents`, 
        'GET', 
        null, 
        queryInstructions
      );
      
      const tokenData = await tokenRes.json();

      if (tokenData.documents && tokenData.documents.length > 0) {
        // Validation check
        if (allTokens.length > 0 && tokenData.documents[0].$id === allTokens[0].$id) {
          throw new Error("Pagination Failed: Server is still ignoring queries. Stopping.");
        }

        allTokens = [...allTokens, ...tokenData.documents];
        offset += 100;
        log(`Progress: ${allTokens.length} / ${totalInDB}`);
      } else {
        break;
      }
    }

    const uniqueTokens = Array.from(new Set(allTokens
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token)));

    log(`[TEST RESULT] Successfully collected ${uniqueTokens.length} unique tokens.`);

    // --- STEP 2: NOTIFICATIONS ---
    const notifRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents`);
    const notifData = await notifRes.json();
    const unsentDocs = (notifData.documents || []).filter(doc => doc.isSent === false);

    if (unsentDocs.length === 0) {
      return res.json({ success: true, tokens: uniqueTokens.length, message: "No notifications." });
    }

    // --- STEP 3: SENDING ---
    for (const doc of unsentDocs) {
      for (let i = 0; i < uniqueTokens.length; i += 100) {
        const chunk = uniqueTokens.slice(i, i + 100);
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk.map(t => ({ to: t, title: doc.title, body: doc.body })))
        });
      }

      // Mark as sent
      await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 'PATCH', {
        isSent: true
      });
    }

    return res.json({ success: true, count: unsentDocs.length });

  } catch (err) {
    error(`Final Error: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};