export default async ({ req, res, log, error }) => {
  log("Step 1: Initializing Final Worker (Structured Query Mode)...");

  const { 
    APPWRITE_FUNCTION_ENDPOINT, 
    APPWRITE_FUNCTION_PROJECT_ID, 
    APPWRITE_FUNCTION_API_KEY,
    DATABASE_ID
  } = process.env;

  // Helper for Appwrite REST calls
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
    // --- 1. COLLECT ALL TOKENS ---
    let allTokens = [];
    let lastId = null;
    let hasMore = true;

    log("Step 2: Fetching tokens using structured queries...");

    while (hasMore) {
      const queries = [];
      
      // Limit to 100 per batch
      queries.push(JSON.stringify({ method: "limit", values: [100] }));
      
      // If we have a cursor, add the 'after' query
      if (lastId) {
        queries.push(JSON.stringify({ method: "after", values: [lastId] }));
      }

      // Build the URL with structured queries: queries[0]=...&queries[1]=...
      const queryString = queries
        .map((q, i) => `queries[${i}]=${encodeURIComponent(q)}`)
        .join('&');
      
      const tokenRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/push_tokens/documents?${queryString}`);
      const tokenData = await tokenRes.json();

      if (!tokenRes.ok) throw new Error(`Token Fetch Error: ${tokenData.message}`);

      const docs = tokenData.documents || [];
      if (docs.length === 0) {
        hasMore = false;
      } else {
        allTokens = [...allTokens, ...docs];
        lastId = docs[docs.length - 1].$id;
        log(`Collected ${allTokens.length} / ${tokenData.total} tokens.`);
        
        // If we've gathered everything, stop the loop
        if (allTokens.length >= tokenData.total) hasMore = false;
      }
    }

    // Filter and Unique-ify
    const expoTokens = Array.from(new Set(allTokens
      .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
      .map(d => d.token)));

    log(`Step 3: Ready to send to ${expoTokens.length} unique devices.`);

    // --- 2. FETCH NOTIFICATIONS ---
    const notifRes = await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents`);
    const notifData = await notifRes.json();
    const unsentDocs = (notifData.documents || []).filter(doc => doc.isSent === false);

    if (unsentDocs.length === 0) {
      return res.json({ success: true, message: "No notifications to send today." });
    }

    // --- 3. PROCESS SENDING ---
    for (const doc of unsentDocs) {
      log(`Processing: ${doc.title}`);

      // Expo allows max 100 per request
      for (let i = 0; i < expoTokens.length; i += 100) {
        const chunk = expoTokens.slice(i, i + 100);
        const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk.map(token => ({
            to: token,
            title: doc.title,
            body: doc.body,
            sound: "default"
          })))
        });

        if (!expoRes.ok) error(`Expo Error for batch in ${doc.$id}`);
      }

      // --- 4. UPDATE STATUS (PATCH) ---
      // Fix: Attributes must be at the root of the object
      const updateRes = await appwriteFetch(
        `/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 
        'PATCH', 
        { isSent: true }
      );

      if (updateRes.ok) {
        log(`SUCCESS: Notification ${doc.$id} marked as sent.`);
      } else {
        const errLog = await updateRes.json();
        error(`Update failed for ${doc.$id}: ${JSON.stringify(errLog)}`);
      }
    }

    return res.json({ 
      success: true, 
      tokensUsed: expoTokens.length, 
      notificationsProcessed: unsentDocs.length 
    });

  } catch (err) {
    error(`Global Worker Crash: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};