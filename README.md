# Msonline Kontrol — Vercel API

`api.msonlinegroup.com` üzerinde çalışan serverless fonksiyon. `msonlinegroup.com` üzerindeki Msonline Kontrol formundan gelen istekleri karşılar.

## Kurulum (10 dakika)

### 1) GitHub'a yükleyin

1. GitHub'da yeni repository açın: **`msonline-rate-shopping-api`** (Public veya Private fark etmez)
2. "Don't initialize" — README/license eklemeden boş bırakın
3. Repo oluşunca **"uploading an existing file"** linkine tıklayın
4. Bu klasördeki tüm dosyaları (`api/`, `package.json`, `vercel.json`, `README.md`) sürükle-bırak yükleyin
5. **Commit changes** butonuna basın

### 2) Vercel'e bağlayın

1. https://vercel.com/new adresine gidin
2. **"Import Git Repository"** bölümünden GitHub'ı bağlayın (ilk kez yapıyorsanız "Install" butonu çıkar)
3. Yeni oluşturduğunuz `msonline-rate-shopping-api` reposunu seçin → **"Import"**
4. Framework Preset: **Other** olarak bırakın
5. **Deploy** butonuna basın
6. ~30 saniye içinde deploy biter, size bir URL verir (ör: `msonline-rate-shopping-api.vercel.app`)

### 3) Test edin

Tarayıcıdan veya curl ile:

```bash
curl -X POST https://msonline-rate-shopping-api.vercel.app/api/rate-shopping \
  -H "Content-Type: application/json" \
  -d '{
    "ownHotel": "May Thermal Pamukkale",
    "competitors": ["Doga Thermal", "Hierapark Thermal"],
    "checkIn": "2026-06-15",
    "checkOut": "2026-06-16",
    "currency": "TRY"
  }'
```

JSON sonuç dönmesi gerekiyor.

### 4) Custom domain bağlayın (opsiyonel ama önerilir)

Vercel projesinde:
1. **Settings → Domains**
2. **`api.msonlinegroup.com`** ekleyin
3. Vercel size DNS kaydı verir (genelde `cname.vercel-dns.com`)
4. isimtescil DNS panelinde:
   - Tür: **CNAME**
   - Host: **api**
   - Hedef: `cname.vercel-dns.com`
5. 5-30 dakika içinde aktif olur

### 5) Site frontend'ini güncelleyin

Custom domain bağladıktan sonra, frontend `.env` dosyasına ekleyin:

```
REACT_APP_RATE_API_URL=https://api.msonlinegroup.com/api/rate-shopping
```

Yeniden build alıp `public_html`'e yükleyin.

> Custom domain bağlamasanız da varsayılan Vercel URL ile çalışır — frontend, aynı origin'de değilse fetch isteği CORS başlıkları sayesinde geçer (kod `msonlinegroup.com`'a izin veriyor).

---

## Geliştirme — Gerçek scraping eklemek

Şu an `api/rate-shopping.js` içindeki `fetchLivePrices()` fonksiyonu `null` dönüp demo veriye düşüyor. Gerçek fiyat çekmek için 3 yol var:

### A) Booking Affiliate Partner API (ücretsiz, resmi)
- https://partner.booking.com/en-us/help/affiliate-partner-help-center
- Onaylanması gerekir, başvuru süreci 1-2 hafta
- Onaylanırsa JSON API ile fiyat çekersiniz, captcha yok

### B) Headless Chromium (orta zorluk, ücretsiz)
```bash
yarn add @sparticuz/chromium puppeteer-core
```

`fetchLivePrices` içinde:
```js
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

async function fetchLivePrices({ ownHotel, competitors, checkIn, checkOut }) {
    const browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });
    // ... her otel için Booking arama URL'ine git, fiyatı DOM'dan oku
}
```
- Vercel free tier 10s timeout var, paid plan'de 30s. Captcha riski yüksek.

### C) ScraperAPI / Bright Data (ücretli, en güvenilir)
- https://www.scraperapi.com/ ($30/ay başlangıç)
- Residential proxy, captcha solver dahil
- Booking URL'ini ScraperAPI'ye proxy'lersiniz, içeriği döner

---

## Endpoint sözleşmesi

**POST** `/api/rate-shopping`

Body:
```json
{
    "ownHotel": "string",
    "city": "string",
    "competitors": ["string", ...],
    "checkIn": "YYYY-MM-DD",
    "checkOut": "YYYY-MM-DD",
    "currency": "TRY|EUR|USD",
    "adults": 2
}
```

Response (200):
```json
{
    "source": "live | demo",
    "ts": "2026-05-07T10:00:00.000Z",
    "results": [
        {
            "name": "May Thermal Pamukkale",
            "isOwn": true,
            "prices": {
                "booking": 4500,
                "expedia": 4620,
                "agoda": 4410,
                "hotels":  null
            },
            "available": 3
        }
    ]
}
```

---

## Lisans

MIT — Msonline Turizm Yönetim Danışmanlığı Ltd. Şti.
