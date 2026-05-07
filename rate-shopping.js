/**
 * Vercel Serverless Function — Msonline Kontrol
 *
 * Endpoint: POST /api/rate-shopping
 *
 * Body:
 * {
 *   ownHotel: string,
 *   city: string,
 *   competitors: string[],
 *   checkIn: "YYYY-MM-DD",
 *   checkOut: "YYYY-MM-DD",
 *   currency: "TRY" | "EUR" | "USD",
 *   adults: number
 * }
 *
 * Response:
 * {
 *   source: "live" | "demo",
 *   ts: ISO,
 *   results: [
 *     { name, isOwn, prices: { booking, expedia, agoda, hotels }, available }
 *   ]
 * }
 *
 * Şu an: Demo veri üretici (gerçekçi simülasyon).
 * Üretim: scraping kodu fetchBookingPrices() içine eklenir.
 */

const OTAS = [
    // İç pazar
    { key: "jolly",        market: "domestic",      bias: 0.97 },
    { key: "ets",          market: "domestic",      bias: 0.96 },
    { key: "tatilbudur",   market: "domestic",      bias: 0.98 },
    { key: "tatilsepeti",  market: "domestic",      bias: 0.99 },
    { key: "otelfiyat",    market: "domestic",      bias: 0.95 },
    { key: "enuygun",      market: "domestic",      bias: 0.97 },
    // Dış pazar
    { key: "booking",      market: "international", bias: 1.00 },
    { key: "expedia",      market: "international", bias: 1.04 },
    { key: "agoda",        market: "international", bias: 0.99 },
    { key: "helalbooking", market: "international", bias: 1.02 },
    { key: "trip",         market: "international", bias: 1.01 },
    { key: "hotels",       market: "international", bias: 1.05 },
];

function seededRandom(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return () => {
        h ^= h << 13;
        h ^= h >>> 17;
        h ^= h << 5;
        return ((h >>> 0) % 100000) / 100000;
    };
}

function generateDemo({ ownHotel, competitors, checkIn, checkOut, currency }) {
    const hotels = [
        { name: ownHotel, isOwn: true },
        ...competitors.map((n) => ({ name: n, isOwn: false })),
    ];

    const isWeekend = (() => {
        const d = new Date(checkIn).getDay();
        return d === 5 || d === 6 || d === 0;
    })();
    const seasonBoost = (() => {
        const m = new Date(checkIn).getMonth() + 1;
        if ([6, 7, 8].includes(m)) return 1.6;
        if ([4, 5, 9, 10].includes(m)) return 1.2;
        if ([12, 1].includes(m)) return 1.3;
        return 1.0;
    })();
    const weekendBoost = isWeekend ? 1.18 : 1.0;
    const baseByCurrency = { TRY: 4500, EUR: 95, USD: 105 };
    const base = (baseByCurrency[currency] || 4500) * seasonBoost * weekendBoost;

    return hotels.map((h) => {
        const rng = seededRandom(`${h.name}|${checkIn}|${checkOut}|${currency}`);
        const hotelMultiplier = 0.78 + rng() * 0.55;
        const hotelBase = Math.round(base * hotelMultiplier);
        const prices = {};
        let available = 0;
        OTAS.forEach((ota) => {
            const r = seededRandom(`${h.name}|${ota.key}|${checkIn}`)();
            const unavailableChance = ota.market === "domestic" ? 0.08 : 0.12;
            if (r <= unavailableChance) {
                prices[ota.key] = null;
                return;
            }
            const parityShift = -0.04 + r * 0.08;
            prices[ota.key] = Math.round(hotelBase * ota.bias * (1 + parityShift));
            available += 1;
        });
        return { name: h.name, isOwn: h.isOwn, prices, available };
    });
}

/**
 * Booking.com canlı fiyat çekici (ileride doldurulacak).
 *
 * Üretim için iki seçenek:
 *   A) Booking Affiliate Partner Program (ücretsiz, partner onayı gerekir)
 *      → https://partner.booking.com/
 *      → JSON API, captcha yok, resmi yol.
 *
 *   B) Headless Chromium + @sparticuz/chromium (ücretsiz ama 10s timeout)
 *      → npm i @sparticuz/chromium puppeteer-core
 *      → Booking arama sayfasını yükler, fiyatları DOM'dan çıkarır.
 *      → Captcha riski var, residential proxy gerekir.
 *
 *   C) ScraperAPI / Bright Data (paralı, en güvenilir)
 *      → ~$30/ay, residential IP, captcha solver dahil.
 */
async function fetchLivePrices(_payload) {
    // TODO: implement live scraping. Şu an demo döner.
    return null;
}

const ALLOWED_ORIGINS = [
    "https://msonlinegroup.com",
    "https://www.msonlinegroup.com",
    "http://localhost:3000",
];

export default async function handler(req, res) {
    const origin = req.headers.origin || "";
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const payload = req.body || {};
        const {
            ownHotel,
            competitors = [],
            checkIn,
            checkOut,
            currency = "TRY",
        } = payload;

        if (!ownHotel || !checkIn || !checkOut || competitors.length === 0) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        let source = "demo";
        let results = await fetchLivePrices(payload);
        if (results && Array.isArray(results)) {
            source = "live";
        } else {
            results = generateDemo({
                ownHotel,
                competitors,
                checkIn,
                checkOut,
                currency,
            });
        }

        return res.status(200).json({
            source,
            ts: new Date().toISOString(),
            results,
        });
    } catch (err) {
        return res.status(500).json({
            error: "Internal error",
            message: err && err.message ? err.message : String(err),
        });
    }
}
