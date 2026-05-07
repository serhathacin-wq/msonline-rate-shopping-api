/**
 * Vercel Serverless Function — Msonline Kontrol (Rate Shopping)
 *
 * POST /api/rate-shopping
 *
 * Body: { ownHotel, city, competitors[], checkIn, checkOut, currency, adults }
 * Response: { source: "live" | "demo" | "mixed", liveRatio, ts, results[] }
 *
 * NOT: Tüm 12 OTA için canlı scraping ileride eklenecek. Şu an "Demo Mode" —
 * deterministik (aynı input → aynı output) sahte fiyatlar döner.
 * Hiçbir veri saklanmaz, cache yok.
 */

const OTAS_META = [
    { key: "jolly",        market: "domestic",      bias: 0.97 },
    { key: "ets",          market: "domestic",      bias: 0.96 },
    { key: "tatilbudur",   market: "domestic",      bias: 0.98 },
    { key: "tatilsepeti",  market: "domestic",      bias: 0.99 },
    { key: "otelfiyat",    market: "domestic",      bias: 0.95 },
    { key: "enuygun",      market: "domestic",      bias: 0.97 },
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

function demoBaseFor({ name, checkIn, currency }) {
    const isWeekend = (() => {
        const d = new Date(checkIn).getDay();
        return d === 5 || d === 6 || d === 0;
    })();
    const m = new Date(checkIn).getMonth() + 1;
    const seasonBoost = [6, 7, 8].includes(m) ? 1.6 :
        [4, 5, 9, 10].includes(m) ? 1.2 :
        [12, 1].includes(m) ? 1.3 : 1.0;
    const weekendBoost = isWeekend ? 1.18 : 1.0;
    const baseByCurrency = { TRY: 4500, EUR: 95, USD: 105 };
    const base = (baseByCurrency[currency] || 4500) * seasonBoost * weekendBoost;
    const rng = seededRandom(`${name}|${checkIn}|${currency}`);
    const mult = 0.78 + rng() * 0.55;
    return Math.round(base * mult);
}

function demoOtaPrice({ name, otaKey, checkIn, hotelBase, ota }) {
    const rng = seededRandom(`${name}|${otaKey}|${checkIn}`);
    const r = rng();
    const unavailableChance = ota.market === "domestic" ? 0.08 : 0.12;
    if (r <= unavailableChance) return null;
    const parityShift = -0.04 + r * 0.08;
    return Math.round(hotelBase * ota.bias * (1 + parityShift));
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

    // Healthcheck (GET): tarayıcıdan açıldığında "alive" gözüksün
    if (req.method === "GET") {
        return res.status(200).json({
            ok: true,
            service: "msonline-rate-shopping",
            mode: "demo",
            otas: OTAS_META.map((o) => o.key),
            ts: new Date().toISOString(),
        });
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const {
            ownHotel,
            competitors = [],
            checkIn,
            checkOut,
            currency = "TRY",
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

        const results = hotels.map((h) => {
            const hotelBase = demoBaseFor({
                name: h.name,
                checkIn,
                currency,
            });
            const prices = {};
            let available = 0;

            OTAS_META.forEach((ota) => {
                const demoVal = demoOtaPrice({
                    name: h.name,
                    otaKey: ota.key,
                    checkIn,
                    hotelBase,
                    ota,
                });
                prices[ota.key] = demoVal;
                if (demoVal !== null) available += 1;
            });

            return { name: h.name, isOwn: h.isOwn, prices, available };
        });

        return res.status(200).json({
            source: "demo",
            liveRatio: 0,
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
