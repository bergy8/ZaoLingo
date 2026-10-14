import 'dotenv/config';
import * as cheerio from 'cheerio';

const FALLBACK_ARTICLES = [
  {
    title: "外交部更新旅游警示 建议公民暂缓前往沙特",
    href: "https://www.zaobao.com.sg/news/singapore/story20261013-9831691",
  },
  {
    title: "颜金勇：全球经济深刻变化 新中更须保持开放与连通",
    href: "https://www.zaobao.com.sg/news/singapore/story20261013-9831431",
  },
  {
    title: "一盘杂菜饭钠也超标？营养专家支招如何吃出健康",
    href: "https://www.zaobao.com.sg/news/singapore/story20261013-9819963",
  },
  {
    title: "酱料制造业者准备就绪 低钠酱料选择日益多元",
    href: "https://www.zaobao.com.sg/news/singapore/story20261013-9819701",
  },
  {
    title: "安全督工虽有培训但紧急时刻“不敢救人” 严重创伤病例居高不下",
    href: "https://www.zaobao.com.sg/news/singapore/story20261013-9830646",
  },
];

function sendJson(res: any, status: number, data: any) {
  if (res.headersSent) return;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export default async function handler(req: any, res: any) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (typeof res.status === 'function' && typeof res.end === 'function') {
      return res.status(200).end();
    }
    res.statusCode = 200;
    return res.end();
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout for fast fallback

    const response = await fetch('https://www.zaobao.com.sg/news/singapore', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      console.warn(`Zaobao fetch returned HTTP ${response.status}, using fallback articles`);
      return sendJson(res, 200, FALLBACK_ARTICLES);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const articles: { title: string; href: string }[] = [];
    const seen = new Set<string>();

    $('a').each((_, el) => {
      let href = $(el).attr('href');
      let title = $(el).text().trim();

      if (href && href.includes('/story') && title.length > 5) {
        if (!href.startsWith('http')) {
          href = `https://www.zaobao.com.sg${href}`;
        }
        if (!seen.has(href)) {
          seen.add(href);
          articles.push({ title, href });
        }
      }
    });

    if (articles.length === 0) {
      return sendJson(res, 200, FALLBACK_ARTICLES);
    }

    return sendJson(res, 200, articles.slice(0, 5));
  } catch (error: any) {
    console.warn('Latest articles fetch error, using fallback articles:', error?.message);
    return sendJson(res, 200, FALLBACK_ARTICLES);
  }
}
