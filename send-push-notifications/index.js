export default async ({ req, res, log, error }) => {
  log("Step 1: Starting dependency-free worker...");

  const { 
    APPWRITE_FUNCTION_ENDPOINT, 
    APPWRITE_FUNCTION_PROJECT_ID, 
    APPWRITE_FUNCTION_API_KEY,
    DATABASE_ID,
    PUSH_TOKENS_COLLECTION 
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
  // 1. Fetch ALL notifications (No filter)
  // Removing the queries[] parameter to test basic connectivity
  const notifPath = `/databases/${DATABASE_ID}/collections/notifications/documents`;
  
  log(`TEST: Fetching all documents from: ${notifPath}`);
  const notifRes = await appwriteFetch(notifPath);
  const data = await notifRes.json();

  if (!notifRes.ok) {
    error(`Appwrite API Error: ${JSON.stringify(data)}`);
    return res.json({ error: "API Failure", details: data }, 500);
  }

  const unsentDocs = data.documents || [];
  log(`TEST SUCCESS: Found ${unsentDocs.length} total documents.`);

  if (unsentDocs.length === 0) {
    log("Collection is empty. Add a row manually to test.");
    return res.json({ message: "No data in collection" });
  }

    // 2. Fetch push tokens
    const tokenPath = `/databases/${DATABASE_ID}/collections/push_tokens/documents`;
    const tokenRes = await appwriteFetch(tokenPath);
    const tokenData = await tokenRes.json();
// This will now print the actual data instead of [object Object]
log(`Step 1.6 Raw Data: ${JSON.stringify(tokenData)}`);

// Check for the documents array specifically
const allDocs = tokenData.documents || [];
log(`Step 1.7: Found ${allDocs.length} total rows in this batch.`);

// Log the actual token values found to see why the filter is hitting them
allDocs.forEach((d, index) => {
    log(`Row ${index} - ID: ${d.$id} - Token Value: "${d.token}"`);
});

const validTokens = allDocs
  .filter(d => d.token && d.token.startsWith("ExponentPushToken"))
  .map(d => d.token);

log(`Step 2: Filtered down to ${validTokens.length} valid tokens.`);

    // 3. Process each notification
    for (const doc of unsentDocs) {
      const messages = validTokens.map(token => ({
        to: token,
        title: doc.title,
        body: doc.body,
        sound: "default"
      }));

      const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages)
      });

      if (expoRes.ok) {
        // 4. Update isSent via PATCH
        // For updates, we send the data object directly
        await appwriteFetch(`/databases/${DATABASE_ID}/collections/notifications/documents/${doc.$id}`, 'PATCH', {
          data: { isSent: true }
        });
        log(`Successfully processed doc: ${doc.$id}`);
      }
    }

    return res.json({ success: true, processedCount: unsentDocs.length });

  } catch (err) {
    error(`Fetch Worker Error: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};