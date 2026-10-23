// Vuno Connect - Yapay zeka & çeviri servisleri (Gemini AI, Google Translate, MyMemory)
const { ipcMain, safeStorage } = require('electron');
const crypto = require('crypto');

module.exports = function createAiModule(ctx) {
  // Gemini anahtarını çözer: düz metin (eski kayıt) veya safeStorage şifresi (yeni)
  function getAiKey() {
    const s = ctx.settings();
    if (s.aiKey && s.aiKey.trim()) return s.aiKey.trim();
    try {
      if (s.aiKeyEnc && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(s.aiKeyEnc, 'base64'));
      }
    } catch (_) {}
    return '';
  }

  // Gemini API çoklu model çağrıcı (seçilen model + yedekler)
  async function callGemini(apiKey, prompt, chosenModel) {
    if (!apiKey) return null;
    const s = ctx.settings();
    const modelToUse = chosenModel || s.aiModel || 'gemini-3.1-flash-lite';
    const models = [modelToUse, 'gemini-3.1-flash-lite', 'gemini-3.8-flash'].filter((v, i, a) => a.indexOf(v) === i);

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.warn(`[Gemini] ${model} HTTP ${res.status}:`, errText);
          continue;
        }
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) {
          return { text: text.trim(), model };
        }
      } catch (err) {
        console.warn(`[Gemini] ${model} hatası:`, err.message || err);
      }
    }
    return null;
  }

  function setupAiIpc() {
    // Gemini API Anahtarı Test Etme (Doğrudan seçilen modeli test eder)
    ipcMain.handle('gemini:test', async (_e, { apiKey, model }) => {
      if (!apiKey || !apiKey.trim()) return { ok: false, error: 'API anahtarı boş' };
      const key = apiKey.trim();
      const targetModel = model || 'gemini-3.1-flash-lite';

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${key}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Ping' }] }] })
        });
        if (res.ok) {
          return { ok: true, model: targetModel };
        }
        const errJson = await res.json().catch(() => ({}));
        const msg = errJson?.error?.message || `HTTP ${res.status}`;
        return { ok: false, error: msg };
      } catch (e) {
        return { ok: false, error: e.message || 'Bağlantı kurulamadı' };
      }
    });


    // Güvenli ve çoklu kaynaklı Çeviri (Gemini AI + Ücretsiz Google Translate + MyMemory)
    ipcMain.handle('translate:text', async (_e, { text, targetLang = 'tr', sourceLang = 'auto' }) => {
      if (!text || !text.trim()) return { text: '', provider: '', detectedLang: '' };
      const s = ctx.settings();
      const apiKey = getAiKey();
      const engine = s.translationEngine || (apiKey ? 'gemini' : 'google-free');

      const langNames = {
        tr: 'Turkish', pl: 'Polish', en: 'English', de: 'German',
        fr: 'French', es: 'Spanish', it: 'Italian', ru: 'Russian', ar: 'Arabic'
      };
      const targetName = langNames[targetLang] || targetLang;

      // 1. Yol: Gemini seçilmişse ve API anahtarı varsa
      if (apiKey && engine === 'gemini') {
        const prompt = `Translate the following text into ${targetName}. Respond ONLY with the direct translation, nothing else, no markdown, no quotes:\n\n${text}`;
        const geminiRes = await callGemini(apiKey, prompt, s.aiModel);
        if (geminiRes) {
          return { text: geminiRes.text, provider: `Google Gemini AI (${geminiRes.model})`, detectedLang: sourceLang === 'auto' ? '' : sourceLang };
        }
      }

      // 2. Yol: MyMemory seçilmişse
      if (engine === 'mymemory-free') {
        try {
          const mUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang === 'auto' ? 'autodetect' : sourceLang}|${targetLang}`;
          const mRes = await fetch(mUrl);
          const mData = await mRes.json();
          if (mData && mData.responseData && mData.responseData.translatedText) {
            return { text: mData.responseData.translatedText, provider: 'MyMemory (Ücretsiz)', detectedLang: '' };
          }
        } catch (err) {
          console.error('MyMemory error:', err);
        }
      }

      // 3. Yol (Varsayılan Ücretsiz): Google Translate GTX API
      try {
        const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const gRes = await fetch(gUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const gData = await gRes.json();
        if (gData && gData[0]) {
          const trans = gData[0].map((item) => item[0]).filter(Boolean).join('');
          const detected = gData[2] || '';
          if (trans) return { text: trans, provider: 'Google Translate (Ücretsiz)', detectedLang: detected };
        }
      } catch (err) {
        console.error('Google GTX error:', err);
      }

      // Yedek Motor: MyMemory
      try {
        const mUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang === 'auto' ? 'autodetect' : sourceLang}|${targetLang}`;
        const mRes = await fetch(mUrl);
        const mData = await mRes.json();
        if (mData && mData.responseData && mData.responseData.translatedText) {
          return { text: mData.responseData.translatedText, provider: 'MyMemory (Ücretsiz)', detectedLang: '' };
        }
      } catch (_) {}

      return { text: 'Çeviri yapılamadı (Bağlantı hatası)', provider: 'Hata', detectedLang: '' };
    });

    // Gelişmiş Özetleme (Gemini AI + Akıllı Türkçe Çevirili Özetleme)
    ipcMain.handle('summarize:text', async (_e, { text, history = [] }) => {
      const allMsgs = [...history, text].filter(Boolean);
      const fullConversation = allMsgs.join('\n');
      const s = ctx.settings();
      const apiKey = getAiKey();

      if (apiKey) {
        const prompt = `Aşağıdaki mesajları ve konuşma geçmişini analiz et. Kimin ne yazdığını, ana konuyu ve amacını Türkçe olarak 1 veya 2 akıcı, net cümleyle özetle. Yanıt olarak yalnızca Türkçe özeti ver, tırnak işareti koyma:\n\n${fullConversation}`;
        const geminiRes = await callGemini(apiKey, prompt, s.aiModel);
        if (geminiRes) {
          return { summary: geminiRes.text, provider: `Google Gemini AI (${geminiRes.model})` };
        }
      }

      // Gemini yoksa veya hata verdiyse: Tüm konuşmayı Google Translate ile Türkçe'ye çevirip özet sun!
      try {
        const combined = allMsgs.join(' /// ');
        const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(combined)}`;
        const gRes = await fetch(gUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const gData = await gRes.json();
        if (gData && gData[0]) {
          const translatedAll = gData[0].map((item) => item[0]).filter(Boolean).join('');
          const parts = translatedAll.split('///').map((p) => p.trim()).filter(Boolean);
          if (parts.length > 1) {
            const last = parts[parts.length - 1];
            const prev = parts.slice(0, -1).join(' / ');
            return {
              summary: `Son mesaj: "${last}" (Önceki akış: ${prev})`,
              provider: 'Google Translate (Ücretsiz)'
            };
          } else if (parts.length === 1) {
            return { summary: parts[0], provider: 'Google Translate (Ücretsiz)' };
          }
        }
      } catch (e) {
        console.error('Fallback translation summary error:', e);
      }

      if (allMsgs.length > 1) {
        return { summary: `Gelen ${allMsgs.length} mesajlık konuşma: "${text}"`, provider: 'Yerel' };
      }
      return { summary: `Mesaj: "${text}"`, provider: 'Yerel' };
    });
  }

  return { getAiKey, setupAiIpc };
};
