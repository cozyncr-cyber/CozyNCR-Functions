export default async ({ req, res, log, error }) => {
  log("Step 1: Starting Diagnostic Worker...");

  const { 
    APPWRITE_FUNCTION_ENDPOINT, 
    APPWRITE_FUNCTION_PROJECT_ID, 
    APPWRITE_FUNCTION_API_KEY,
    DATABASE_ID
  } = process.env;

  const appwriteFetch = (path, method = 'GET', body = null, queryArray = []) => {
    let finalPath = path;
    if (queryArray.length > 0) {
      // Use the standard array format but perfectly encoded
      const queryStr = queryArray.map(q => `queries[]=${encodeURIComponent(q)}`).join('&');
      finalPath += `?${queryStr}`;
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
    // --- 1. TEST THE COLLECTION ---
    const totalRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/push_tokens/documents`);
    const totalData = await totalRes.json();
    const totalInDB = totalData.total || 0;
    const rawDocs = totalData.documents || [];
    
    log(`[TEST] DB Total: ${totalInDB}. Batch Size: ${rawDocs.length}`);

    if (rawDocs.length > 0) {
        log(`[DIAGNOSTIC] Sample Token from DB: "${rawDocs[0].token}"`);
    } else {
        log(`[DIAGNOSTIC] Collection returned NO documents. Check permissions!`);
    }

    // --- 2. THE PAGINATION ---
    let allTokens = [];
    let offset = 0;

    while (allTokens.length < totalInDB) {
      const tokenRes = await appwriteFetch(
        `/databases/${DATABASE_ID}/collections/push_tokens/documents`, 
        'GET', 
        null, 
        [`limit(25)`, `offset(${offset})`]
      );
      
      const tokenData = await tokenRes.json();
      const docs = tokenData.documents || [];

      if (docs.length === 0) break;

      allTokens = [...allTokens, ...docs];
      offset += 25;
      log(`Fetched ${allTokens.length} / ${totalInDB}...`);
      
      if (offset > 5000) break;
    }

    // --- 3. THE FILTER ---
    // We log the count BEFORE and AFTER the filter to see if the filter is the "killer"
    const expoTokens = allTokens
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token);

    log(`Filter Result: ${allTokens.length} total docs -> ${expoTokens.length} Expo tokens.`);

    // --- 4. NOTIFICATIONS ---
    const notifRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents`);
    const notifData = await notifRes.json();
    const unsentDocs = (notifData.documents || []).filter(doc => doc.isSent === false);

    if (unsentDocs.length === 0 || expoTokens.length === 0) {
        return res.json({ 
            success: true, 
            tokensFound: allTokens.length, 
            expoTokens: expoTokens.length,
            unsentNotifs: unsentDocs.length 
        });
    }

    // --- 5. SENDING ---
    for (const doc of unsentDocs) {
      for (let i = 0; i < expoTokens.length; i += 100) {
        const chunk = expoTokens.slice(i, i + 100);
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk.map(t => ({ to: t, title: doc.title, body: doc.body })))
        });
      }
      await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 'PATCH', { isSent: true });
    }

    return res.json({ success: true, processed: unsentDocs.length });

  } catch (err) {
    error(`Crash: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};