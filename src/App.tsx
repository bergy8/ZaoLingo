import React, { useState, useRef, useEffect, MouseEvent } from 'react';
import { Loader2, ArrowRight, Sun, Moon, ZoomIn, ZoomOut, Type } from 'lucide-react';

type Word = { z: string; p: string };
type Sentence = {
  t?: boolean;
  np: boolean;
  e: string;
  w: Word[];
};
type ArticleData = {
  title: string;
  sentences: Sentence[];
};

const DEFAULT_RECENT_ARTICLES = [
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

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [error, setError] = useState('');
  
  const [darkMode, setDarkMode] = useState(true);
  const [fontSizeScale, setFontSizeScale] = useState(0.6);
  const [showPinyin, setShowPinyin] = useState(true);

  const [recentArticles, setRecentArticles] = useState<{title: string, href: string}[]>(DEFAULT_RECENT_ARTICLES);
  const [loadingRecent, setLoadingRecent] = useState(false);

  useEffect(() => {
    async function fetchRecent() {
      setLoadingRecent(true);
      try {
        const res = await fetch('/api/latest-articles');
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setRecentArticles(data);
            return;
          }
        }
      } catch (err) {
        console.warn("Failed to load recent articles", err);
      } finally {
        setLoadingRecent(false);
      }
      // Guarantee fallback articles are always available
      setRecentArticles((prev) => (prev.length > 0 ? prev : DEFAULT_RECENT_ARTICLES));
    }
    fetchRecent();
  }, []);

  const [loadingStep, setLoadingStep] = useState('Fetching article...');

  const handleExtract = async (e: React.FormEvent | string) => {
    if (typeof e !== 'string') {
      e.preventDefault();
    }
    
    const targetUrl = typeof e === 'string' ? e : url;
    if (!targetUrl || !targetUrl.trim()) return;
    
    setUrl(targetUrl);
    setError('');

    // Check client-side session cache for instant load
    const normalized = targetUrl.trim().split('#')[0];
    try {
      const cached = sessionStorage.getItem(`zaobao_art_${normalized}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.sentences?.length) {
          setArticle(parsed);
          return;
        }
      }
    } catch (e) {}

    setLoading(true);
    setLoadingStep('Fetching article...');

    const stepTimer1 = setTimeout(() => {
      setLoadingStep('Segmenting Chinese words & translating...');
    }, 1200);
    const stepTimer2 = setTimeout(() => {
      setLoadingStep('Generating tone-marked Pinyin & formatting...');
    }, 4000);

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl.trim() }),
      });

      const responseText = await res.text();
      let data: any;

      try {
        data = JSON.parse(responseText);
      } catch {
        if (res.status === 404) {
          throw new Error("API route '/api/extract' was not found (404). If deploying on Vercel, ensure the Serverless Function at api/extract.ts is deployed.");
        } else if (res.status === 504) {
          throw new Error("Request timed out (504). Please try a shorter article or paste the text directly.");
        } else {
          throw new Error(`Server returned status ${res.status}: ${responseText.slice(0, 160)}`);
        }
      }

      if (!res.ok) {
        throw new Error(data.error || `Error ${res.status}: Failed to extract article.`);
      }

      // Save to client session cache for instantaneous retrieval
      try {
        sessionStorage.setItem(`zaobao_art_${normalized}`, JSON.stringify(data));
      } catch (e) {}

      setArticle(data);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      setLoading(false);
    }
  };

  if (article) {
    return (
      <ArticleCanvas 
        article={article} 
        onReset={() => setArticle(null)}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        fontSizeScale={fontSizeScale}
        setFontSizeScale={setFontSizeScale}
        showPinyin={showPinyin}
        setShowPinyin={setShowPinyin}
      />
    );
  }

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 transition-colors ${darkMode ? 'bg-gradient-to-br from-gray-900 to-gray-800' : 'bg-gradient-to-br from-indigo-50 to-purple-50'}`} style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
      <button 
        onClick={() => setDarkMode(!darkMode)}
        className={`absolute top-6 right-6 p-2 rounded-full ${darkMode ? 'bg-gray-800 text-yellow-400 shadow-lg' : 'bg-white shadow-md text-purple-400 hover:text-purple-600'}`}
      >
        {darkMode ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <div className={`${darkMode ? 'bg-gray-800 border-gray-700 shadow-xl shadow-black/40' : 'bg-white/90 backdrop-blur-md border border-white/50 shadow-xl shadow-purple-900/5'} p-8 rounded-2xl max-w-lg w-full transition-colors`}>
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-indigo-800 rounded flex items-center justify-center text-white font-bold shadow-sm">早</div>
          <h1 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>Lingo</h1>
        </div>
        <p className={`${darkMode ? 'text-gray-400' : 'text-gray-500'} mb-8 text-center text-sm`}>
          Extract articles to read with Pinyin and translations.
        </p>

        <form onSubmit={handleExtract} className="space-y-4">
          <div>
            <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`} htmlFor="url">
              Article URL or Chinese Text
            </label>
            <div className={`flex items-center rounded-lg px-3 py-2 border transition-all ${darkMode ? 'bg-gray-900 border-gray-600 focus-within:ring-purple-500' : 'bg-gray-100 border-gray-200 focus-within:ring-purple-500'} focus-within:ring-2`}>
              <input
                id="url"
                type="text"
                placeholder="Paste Zaobao link or Chinese text here"
                className={`w-full bg-transparent outline-none text-sm ${darkMode ? 'text-white placeholder-gray-500' : 'text-gray-800'}`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
          </div>

          {error && (
            <div className={`text-sm p-3 rounded-lg border leading-relaxed ${
              darkMode 
                ? 'bg-rose-950/40 border-rose-800/80 text-rose-300' 
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-purple-600 to-indigo-700 text-white rounded-lg px-4 py-3 font-medium hover:from-purple-700 hover:to-indigo-800 transition-all flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed group shadow-sm"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                <span>{loadingStep}</span>
              </>
            ) : (
              <>
                Render Article
                <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
          {loading && (
            <p className={`text-xs text-center animate-pulse ${darkMode ? 'text-purple-300' : 'text-purple-700'}`}>
              ⚡ Accelerated with cached linguistic analysis & instant phonetics
            </p>
          )}
        </form>

        <div className="mt-10">
          <h3 className={`text-sm font-semibold mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            Or choose a recent Singapore news article:
          </h3>
          {loadingRecent ? (
            <div className={`flex items-center justify-center py-4 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`}>
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : recentArticles.length > 0 ? (
            <ul className="space-y-2">
              {recentArticles.map((art, i) => (
                <li key={i}>
                  <button
                    onClick={() => handleExtract(art.href)}
                    className={`w-full text-left text-sm py-2 px-3 rounded-lg border transition-colors ${
                      darkMode 
                        ? 'border-gray-700 bg-gray-800/50 hover:bg-gray-700 hover:border-purple-500/50 text-gray-200' 
                        : 'border-gray-200 bg-gray-50 hover:bg-purple-50 hover:border-purple-200 text-gray-800'
                    }`}
                  >
                    {art.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>No recent articles found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ------ Canvas Architecture ------

interface WordBounds {
  z: string;
  p: string;
  x: number;
  y: number;
  zhWidth: number;
  pyWidth: number;
  cellWidth: number;
}

interface SentenceLayout {
  e: string;
  isTitle: boolean;
  words: WordBounds[];
  segments: { x: number; y: number; w: number; h: number }[];
}

function ArticleCanvas({ 
  article, 
  onReset,
  darkMode,
  setDarkMode,
  fontSizeScale,
  setFontSizeScale,
  showPinyin,
  setShowPinyin
}: { 
  article: ArticleData; 
  onReset: () => void;
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
  fontSizeScale: number;
  setFontSizeScale: (v: number | ((prev: number) => number)) => void;
  showPinyin: boolean;
  setShowPinyin: (v: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [layout, setLayout] = useState<{ layouts: SentenceLayout[]; height: number } | null>(null);
  const [activeTranslation, setActiveTranslation] = useState<string>('');

  // 1. Compute Layout
  useEffect(() => {
    const computeLayout = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const maxW = container.clientWidth;
      const paddingLeft = 24 - (fontSizeScale - 1) * 8; // Adjust padding slightly on scale
      const paddingRight = 24;
      const innerW = maxW - paddingLeft - paddingRight;

      const zhFontSize = Math.floor(32 * fontSizeScale);
      const pyFontSize = Math.floor(18 * fontSizeScale);
      const lineGap = Math.floor(40 * fontSizeScale);

      // Start y lower to prevent Hanyu Pinyin cut off at the top
      let cursorY = Math.floor(70 * fontSizeScale); 
      const layouts: SentenceLayout[] = [];

      let cursorX = paddingLeft;

      for (let s of article.sentences) {
        const isTitle = !!s.t;
        const currentZhSize = isTitle ? Math.floor(38 * fontSizeScale) : zhFontSize;
        const currentPySize = isTitle ? Math.floor(18 * fontSizeScale) : pyFontSize;
        const currentLineGap = isTitle ? Math.floor(48 * fontSizeScale) : lineGap;

        if (s.np && layouts.length > 0) {
          cursorX = paddingLeft;
          cursorY += (zhFontSize + pyFontSize + lineGap) * 0.8; // Paragraph spacing
        }

        const wordBounds: WordBounds[] = [];
        let lineStartIndex = 0;
        const wordsList = s.w || [];        for (let i = 0; i < wordsList.length; i++) {
          const word = wordsList[i];
          ctx.font = `${currentPySize}px 'Helvetica Neue', Arial, sans-serif`;
          const pyText = word?.p || '';
          const pyW = ctx.measureText(pyText).width;
          ctx.font = `${currentZhSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
          const zhText = word?.z || '';
          const zhW = ctx.measureText(zhText).width;
          const cellPadding = isTitle ? (2 * fontSizeScale) : (12 * fontSizeScale);
          const cellW = Math.max(pyW, zhW) + cellPadding; 

          if (cursorX + cellW > innerW && cursorX > paddingLeft) {
            cursorX = paddingLeft;
            cursorY += currentZhSize + currentPySize + currentLineGap;
            lineStartIndex = wordBounds.length;
          }

          wordBounds.push({
            z: zhText,
            p: pyText,
            x: cursorX,
            y: cursorY,
            zhWidth: zhW,
            pyWidth: pyW,
            cellWidth: cellW
          });

          cursorX += cellW;
        }

        if (isTitle && wordBounds.length > lineStartIndex) {
          cursorX = paddingLeft;
          cursorY += currentZhSize + currentPySize + currentLineGap;
        }

        const segments: { x: number; y: number; w: number; h: number }[] = [];
        if (wordBounds.length > 0) {
          const byY = new Map<number, WordBounds[]>();
          for(let wb of wordBounds) {
            if(!byY.has(wb.y)) byY.set(wb.y, []);
            byY.get(wb.y)!.push(wb);
          }
          byY.forEach((wbs, y) => {
            const minX = wbs[0].x;
            const maxX = wbs[wbs.length - 1].x + wbs[wbs.length - 1].cellWidth;
            segments.push({
               x: minX - 4,
               y: y - currentZhSize - currentPySize - 6,
               w: maxX - minX + 8,
               h: currentZhSize + currentPySize + 18
            });
          });
        }

        layouts.push({
          e: s.e,
          isTitle: isTitle,
          words: wordBounds,
          segments
        });
      }

      setLayout({ layouts, height: cursorY + 100 });
    };

    computeLayout();
    window.addEventListener('resize', computeLayout);
    return () => window.removeEventListener('resize', computeLayout);
  }, [article, fontSizeScale]);

  // 2. Render Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const maxW = containerRef.current?.clientWidth || window.innerWidth;
    const height = layout.height;

    canvas.width = maxW * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${maxW}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);

    // Initial Fill
    ctx.fillStyle = darkMode ? '#1F2937' : '#FFFFFF';
    ctx.fillRect(0, 0, maxW, height);

    const zhFontSize = Math.floor(32 * fontSizeScale);
    const pyFontSize = Math.floor(18 * fontSizeScale);

    let hoveredLayout: SentenceLayout | null = null;

    layout.layouts.forEach((s) => {
      let isHovered = false;
      if (mousePos) {
        // Check collision against any of the sentence's line segments
        isHovered = s.segments.some(seg => 
          mousePos.x >= seg.x && mousePos.x <= seg.x + seg.w &&
          mousePos.y >= seg.y && mousePos.y <= seg.y + seg.h
        );
      }

      if (isHovered) {
        hoveredLayout = s;
        ctx.fillStyle = darkMode ? '#374151' : '#F3F4F6';
        ctx.beginPath();
        s.segments.forEach(seg => {
           ctx.roundRect(seg.x, seg.y, seg.w, seg.h, 8);
        });
        ctx.fill();
      }

      for (let w of s.words) {
        const pyOffset = (w.cellWidth - w.pyWidth) / 2;
        const zhOffset = (w.cellWidth - w.zhWidth) / 2;

        const currentZhSize = s.isTitle ? Math.floor(38 * fontSizeScale) : zhFontSize;
        const currentPySize = s.isTitle ? Math.floor(18 * fontSizeScale) : pyFontSize;

        if (showPinyin) {
          ctx.font = `${currentPySize}px 'Helvetica Neue', Arial, sans-serif`;
          ctx.fillStyle = darkMode ? '#D8B4FE' : '#7E22CE'; // Purple for pinyin
          ctx.fillText(w.p || '', w.x + pyOffset, w.y - currentZhSize - 8);
        }

        ctx.font = `${currentZhSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = isHovered 
            ? (darkMode ? '#FFFFFF' : '#111827')
            : (darkMode ? '#E5E7EB' : '#1F2937');
        ctx.fillText(w.z || '', w.x + zhOffset, w.y);
      }
    });

    if (hoveredLayout) {
      setActiveTranslation(hoveredLayout.e);
    }

  }, [layout, mousePos, darkMode, fontSizeScale, showPinyin]);

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    setMousePos({
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  };

  return (
    <div className={`w-full h-screen flex flex-col overflow-hidden transition-colors ${darkMode ? 'bg-gray-900' : 'bg-[#F8F9FA]'}`} style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
      {/* Top Bar */}
      <div className={`flex-none px-4 md:px-6 py-3 flex flex-nowrap gap-3 justify-between items-center border-b shrink-0 transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-indigo-800 rounded flex items-center justify-center text-white font-bold">早</div>
          <span className={`text-xl font-bold hidden sm:inline ${darkMode ? 'text-white' : 'text-gray-800'}`}>Lingo</span>
        </div>
        
        <div className="flex items-center gap-2 md:gap-4 flex-nowrap">
          <div className={`flex items-center gap-1 bg-transparent rounded-lg border ${darkMode ? 'border-gray-600' : 'border-gray-200'} p-1`}>
            <button 
              onClick={() => setFontSizeScale(s => Math.max(s - 0.1, 0.5))}
              className={`p-1 lg:p-1.5 rounded hover:bg-gray-500/20 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}
              title="Decrease Font Size"
            >
              <ZoomOut size={16} />
            </button>
            <span className={`text-xs font-medium w-6 lg:w-8 text-center ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              {Math.round(fontSizeScale * 100)}%
            </span>
            <button 
              onClick={() => setFontSizeScale(s => Math.min(s + 0.1, 1.5))}
              className={`p-1 lg:p-1.5 rounded hover:bg-gray-500/20 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}
              title="Increase Font Size"
            >
              <ZoomIn size={16} />
            </button>
          </div>

          <button 
            onClick={() => setDarkMode(!darkMode)}
            className={`p-2 rounded hover:bg-gray-500/20 ${darkMode ? 'text-yellow-400' : 'text-gray-600'}`}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <button 
            onClick={onReset}
            className={`text-sm font-medium border px-3 py-1.5 md:px-4 md:py-2 rounded-md transition-colors ${darkMode ? 'bg-gray-700 border-gray-600 text-purple-400 hover:bg-gray-600' : 'bg-white border-gray-200 text-purple-700 hover:bg-gray-50'}`}
          >
            New
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className={`flex-1 w-full overflow-hidden relative flex justify-center items-start p-6 ${darkMode ? 'bg-gray-900' : 'bg-[#FDFDFD]'}`}>
        <div 
          ref={containerRef} 
          className={`w-full h-full max-w-4xl shadow-xl overflow-x-hidden overflow-y-auto rounded-md relative transition-colors ${darkMode ? 'bg-gray-800 border-gray-700 shadow-black/30' : 'bg-white border-[#E5E7EB] shadow-black/5'}`}
        >
          <canvas
            ref={canvasRef}
            onMouseMove={handlePointerMove}
            onTouchStart={handlePointerMove}
            onTouchMove={handlePointerMove}
            className="block touch-pan-y cursor-crosshair"
          />
        </div>
      </div>

      {/* Persistent Translation Box at Bottom */}
      <div className={`flex-none h-48 md:h-56 border-t flex flex-col p-6 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] transition-colors z-10 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="flex justify-between items-center mb-2">
          <h3 className={`text-xs uppercase font-bold tracking-wider ${darkMode ? 'text-purple-400' : 'text-purple-700'}`}>English Translation</h3>
          <button 
            onClick={() => setShowPinyin(!showPinyin)}
            className={`p-2 w-8 h-8 rounded-lg flex items-center justify-center transition-all ${!showPinyin ? (darkMode ? 'bg-gray-700 text-gray-400 hover:bg-gray-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200') : 'bg-purple-600 text-white hover:bg-purple-700'}`}
            title="Toggle Pinyin"
          >
            <span className="text-sm font-bold font-sans">拼</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {activeTranslation ? (
            <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-200' : 'text-gray-800'} transition-opacity duration-200`}>
              {activeTranslation}
            </p>
          ) : (
            <p className={`text-sm italic ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              Hover over or tap a sentence above to view its English translation.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
