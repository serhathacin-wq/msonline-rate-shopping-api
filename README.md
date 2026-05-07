# Msonline Kontrol — Rate Shopping API

`api.msonlinegroup.com` üzerinde çalışan Vercel serverless fonksiyon. 12 OTA'dan anlık fiyat çeker, sonuçları `msonlinegroup.com/hizmetler/msonline-kontrol` formuna döndürür.

## 🎯 Mimari

```
Browser → msonlinegroup.com (form)
            ↓ AJAX
         api.msonlinegroup.com/api/rate-shopping (Vercel)
            ↓ paralel HTTP fetch (her oda için 12 OTA aynı anda)
         12 OTA scraper modülü (api/lib/otas/*.js)
            ↓
         Sonuçlar tabloya
```

- ✅ Veri saklanmaz, cache yok
- ✅ Tüm istekler 10 saniye içinde tamamlanır (Vercel Hobby limit)
- ✅ Bir OTA'dan veri gelmezse o hücre demo verisiyle dolar
- ✅ Response'da `liveRatio` ile kaç hücrenin canlı olduğu görünür

## 🚀 Kurulum (15 dakika)

### 1) GitHub'a yükleyin

1. https://github.com/new — yeni repo: **`msonline-rate-shopping-api`** (Public veya Private fark etmez)
2. "Initialize repository with README" işaretlemeyin, boş bırakın
3. Repo oluştuktan sonra **"uploading an existing file"** linkine tıklayın
4. Bu klasördeki tüm dosyaları (`api/`, `package.json`, `vercel.json`, `README.md`) sürükle-bırak yapın
5. Aşağıda commit mesajı: "İlk yükleme" → **Commit changes**

### 2) Vercel'e bağlayın

1. https://vercel.com/new
2. **"Import Git Repository"** → GitHub'ı bağlayın (ilk kez yapıyorsanız "Install Vercel" butonu çıkar, izin verin)
3. `msonline-rate-shopping-api` reposunu seçin → **"Import"**
4. **Framework Preset:** Other olarak bırakın
5. **Deploy** — 30 saniye içinde biter
6. Size şuna benzer bir URL verir: `msonline-rate-shopping-api.vercel.app`

### 3) İlk testi yapın

```bash
curl -X POST https://msonline-rate-shopping-api.vercel.app/api/rate-shopping \
  -H "Content-Type: application/json" \
  -d '{
    "ownHotel": "May Thermal Pamukkale",
    "city": "Pamukkale",
    "competitors": ["Doga Thermal Hotel"],
    "checkIn": "2026-06-15",
    "checkOut": "2026-06-16",
    "currency": "TRY",
    "adults": 2
  }'
```

Cevap içinde `"source": "live" | "mixed" | "demo"` ve `"liveRatio": 0-100` görmelisiniz. **liveRatio %0 ise hiçbir scraper başarılı olmamış demektir** — proxy entegrasyonu için README'nin sonuna bakın.

### 4) Custom domain bağlayın

Vercel projesinde:
1. **Settings → Domains**
2. **`api.msonlinegroup.com`** ekleyin
3. Vercel size DNS bilgisi verir (CNAME)
4. isimtescil DNS panelinde:
   - Tür: **CNAME**
   - Host: **api**
   - Hedef: `cname.vercel-dns.com`
5. 5-30 dakika içinde aktif olur

### 5) Frontend'i bağlayın

`frontend/.env`'ye ekleyin:
```
REACT_APP_RATE_API_URL=https://api.msonlinegroup.com/api/rate-shopping
```

Yeniden build alıp `public_html`'e yükleyin.

> 💡 Custom domain bağlamasanız da varsayılan Vercel URL ile çalışır. CORS başlıkları `msonlinegroup.com`'a izin veriyor.

---

## 🔧 Hangi OTA hangi yöntemle çekiyor?

| OTA | Yöntem | Beklenen başarı |
|---|---|---|
| Booking.com | HTML fetch + regex | %50-70 (Cloudflare) |
| Expedia | HTML fetch + regex | %30-50 (PerimeterX) |
| Agoda | HTML + JSON regex | %60-80 |
| Hotels.com | HTML fetch + regex | %30-50 (PerimeterX) |
| HelalBooking | HTML fetch | %80-95 |
| Trip.com | HTML + JSON | %60-80 |
| Jollytur | HTML fetch | %50-70 (Cloudflare) |
| Etstur | HTML + JSON | %50-70 |
| Tatilbudur | HTML fetch | %50-70 |
| Tatilsepeti | HTML fetch | %60-80 |
| Otelfiyat | HTML fetch | %70-85 |
| Enuygun | HTML fetch | %30-50 (DataDome) |

> 50 sorgu/gün ölçeğinde rate-limit'e takılma riski düşük.

## 🛠️ Bir OTA bozulursa nasıl düzeltilir?

Her scraper kendi dosyasında izole: `api/lib/otas/<ota>.js`. Düzeltme akışı:

1. Vercel dashboard'dan log'a bakın → hangi OTA null dönüyor?
2. O OTA'nın search URL'ini tarayıcıda açın
3. Sayfanın HTML'ini inceleyin, fiyatın hangi pattern'da olduğunu bulun
4. İlgili `<ota>.js` dosyasındaki regex'i güncelleyin
5. GitHub'a push edin → Vercel otomatik yeni deploy yapar

## 📈 Daha yüksek başarı için (opsiyonel — sonra)

Eğer canlı oran %50'nin altında kalırsa:

### A) ScraperAPI ekle (ücretsiz aylık 1000 sorgu)
1. https://www.scraperapi.com/ — kayıt olun
2. API key alın
3. Vercel **Environment Variables**'a `SCRAPER_API_KEY` ekleyin
4. `api/lib/otas/_common.js` içinde fetch'i ScraperAPI proxy'sine yönlendirin:
   ```js
   const proxyUrl = process.env.SCRAPER_API_KEY
       ? `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`
       : url;
   ```

### B) Headless Chromium (Vercel Pro gerekir, $20/ay)
- `@sparticuz/chromium-min` + `playwright-core` ekleyin
- Bot koruması olan siteler için JavaScript render

---

## 📋 Endpoint sözleşmesi

### POST `/api/rate-shopping`

Request:
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

Response:
```json
{
    "source": "live|mixed|demo",
    "liveRatio": 67,
    "ts": "2026-05-07T15:00:00.000Z",
    "results": [
        {
            "name": "May Thermal Pamukkale",
            "isOwn": true,
            "prices": {
                "jolly": 4500, "ets": 4380, "tatilbudur": 4520,
                "tatilsepeti": 4600, "otelfiyat": 4350, "enuygun": null,
                "booking": 4700, "expedia": null, "agoda": 4650,
                "helalbooking": 4720, "trip": 4690, "hotels": null
            },
            "available": 9
        }
    ]
}
```

---

© 2026 Msonline Turizm Yönetim Danışmanlığı Ltd. Şti.
