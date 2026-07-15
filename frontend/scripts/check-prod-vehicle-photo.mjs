import https from "https";

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "cache-control": "no-cache", pragma: "no-cache" } }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body,
            location: res.headers.location,
          })
        );
      })
      .on("error", reject);
  });
}

const base = "https://grx-management.vercel.app";
const home = await get(base);
const html = home.body;
const buildId =
  html.match(/\/_next\/static\/([A-Za-z0-9_-]{8,})\//)?.[1] ??
  html.match(/"buildId":"([^"]+)"/)?.[1] ??
  null;
console.log("Home status:", home.status);
console.log("Build ID:", buildId);

const needles = ["Foto do veículo", "foto-veiculo-", "Enviar foto", "company-attachments"];

if (buildId) {
  const manifest = await get(`${base}/_next/static/${buildId}/_buildManifest.js`);
  console.log("Manifest:", manifest.status);
  const matches = [...manifest.body.matchAll(/cadastros\/veiculos[^"]+/g)].map((m) => m[0]);
  console.log("Manifest veiculos refs:", [...new Set(matches)].slice(0, 20));

  const pageFiles = [...manifest.body.matchAll(/static\/chunks\/[^"]*veiculos[^"]+\.js/g)].map(
    (m) => m[0]
  );
  const alt = [...manifest.body.matchAll(/page-[a-f0-9]+\.js/g)]
    .map((m) => m[0])
    .filter((p, i, a) => a.indexOf(p) === i)
    .slice(0, 80);

  for (const rel of pageFiles) {
    const url = `${base}/_next/${rel.replace(/^static\//, "static/")}`;
    const res = await get(url.startsWith("http") ? url : `${base}/_next/${rel}`);
    const found = needles.filter((n) => res.body.includes(n));
    console.log("chunk", rel, res.status, found);
  }

  // scan all app page chunks for string
  let hits = 0;
  for (const file of alt) {
    const candidates = [
      `${base}/_next/static/chunks/app/(app)/cadastros/veiculos/${file}`,
      `${base}/_next/static/chunks/app/cadastros/veiculos/${file}`,
    ];
    for (const url of candidates) {
      const res = await get(url);
      if (res.status !== 200) continue;
      const found = needles.filter((n) => res.body.includes(n));
      if (found.length) {
        console.log("HIT", url, found);
        hits += 1;
      }
    }
  }
  console.log("Hits on veiculos page chunks:", hits);
}

// vercel deployment list via public headers
const deploy = await get(`${base}/cadastros/veiculos`);
console.log("veiculos route:", deploy.status, deploy.location || "");
