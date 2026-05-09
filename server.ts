import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import * as cheerio from 'cheerio';
import OpenAI from 'openai';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API endpoints FIRST
  app.post('/api/extract', async (req, res) => {
    try {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'GROQ_API_KEY environment variable is not configured. Please add it to your Settings or .env file.' });
      }

      const groq = new OpenAI({
        apiKey: apiKey,
        baseURL: "https://api.groq.com/openai/v1",
      });

      const { url } = req.body;
      if (!url || !url.includes('zaobao.com.sg')) {
        return res.status(400).json({ error: 'Please enter a valid Zaobao URL.' });
      }

      // 1. Fetch raw HTML from Zaobao
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };
      
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Failed to fetch article: HTTP ${response.status}`);
      }
      
      const html = await response.text();
      const $ = cheerio.load(html);

      // 2. Extract article text. Zaobao usually puts content in .article-content or similar.
      let paragraphs: string[] = [];
      $('article p, .article-content p, .article_content p').each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 0) paragraphs.push(text);
      });

      // Fallback if no text found in selectors
      if (paragraphs.length === 0) {
        $('p').each((_, el) => {
          const text = $(el).text().trim();
          if (text.length > 0) paragraphs.push(text);
        });
      }

      const pageTitle = $('h1').text().trim() || $('title').text().replace(/(- 联合早报|_联合早报)/g, '').trim() || 'Chinese Article';

      // We'll process the full text, but chunk it out to keep each prompt fast and manageable
      const rawText = paragraphs.join('\n\n').substring(0, 15000);

      if (!rawText.trim()) {
        return res.status(400).json({ error: 'Could not extract any text from this URL.' });
      }

      // Chunking by paragraphs. Approx 350 characters per chunk to prevent LLM from getting lazy, skipping text, and hitting token limits.
      const chunks: string[] = [];
      const extractedParas = rawText.split('\n\n');
      let currentChunk = '';
      for (const p of extractedParas) {
        if (currentChunk.length + p.length > 350) {
          if (currentChunk.trim()) chunks.push(currentChunk.trim());
          currentChunk = p + '\n\n';
        } else {
          currentChunk += p + '\n\n';
        }
      }
      if (currentChunk.trim()) chunks.push(currentChunk.trim());

      // 3. Process with Groq in batches to prevent rate limits
      const parseTasks = chunks.map((chunkText, i) => async () => {
        const textToProcess = i === 0 ? `TITLE: ${pageTitle}\n\n${chunkText}` : chunkText;

        const completion = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: `You are an expert Chinese language API. Output ONLY perfectly formatted JSON.

{
  "sentences": [
    {
      "t": false, // boolean. True ONLY if this sentence is the main article title.
      "np": false, // boolean. True ONLY if this sentence starts a new paragraph.
      "e": "Smooth English translation",
      "w": [
        ["中", "zhōng"],
        ["文", "wén"],
        ["，", ""] // IMPORTANT: Leave pinyin EMPTY string "" for ANY punctuation!
      ]
    }
  ]
}

Instructions:
1. Break text into logical sentences. Include ALL punctuation marks (。，！？、” etc) as separate items in 'w'.
2. For EACH sentence, provide translation 'e'.
3. Break the sentence into words/characters in the 'w' array using the simple array format: ["text", "pinyin"].
4. Provide correct Hanyu Pinyin with tone marks. Pinyin for punctuations is "".
5. CRITICAL: Do NOT omit any text. You must process the ENTIRE text provided verbatim. DO NOT summarize.`
            },
            {
              role: "user",
              content: `Analyze this Chinese text COMPLETELY without skipping a single word or punctuation:\n\n${textToProcess}`
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.0,
        });

        const resultText = completion.choices[0]?.message?.content;
        if (!resultText) throw new Error("No response from Groq API");

        let parsedResponse;
        try {
          parsedResponse = JSON.parse(resultText);
        } catch (e) {
          console.error("Groq JSON parse error:", resultText);
          throw new Error("Groq API returned invalid JSON.");
        }
        
        let sentences = parsedResponse.sentences || parsedResponse || [];
        
        // Map the efficient array format back to the object format expected by the frontend
        sentences = sentences.map((s: any) => {
          if (Array.isArray(s.w)) {
            s.w = s.w.map((item: any) => {
              if (Array.isArray(item)) {
                return { z: item[0] || "", p: item[1] || "" };
              }
              return item;
            });
          }
          return s;
        });

        return sentences;
      });

      const chunkResults = [];
      const concurrencyLimit = 3;
      for (let i = 0; i < parseTasks.length; i += concurrencyLimit) {
        const batch = parseTasks.slice(i, i + concurrencyLimit);
        const batchResults = await Promise.all(batch.map(fn => fn()));
        chunkResults.push(...batchResults);
      }
      
      const allSentences = chunkResults.flat();

      res.json({ title: pageTitle, sentences: allSentences });

    } catch (error: any) {
      console.error('Extraction Error:', error);
      let errorMessage = error.message || 'Failed to process the article.';
      try {
        const parsedError = JSON.parse(errorMessage);
        if (parsedError[0]?.error?.message) {
          errorMessage = parsedError[0].error.message;
        } else if (parsedError.error?.message) {
          errorMessage = parsedError.error.message;
        }
      } catch(e) {}
      res.status(500).json({ error: errorMessage });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serving static files in production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
