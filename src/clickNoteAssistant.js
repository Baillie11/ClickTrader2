const crypto = require("crypto");

const MAX_QUESTIONS = 40;
const MAX_TEXT_LENGTH = 12000;

function secureMatch(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validatePayload(body) {
  if (!body || typeof body !== "object") throw new Error("A report request is required.");
  if (!Array.isArray(body.questions) || body.questions.length < 1) {
    throw new Error("At least one report question is required.");
  }
  if (body.questions.length > MAX_QUESTIONS) throw new Error("Too many report questions.");

  const questions = body.questions.map((question) => ({
    id: cleanText(question?.id, 100),
    prompt: cleanText(question?.prompt, 2000),
    currentAnswer: cleanText(question?.currentAnswer, 5000),
    answerType: cleanText(question?.answerType, 50)
  }));
  if (questions.some((question) => !question.id || !question.prompt)) {
    throw new Error("Each report question requires an id and prompt.");
  }

  return {
    shift: body.shift && typeof body.shift === "object" ? body.shift : {},
    evidence: body.evidence && typeof body.evidence === "object" ? body.evidence : {},
    questions
  };
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

async function createReportDrafts(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI service is not configured.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.CLICK_NOTE_AI_MODEL || process.env.OPENAI_REPORT_MODEL || "gpt-5-mini",
      store: false,
      instructions: [
        "You assist an Australian disability support worker to draft factual end-of-shift responses.",
        "Use only the supplied shift evidence and current answers. Never invent an event, observation, outcome, medication detail, incident, person, place, or time.",
        "If evidence is insufficient, answer exactly: More information is required.",
        "Use concise, professional, objective language and preserve the chronological order of live notes.",
        "For goal questions, explicitly connect the selected goal to documented support actions. Describe progress only when the evidence demonstrates it.",
        "Do not provide clinical diagnoses, legal conclusions, or compliance guarantees. Return JSON only."
      ].join(" "),
      input: JSON.stringify(payload),
      text: {
        format: {
          type: "json_schema",
          name: "shift_report_drafts",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              answers: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    questionId: { type: "string" },
                    answer: { type: "string" }
                  },
                  required: ["questionId", "answer"]
                }
              }
            },
            required: ["answers"]
          }
        }
      }
    }),
    signal: AbortSignal.timeout(45000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[ClickNoteAI] OpenAI request failed:", response.status, data?.error?.code || "unknown");
    throw new Error("AI assistance is temporarily unavailable.");
  }

  const parsed = JSON.parse(extractOutputText(data));
  const requestedIds = new Set(payload.questions.map((question) => question.id));
  return (Array.isArray(parsed.answers) ? parsed.answers : []).filter(
    (answer) => requestedIds.has(answer?.questionId) && typeof answer.answer === "string"
  );
}

function registerClickNoteAssistant(app, rateLimit) {
  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
  });

  app.post("/api/click-note-taker/report-assistant", limiter, async (req, res) => {
    try {
      const expectedCode = process.env.CLICK_NOTE_ACCESS_CODE;
      if (!expectedCode || !secureMatch(req.get("X-Click-Note-Access"), expectedCode)) {
        return res.status(401).json({ error: "Invalid AI access code." });
      }
      const payload = validatePayload(req.body);
      const answers = await createReportDrafts(payload);
      return res.json({ answers });
    } catch (error) {
      if (error instanceof SyntaxError) return res.status(502).json({ error: "The AI response could not be read." });
      if (error?.name === "TimeoutError") return res.status(504).json({ error: "AI assistance timed out. Please try again." });
      if (/required|questions|request/i.test(error.message)) return res.status(400).json({ error: error.message });
      console.error("[ClickNoteAI]", error.message);
      return res.status(503).json({ error: error.message || "AI assistance is unavailable." });
    }
  });
}

module.exports = { registerClickNoteAssistant };
