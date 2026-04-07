import { SharedArray } from "k6/data";

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });
}

export const users = new SharedArray("users.csv", () => {
  const raw = open("../data/users.csv");
  return parseCsv(raw);
});

export const services = new SharedArray("services.json", () => {
  const raw = open("../data/services.json");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("k6/data/services.json must be a JSON array.");
  }
  return parsed;
});

export const products = new SharedArray("products.json", () => {
  const raw = open("../data/products.json");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("k6/data/products.json must be a JSON array.");
  }
  return parsed;
});

export function pickServiceSeed() {
  if (!services.length) {
    return null;
  }
  const index = (__VU + __ITER) % services.length;
  return services[index];
}

function normalizeSeedSessionIds(seed) {
  if (!seed) {
    return [];
  }

  if (Array.isArray(seed.sessionIds)) {
    return seed.sessionIds
      .map((value) => String(value || "").trim())
      .filter((value) => value.length > 0);
  }

  if (seed.sessionId) {
    const single = String(seed.sessionId).trim();
    return single ? [single] : [];
  }

  return [];
}

function normalizeIndex(value, size) {
  if (size <= 0) {
    return 0;
  }
  return ((value % size) + size) % size;
}

function normalizeSelectionOptions(optionsOrOffset) {
  if (typeof optionsOrOffset === "number") {
    return {
      offset: Number(optionsOrOffset || 0),
      iterStride: 1,
      vuStride: 1,
    };
  }

  const options = optionsOrOffset || {};
  return {
    offset: Number(options.offset || 0),
    iterStride: Number(options.iterStride || 1),
    vuStride: Number(options.vuStride || 1),
  };
}

export function pickSeedSessionId(seed, optionsOrOffset = 0) {
  const sessionIds = normalizeSeedSessionIds(seed);
  if (!sessionIds.length) {
    return "";
  }

  const options = normalizeSelectionOptions(optionsOrOffset);
  const vuBase = Math.max(0, Number(__VU) - 1);
  const iterBase = Math.max(0, Number(__ITER));
  const rawIndex = options.offset + vuBase * options.vuStride + iterBase * options.iterStride;
  const index = normalizeIndex(rawIndex, sessionIds.length);
  return sessionIds[index];
}

export function pickProductSeed() {
  if (!products.length) {
    return null;
  }
  const index = (__VU + __ITER) % products.length;
  return products[index];
}

function normalizeCohort(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function getUsersByCohort(cohort) {
  const normalized = normalizeCohort(cohort);
  if (!normalized) {
    throw new Error("Cohort name is required.");
  }

  const pool = users.filter((user) => normalizeCohort(user.cohort) === normalized);
  if (pool.length === 0) {
    throw new Error(
      `No users found for cohort='${normalized}' in k6/data/users.csv. Seed or provide cohort-tagged users before load run.`,
    );
  }
  return pool;
}

export function pickUserByCohort(cohort) {
  const pool = getUsersByCohort(cohort);
  const index = (__VU + __ITER) % pool.length;
  return pool[index];
}

export function pickUserByCohortDeterministic(cohort, optionsOrOffset = 0) {
  const pool = getUsersByCohort(cohort);
  const options = normalizeSelectionOptions(optionsOrOffset);
  const vuBase = Math.max(0, Number(__VU) - 1);
  const iterBase = Math.max(0, Number(__ITER));
  const rawIndex = options.offset + vuBase * options.vuStride + iterBase * options.iterStride;
  const index = normalizeIndex(rawIndex, pool.length);
  return pool[index];
}

export function pickUniqueUserByCohortForVu(cohort) {
  const pool = getUsersByCohort(cohort);
  const index = Math.max(0, Number(__VU) - 1);
  if (index >= pool.length) {
    return null;
  }
  return pool[index];
}
