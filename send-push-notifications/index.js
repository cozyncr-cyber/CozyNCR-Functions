export default async ({ req, res, log, error }) => {
  log("Step 1: Starting Cursor-Based Worker...");

  const { 
    APPWRITE_FUNCTION_ENDPOINT, 
    APPWRITE_FUNCTION_PROJECT_ID, 
    APPWRITE_FUNCTION_API_KEY,
    DATABASE_ID
  } = process.env;

  const appwriteFetch = (path, method = 'GET', body = null) => {
    return fetch(`${APPWRITE_FUNCTION_ENDPOINT}${path}`, {
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
    // 1. Initial Fetch to get the first page and total
    const firstRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/push_tokens/documents`);
    const firstData = await firstRes.json();
    
    let allTokens = firstData.documents || [];
    const totalInDB = firstData.total || 0;
    
    log(`[START] Found ${allTokens.length} initial tokens. Total in DB: ${totalInDB}`);

    // 2. CURSOR PAGINATION (No 'offset' or 'limit' keywords)
    // We fetch until our local array matches the total count
    while (allTokens.length < totalInDB) {
      const lastId = allTokens[allTokens.length - 1].$id;
      
      // We use the 'after' query. This is much more stable than offset.
      // Format: ?queries[]=after("ID")
      const query = encodeURIComponent(`after("${lastId}")`);
      const path = `/databases/${DATABASE_ID}/collections/push_tokens/documents?queries[]=${query}`;
      
      log(`Fetching next batch after ID: ${lastId}`);
      
      const nextRes = await appwriteFetch(path);
      const nextData = await nextRes.json();
      const nextBatch = nextData.documents || [];

      if (nextBatch.length === 0) {
        log("No more documents returned by server.");
        break;
      }

      allTokens = [...allTokens, ...nextBatch];
      log(`Progress: ${allTokens.length} / ${totalInDB}`);
    }

    // 3. Filter
    const expoTokens = allTokens
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token);

    log(`Final: Collected ${allTokens.length} docs. Valid Expo tokens: ${expoTokens.length}`);

    // 4. Notifications
    const notifRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents`);
    const notifData = await notifRes.json();
    const unsentDocs = (notifData.documents || []).filter(doc => doc.isSent === false);

    if (unsentDocs.length === 0 || expoTokens.length === 0) {
      return res.json({ success: true, tokens: expoTokens.length, unsent: unsentDocs.length });
    }

    // 5. Send
    for (const doc of unsentDocs) {
      for (let i = 0; i < expoTokens.length; i += 100) {
        const chunk = expoTokens.slice(i, i + 100);
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk.map(t => ({ to: t, title: doc.title, body: doc.body })))
        });
      }
      // Corrected PATCH
      await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 'PATCH', { isSent: true });
    }

    return res.json({ success: true, totalSent: unsentDocs.length });

  } catch (err) {
    error(`Crash: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};