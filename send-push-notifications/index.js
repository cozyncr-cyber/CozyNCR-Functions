export default async ({ req, res, log, error }) => {

  log("Step 1: Starting Offset Pagination Worker...");

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

    // 1. OFFSET PAGINATION (FIXED)
    let allTokens = [];
    let offset = 0;
    const limit = 25;

    while (true) {

      const response = await appwriteFetch(
        `/databases/${DATABASE_ID}/collections/push_tokens/documents?limit=${limit}&offset=${offset}`
      );

      const data = await response.json();
      const batch = data.documents || [];

      log(`Fetched batch: ${batch.length} at offset ${offset}`);

      if (batch.length === 0) break;

      allTokens = [...allTokens, ...batch];
      offset += limit;

      if (batch.length < limit) break; // last page
    }

    log(`[FETCH COMPLETE] Total Raw Docs: ${allTokens.length}`);

    // 2. DEDUPLICATION SAFETY (IMPORTANT)
    const uniqueMap = new Map();
    for (const doc of allTokens) {
      uniqueMap.set(doc.$id, doc);
    }
    allTokens = Array.from(uniqueMap.values());

    log(`[DEDUPED] Unique Docs: ${allTokens.length}`);

    // 3. FILTER EXPO TOKENS
    const expoTokens = allTokens
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token);

    log(`Step 2: Valid Expo Tokens: ${expoTokens.length}`);

    // 4. FETCH NOTIFICATIONS
    const notifRes = await appwriteFetch(
      `/databases/${DATABASE_ID}/collections/notifications/documents`
    );

    const notifData = await notifRes.json();

    const unsentDocs = (notifData.documents || []).filter(
      doc => doc.isSent === false
    );

    log(`Step 3: Unsent Notifications: ${unsentDocs.length}`);

    if (unsentDocs.length === 0 || expoTokens.length === 0) {
      return res.json({
        success: true,
        tokens: expoTokens.length,
        notifications: unsentDocs.length
      });
    }

    // 5. SEND NOTIFICATIONS
    for (const doc of unsentDocs) {

      for (let i = 0; i < expoTokens.length; i += 100) {

        const chunk = expoTokens.slice(i, i + 100);

        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            chunk.map(t => ({
              to: t,
              title: doc.title,
              body: doc.body
            }))
          )
        });
      }

      // MARK AS SENT
      await appwriteFetch(
        `/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`,
        'PATCH',
        { isSent: true }
      );
    }

    return res.json({
      success: true,
      sentNotifications: unsentDocs.length,
      totalTokens: expoTokens.length
    });

  } catch (err) {
    error(`Worker Error: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};