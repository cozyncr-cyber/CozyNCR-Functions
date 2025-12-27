import sdk from "node-appwrite";
import fetch from "node-fetch";

export default async ({ req, res, log }) => {
  try {
    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

    const db = new sdk.Databases(client);

    const { title, body } = req.body;

    if (!title || !body) {
      return res.json({ error: "Missing title or body" }, 400);
    }

    const list = await db.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION
    );

    if (!list.documents.length) {
      log("No tokens found");
      return res.json({ sent: 0 });
    }

    const messages = list.documents.map((d) => ({
      to: d.token,
      title,
      body
    }));

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages)
    });

    return res.json({ sent: messages.length });
  } catch (err) {
    log("ERROR:", err);
    return res.json({ error: err.message }, 500);
  }
};