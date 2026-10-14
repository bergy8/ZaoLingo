import 'dotenv/config';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import { pinyin } from 'pinyin-pro';

// In-memory cache for parsed articles (URL -> { data, timestamp })
const ARTICLE_CACHE = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Gemini candidate models in order of priority:
// gemini-3.1-flash-lite provides lowest latency and highest throughput
const DEFAULT_CANDIDATE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest',
];

function sendJson(res: any, status: number, data: any) {
  if (res.headersSent) return;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function parseRequestBody(req: any): Promise<any> {
  // If req.body is already parsed (Express or Vercel middleware)
  if (req.body) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch (e) {
        return {};
      }
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        return JSON.parse(req.body.toString('utf-8'));
      } catch (e) {
        return {};
      }
    }
    if (typeof req.body === 'object') {
      return req.body;
    }
  }

  // If req is an unread Node Readable stream
  if (req && typeof req.on === 'function' && req.readable) {
    try {
      const chunks: any[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (raw.trim()) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Could not read stream body:', e);
    }
  }

  return {};
}

function repairAndParseJson(text: string): any {
  let clean = text.trim();

  // 1. Strip markdown code fences if present
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    clean = fenceMatch[1].trim();
  }

  // 2. Direct JSON parse
  try {
    return JSON.parse(clean);
  } catch (e) {}

  // 3. Find outermost container: object { ... } or array [ ... ]
  const firstBrace = clean.indexOf('{');
  const firstBracket = clean.indexOf('[');

  let isArray = false;
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    isArray = true;
  }

  if (isArray) {
    const lastBracket = clean.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      clean = clean.substring(firstBracket, lastBracket + 1);
    } else if (firstBracket !== -1) {
      clean = clean.substring(firstBracket);
    }
  } else {
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.substring(firstBrace, lastBrace + 1);
    } else if (firstBrace !== -1) {
      clean = clean.substring(firstBrace);
    }
  }

  // Try parsing extracted block
  try {
    return JSON.parse(clean);
  } catch (e) {}

  // 4. Repair unclosed quotes and brackets
  let openQuotes = (clean.match(/"/g) || []).length % 2 !== 0;
  if (openQuotes) clean += '"';

  let openBraces = (clean.match(/\{/g) || []).length - (clean.match(/\}/g) || []).length;
  let openBrackets = (clean.match(/\[/g) || []).length - (clean.match(/\]/g) || []).length;
  
  let suffix = '';
  while (openBrackets > 0) { suffix += ']'; openBrackets--; }
  while (openBraces > 0) { suffix += '}'; openBraces--; }

  try {
    return JSON.parse(clean + suffix);
  } catch (e) {}

  throw new Error("Invalid JSON returned from model.");
}

// Format Chinese words into { z, p } with local high-performance Pinyin
function formatSentenceWords(wArray: any[]): { z: string; p: string }[] {
  if (!Array.isArray(wArray)) return [];
  return wArray.map((item: any) => {
    let zh = '';
    let py = '';

    if (typeof item === 'string') {
      zh = item;
    } else if (Array.isArray(item)) {
      zh = item[0] || '';
      py = item[1] || '';
    } else if (item && typeof item === 'object') {
      zh = item.z || item.word || '';
      py = item.p || item.pinyin || '';
    }

    const isPunctuation = /^[，。！？、：；“”‘’（）《》〈〉【】—…\s.,?!:;'"\-_—]+$/.test(zh);
    if (isPunctuation) {
      py = '';
    } else if (!py || py === zh) {
      // Compute tone-marked pinyin with pinyin-pro
      py = pinyin(zh);
    }

    return { z: zh, p: py };
  });
}

export default async function handler(req: any, res: any) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (typeof res.status === 'function' && typeof res.end === 'function') {
      return res.status(200).end();
    }
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed. Please use POST or GET.' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY 
      || process.env.GOOGLE_API_KEY 
      || process.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
      return sendJson(res, 500, {
        error: 'GEMINI_API_KEY is not configured on Vercel. Go to Vercel Dashboard > Project Settings > Environment Variables, add GEMINI_API_KEY, and redeploy.'
      });
    }

    // Safely extract request body / query parameters
    const body = await parseRequestBody(req);
    const rawUrl = body.url || req.query?.url;
    const directText = body.text || req.query?.text;

    let targetUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    let pageTitle = 'Chinese Article';
    let rawText = '';

    // Check if input is direct Chinese text (not a URL)
    if (!targetUrl.startsWith('http') && targetUrl.length > 5 && !directText) {
      // User pasted article text directly into the input!
      rawText = targetUrl.substring(0, 15000);
      const firstLine = rawText.split('\n')[0].trim();
      pageTitle = firstLine.length < 50 ? firstLine : 'Custom Chinese Text';
    } else if (directText && typeof directText === 'string') {
      rawText = directText.substring(0, 15000);
      pageTitle = body.title || 'Custom Chinese Text';
    } else {
      // It is a URL
      if (!targetUrl || !targetUrl.includes('zaobao.com.sg')) {
        return sendJson(res, 400, { 
          error: 'Please enter a valid Zaobao article URL (e.g. https://www.zaobao.com.sg/news/singapore/story...) or paste Chinese text directly.' 
        });
      }

      const normalizedUrl = targetUrl.split('#')[0];

      // Check cache first for instant response
      const cached = ARTICLE_CACHE.get(normalizedUrl);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return sendJson(res, 200, cached.data);
      }

      // Fetch article HTML from Zaobao
      const fetchHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      };

      const response = await fetch(normalizedUrl, { headers: fetchHeaders, redirect: 'follow' });
      if (!response.ok) {
        throw new Error(`Failed to fetch article from Zaobao: HTTP ${response.status}. The news site may have blocked the request from the hosting server. You can also paste the article text directly.`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      let paragraphs: string[] = [];
      $('article p, .article-content p, .article_content p').each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 0) paragraphs.push(text);
      });

      if (paragraphs.length === 0) {
        $('p').each((_, el) => {
          const text = $(el).text().trim();
          if (text.length > 0) paragraphs.push(text);
        });
      }

      pageTitle = $('h1').text().trim() || $('title').text().replace(/(- 联合早报|_联合早报)/g, '').trim() || 'Chinese Article';
      rawText = paragraphs.join('\n\n').substring(0, 15000);

      if (!rawText.trim()) {
        return sendJson(res, 400, { 
          error: 'Could not extract article text from this URL. Please verify the URL points to an article or paste the text directly.' 
        });
      }
    }

    // Chunking: 1,800 characters per chunk to maximize speed and minimize roundtrips
    const chunks: string[] = [];
    const extractedParas = rawText.split('\n\n');
    let currentChunk = '';
    for (const p of extractedParas) {
      if (currentChunk.length + p.length > 1800) {
        if (currentChunk.trim()) chunks.push(currentChunk.trim());
        currentChunk = p + '\n\n';
      } else {
        currentChunk += p + '\n\n';
      }
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());

    const candidateModels = process.env.GEMINI_MODEL
      ? [process.env.GEMINI_MODEL, ...DEFAULT_CANDIDATE_MODELS]
      : DEFAULT_CANDIDATE_MODELS;

    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const systemInstruction = `You are an educational linguistic analyzer for Chinese language learners.
Break the provided Chinese text into sentences.
For each sentence, output:
- "np": boolean (true if this sentence begins a new paragraph, false otherwise)
- "e": Accurate, natural English translation
- "w": Array of segmented Chinese words and punctuation marks (e.g. ["外交部", "呼吁", "国人", "暂缓", "前往", "沙特阿拉伯", "。"])

Output valid JSON matching this schema:
{"sentences":[{"np":false,"e":"translation","w":["词语","，","词语","。"]}]}`;

    const allSentences: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const isFirstChunk = (i === 0);
      const textToProcess = isFirstChunk ? `TITLE: ${pageTitle}\n\n${chunkText}` : chunkText;
      let chunkSuccess = false;
      let lastChunkError: any = null;

      for (const model of candidateModels) {
        // Try up to 2 attempts per model (handles transient 503 high demand spikes)
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const resp = await ai.models.generateContent({
              model: model,
              contents: `Analyze this Chinese text into valid JSON:\n\n${textToProcess}`,
              config: {
                systemInstruction: systemInstruction,
                responseMimeType: 'application/json',
                temperature: 0.1,
              },
            });

            const resultText = resp.text;
            if (!resultText) throw new Error("No response received from Gemini model");

            const parsedResponse = repairAndParseJson(resultText);
            let sentences = parsedResponse.sentences || parsedResponse || [];
            if (!Array.isArray(sentences) && typeof sentences === 'object') {
              sentences = [sentences];
            }

            sentences = sentences.map((s: any, idx: number) => {
              const isTitle = isFirstChunk && idx === 0;
              return {
                t: isTitle ? true : (s.t ?? false),
                np: s.np ?? false,
                e: s.e || '',
                w: formatSentenceWords(s.w),
              };
            });

            allSentences.push(...sentences);
            chunkSuccess = true;
            break;
          } catch (modelErr: any) {
            lastChunkError = modelErr;
            const msg = modelErr.message || '';
            const is503 = msg.includes('503') || msg.includes('high demand') || msg.includes('UNAVAILABLE');
            if (is503 && attempt === 0) {
              await new Promise(r => setTimeout(r, 800));
              continue;
            }
            break;
          }
        }
        if (chunkSuccess) break;
      }

      if (!chunkSuccess) {
        throw lastChunkError || new Error(`Failed to parse chunk ${i} with Gemini.`);
      }
    }

    const resultPayload = { title: pageTitle, sentences: allSentences };

    // Store in cache
    if (targetUrl.startsWith('http')) {
      const normalizedUrl = targetUrl.split('#')[0];
      if (ARTICLE_CACHE.size > 100) {
        const oldestKey = ARTICLE_CACHE.keys().next().value;
        if (oldestKey) ARTICLE_CACHE.delete(oldestKey);
      }
      ARTICLE_CACHE.set(normalizedUrl, { data: resultPayload, timestamp: Date.now() });
    }

    return sendJson(res, 200, resultPayload);

  } catch (error: any) {
    console.error('Extraction Error:', error);
    let errorMessage = error.message || 'Failed to process the article.';
    try {
      const parsedError = JSON.parse(errorMessage);
      if (parsedError?.error?.message) {
        errorMessage = parsedError.error.message;
      }
    } catch (e) {}
    return sendJson(res, 500, { error: errorMessage });
  }
}
