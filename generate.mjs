#!/usr/bin/env node
// Generates dark.svg / light.svg: an animated jet flying across the
// GitHub contribution heatmap, strafing the busiest contribution days.

const GH_USERNAME = process.env.GH_USERNAME;
const GH_TOKEN = process.env.GH_TOKEN;

if (!GH_USERNAME || !GH_TOKEN) {
  console.error("Missing GH_USERNAME or GH_TOKEN environment variables.");
  process.exit(1);
}

const QUERY = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

async function fetchContributions() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${GH_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "github-jet-heatmap",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: GH_USERNAME } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  return json.data.user.contributionsCollection.contributionCalendar.weeks;
}

function levelFor(count, thresholds) {
  if (count === 0) return 0;
  if (count <= thresholds[0]) return 1;
  if (count <= thresholds[1]) return 2;
  if (count <= thresholds[2]) return 3;
  return 4;
}

function computeThresholds(weeks) {
  const counts = weeks
    .flatMap((w) => w.contributionDays.map((d) => d.contributionCount))
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  if (counts.length === 0) return [1, 2, 3];
  const q = (p) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))];
  return [q(0.25), q(0.5), q(0.75)];
}

function buildSvg(weeks, theme) {
  const CELL = 11;
  const GAP = 3;
  const MARGIN_X = 24;
  const MARGIN_Y = 34;
  const ROWS = 7;
  const DUR = 20; // seconds per loop

  const cols = weeks.length;
  const gridW = cols * (CELL + GAP) - GAP;
  const gridH = ROWS * (CELL + GAP) - GAP;
  const width = MARGIN_X * 2 + gridW;
  const height = MARGIN_Y * 2 + gridH;
  const midY = MARGIN_Y + gridH / 2;

  const palette =
    theme === "dark"
      ? {
          bg: "#0D1117",
          empty: "#161B22",
          levels: ["#0E4429", "#006D32", "#26A641", "#39D353"],
          star: "#30363D",
          jetBody: "#C9D1D9",
          jetTrim: "#58A6FF",
          flash: "#58A6FF",
          flashRing: "#0A66C2",
        }
      : {
          bg: "#FFFFFF",
          empty: "#EBEDF0",
          levels: ["#9BE9A8", "#40C463", "#30A14E", "#216E39"],
          star: "#F0F2F5",
          jetBody: "#24292F",
          jetTrim: "#0A66C2",
          flash: "#0A66C2",
          flashRing: "#58A6FF",
        };

  const thresholds = computeThresholds(weeks);

  // Flatten to (col,row,count) cells.
  const cells = [];
  weeks.forEach((week, col) => {
    week.contributionDays.forEach((day, row) => {
      cells.push({ col, row, count: day.contributionCount });
    });
  });

  // Pick the busiest days to strafe.
  const topDays = [...cells]
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const cellRects = cells
    .map((c) => {
      const level = levelFor(c.count, thresholds);
      const fill = level === 0 ? palette.empty : palette.levels[level - 1];
      const x = MARGIN_X + c.col * (CELL + GAP);
      const y = MARGIN_Y + c.row * (CELL + GAP);
      return `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" ry="2" fill="${fill}"/>`;
    })
    .join("\n    ");

  const stars = Array.from({ length: 40 }, (_, i) => {
    const x = ((i * 53) % width).toFixed(1);
    const y = ((i * 97) % height).toFixed(1);
    const r = (0.6 + ((i * 7) % 5) * 0.15).toFixed(2);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${palette.star}"/>`;
  }).join("\n    ");

  const flashes = topDays
    .map((c) => {
      const x = MARGIN_X + c.col * (CELL + GAP) + CELL / 2;
      const y = MARGIN_Y + c.row * (CELL + GAP) + CELL / 2;
      const frac = (c.col * (CELL + GAP)) / gridW;
      const f0 = Math.max(0, frac - 0.012).toFixed(4);
      const f1 = frac.toFixed(4);
      const f2 = Math.min(1, frac + 0.012).toFixed(4);
      return `<circle cx="${x}" cy="${y}" r="${CELL * 0.85}" fill="${palette.flash}" opacity="0">
      <animate attributeName="opacity" values="0;0;0.9;0;0" keyTimes="0;${f0};${f1};${f2};1" dur="${DUR}s" repeatCount="indefinite"/>
      <animate attributeName="r" values="${CELL * 0.5};${CELL * 0.5};${CELL * 1.1};${CELL * 0.5};${CELL * 0.5}" keyTimes="0;${f0};${f1};${f2};1" dur="${DUR}s" repeatCount="indefinite"/>
    </circle>
    <circle cx="${x}" cy="${y}" r="${CELL * 1.6}" stroke="${palette.flashRing}" stroke-width="1.2" fill="none" opacity="0">
      <animate attributeName="opacity" values="0;0;0.7;0;0" keyTimes="0;${f0};${f1};${f2};1" dur="${DUR}s" repeatCount="indefinite"/>
    </circle>`;
    })
    .join("\n    ");

  const motionPath = `M ${MARGIN_X - 16} ${midY - 10} Q ${MARGIN_X + gridW * 0.25} ${midY - 24}, ${MARGIN_X + gridW * 0.5} ${midY} T ${MARGIN_X + gridW + 16} ${midY + 8}`;

  const jet = `<g>
    <path d="M -8,0 L 6,-3 L 12,0 L 6,3 Z M -8,0 L -3,-6 L 0,-4 L -3,0 Z M -8,0 L -3,6 L 0,4 L -3,0 Z" fill="${palette.jetBody}" stroke="${palette.jetTrim}" stroke-width="0.6"/>
    <path d="M -8,0 L -22,-1.5 L -22,1.5 Z" fill="${palette.jetTrim}" opacity="0.85">
      <animate attributeName="opacity" values="0.85;0.3;0.85" dur="0.6s" repeatCount="indefinite"/>
    </path>
    <animateMotion dur="${DUR}s" repeatCount="indefinite" rotate="auto" path="${motionPath}"/>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${palette.bg}" rx="6"/>
  <g>
    ${stars}
  </g>
  <g>
    ${cellRects}
  </g>
  <g>
    ${flashes}
  </g>
  ${jet}
</svg>
`;
}

const weeks = await fetchContributions();
const fs = await import("node:fs/promises");
await fs.writeFile("dark.svg", buildSvg(weeks, "dark"));
await fs.writeFile("light.svg", buildSvg(weeks, "light"));
console.log(`Generated dark.svg and light.svg for ${GH_USERNAME} (${weeks.length} weeks).`);
