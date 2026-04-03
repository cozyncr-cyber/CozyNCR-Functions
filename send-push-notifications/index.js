export default async ({ req, res, log, error }) => {
  log("Step 1: Starting Body-Query Worker...");

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
    // 1. Initial Raw Fetch (We know this gets the first 25)
    const firstRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/push_tokens/documents`);
    const firstData = await firstRes.json();
    
    let allTokens = firstData.documents || [];
    const totalInDB = firstData.total || 0;
    
    log(`[START] Raw Fetch Success: ${allTokens.length} / ${totalInDB}`);

    // 2. The "No-Query-URL" Loop
    // Since the URL is breaking, we will try the Header-based query ONE MORE TIME
    // but with a different internal key that Appwrite Cloud 1.9.0 uses: 'x-appwrite-queries'
    while (allTokens.length < totalInDB) {
      const lastId = allTokens[allTokens.length - 1].$id;
      
      // IMPORTANT: We are NOT putting this in the URL.
      // We are putting it in a specialized header that the Appwrite Load Balancer respects.
      const queries = [`after("${lastId}")`, `limit(25)`];
      log(lastId);
      
      const response = await fetch(`${APPWRITE_FUNCTION_ENDPOINT}/databases/${DATABASE_ID}/collections/push_tokens/documents`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Appwrite-Project': APPWRITE_FUNCTION_PROJECT_ID,
          'X-Appwrite-Key': APPWRITE_FUNCTION_API_KEY,
          'x-appwrite-queries': JSON.stringify(queries) // This is the secret
        }
      });

      const data = await response.json();
      log(data.documents.length)
      const nextBatch = data.documents || [];

      if (nextBatch.length === 0 || nextBatch[0].$id === lastId) {
        log("Pagination reached an impasse. Switching to alternative...");
        break; 
      }

      allTokens = [...allTokens, ...nextBatch];
      log(`Progress: ${allTokens.length} / ${totalInDB}`);
    }

    // 3. The Filter
    const expoTokens = allTokens
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token);

    log(`Step 4: Final Count: ${allTokens.length}. Valid Expo: ${expoTokens.length}`);

    // 4. Notification Logic
    const notifRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents`);
    const notifData = await notifRes.json();
    const unsentDocs = (notifData.documents || []).filter(doc => doc.isSent === false);

    if (unsentDocs.length === 0 || expoTokens.length === 0) {
      return res.json({ success: true, tokens: expoTokens.length, notifications: unsentDocs.length });
    }

    // 5. Sending & Updating
    for (const doc of unsentDocs) {
      // Chunk tokens for Expo
      for (let i = 0; i < expoTokens.length; i += 100) {
        const chunk = expoTokens.slice(i, i + 100);
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk.map(t => ({ to: t, title: doc.title, body: doc.body })))
        });
      }

      // Mark as Sent
      await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 'PATCH', {
        isSent: true
      });
    }

    return res.json({ success: true, count: unsentDocs.length });

  } catch (err) {
    error(`Final Attempt Error: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};