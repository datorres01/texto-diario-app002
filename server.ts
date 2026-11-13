import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { GoogleGenAI, type LiveServerMessage, Modality } from '@google/genai';
import { WebSocketServer, type WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface DailyTextPayload {
  date: string;
  dateTitle: string;
  themeScripture: string;
  bodyParagraphs: string[];
  studyReference: string;
  publicationTitle: string;
  reference: string;
  sourceUrl: string;
  spokenText: string;
}

const dailyTextCache = new Map<string, { data: DailyTextPayload; fetchedAt: number }>();
const ttsCache = new Map<string, string>();
const MAX_TTS_CACHE = 30;

function getAiClient(apiVersion: 'v1beta' | 'v1alpha' = 'v1beta'): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada en el servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rsquo;/gi, '’')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

const BIBLE_BOOK_EXPANSIONS: Array<[RegExp, string]> = [
  [/\bGén\./g, 'Génesis'],
  [/\bÉx\./g, 'Éxodo'],
  [/\bLev\./g, 'Levítico'],
  [/\bNúm\./g, 'Números'],
  [/\bDeut\./g, 'Deuteronomio'],
  [/\bJos\./g, 'Josué'],
  [/\bJuec\./g, 'Jueces'],
  [/\b1\s*Sam\./g, 'Primero de Samuel'],
  [/\b2\s*Sam\./g, 'Segundo de Samuel'],
  [/\b1\s*Rey\./g, 'Primero de Reyes'],
  [/\b2\s*Rey\./g, 'Segundo de Reyes'],
  [/\b1\s*Crón\./g, 'Primero de Crónicas'],
  [/\b2\s*Crón\./g, 'Segundo de Crónicas'],
  [/\bNeh\./g, 'Nehemías'],
  [/\bSal\./g, 'Salmo'],
  [/\bProv\./g, 'Proverbios'],
  [/\bEcl\./g, 'Eclesiastés'],
  [/\bCant\./g, 'Cantar de los Cantares'],
  [/\bIs\./g, 'Isaías'],
  [/\bJer\./g, 'Jeremías'],
  [/\bLam\./g, 'Lamentaciones'],
  [/\bEzeq\./g, 'Ezequiel'],
  [/\bDan\./g, 'Daniel'],
  [/\bOs\./g, 'Oseas'],
  [/\bAbd\./g, 'Abdías'],
  [/\bMiq\./g, 'Miqueas'],
  [/\bNah\./g, 'Nahúm'],
  [/\bHab\./g, 'Habacuc'],
  [/\bSof\./g, 'Sofonías'],
  [/\bAgeo\b/g, 'Ageo'],
  [/\bZac\./g, 'Zacarías'],
  [/\bMal\./g, 'Malaquías'],
  [/\bMat\./g, 'Mateo'],
  [/\bMar\./g, 'Marcos'],
  [/\bLuc\./g, 'Lucas'],
  [/\bHech\./g, 'Hechos'],
  [/\bRom\./g, 'Romanos'],
  [/\b1\s*Cor\./g, 'Primera a los Corintios'],
  [/\b2\s*Cor\./g, 'Segunda a los Corintios'],
  [/\bGál\./g, 'Gálatas'],
  [/\bEfes\./g, 'Efesios'],
  [/\bFilip\./g, 'Filipenses'],
  [/\bCol\./g, 'Colosenses'],
  [/\b1\s*Tes\./g, 'Primera a los Tesalonicenses'],
  [/\b2\s*Tes\./g, 'Segunda a los Tesalonicenses'],
  [/\b1\s*Tim\./g, 'Primera a Timoteo'],
  [/\b2\s*Tim\./g, 'Segunda a Timoteo'],
  [/\bFilem\./g, 'Filemón'],
  [/\bHeb\./g, 'Hebreos'],
  [/\bSant\./g, 'Santiago'],
  [/\b1\s*Ped\./g, 'Primera de Pedro'],
  [/\b2\s*Ped\./g, 'Segunda de Pedro'],
  [/\bApoc\./g, 'Apocalipsis'],
];

function sanitizeSpokenText(rawText: string): string {
  // Iteratively remove everything inside parentheses () (including nested) and editorial brackets []
  let cleaned = rawText;
  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/\([^()]*\)/g, ' ').replace(/\[[^[\]]*\]/g, ' ');
  }
  cleaned = cleaned.replace(/[()[\]]/g, ' ');
  // Remove trailing watchtower/publication codes (e.g. w24.11 9 párrs. 5, 6)
  cleaned = cleaned.replace(/\bw\d{2}\.\d{2}\b[\s\S]*$/gi, '');
  // Expand any remaining stray abbreviations outside parentheses just in case
  for (const [pattern, replacement] of BIBLE_BOOK_EXPANSIONS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  cleaned = cleaned.replace(/(\d+):(\d+)-(\d+)/g, '$1, versículos $2 al $3');
  cleaned = cleaned.replace(/(\d+):(\d+)/g, '$1, versículo $2');
  // Fix spacing before punctuation and collapse duplicate punctuation/spaces
  cleaned = cleaned
    .replace(/\s+([.,;:!?»”])/g, '$1')
    .replace(/([.,;:!?])\s*\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

function buildSpokenText(
  dateTitle: string,
  themeScripture: string,
  bodyParagraphs: string[]
): string {
  const cleanTheme = sanitizeSpokenText(themeScripture);
  const cleanParagraphs = bodyParagraphs
    .map((p) => sanitizeSpokenText(p))
    .filter((p) => p.length > 0);

  return [`${dateTitle}.`, cleanTheme, ...cleanParagraphs]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDailyTextItem(dateStr: string, item: Record<string, unknown>): DailyTextPayload {
  const html = typeof item.content === 'string' ? item.content : '';
  const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const dateTitle = h2Match ? stripTags(h2Match[1]) : dateStr;

  const themeMatch = html.match(/<p[^>]*class="[^"]*themeScrp[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  const themeScripture = themeMatch ? stripTags(themeMatch[1]) : '';

  const bodyMatch = html.match(/<div[^>]*class="[^"]*bodyTxt[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : '';

  const rawParagraphs = Array.from(bodyHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)).map((m) =>
    stripTags(m[1])
  );
  const bodyParagraphs = rawParagraphs.filter((p) => p.length > 0);

  // Extract trailing watchtower citation if present in the last paragraph
  let studyReference = '';
  if (bodyParagraphs.length > 0) {
    const last = bodyParagraphs[bodyParagraphs.length - 1];
    const refMatch = last.match(/(w\d{2}\.\d{2}.*)$/i);
    if (refMatch) {
      studyReference = refMatch[1].trim();
    }
  }

  const publicationTitle =
    typeof item.publicationTitle === 'string'
      ? item.publicationTitle
      : 'Examinemos las Escrituras todos los días';
  const reference = typeof item.reference === 'string' ? item.reference : '';
  const rawUrl = typeof item.url === 'string' ? item.url : '/es/wol/h/r4/lp-s';
  const sourceUrl = rawUrl.startsWith('http')
    ? rawUrl
    : `https://wol.jw.org/es${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;

  return {
    date: dateStr,
    dateTitle,
    themeScripture,
    bodyParagraphs,
    studyReference,
    publicationTitle,
    reference,
    sourceUrl,
    spokenText: buildSpokenText(dateTitle, themeScripture, bodyParagraphs),
  };
}

async function fetchDailyTextFromWol(dateStr: string): Promise<DailyTextPayload> {
  const cached = dailyTextCache.get(dateStr);
  if (cached && Date.now() - cached.fetchedAt < 1000 * 60 * 60 * 6) {
    return cached.data;
  }

  const [y, m, d] = dateStr.split('-').map((n) => Number(n));
  if (!y || !m || !d) {
    throw new Error('Formato de fecha inválido. Use YYYY-MM-DD.');
  }

  const wolUrl = `https://wol.jw.org/wol/dt/r4/lp-s/${y}/${m}/${d}`;
  const response = await fetch(wolUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    },
  });

  if (!response.ok) {
    throw new Error(`No se pudo obtener el texto diario de wol.jw.org (HTTP ${response.status}).`);
  }

  const json = (await response.json()) as { items?: Array<Record<string, unknown>> };
  const dailyItem = json.items?.[0];
  if (!dailyItem) {
    throw new Error('No se encontró el texto diario para la fecha seleccionada.');
  }

  const parsed = parseDailyTextItem(dateStr, dailyItem);
  if (dailyTextCache.size >= 60) {
    const oldestKey = dailyTextCache.keys().next().value;
    if (oldestKey) dailyTextCache.delete(oldestKey);
  }
  dailyTextCache.set(dateStr, { data: parsed, fetchedAt: Date.now() });
  return parsed;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const body = req.body as {
        message?: string;
        dailyContext?: string;
        history?: Array<{ role: 'user' | 'model'; text: string }>;
      };
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      const dailyContext = typeof body.dailyContext === 'string' ? body.dailyContext.trim() : '';
      if (!message) {
        res.status(400).json({ error: 'Escribe o di una pregunta para conversar.' });
        return;
      }

      const ai = getAiClient('v1beta');
      const systemInstruction = [
        'Eres un acompañante amable, cálido y respetuoso que conversa en español sobre el texto bíblico diario de Examinemos las Escrituras todos los días.',
        'Responde de forma clara, cercana y breve (2 a 4 oraciones), ideal para escuchar en voz alta sin paréntesis ni abreviaturas difíciles de leer.',
        dailyContext ? `Texto diario de referencia:\n${dailyContext}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const historyContents = Array.isArray(body.history)
        ? body.history
            .slice(-8)
            .filter((h) => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string')
            .map((h) => ({
              role: h.role,
              parts: [{ text: h.text }],
            }))
        : [];

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          ...historyContents,
          { role: 'user', parts: [{ text: message }] },
        ],
        config: {
          systemInstruction,
        },
      });

      const reply = (response.text ?? '').trim();
      if (!reply) {
        throw new Error('No se recibió respuesta del asistente.');
      }
      res.json({ reply, spokenReply: sanitizeSpokenText(reply) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al conversar sobre el texto.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/daily-text', async (req, res) => {
    try {
      const requestedDate = typeof req.query.date === 'string' ? req.query.date : '';
      const now = new Date();
      const fallbackDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : fallbackDate;

      const data = await fetchDailyTextFromWol(dateStr);
      res.json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al consultar el texto diario.';
      res.status(502).json({ error: message });
    }
  });

  app.post('/api/tts', async (req, res) => {
    try {
      const body = req.body as { text?: string; voiceName?: string; style?: string };
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const voiceName = typeof body.voiceName === 'string' && body.voiceName.trim() ? body.voiceName.trim() : 'Kore';
      const style =
        typeof body.style === 'string' && body.style.trim()
          ? body.style.trim()
          : 'Voz cálida, serena, clara y natural en español latinoamericano, ideal para leer el texto bíblico diario por la mañana.';

      if (!text) {
        res.status(400).json({ error: 'Se requiere texto para generar el audio.' });
        return;
      }

      const trimmedText = sanitizeSpokenText(text).slice(0, 4500);
      const cacheKey = crypto
        .createHash('sha256')
        .update(`v2::${voiceName}::${style}::${trimmedText}`)
        .digest('hex');

      const cachedAudio = ttsCache.get(cacheKey);
      if (cachedAudio) {
        res.json({ audioBase64: cachedAudio, mimeType: 'audio/wav', cached: true });
        return;
      }

      const naturalStyle =
        typeof body.style === 'string' && body.style.trim()
          ? body.style.trim()
          : 'Narrador humano muy cálido, amable y expresivo en español latinoamericano. Lee con entonación natural, pausas suaves y respiración tranquila, nunca monótono ni robótico.';

      let base64Audio: string | undefined;
      let lastError: unknown;

      // Try flagship natural TTS first on v1beta, then lite TTS, then v1beta without speechMetadata
      const attempts: Array<{
        model: string;
        apiVersion: 'v1beta' | 'v1alpha';
        useMetadata: boolean;
      }> = [
        { model: 'gemini-3.8-flash-tts', apiVersion: 'v1beta', useMetadata: true },
        { model: 'gemini-3.8-flash-lite-tts', apiVersion: 'v1beta', useMetadata: true },
        { model: 'gemini-3.8-flash-tts', apiVersion: 'v1beta', useMetadata: false },
        { model: 'gemini-2.5-flash-preview-tts', apiVersion: 'v1beta', useMetadata: false },
      ];

      for (const attempt of attempts) {
        try {
          const ai = getAiClient(attempt.apiVersion);
          const partPayload = attempt.useMetadata
            ? {
                text: trimmedText,
                speechMetadata: { style: naturalStyle },
              }
            : {
                text: `Lee en español latinoamericano con voz muy natural, cálida, expresiva y pausada (sin sonar robótico): ${trimmedText}`,
              };

          const ttsResponse = await ai.models.generateContent({
            model: attempt.model,
            contents: [{ role: 'user', parts: [partPayload] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          });

          const data =
            ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (data) {
            base64Audio = data;
            break;
          }
        } catch (err) {
          lastError = err;
        }
      }

      if (!base64Audio) {
        throw lastError instanceof Error
          ? lastError
          : new Error('El servicio de voz IA no devolvió audio.');
      }

      if (ttsCache.size >= MAX_TTS_CACHE) {
        const oldestKey = ttsCache.keys().next().value;
        if (oldestKey) ttsCache.delete(oldestKey);
      }
      ttsCache.set(cacheKey, base64Audio);

      res.json({ audioBase64: base64Audio, mimeType: 'audio/wav', cached: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo generar la lectura por voz IA.';
      res.status(500).json({ error: message });
    }
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? request.url.split('?')[0] : '';
    if (pathname === '/api/live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (clientWs: WebSocket) => {
    let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let isClosed = false;

    const sendSafe = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const startLiveSession = async (voiceName: string, dailyContext: string) => {
      try {
        const ai = getAiClient();
        const allowedVoices = ['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir'];
        const safeVoice = allowedVoices.includes(voiceName) ? voiceName : 'Kore';

        const systemInstruction = [
          'Eres un acompañante amable, cálido y respetuoso que conversa en español sobre el texto bíblico diario de Examinemos las Escrituras todos los días.',
          'Responde de forma clara, breve y natural para una conversación de voz.',
          dailyContext
            ? `Este es el texto diario actual para tenerlo presente en la conversación:\n${dailyContext}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        session = await ai.live.connect({
          model: 'gemini-3.8-live',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: safeVoice } },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction,
          },
          callbacks: {
            onopen: () => {
              sendSafe({ ready: true });
            },
            onmessage: (message: LiveServerMessage) => {
              const content = message.serverContent;
              if (content?.inputTranscription?.text) {
                sendSafe({ inputTranscript: content.inputTranscription.text });
              }
              if (content?.outputTranscription?.text) {
                sendSafe({ outputTranscript: content.outputTranscription.text });
              }
              for (const part of content?.modelTurn?.parts ?? []) {
                if (part.inlineData?.data) {
                  sendSafe({ audio: part.inlineData.data });
                }
              }
              if (content?.interrupted) {
                sendSafe({ interrupted: true });
              }
              if (content?.turnComplete) {
                sendSafe({ turnComplete: true });
              }
            },
            onerror: (err: unknown) => {
              const msg = err instanceof Error ? err.message : 'Error en la sesión de voz en vivo.';
              sendSafe({ error: msg });
            },
            onclose: () => {
              if (!isClosed) {
                sendSafe({ closed: true });
              }
            },
          },
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'No se pudo iniciar la conversación en vivo.';
        sendSafe({ error: msg });
      }
    };

    clientWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          voiceName?: string;
          dailyContext?: string;
          audio?: string;
          text?: string;
        };

        if (msg.type === 'init') {
          if (!session) {
            await startLiveSession(msg.voiceName || 'Kore', msg.dailyContext || '');
          }
          return;
        }

        if (!session) return;

        if (msg.audio) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.text) {
          session.sendRealtimeInput({
            text: msg.text,
          });
        }
      } catch {
        // ignore malformed frames
      }
    });

    clientWs.on('close', () => {
      isClosed = true;
      if (session) {
        try {
          session.close();
        } catch {
          // ignore
        }
        session = null;
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Texto Diario server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
