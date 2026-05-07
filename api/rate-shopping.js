/**
 * Vercel Serverless — Msonline Kontrol (Rate Shopping)
 * POST /api/rate-shopping
 *
 * Body: { ownHotel, city, competitors[], checkIn, checkOut, currency, adults }
 * Response: { source, liveRatio, ts, results[{ name, isOwn, prices, links, available }] }
 *
 * Strateji: ScraperAPI (env: SCRAPERAPI_KEY) üzerinden 12 OTA'da otel arar.
 * Bulduğu fiyatı çıkarır; bulamadığı OTA için frontend "Site'de Aç →" linki gösterir.
 */

const OTAS_META = [
    { key: "jolly",        market: "domestic",      country: "tr" },
    { key: "ets",          market: "domestic",      country: "tr" },
    { key: "tatilbudur",   market: "domestic",      country: "tr" },
    { key: "tatilsepeti",  market: "domestic",      country: "tr" },
    { key: "otelfiyat",    market: "domestic",      country: "tr" },
    { key: "enuygun",      market: "domestic",      country: "tr" },
    { key: "booking",      market: "international", country: "tr" },
    { key: "expedia",      market: "international", country: "tr" },
    { key: "agoda",        market: "international", country: "tr" },
    { key: "helalbooking", market: "international", country: "tr" },
    { key: "trip",         market: "international", country: "tr" },
    { key: "hotels",       market: "international", country: "tr" },
];
const OTA_KEYS = OTAS_META.map((o) => o.key);

/** Build the public-facing search URL for each OTA — used by frontend "Site'de Aç" links. */
function buildSearchUrl(otaKey, args) {
    const { hotelName, city, checkIn, checkOut, adults } = args;
    const q = encodeURIComponent(hotelName);
    const ciDot = checkIn.split("-").reverse().join(".");
    const coDot = checkOut.split("-").reverse().join(".");
    const ciCompact = checkIn.replace(/-/g, "");
    const coCompact = checkOut.replace(/-/g, "");

    switch (otaKey) {
        case "jolly":
            return `https://www.jollytur.com/oteller?aramaMetni=${q}&girisTarihi=${checkIn}&cikisTarihi=${checkOut}&yetiskin=${adults}`;
        case "ets":
            return `https://www.etstur.com/Otel-Arama?bolgeAdi=${q}&checkInDate=${ciDot}&checkOutDate=${coDot}&adults=${adults}`;
        case "tatilbudur":
            return `https://www.tatilbudur.com/oteller?keyword=${q}&checkin=${checkIn}&checkout=${checkOut}&adult=${adults}`;
        case "tatilsepeti":
            return `https://www.tatilsepeti.com/otel-ara?aramaMetni=${q}&girisTarihi=${checkIn}&cikisTarihi=${checkOut}&yetiskinSayisi=${adults}`;
        case "otelfiyat":
            return `https://www.otelfiyat.com/oteller?q=${q}&giris=${checkIn}&cikis=${checkOut}&yetiskin=${adults}`;
        case "enuygun":
            return `https://www.enuygun.com/otel/arama/?aramaMetni=${q}&girisTarihi=${checkIn}&cikisTarihi=${checkOut}&yetiskinSayisi=${adults}`;
        case "booking":
            return `https://www.booking.com/searchresults.html?ss=${q}&checkin=${checkIn}&checkout=${checkOut}&group_adults=${adults}&no_rooms=1&selected_currency=TRY`;
        case "expedia":
            return `https://www.expedia.com/Hotel-Search?destination=${encodeURIComponent(hotelName || city)}&startDate=${checkIn}&endDate=${checkOut}&adults=${adults}`;
        case "agoda":
            return `https://www.agoda.com/search?q=${q}&checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&rooms=1`;
        case "helalbooking":
            return `https://www.helalbooking.com/tr/oteller?aramaMetni=${q}`;
        case "trip":
            return `https://tr.trip.com/hotels/list?keyword=${q}&checkin=${ciCompact}&checkout=${coCompact}`;
        case "hotels":
            return `https://tr.hotels.com/Hotel-Search?destination=${q}&startDate=${checkIn}&endDate=${checkOut}&adults=${adults}`;
        default:
            return null;
    }
}

/** Some OTAs need JS rendering — costs more credits but is the only way. */
const RENDER_REQUIRED = new Set(["booking", "agoda", "tatilbudur", "enuygun", "trivago", "trip"]);

async function fetchViaScraperAPI(targetUrl, { render = false, country = "tr", timeoutMs = 60000 } = {}) {
    const KEY = process.env.SCRAPERAPI_KEY;
    if (!KEY) return null;

    const params = new URLSearchParams({
        api_key: KEY,
        url: targetUrl,
        country_code: country,
    });
    if (render) params.set("render", "true");

    const proxyUrl = `https://api.scraperapi.com/?${params.toString()}`;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const r = await fetch(proxyUrl, { method: "GET", signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) return null;
        const html = await r.text();
        return html;
    } catch {
        return null;
    }
}

/* ─────────────────────── Per-OTA HTML → Price extractors ─────────────────────── */

function parseAmount(text) {
    if (!text) return null;
    const stripped = String(text).replace(/[^\d]/g, "");
    if (!stripped) return null;
    const n = parseInt(stripped, 10);
    return Number.isFinite(n) && n >= 100 && n < 10000000 ? n : null;
}

const EXTRACTORS = {
    booking(html) {
        // <... data-testid="price-and-discounted-price" ...>TL&nbsp;4,414</...>
        const m = html.match(/data-testid="price-and-discounted-price"[^>]*>[^<]*?TL[\s\u00A0]*([\d.,]+)/i);
        return m ? parseAmount(m[1]) : null;
    },
    tatilbudur(html) {
        // "37.500 TL" → en küçük plausible (en düşük fiyat)
        const matches = [...html.matchAll(/([\d][\d.,]{2,8})\s*TL/g)]
            .map((m) => parseAmount(m[1]))
            .filter((n) => n && n >= 500 && n < 5000000);
        return matches.length ? Math.min(...matches) : null;
    },
    tatilsepeti(html) {
        const matches = [...html.matchAll(/([\d][\d.,]{2,8})\s*TL/g)]
            .map((m) => parseAmount(m[1]))
            .filter((n) => n && n >= 500 && n < 5000000);
        return matches.length ? Math.min(...matches) : null;
    },
    enuygun(html) {
        // JSON-LD lowPrice / "price" in JSON
        const ld = html.match(/"price"\s*:\s*"?(\d[\d.,]{2,8})"?/);
        if (ld) {
            const n = parseAmount(ld[1]);
            if (n) return n;
        }
        const matches = [...html.matchAll(/([\d][\d.,]{2,8})\s*TL/g)]
            .map((m) => parseAmount(m[1]))
            .filter((n) => n && n >= 500 && n < 5000000);
        return matches.length ? Math.min(...matches) : null;
    },
    jolly(html) {
        const ld = html.match(/"price"\s*:\s*"?(\d[\d.,]{2,8})"?/);
        if (ld) {
            const n = parseAmount(ld[1]);
            if (n) return n;
        }
        const matches = [...html.matchAll(/([\d][\d.,]{2,8})\s*TL/g)]
            .map((m) => parseAmount(m[1]))
            .filter((n) => n && n >= 500 && n < 5000000);
        return matches.length ? Math.min(...matches) : null;
    },
    /* Aşağıdakiler şu an boş HTML/JS-only döndüğü için null verir → frontend link gösterir */
    ets() { return null; },
    otelfiyat() { return null; },
    helalbooking() { return null; },
    expedia() { return null; },
    agoda() { return null; },
    trip() { return null; },
    hotels() { return null; },
};

async function fetchPriceFor(otaKey, args) {
    const url = buildSearchUrl(otaKey, args);
    if (!url) return null;
    const render = RENDER_REQUIRED.has(otaKey);
    const html = await fetchViaScraperAPI(url, { render, timeoutMs: render ? 70000 : 25000 });
    if (!html) return null;
    const fn = EXTRACTORS[otaKey];
    if (!fn) return null;
    try {
        return fn(html);
    } catch {
        return null;
    }
}

async function fetchHotelPrices(args) {
    const tasks = OTA_KEYS.map(async (key) => {
        const price = await fetchPriceFor(key, args);
        const url = buildSearchUrl(key, args);
        return [key, { price, url }];
    });
    const settled = await Promise.all(tasks);
    return Object.fromEntries(settled);
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
    } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(204).end();

    if (req.method === "GET") {
        return res.status(200).json({
            ok: true,
            service: "msonline-rate-shopping",
            mode: process.env.SCRAPERAPI_KEY ? "live" : "demo",
            otas: OTA_KEYS,
            ts: new Date().toISOString(),
        });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const {
            ownHotel,
            city = "",
            competitors = [],
            checkIn,
            checkOut,
            currency = "TRY",
            adults = 2,
        } = body;

        if (!ownHotel || !checkIn || !checkOut || competitors.length === 0) {
            return res.status(400).json({
                error: "Missing required fields",
                required: ["ownHotel", "competitors[]", "checkIn", "checkOut"],
            });
        }

        const hotels = [
            { name: ownHotel, isOwn: true },
            ...competitors.map((n) => ({ name: n, isOwn: false })),
        ];

        const livePerHotel = await Promise.all(
            hotels.map((h) => fetchHotelPrices({
                hotelName: h.name, city, checkIn, checkOut, adults, currency,
            })),
        );

        let totalLive = 0, totalCells = 0;

        const results = hotels.map((h, i) => {
            const live = livePerHotel[i];
            const prices = {};
            const links = {};
            let available = 0;
            OTA_KEYS.forEach((key) => {
                totalCells += 1;
                const cell = live[key];
                prices[key] = cell.price;
                links[key] = cell.url;
                if (typeof cell.price === "number" && cell.price > 0) {
                    available += 1;
                    totalLive += 1;
                }
            });
            return { name: h.name, isOwn: h.isOwn, prices, links, available };
        });

        const liveRatio = totalLive / Math.max(1, totalCells);
        const source = liveRatio === 0 ? "demo" : liveRatio >= 0.95 ? "live" : "mixed";

        return res.status(200).json({
            source,
            liveRatio: Math.round(liveRatio * 100),
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
